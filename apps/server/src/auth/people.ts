import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import {
  CreateAccountInviteSchema,
  RECOVERY_HOURS,
  RecoverySchema,
  UpdatePersonSchema,
  can,
  type CreatedLink,
  type PersonSummary,
  type PlatformAction,
  type SessionSummary,
} from '@agora/shared';
import type { Config } from '../config';
import type { Store, StoredAccount } from '../db/store';
import type { Auth, Sessions } from '../http/sessions';
import type { Actor, SpaceManager } from '../spaces/manager';
import { issueTicket, ticketSummary } from './tickets';

interface Deps {
  cfg: Config;
  store: Store;
  sessions: Sessions;
  spaces: SpaceManager;
  actorOf: (a: Auth) => Actor;
  log: { info: (o: object, m?: string) => void };
}

/**
 * The owner's People page (PLAN P2.15, P2.16): invites, members, roles, spaces, sessions,
 * recovery links, removal. Every route checks the permission matrix; nobody here can
 * create, demote, rename, recover or remove the owner.
 */
export function registerPeopleRoutes(app: FastifyInstance, d: Deps) {
  const { cfg, store, sessions, spaces } = d;
  const on = cfg.authMode === 'passkey';

  const guard = (req: FastifyRequest, reply: FastifyReply, action: PlatformAction) => {
    if (!on) {
      void reply.code(404).send({ error: 'not_found' });
      return null;
    }
    if (!req.auth) {
      void reply.code(401).send({ error: 'unauthenticated' });
      return null;
    }
    const actor = d.actorOf(req.auth);
    if (!can(actor.role, action)) {
      void reply.code(403).send({ error: 'forbidden' });
      return null;
    }
    return { actor, auth: req.auth };
  };

  /** Invite-only spaces that exist; ids from the client are filtered through this. */
  const inviteOnlySpaces = async () =>
    new Set(
      (await store.listSpaces())
        .filter((s) => !s.archivedAt && spaces.effective(s).access === 'invite')
        .map((s) => s.id),
    );

  /** A person the owner may manage (exists, is not the owner). */
  const managed = async (uid: string): Promise<StoredAccount | null> => {
    const a = await store.getAccount(String(uid).slice(0, 64));
    return a && a.role !== 'owner' ? a : null;
  };

  const person = async (a: StoredAccount, inviteOnly: Set<string>): Promise<PersonSummary> => {
    const [keys, sess, members] = await Promise.all([
      store.listPasskeys(a.uid),
      store.listSessions(a.uid),
      store.membershipsOf(a.uid),
    ]);
    return {
      uid: a.uid,
      name: a.name,
      invitedName: a.invitedName,
      role: a.role,
      spaces: members.filter((m) => inviteOnly.has(m.spaceId)).map((m) => m.spaceId),
      createdAt: a.createdAt,
      lastSeenAt: a.lastSeenAt,
      passkeys: keys.length,
      sessions: sess.filter((s) => s.expiresAt > Date.now()).length,
      disabled: !!a.disabledAt,
      pilot: keys.length === 0 && a.role !== 'owner',
    };
  };

  // ── People
  app.get('/api/admin/people', async (req, reply) => {
    if (!guard(req, reply, 'account.manage')) return;
    const inviteOnly = await inviteOnlySpaces();
    const all = await store.listAccounts();
    const people = await Promise.all(
      all.filter((a) => !a.disabledAt).map((a) => person(a, inviteOnly)),
    );
    return { people };
  });

  app.patch<{ Params: { uid: string } }>('/api/admin/people/:uid', async (req, reply) => {
    const g = guard(req, reply, 'account.manage');
    if (!g) return;
    const body = UpdatePersonSchema.safeParse(req.body);
    if (!body.success) return reply.code(400).send({ error: 'bad_request' });
    const a = await managed(req.params.uid);
    if (!a || a.disabledAt) return reply.code(404).send({ error: 'not_found' });
    if (body.data.role && body.data.role !== a.role) await store.setRole(a.uid, body.data.role);
    if (body.data.name && body.data.name !== a.name) {
      await store.rename(a.uid, body.data.name);
      for (const s of await store.listSpaces()) {
        const m = await store.getMember(s.id, a.uid);
        spaces.loadedRoom(s.id)?.rename(a.uid, m?.displayName || body.data.name);
      }
    }
    if (body.data.spaces) {
      const inviteOnly = await inviteOnlySpaces();
      const want = new Set(body.data.spaces.filter((s) => inviteOnly.has(s)));
      for (const m of await store.membershipsOf(a.uid))
        if (inviteOnly.has(m.spaceId) && !want.has(m.spaceId))
          await store.deleteMember(m.spaceId, a.uid);
      for (const id of want)
        if (!(await store.getMember(id, a.uid)))
          await store.upsertMember({ spaceId: id, uid: a.uid, role: 'member', displayName: null });
    }
    // reconnect with the new rights (role, spaces); the server decides again
    sessions.rightsChanged(a.uid);
    d.log.info({ by: g.actor.uid, uid: a.uid, change: Object.keys(body.data) }, 'person updated');
    return person((await store.getAccount(a.uid))!, await inviteOnlySpaces());
  });

  app.delete<{ Params: { uid: string } }>('/api/admin/people/:uid', async (req, reply) => {
    const g = guard(req, reply, 'account.remove');
    if (!g) return;
    const a = await managed(req.params.uid);
    if (!a || a.disabledAt) return reply.code(404).send({ error: 'not_found' });
    // Disabled, not deleted: their past chat keeps its author. They can never sign in again.
    await store.setDisabled(a.uid, Date.now());
    await store.deletePasskeysOf(a.uid);
    await store.revokeTickets('recovery', a.uid);
    for (const m of await store.membershipsOf(a.uid)) await store.deleteMember(m.spaceId, a.uid);
    for (const s of await store.listSpaces()) spaces.loadedRoom(s.id)?.releaseDeskOf(a.uid);
    await store.deleteDesksOf(a.uid);
    sessions.rightsChanged(a.uid);
    await sessions.revokeUser(a.uid, undefined, 'account_removed');
    d.log.info({ by: g.actor.uid, uid: a.uid }, 'account removed');
    return { ok: true };
  });

  // ── Their sessions
  app.get<{ Params: { uid: string } }>('/api/admin/people/:uid/sessions', async (req, reply) => {
    if (!guard(req, reply, 'session.manage_others')) return;
    const a = await managed(req.params.uid);
    if (!a) return reply.code(404).send({ error: 'not_found' });
    const list: SessionSummary[] = (await store.listSessions(a.uid))
      .filter((s) => s.expiresAt > Date.now())
      .map((s) => ({
        id: s.id,
        createdAt: s.createdAt,
        lastUsedAt: s.lastUsedAt,
        expiresAt: s.expiresAt,
        shared: s.shared,
        userAgent: s.userAgent,
        ip: s.ip,
        current: false,
      }));
    return { sessions: list };
  });

  app.delete<{ Params: { uid: string } }>('/api/admin/people/:uid/sessions', async (req, reply) => {
    const g = guard(req, reply, 'session.manage_others');
    if (!g) return;
    const a = await managed(req.params.uid);
    if (!a) return reply.code(404).send({ error: 'not_found' });
    const n = await sessions.revokeUser(a.uid, undefined, 'signed_out_by_owner');
    d.log.info({ by: g.actor.uid, uid: a.uid, n }, 'sessions ended by owner');
    return { ok: true, revoked: n };
  });

  app.delete<{ Params: { uid: string; id: string } }>(
    '/api/admin/people/:uid/sessions/:id',
    async (req, reply) => {
      if (!guard(req, reply, 'session.manage_others')) return;
      const a = await managed(req.params.uid);
      const id = String(req.params.id).slice(0, 64);
      if (!a || !(await store.listSessions(a.uid)).some((s) => s.id === id))
        return reply.code(404).send({ error: 'not_found' });
      await sessions.revoke(id, 'signed_out_by_owner');
      return { ok: true };
    },
  );

  // ── Recovery link
  app.post<{ Params: { uid: string } }>('/api/admin/people/:uid/recovery', async (req, reply) => {
    const g = guard(req, reply, 'account.recovery');
    if (!g) return;
    const body = RecoverySchema.safeParse(req.body ?? {});
    if (!body.success) return reply.code(400).send({ error: 'bad_request' });
    const a = await managed(req.params.uid);
    if (!a || a.disabledAt) return reply.code(404).send({ error: 'not_found' });
    if (body.data.revokeExisting) {
      await store.deletePasskeysOf(a.uid);
      await sessions.revokeUser(a.uid, undefined, 'recovery_revoke');
    }
    // one recovery link at a time per person
    await store.revokeTickets('recovery', a.uid);
    const now = Date.now();
    const made = await issueTicket(store, cfg.sessionSecret, {
      kind: 'recovery',
      name: a.name,
      role: null,
      targetUid: a.uid,
      expiresAt: now + RECOVERY_HOURS * 3600_000,
      createdBy: g.actor.uid,
      withPin: true,
    });
    d.log.info(
      { by: g.actor.uid, uid: a.uid, revoked: body.data.revokeExisting },
      'recovery link issued',
    );
    const out: CreatedLink = { invite: ticketSummary(made.ticket), path: made.path, pin: made.pin };
    return reply.code(201).send(out);
  });

  // ── Invites
  app.get('/api/admin/invites', async (req, reply) => {
    if (!guard(req, reply, 'invite.manage')) return;
    const list = await store.listTickets(['invite', 'recovery']);
    return { invites: list.map((t) => ticketSummary(t)) };
  });

  app.post('/api/admin/invites', async (req, reply) => {
    const g = guard(req, reply, 'invite.manage');
    if (!g) return;
    const body = CreateAccountInviteSchema.safeParse(req.body ?? {});
    if (!body.success) return reply.code(400).send({ error: 'bad_request' });
    const v = body.data;
    if (v.pilotUid) {
      const p = await managed(v.pilotUid);
      if (!p || p.disabledAt || (await store.listPasskeys(p.uid)).length)
        return reply.code(409).send({ error: 'not_a_pilot' });
    }
    const inviteOnly = await inviteOnlySpaces();
    const now = Date.now();
    const made = await issueTicket(store, cfg.sessionSecret, {
      kind: 'invite',
      name: v.name,
      note: v.note,
      role: v.role,
      spaces: [...new Set(v.spaces)].filter((s) => inviteOnly.has(s)),
      pilotUid: v.pilotUid,
      expiresAt: now + v.expiresInHours * 3600_000,
      createdBy: g.actor.uid,
      withPin: v.protection === 'pin',
    });
    d.log.info({ by: g.actor.uid, invite: made.ticket.id, role: v.role }, 'invite created');
    const out: CreatedLink = { invite: ticketSummary(made.ticket), path: made.path, pin: made.pin };
    return reply.code(201).send(out);
  });

  app.delete<{ Params: { id: string } }>('/api/admin/invites/:id', async (req, reply) => {
    const g = guard(req, reply, 'invite.manage');
    if (!g) return;
    const t = await store.getTicket(String(req.params.id).slice(0, 64));
    if (!t || t.kind === 'setup' || !(await store.revokeTicket(t.id)))
      return reply.code(404).send({ error: 'not_found' });
    d.log.info({ by: g.actor.uid, invite: t.id }, 'invite revoked');
    return { ok: true };
  });
}
