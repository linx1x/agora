import { createHash, randomBytes } from 'node:crypto';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import {
  CreateInviteSchema,
  CreateSpaceSchema,
  DisplayNameSchema,
  MAX_OWNED_SPACES,
  SlugSchema,
  SpaceSettingsSchema,
  can,
  inviteState,
  roleAtLeast,
  strongerRole,
  type InvitePreview,
  type InviteSummary,
} from '@agora/shared';
import type { Config } from '../config';
import type { Store, StoredInvite, StoredSpace } from '../db/store';
import type { Actor, SpaceManager } from '../spaces/manager';
import type { Auth } from './sessions';

interface Deps {
  cfg: Config;
  store: Store;
  spaces: SpaceManager;
  actorOf: (a: Auth) => Actor;
}

export const hashToken = (t: string) => createHash('sha256').update(t).digest('base64url');

const inviteSummary = (i: StoredInvite): InviteSummary => ({
  id: i.id,
  role: i.role,
  label: i.label,
  expiresAt: i.expiresAt,
  maxUses: i.maxUses,
  uses: i.uses,
  createdAt: i.createdAt,
  active: inviteState(i).valid,
});

/**
 * Spaces (P2.3) and invite links (P2.4). Every route re-checks the caller's role in the
 * space on the server; the client only hides what would be refused.
 */
export function registerSpaceRoutes(app: FastifyInstance, d: Deps) {
  const { cfg, store, spaces } = d;
  const enabled = () => cfg.flags.spaces !== false;

  /** Signed-in actor or a 401 reply. */
  const auth = (req: FastifyRequest, reply: FastifyReply) => {
    const s = req.auth;
    if (!s) {
      void reply.code(401).send({ error: 'unauthenticated' });
      return null;
    }
    return { account: s.account, actor: d.actorOf(s) };
  };

  /** Resolve :slug and the caller's role; replies 404/403 itself. */
  const load = async (
    req: FastifyRequest<{ Params: { slug: string } }>,
    reply: FastifyReply,
    need: 'enter' | 'settings' | 'invite',
  ) => {
    const who = auth(req, reply);
    if (!who) return null;
    const slug = SlugSchema.safeParse(req.params.slug);
    const space = slug.success ? await spaces.get(slug.data) : null;
    if (!space) {
      void reply.code(404).send({ error: 'space_not_found' });
      return null;
    }
    const role = await spaces.roleOf(space, who.actor);
    if (!(await spaces.allowed(space, who.actor, need))) {
      void reply.code(403).send({ error: need === 'enter' ? 'space_forbidden' : 'forbidden' });
      return null;
    }
    return { ...who, space, role };
  };

  /** Passkey mode: the owner only (ADR-032). Pilot modes: SPACE_CREATION as before. */
  const canCreate = (a: Actor) =>
    enabled() &&
    (can(a.role, 'space.create') ||
      (cfg.authMode !== 'passkey' && cfg.spaceCreation === 'everyone'));

  // ── Spaces
  app.get('/api/spaces', async (req, reply) => {
    const who = auth(req, reply);
    if (!who) return;
    const list = await spaces.list(who.actor);
    return {
      spaces: enabled() ? list : list.filter((s) => s.isDefault),
      canCreate: canCreate(who.actor),
    };
  });

  app.post('/api/spaces', async (req, reply) => {
    const who = auth(req, reply);
    if (!who) return;
    if (!canCreate(who.actor)) return reply.code(403).send({ error: 'forbidden' });
    const body = CreateSpaceSchema.safeParse(req.body);
    if (!body.success) return reply.code(400).send({ error: 'bad_request' });
    if (
      !can(who.actor.role, 'space.create') &&
      (await spaces.ownedCount(who.actor.uid)) >= MAX_OWNED_SPACES
    )
      return reply.code(409).send({ error: 'too_many_spaces' });
    const s = await spaces.create(who.actor.uid, body.data);
    if (!s) return reply.code(409).send({ error: 'slug_taken' });
    return reply.code(201).send(await spaces.detail(s, who.actor));
  });

  app.get<{ Params: { slug: string } }>('/api/spaces/:slug', async (req, reply) => {
    const ctx = await load(req, reply, 'enter');
    if (!ctx) return;
    return spaces.detail(ctx.space, ctx.actor);
  });

  app.patch<{ Params: { slug: string } }>('/api/spaces/:slug', async (req, reply) => {
    const ctx = await load(req, reply, 'settings');
    if (!ctx) return;
    const body = SpaceSettingsSchema.safeParse(req.body);
    if (!body.success) return reply.code(400).send({ error: 'bad_request' });
    const updated = await spaces.updateSettings(ctx.space, body.data);
    return spaces.detail(updated, ctx.actor);
  });

  app.get<{ Params: { slug: string } }>('/api/spaces/:slug/map', async (req, reply) => {
    const ctx = await load(req, reply, 'enter');
    if (!ctx) return;
    const room = await spaces.room(ctx.space);
    reply.type('application/json').header('Cache-Control', 'no-store');
    reply.header('X-Map-Rev', String(room.mapRev));
    return room.tmjJson();
  });

  /** My name in this space (null = my account name). */
  app.patch<{ Params: { slug: string } }>('/api/spaces/:slug/me', async (req, reply) => {
    const ctx = await load(req, reply, 'enter');
    if (!ctx) return;
    const body = DisplayNameSchema.safeParse(req.body);
    if (!body.success) return reply.code(400).send({ error: 'bad_request' });
    const displayName = body.data.displayName || null;
    const m = await store.getMember(ctx.space.id, ctx.actor.uid);
    await store.upsertMember({
      spaceId: ctx.space.id,
      uid: ctx.actor.uid,
      role: m?.role ?? (ctx.space.ownerUid === ctx.actor.uid ? 'owner' : 'member'),
      displayName,
    });
    const account = await store.getUser(ctx.actor.uid).catch(() => null);
    spaces
      .loadedRoom(ctx.space.id)
      ?.rename(ctx.actor.uid, displayName ?? account?.name ?? ctx.account.name);
    return spaces.detail(ctx.space, ctx.actor);
  });

  // ── Invites
  app.get<{ Params: { slug: string } }>('/api/spaces/:slug/invites', async (req, reply) => {
    const ctx = await load(req, reply, 'invite');
    if (!ctx) return;
    return { invites: (await store.listInvites(ctx.space.id)).map(inviteSummary) };
  });

  app.post<{ Params: { slug: string } }>('/api/spaces/:slug/invites', async (req, reply) => {
    if (!enabled()) return reply.code(403).send({ error: 'forbidden' });
    const ctx = await load(req, reply, 'invite');
    if (!ctx) return;
    const body = CreateInviteSchema.safeParse(req.body ?? {});
    if (!body.success) return reply.code(400).send({ error: 'bad_request' });
    // Nobody hands out a role stronger than their own.
    if (!roleAtLeast(ctx.role, body.data.role)) return reply.code(403).send({ error: 'forbidden' });
    const token = randomBytes(18).toString('base64url');
    const now = Date.now();
    const inv: StoredInvite = {
      id: randomBytes(6).toString('base64url'),
      spaceId: ctx.space.id,
      tokenHash: hashToken(token),
      role: body.data.role,
      label: body.data.label,
      expiresAt:
        body.data.expiresInHours === null ? null : now + body.data.expiresInHours * 3600_000,
      maxUses: body.data.maxUses,
      uses: 0,
      createdBy: ctx.actor.uid,
      createdAt: now,
      revokedAt: null,
    };
    await store.createInvite(inv);
    // The token is only ever shown here; the server keeps its hash.
    return reply.code(201).send({ invite: inviteSummary(inv), token, path: `/join/${token}` });
  });

  app.delete<{ Params: { slug: string; id: string } }>(
    '/api/spaces/:slug/invites/:id',
    async (req, reply) => {
      const ctx = await load(req, reply, 'invite');
      if (!ctx) return;
      const ok = await store.revokeInvite(ctx.space.id, String(req.params.id).slice(0, 64));
      if (!ok) return reply.code(404).send({ error: 'not_found' });
      return { ok: true };
    },
  );

  /** Look up a token: invite + its space, and whether it can be used now. */
  const lookup = async (
    token: string,
  ): Promise<{ inv: StoredInvite; space: StoredSpace; preview: InvitePreview } | null> => {
    if (!token || token.length > 200) return null;
    const inv = await store.getInviteByHash(hashToken(token));
    if (!inv) return null;
    const space = (await store.listSpaces()).find((s) => s.id === inv.spaceId);
    if (!space || space.archivedAt) return null;
    const st = inviteState(inv);
    return {
      inv,
      space,
      preview: {
        spaceName: space.name,
        slug: space.slug,
        role: inv.role,
        valid: st.valid,
        reason: st.valid ? undefined : st.reason,
      },
    };
  };

  const previewTries = new Map<string, { n: number; at: number }>();
  /** Public: what an invite link leads to (shown before sign-in). */
  app.get<{ Params: { token: string } }>('/api/invites/:token', async (req, reply) => {
    const t = previewTries.get(req.ip) ?? { n: 0, at: Date.now() };
    if (Date.now() - t.at > 60_000) Object.assign(t, { n: 0, at: Date.now() });
    if (++t.n > 30) return reply.code(429).send({ error: 'rate_limited' });
    previewTries.set(req.ip, t);
    if (!enabled()) return reply.code(404).send({ valid: false, reason: 'not_found' });
    const found = await lookup(req.params.token);
    if (!found) return reply.code(404).send({ valid: false, reason: 'not_found' });
    return found.preview;
  });

  /** Signed in: join the space with the invite's role (never a downgrade). */
  app.post<{ Params: { token: string } }>('/api/invites/:token/accept', async (req, reply) => {
    const who = auth(req, reply);
    if (!who) return;
    if (!enabled()) return reply.code(404).send({ error: 'not_found' });
    const found = await lookup(req.params.token);
    if (!found) return reply.code(404).send({ error: 'not_found' });
    const { inv, space } = found;
    const current = await spaces.roleOf(space, who.actor);
    const member = await store.getMember(space.id, who.actor.uid);
    // Already as strong as the invite: nothing to do, and the use is not counted.
    if (member && roleAtLeast(current, inv.role)) return { slug: space.slug, role: current };
    if (!(await store.consumeInvite(inv.id)))
      return reply.code(410).send({ error: found.preview.reason ?? 'expired' });
    const role = strongerRole(member?.role, inv.role);
    await store.upsertMember({
      spaceId: space.id,
      uid: who.actor.uid,
      role,
      displayName: member?.displayName ?? null,
    });
    app.log.info({ space: space.slug, uid: who.actor.uid, role }, 'invite accepted');
    return { slug: space.slug, role };
  });

  return {
    /** For login: an invite token can replace the access code. */
    preview: async (token: string) => (await lookup(token))?.preview ?? null,
  };
}
