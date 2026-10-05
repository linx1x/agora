import { randomUUID } from 'node:crypto';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import {
  MAX_PIN_FAILURES,
  NameSchema,
  PIN_RE,
  PasskeyLabelSchema,
  deviceLabel,
  ticketStatus,
  type PasskeySummary,
  type TicketPreview,
} from '@agora/shared';
import type { Config } from '../config';
import type { Store, StoredAccount, StoredPasskey, StoredTicket } from '../db/store';
import type { Sessions } from '../http/sessions';
import { RateLimit } from '../http/rate';
import type { SpaceManager } from '../spaces/manager';
import { hashToken, pinMatches } from './tickets';
import type { Ceremonies, NewCredential } from './webauthn';

interface Deps {
  cfg: Config;
  store: Store;
  sessions: Sessions;
  spaces: SpaceManager;
  ceremonies: Ceremonies;
  log: { info: (o: object, m?: string) => void; warn: (o: object, m?: string) => void };
}

/** What a registration flow started from a ticket remembers. */
interface ClaimFlow {
  ticketId: string;
  uid: string;
}
/** A registration flow for "add a passkey" on the Account page. */
interface AddFlow {
  add: true;
  uid: string;
  sessionId: string;
}

const Token = z.string().min(20).max(100);
/** Adding or removing a passkey needs a passkey check this recent (sign-in counts). */
const STEP_UP_MS = 10 * 60_000;
const TicketBody = z.object({
  token: Token,
  pin: z.string().max(12).optional(),
});
const FinishBody = z.object({
  flowId: z.string().max(64),
  response: z.record(z.string(), z.unknown()),
  shared: z.boolean().default(false),
});

const passkeySummary = (p: StoredPasskey): PasskeySummary => ({
  id: p.id,
  label: p.label,
  createdAt: p.createdAt,
  lastUsedAt: p.lastUsedAt,
  backedUp: p.backedUp,
});

/**
 * Passkey sign-in (P2.14), setup / invite / recovery links (P2.13, P2.15) and the
 * passkeys of my account (P2.17). Only in AUTH_MODE=passkey; every public route is rate
 * limited and answers "invalid" the same way whatever went wrong.
 */
export function registerAuthRoutes(app: FastifyInstance, d: Deps) {
  const { cfg, store, sessions, ceremonies } = d;
  const on = cfg.authMode === 'passkey';
  const perIp = {
    login: new RateLimit(30, 60_000),
    ticket: new RateLimit(30, 60_000),
    finish: new RateLimit(20, 60_000),
  };
  const limited = (lim: RateLimit, req: FastifyRequest, reply: FastifyReply) => {
    if (lim.take(req.ip)) return false;
    void reply.code(429).send({ error: 'rate_limited' });
    return true;
  };
  const off = (reply: FastifyReply) => void reply.code(404).send({ error: 'not_found' });
  const invalid = (reply: FastifyReply) => void reply.code(404).send({ error: 'invalid' });

  // ── Sign-in with a passkey
  app.post('/api/auth/passkey/options', async (req, reply) => {
    if (!on) return off(reply);
    if (limited(perIp.login, req, reply)) return;
    return ceremonies.startAuthentication(req);
  });

  app.post('/api/auth/passkey/verify', async (req, reply) => {
    if (!on) return off(reply);
    if (limited(perIp.finish, req, reply)) return;
    const body = FinishBody.safeParse(req.body);
    if (!body.success) return reply.code(400).send({ error: 'bad_request' });
    const r = await ceremonies.finishAuthentication(body.data.flowId, body.data.response, (id) =>
      store.getPasskey(id),
    );
    const account = r ? await store.getAccount(r.passkey.uid) : null;
    if (!r || !account || account.disabledAt) {
      d.log.info({ ip: req.ip }, 'passkey sign-in refused');
      return reply.code(401).send({ error: 'not_recognised' });
    }
    await store.usePasskey(r.passkey.id, r.counter, Date.now(), r.backedUp);
    await store.upsertUser({ uid: account.uid, name: account.name, avatar: null });
    await sessions.issue(req, reply, account.uid, { shared: body.data.shared });
    d.log.info({ uid: account.uid, passkey: r.passkey.id.slice(0, 8) }, 'signed in');
    return { uid: account.uid, name: account.name };
  });

  /** Re-check with a passkey of this very account (step-up before sensitive changes). */
  app.post('/api/auth/passkey/reauth', async (req, reply) => {
    if (!on) return off(reply);
    const a = req.auth;
    if (!a) return reply.code(401).send({ error: 'unauthenticated' });
    if (limited(perIp.finish, req, reply)) return;
    const body = FinishBody.safeParse(req.body);
    if (!body.success) return reply.code(400).send({ error: 'bad_request' });
    const r = await ceremonies.finishAuthentication(body.data.flowId, body.data.response, (id) =>
      store.getPasskey(id),
    );
    if (!r || r.passkey.uid !== a.account.uid)
      return reply.code(401).send({ error: 'not_recognised' });
    await store.usePasskey(r.passkey.id, r.counter, Date.now(), r.backedUp);
    sessions.markVerified(a.session.id);
    return { ok: true };
  });

  // ── Links: setup, invite, recovery
  /**
   * Check a ticket token (and PIN when it has one). Wrong PINs are counted on the ticket;
   * the fifth locks it for good.
   */
  const usable = async (
    token: string,
    pin: string | undefined,
  ): Promise<
    | { ok: true; t: StoredTicket }
    | { ok: false; error: 'invalid' | 'pin_required' | 'bad_pin'; left?: number }
  > => {
    const t = await store.getTicketByHash(hashToken(token));
    if (!t || ticketStatus(t) !== 'pending') return { ok: false, error: 'invalid' };
    if (!t.pinHash) return { ok: true, t };
    if (pin === undefined) return { ok: false, error: 'pin_required' };
    if (PIN_RE.test(pin) && pinMatches(cfg.sessionSecret, t, pin)) return { ok: true, t };
    const f = await store.failPin(t.id, MAX_PIN_FAILURES);
    d.log.warn({ ticket: t.id, failures: f.failures, locked: f.locked }, 'wrong invite PIN');
    if (f.locked) return { ok: false, error: 'invalid' };
    return { ok: false, error: 'bad_pin', left: MAX_PIN_FAILURES - f.failures };
  };

  /** Who a ticket is for, and whether it can still make or reach that account. */
  const target = async (
    t: StoredTicket,
  ): Promise<{ uid: string; name: string; account: StoredAccount | null } | null> => {
    switch (t.kind) {
      case 'setup':
        return (await store.ownerUid())
          ? null
          : { uid: `u-${randomUUID()}`, name: '', account: null };
      case 'invite': {
        if (!t.pilotUid) return { uid: `u-${randomUUID()}`, name: t.name, account: null };
        const a = await store.getAccount(t.pilotUid);
        // a pilot identity is claimed once, and never the owner's
        if (!a || a.disabledAt || a.role === 'owner') return null;
        if ((await store.listPasskeys(a.uid)).length) return null;
        return { uid: a.uid, name: t.name, account: a };
      }
      case 'recovery': {
        const a = t.targetUid ? await store.getAccount(t.targetUid) : null;
        if (!a || a.disabledAt) return null;
        return { uid: a.uid, name: a.name, account: a };
      }
    }
  };

  /** Public: what a link leads to. The invitee's name only shows once the PIN is right. */
  app.post('/api/tickets/preview', async (req, reply) => {
    if (!on) return off(reply);
    if (limited(perIp.ticket, req, reply)) return;
    const body = TicketBody.safeParse(req.body);
    if (!body.success) return invalid(reply);
    const t = await store.getTicketByHash(hashToken(body.data.token));
    if (!t || ticketStatus(t) !== 'pending' || !(await target(t))) return invalid(reply);
    const preview: TicketPreview = {
      kind: t.kind,
      name: t.pinHash ? '' : t.name,
      expiresAt: t.expiresAt,
      needsPin: !!t.pinHash,
    };
    return preview;
  });

  app.post('/api/tickets/check', async (req, reply) => {
    if (!on) return off(reply);
    if (limited(perIp.ticket, req, reply)) return;
    const body = TicketBody.safeParse(req.body);
    if (!body.success) return invalid(reply);
    const u = await usable(body.data.token, body.data.pin);
    if (!u.ok)
      return reply.code(u.error === 'invalid' ? 404 : 403).send({ error: u.error, left: u.left });
    return { ok: true, name: u.t.name };
  });

  app.post('/api/tickets/options', async (req, reply) => {
    if (!on) return off(reply);
    if (limited(perIp.ticket, req, reply)) return;
    const body = TicketBody.extend({ name: NameSchema.optional() }).safeParse(req.body);
    if (!body.success) return invalid(reply);
    const u = await usable(body.data.token, body.data.pin);
    if (!u.ok)
      return reply.code(u.error === 'invalid' ? 404 : 403).send({ error: u.error, left: u.left });
    const who = await target(u.t);
    if (!who) return invalid(reply);
    const name = body.data.name ?? (who.name || 'Agora');
    const existing = who.account ? await store.listPasskeys(who.uid) : [];
    return ceremonies.startRegistration<ClaimFlow>(req, { uid: who.uid, name }, existing, {
      ticketId: u.t.id,
      uid: who.uid,
    });
  });

  app.post('/api/tickets/verify', async (req, reply) => {
    if (!on) return off(reply);
    if (limited(perIp.finish, req, reply)) return;
    const body = FinishBody.extend({ name: NameSchema.optional() }).safeParse(req.body);
    if (!body.success) return reply.code(400).send({ error: 'bad_request' });
    const done = await ceremonies.finishRegistration<ClaimFlow | AddFlow>(
      body.data.flowId,
      body.data.response,
    );
    if (!done || 'add' in done.data) return reply.code(400).send({ error: 'passkey_failed' });
    const { ticketId, uid } = done.data;
    const t = await store.getTicket(ticketId);
    const who = t && ticketStatus(t) === 'pending' ? await target(t) : null;
    if (!t || !who) return invalid(reply);
    const now = Date.now();
    const name = body.data.name ?? (who.name || 'Agora');
    const account =
      t.kind === 'recovery'
        ? null
        : t.kind === 'setup'
          ? { name, role: 'owner' as const, invitedName: null }
          : { name, role: t.role ?? 'member', invitedName: t.name };
    const known = new Set((await store.listSpaces()).filter((s) => !s.archivedAt).map((s) => s.id));
    const ok = await store.redeemTicket({
      ticketId,
      now,
      uid,
      account,
      spaces: t.kind === 'invite' ? t.spaces.filter((s) => known.has(s)) : [],
      passkey: newPasskey(uid, done.credential, String(req.headers['user-agent'] ?? ''), now),
    });
    if (!ok) return invalid(reply);
    // A claimed pilot identity: whoever still holds its old access-code cookie is out.
    if (t.kind === 'invite' && t.pilotUid)
      await sessions.revokeUser(uid, undefined, 'pilot_claimed');
    sessions.rightsChanged(uid);
    await sessions.issue(req, reply, uid, { shared: body.data.shared });
    d.log.info({ uid, ticket: t.id, kind: t.kind }, 'link used');
    return { ok: true, kind: t.kind, uid };
  });

  // ── My passkeys (Account page, P2.17)
  const me = (req: FastifyRequest, reply: FastifyReply) => {
    if (!on) {
      off(reply);
      return null;
    }
    if (!req.auth) {
      void reply.code(401).send({ error: 'unauthenticated' });
      return null;
    }
    return req.auth;
  };

  app.get('/api/me/passkeys', async (req, reply) => {
    const a = me(req, reply);
    if (!a) return;
    return { passkeys: (await store.listPasskeys(a.account.uid)).map(passkeySummary) };
  });

  app.post('/api/me/passkeys/options', async (req, reply) => {
    const a = me(req, reply);
    if (!a) return;
    if (limited(perIp.login, req, reply)) return;
    if (!sessions.recentlyVerified(a.session, STEP_UP_MS))
      return reply.code(403).send({ error: 'reauth_required' });
    const existing = await store.listPasskeys(a.account.uid);
    if (existing.length >= 20) return reply.code(409).send({ error: 'too_many_passkeys' });
    return ceremonies.startRegistration<AddFlow>(
      req,
      { uid: a.account.uid, name: a.account.name },
      existing,
      { add: true, uid: a.account.uid, sessionId: a.session.id },
    );
  });

  app.post('/api/me/passkeys/verify', async (req, reply) => {
    const a = me(req, reply);
    if (!a) return;
    const body = FinishBody.safeParse(req.body);
    if (!body.success) return reply.code(400).send({ error: 'bad_request' });
    const done = await ceremonies.finishRegistration<ClaimFlow | AddFlow>(
      body.data.flowId,
      body.data.response,
    );
    // the flow must have been started by this very session
    if (!done || !('add' in done.data) || done.data.sessionId !== a.session.id)
      return reply.code(400).send({ error: 'passkey_failed' });
    if (await store.getPasskey(done.credential.id))
      return reply.code(409).send({ error: 'already_registered' });
    const p = newPasskey(
      a.account.uid,
      done.credential,
      String(req.headers['user-agent'] ?? ''),
      Date.now(),
    );
    await store.addPasskey(p);
    d.log.info({ uid: a.account.uid, passkey: p.id.slice(0, 8) }, 'passkey added');
    return reply.code(201).send(passkeySummary(p));
  });

  app.patch<{ Params: { id: string } }>('/api/me/passkeys/:id', async (req, reply) => {
    const a = me(req, reply);
    if (!a) return;
    const body = PasskeyLabelSchema.safeParse(req.body);
    if (!body.success) return reply.code(400).send({ error: 'bad_request' });
    const ok = await store.renamePasskey(a.account.uid, String(req.params.id), body.data.label);
    return ok ? { ok: true } : reply.code(404).send({ error: 'not_found' });
  });

  app.delete<{ Params: { id: string } }>('/api/me/passkeys/:id', async (req, reply) => {
    const a = me(req, reply);
    if (!a) return;
    const mine = await store.listPasskeys(a.account.uid);
    const id = String(req.params.id);
    if (!mine.some((p) => p.id === id)) return reply.code(404).send({ error: 'not_found' });
    if (!sessions.recentlyVerified(a.session, STEP_UP_MS))
      return reply.code(403).send({ error: 'reauth_required' });
    // never lock yourself out: the last passkey stays
    if (mine.length <= 1) return reply.code(409).send({ error: 'last_passkey' });
    await store.deletePasskey(a.account.uid, id);
    d.log.info({ uid: a.account.uid, passkey: id.slice(0, 8) }, 'passkey removed');
    return { ok: true };
  });
}

export function newPasskey(
  uid: string,
  c: NewCredential,
  userAgent: string,
  now: number,
): StoredPasskey {
  return {
    id: c.id,
    uid,
    publicKey: c.publicKey,
    counter: c.counter,
    transports: c.transports,
    deviceType: c.deviceType,
    backedUp: c.backedUp,
    label: deviceLabel(userAgent).slice(0, 40),
    createdAt: now,
    lastUsedAt: now,
  };
}
