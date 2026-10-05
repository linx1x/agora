import { createHash, randomBytes } from 'node:crypto';
import type { FastifyReply, FastifyRequest } from 'fastify';
import type { Config } from '../config';
import type { StoredAccount, StoredSession, Store } from '../db/store';

/**
 * Server-side sessions (PLAN P2.12, docs/AUTH.md "Sessions").
 *
 * The cookie carries a random 256-bit secret; Postgres keeps only its SHA-256, so a
 * database leak gives no usable cookie. Every session is a row, which is what makes
 * "sign out that device", account removal and role changes take effect at once: the
 * row goes, and the sockets opened with it are closed.
 */

/** `__Host-` pins the cookie to this exact host, https and path `/` (needs Secure). */
export const COOKIE_SECURE_NAME = '__Host-agora_session';
/** Plain-http development (localhost) cannot set a `__Host-` cookie. */
export const COOKIE_DEV_NAME = 'agora_session';

/** How long a looked-up session is trusted before asking the store again. */
const CACHE_MS = 15_000;
/** Sliding expiry is pushed forward at most this often (fewer writes). */
const TOUCH_MS = 10 * 60_000;
const SWEEP_MS = 5 * 60_000;

/** WebSocket close codes the client understands (apps/web/src/net/client.ts). */
export const CLOSE_SIGNED_OUT = 4401;
/** rights changed (role, removal from a space): reconnect to get the new ones */
export const CLOSE_RIGHTS_CHANGED = 4409;

export interface Closable {
  close(code?: number, reason?: string): void;
}

/** What a request knows about its caller once the session is resolved. */
export interface Auth {
  session: StoredSession;
  account: StoredAccount;
}

const sha256 = (s: string) => createHash('sha256').update(s).digest('base64url');

/** IPv4 → /24, IPv6 → /48: enough to recognise a device list entry, not a person. */
export function coarseIp(ip: string | undefined): string {
  if (!ip) return '';
  const v4 = ip.replace(/^::ffff:/, '');
  if (/^\d+\.\d+\.\d+\.\d+$/.test(v4)) return v4.replace(/\.\d+$/, '.0/24');
  if (ip.includes(':')) return `${ip.split(':').slice(0, 3).join(':')}::/48`;
  return '';
}

export class Sessions {
  readonly cookieName: string;
  private cache = new Map<string, { s: StoredSession; a: StoredAccount; at: number }>();
  /** session id → open sockets */
  private sockets = new Map<string, Set<Closable>>();
  /** session id → uid, for sockets */
  private socketOwner = new Map<string, string>();
  /** session id → last time its owner proved it with a passkey (step-up, P2.17) */
  private verified = new Map<string, number>();
  private sweeper?: NodeJS.Timeout;

  constructor(
    private cfg: Config,
    private store: Store,
    private log: { info: (o: object, m?: string) => void },
    private now: () => number = Date.now,
  ) {
    this.cookieName = cfg.cookieSecure ? COOKIE_SECURE_NAME : COOKIE_DEV_NAME;
  }

  start() {
    this.sweeper = setInterval(() => void this.sweep().catch(() => {}), SWEEP_MS);
    this.sweeper.unref?.();
  }
  stop() {
    if (this.sweeper) clearInterval(this.sweeper);
  }

  lifetimeMs(shared: boolean) {
    return shared ? this.cfg.sessionHours * 3600_000 : this.cfg.sessionDays * 86400_000;
  }

  private setCookie(reply: FastifyReply, token: string, s: StoredSession) {
    reply.setCookie(this.cookieName, token, {
      httpOnly: true,
      secure: this.cfg.cookieSecure,
      sameSite: 'lax',
      path: '/',
      // shared computer: a browser-session cookie, gone when the browser closes
      maxAge: s.shared ? undefined : Math.max(1, Math.round((s.expiresAt - this.now()) / 1000)),
    });
  }

  clearCookie(reply: FastifyReply) {
    reply.clearCookie(this.cookieName, { path: '/', secure: this.cfg.cookieSecure });
  }

  /**
   * Sign `uid` in on this browser. Any session the request already carried is ended
   * first (a fresh id on every sign-in, so a planted cookie is never upgraded).
   */
  async issue(
    req: FastifyRequest,
    reply: FastifyReply,
    uid: string,
    opts: { shared: boolean; grants?: StoredSession['grants'] },
  ): Promise<StoredSession> {
    const current = req.auth?.session;
    if (current) await this.revoke(current.id, 'replaced');
    const token = randomBytes(32).toString('base64url');
    const now = this.now();
    const s: StoredSession = {
      id: randomBytes(9).toString('base64url'),
      tokenHash: sha256(token),
      uid,
      createdAt: now,
      lastUsedAt: now,
      expiresAt: now + this.lifetimeMs(opts.shared),
      shared: opts.shared,
      userAgent: String(req.headers['user-agent'] ?? '').slice(0, 200),
      ip: coarseIp(req.ip),
      grants: opts.grants ?? {},
    };
    await this.store.createSession(s);
    this.setCookie(reply, token, s);
    return s;
  }

  /**
   * The caller's live session and account, or null. Pushes a sliding expiry forward
   * (and the cookie with it) when the session has not been used for a while.
   */
  async resolve(req: FastifyRequest, reply?: FastifyReply): Promise<Auth | null> {
    const token = req.cookies[this.cookieName];
    if (!token || token.length > 100) return null;
    const hash = sha256(token);
    const now = this.now();
    let hit = this.cache.get(hash);
    if (!hit || now - hit.at > CACHE_MS) {
      const s = await this.store.getSessionByHash(hash);
      const a = s ? await this.store.getAccount(s.uid) : null;
      if (!s || !a) {
        this.cache.delete(hash);
        return null;
      }
      hit = { s, a, at: now };
      this.cache.set(hash, hit);
    }
    const { s, a } = hit;
    if (s.expiresAt <= now) {
      await this.revoke(s.id, 'expired');
      return null;
    }
    if (a.disabledAt) return null;
    if (!s.shared && now - s.lastUsedAt > TOUCH_MS) {
      s.lastUsedAt = now;
      s.expiresAt = now + this.lifetimeMs(false);
      await this.store.touchSession(s.id, s.lastUsedAt, s.expiresAt);
      if (reply) this.setCookie(reply, token, s);
    }
    return { session: s, account: a };
  }

  /** The session's owner just used their passkey again (re-authentication). */
  markVerified(sessionId: string) {
    this.verified.set(sessionId, this.now());
    if (this.verified.size > 10_000) {
      const cutoff = this.now() - 3600_000;
      for (const [id, at] of this.verified) if (at < cutoff) this.verified.delete(id);
    }
  }

  /**
   * Did the owner prove themselves recently (sign-in or re-check)? Sensitive account
   * changes (adding or removing a passkey) need it, so a stolen cookie alone cannot
   * plant a passkey that outlives the session.
   */
  recentlyVerified(s: StoredSession, withinMs: number): boolean {
    return this.now() - Math.max(s.createdAt, this.verified.get(s.id) ?? 0) < withinMs;
  }

  /** Is this session id still live? (world sockets are bound to one) */
  async isLive(sessionId: string, uid: string): Promise<boolean> {
    for (const { s, a } of this.cache.values())
      if (s.id === sessionId) return s.uid === uid && s.expiresAt > this.now() && !a.disabledAt;
    const s = (await this.store.listSessions(uid)).find((x) => x.id === sessionId);
    const a = s ? await this.store.getAccount(uid) : null;
    return !!s && !!a && !a.disabledAt && s.expiresAt > this.now();
  }

  private forget(sessionId: string) {
    for (const [h, { s }] of this.cache) if (s.id === sessionId) this.cache.delete(h);
  }

  private closeSockets(sessionId: string, code: number, reason: string) {
    const set = this.sockets.get(sessionId);
    if (!set) return;
    for (const c of [...set]) c.close(code, reason);
    this.sockets.delete(sessionId);
    this.socketOwner.delete(sessionId);
  }

  /** End one session; its sockets are closed and the client goes back to sign-in. */
  async revoke(sessionId: string, why = 'revoked'): Promise<StoredSession | null> {
    const s = await this.store.deleteSession(sessionId);
    this.forget(sessionId);
    this.verified.delete(sessionId);
    this.closeSockets(sessionId, CLOSE_SIGNED_OUT, 'signed_out');
    if (s) this.log.info({ uid: s.uid, session: s.id, why }, 'session ended');
    return s;
  }

  /** End every session of a user (except one, e.g. "sign out my other devices"). */
  async revokeUser(uid: string, exceptId?: string, why = 'revoked'): Promise<number> {
    const ids = await this.store.deleteSessionsOf(uid, exceptId);
    for (const id of ids) {
      this.forget(id);
      this.closeSockets(id, CLOSE_SIGNED_OUT, 'signed_out');
    }
    // sockets of sessions we did not know about (another process's cache, races)
    for (const [id, owner] of [...this.socketOwner])
      if (owner === uid && id !== exceptId) this.closeSockets(id, CLOSE_SIGNED_OUT, 'signed_out');
    if (ids.length) this.log.info({ uid, n: ids.length, why }, 'sessions ended');
    return ids.length;
  }

  /**
   * Someone's rights changed (role, disabled): drop cached accounts and close their
   * sockets so they reconnect and the server decides again with the new rights.
   */
  rightsChanged(uid: string) {
    for (const [h, v] of this.cache) if (v.s.uid === uid) this.cache.delete(h);
    for (const [id, owner] of [...this.socketOwner])
      if (owner === uid) this.closeSockets(id, CLOSE_RIGHTS_CHANGED, 'rights_changed');
  }

  /** Track a world socket opened with this session; returns the detach function. */
  attach(sessionId: string, uid: string, c: Closable): () => void {
    let set = this.sockets.get(sessionId);
    if (!set) this.sockets.set(sessionId, (set = new Set()));
    set.add(c);
    this.socketOwner.set(sessionId, uid);
    return () => {
      set.delete(c);
      if (!set.size && this.sockets.get(sessionId) === set) {
        this.sockets.delete(sessionId);
        this.socketOwner.delete(sessionId);
      }
    };
  }

  /**
   * Housekeeping: drop expired rows, close sockets whose session ended elsewhere, and
   * count being in the world as using the session (sliding expiry).
   */
  async sweep() {
    const now = this.now();
    await this.store.purgeSessions(now);
    for (const [id, uid] of [...this.socketOwner]) {
      const s = (await this.store.listSessions(uid)).find((x) => x.id === id);
      const a = s ? await this.store.getAccount(uid) : null;
      if (!s || !a || a.disabledAt || s.expiresAt <= now) {
        this.forget(id);
        this.closeSockets(id, CLOSE_SIGNED_OUT, 'signed_out');
      } else if (!s.shared && now - s.lastUsedAt > TOUCH_MS) {
        await this.store.touchSession(id, now, now + this.lifetimeMs(false));
        this.forget(id);
      }
    }
    for (const [h, v] of this.cache) if (now - v.at > CACHE_MS) this.cache.delete(h);
  }
}

declare module 'fastify' {
  interface FastifyRequest {
    /** resolved once per request by the onRequest hook in app.ts */
    auth: Auth | null;
  }
}
