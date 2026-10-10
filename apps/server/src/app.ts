import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID, timingSafeEqual } from 'node:crypto';
import Fastify, { type FastifyInstance, type FastifyRequest } from 'fastify';
import cookie from '@fastify/cookie';
import fastifyStatic from '@fastify/static';
import websocket from '@fastify/websocket';
import { z } from 'zod';
import {
  AvatarSchema,
  DEFAULT_SPACE,
  MAX_NAME_LEN,
  can,
  ensureEditLayers,
  type PlatformRole,
  type S2CMsg,
  type Tmj,
} from '@agora/shared';
import type { Config } from './config';
import { describeDbUrl, openStore, type Store } from './db/store';
import { registerSpaceRoutes } from './http/spaces';
import { sign, verify } from './http/tokens';
import { Sessions, type Auth } from './http/sessions';
import { Ceremonies } from './auth/webauthn';
import { registerAuthRoutes } from './auth/routes';
import { registerPeopleRoutes } from './auth/people';
import { SpaceManager, type Actor } from './spaces/manager';
import type { SpaceRoom, Player } from './world/room';
import { LiveKitApi, apiUrlFrom } from './media/livekit';
import { startupNote, startupStep, withTimeout } from './startup';
import { staleWebBuild } from './webBuild';

const here = dirname(fileURLToPath(import.meta.url));

/** First existing path among candidates (works from src/ with tsx and from dist/). */
function findPath(candidates: (string | undefined)[]): string | undefined {
  return candidates
    .filter(Boolean)
    .map((p) => resolve(p!))
    .find((p) => existsSync(p));
}

export const DEV_USERS = [
  { uid: 'dev-alice', name: 'Alice Tremblay' },
  { uid: 'dev-benoit', name: 'Benoît Gagnon' },
  { uid: 'dev-chloe', name: 'Chloé Roy' },
];

/** Long-lived device identity for access-code logins (ADR-028). */
const ID_COOKIE = 'agora_id';

export interface App {
  app: FastifyInstance;
  /** the default space's room */
  room: SpaceRoom;
  spaces: SpaceManager;
  store: Store;
  sessions: Sessions;
  cfg: Config;
  /** set when localhost:PORT serves a web build older than the web sources (development) */
  staleWebBuild?: Date;
}

export async function buildApp(cfg: Config): Promise<App> {
  const app = Fastify({
    logger: { level: cfg.logLevel, redact: ['req.headers.cookie', 'req.headers.authorization'] },
    trustProxy: true,
    bodyLimit: 64 * 1024,
  });
  for (const w of cfg.warnings) app.log.warn(w);

  startupStep(cfg.databaseUrl ? 'connecting to Postgres' : 'opening in-memory store');
  const store = await openStore(cfg.databaseUrl, app.log, cfg.mapSavePath, {
    // invite-only accounts must never silently land in memory
    strict: cfg.authMode === 'passkey' && cfg.env !== 'test',
  });
  app.log.info({ store: store.kind }, 'store ready');
  const lost = 'accounts, passkeys, desks and chat are LOST when the server stops';
  startupNote(
    store.kind === 'postgres' && cfg.databaseUrl
      ? `data: Postgres at ${describeDbUrl(cfg.databaseUrl)} (kept across restarts)`
      : cfg.databaseUrl
        ? `data: IN MEMORY, Postgres at ${describeDbUrl(cfg.databaseUrl)} did not answer: ${lost}`
        : `data: IN MEMORY (no DATABASE_URL): ${lost}`,
  );

  startupStep('loading the map');
  const mapPath = findPath([
    cfg.mapPath,
    join(here, '../../../packages/maps/hq.tmj'),
    join(here, '../maps/hq.tmj'),
    '/app/maps/hq.tmj',
  ]);
  if (!mapPath) throw new Error('hq.tmj not found; set MAP_PATH');
  /** Generated map from disk (template); a space's live map is its edited copy (ADR-021). */
  const templateJson = readFileSync(mapPath, 'utf8');
  const template = () => ensureEditLayers(JSON.parse(templateJson) as Tmj);

  // Media backend (ADR-031): LiveKit SFU when configured, else peer-to-peer (ADR-009)
  let sfu: LiveKitApi | undefined;
  if (cfg.livekit) {
    sfu = new LiveKitApi(cfg.livekit);
    const lk = { url: cfg.livekit.url, api: cfg.livekit.apiUrl };
    startupStep(`checking LiveKit at ${cfg.livekit.apiUrl}`);
    await withTimeout(sfu.ping(), 5000, 'LiveKit')
      .then(() => app.log.info(lk, 'media: LiveKit reachable'))
      .catch((err) =>
        app.log.warn(
          { ...lk, err: String(err) },
          'media: LiveKit not reachable yet (calls will fail until it is)',
        ),
      );
  } else app.log.info('media: peer-to-peer (set LIVEKIT_URL to use LiveKit)');
  startupStep('loading spaces');
  const spaces = new SpaceManager(cfg, store, app.log, template, sfu);
  await spaces.init();
  const hq = (await spaces.get(DEFAULT_SPACE))!;
  /** The default space is loaded at boot so its room ticks like before (and for tests). */
  const room = await spaces.room(hq);
  spaces.start();
  // stops every room and saves edited maps (index.ts shutdown calls app.close)
  app.addHook('onClose', async () => spaces.stop());

  const sessions = new Sessions(cfg, store, app.log);
  sessions.start();
  app.addHook('onClose', async () => sessions.stop());

  /**
   * Effective platform role (ADR-032). Passkey mode: the account's role, nothing else.
   * Pilot modes: the env grants and unlock codes still apply on top of it.
   */
  const roleFor = (
    uid: string,
    stored: PlatformRole,
    grants: { builder?: boolean; admin?: boolean },
  ): PlatformRole => {
    if (cfg.authMode === 'passkey') return stored;
    if (cfg.adminIds.includes(uid) || (grants.admin && cfg.adminCode)) return 'owner';
    if (
      stored === 'member' &&
      (cfg.builderIds.includes(uid) || (grants.builder && cfg.builderCode))
    )
      return 'builder';
    return stored;
  };
  const actorOf = (a: Auth): Actor => ({
    uid: a.account.uid,
    role: roleFor(a.account.uid, a.account.role, a.session.grants),
  });

  await app.register(cookie);
  app.decorateRequest('auth', null);
  // One session lookup per API request; routes read req.auth (P2.12).
  app.addHook('onRequest', async (req, reply) => {
    req.auth = req.url.startsWith('/api/') ? await sessions.resolve(req, reply) : null;
  });

  /**
   * Cross-site request forgery: a state-changing API call must come from our own page.
   * Browsers always send Origin on cross-site POST/PATCH/DELETE; Sec-Fetch-Site backs it
   * up. Requests without either (tests, curl) carry no cookie a victim's browser added.
   */
  const sameOrigin = (req: FastifyRequest) => {
    const origin = req.headers.origin;
    if (origin === undefined) return req.headers['sec-fetch-site'] !== 'cross-site';
    if (cfg.publicOrigins.includes(origin)) return true;
    try {
      return new URL(origin).host === req.host;
    } catch {
      return false;
    }
  };
  app.addHook('onRequest', async (req, reply) => {
    if (['GET', 'HEAD', 'OPTIONS'].includes(req.method) || !req.url.startsWith('/api/')) return;
    if (!sameOrigin(req)) return reply.code(403).send({ error: 'bad_origin' });
  });
  await app.register(websocket, { options: { maxPayload: 64 * 1024 } });

  // LiveKit's client also calls its server over http(s) (connection checks)
  const sfuOrigin = cfg.livekit ? ` ${new URL(apiUrlFrom(cfg.livekit.url)).origin}` : '';
  app.addHook('onSend', async (_req, reply, payload) => {
    reply.header('X-Content-Type-Options', 'nosniff');
    reply.header('Referrer-Policy', 'same-origin');
    reply.header('Permissions-Policy', 'camera=(self), microphone=(self), display-capture=(self)');
    reply.header(
      'Content-Security-Policy',
      `default-src 'self'; img-src 'self' data: blob:; media-src 'self' blob:; style-src 'self' 'unsafe-inline'; ` +
        `script-src 'self'; connect-src 'self' ws: wss:${sfuOrigin}; font-src 'self' data:; frame-ancestors 'self'; object-src 'none'; base-uri 'self'`,
    );
    return payload;
  });

  // ── Health
  app.get('/healthz', async () => ({ ok: true }));
  app.get('/readyz', async () => ({
    ok: true,
    store: store.kind,
    players: spaces.connectedCount,
  }));

  // ── Auth
  app.get('/api/auth/options', async () => ({
    mode: cfg.authMode,
    /** passkey mode, nobody owns this server yet: the page points at the console link */
    setupPending: cfg.authMode === 'passkey' && !(await store.ownerUid().catch(() => 'x')),
    /** session lengths, for the "shared computer" hint on the sign-in page */
    sessionDays: cfg.sessionDays,
    sharedHours: cfg.sessionHours,
    needsCode: cfg.authMode === 'access-code' && !!cfg.accessCode,
    devUsers: cfg.authMode === 'dev' ? DEV_USERS.map((u) => u.name) : [],
  }));

  const LoginBody = z.object({
    name: z.string().trim().min(1).max(MAX_NAME_LEN),
    code: z.string().max(200).optional(),
    /** an invite token stands in for the access code (P2.4) */
    invite: z.string().max(200).optional(),
    /** keep this browser's identity for next time (ADR-028); default on */
    remember: z.boolean().default(true),
    devUser: z
      .number()
      .int()
      .min(0)
      .max(DEV_USERS.length - 1)
      .optional(),
  });
  app.post('/api/auth/login', async (req, reply) => {
    const body = LoginBody.safeParse(req.body);
    if (!body.success) return reply.code(400).send({ error: 'bad_request' });
    // Invite-only accounts sign in with a passkey (P2.14), never with a name and a code.
    if (cfg.authMode === 'passkey') return reply.code(403).send({ error: 'use_passkey' });
    let uid: string;
    let name = body.data.name;
    if (cfg.authMode === 'dev' && body.data.devUser !== undefined) {
      const u = DEV_USERS[body.data.devUser]!;
      uid = u.uid;
      name = u.name;
    } else {
      if (cfg.authMode === 'access-code' && cfg.accessCode && body.data.code !== cfg.accessCode) {
        const inv = body.data.invite ? await invites.preview(body.data.invite) : null;
        if (!inv?.valid) return reply.code(401).send({ error: 'bad_code' });
      }
      // Same browser, same person: reuse the identity cookie when it is valid (ADR-028).
      uid = verify(req.cookies[ID_COOKIE], cfg.sessionSecret, 'id')?.uid ?? `u-${randomUUID()}`;
      if (body.data.remember && cfg.identityDays > 0)
        reply.setCookie(
          ID_COOKIE,
          sign(
            { uid, name: '', typ: 'id', exp: Date.now() + cfg.identityDays * 86400_000 },
            cfg.sessionSecret,
          ),
          {
            httpOnly: true,
            secure: cfg.cookieSecure,
            sameSite: 'lax',
            path: '/',
            maxAge: cfg.identityDays * 86400,
          },
        );
      else reply.clearCookie(ID_COOKIE, { path: '/' });
    }
    // The typed name is the account name from now on (the avatar editor can change it).
    await store.upsertUser({ uid, name, avatar: null });
    // "Remember me" unticked = shared computer: a short session that ends with the browser.
    await sessions.issue(req, reply, uid, { shared: !body.data.remember });
    return { uid, name };
  });

  const LogoutBody = z.object({ forget: z.boolean().default(false) }).default({ forget: false });
  app.post('/api/auth/logout', async (req, reply) => {
    if (req.auth) await sessions.revoke(req.auth.session.id, 'logout');
    sessions.clearCookie(reply);
    if (LogoutBody.safeParse(req.body ?? {}).data?.forget)
      reply.clearCookie(ID_COOKIE, { path: '/' });
    return { ok: true };
  });

  app.get('/api/me', async (req, reply) => {
    const s = req.auth;
    if (!s) return reply.code(401).send({ error: 'unauthenticated' });
    const a = actorOf(s);
    const legacy = cfg.authMode !== 'passkey';
    return {
      uid: s.account.uid,
      name: s.account.name,
      avatar: s.account.avatar,
      /** platform role (ADR-032) */
      role: a.role,
      /** the name the owner put on my invite, when it differs (shown in Account) */
      invitedName: s.account.invitedName,
      builder: can(a.role, 'map.build'),
      admin: a.role === 'owner',
      /** Settings shows the code field when a code could add something (pilot modes) */
      builderCode: legacy && !!cfg.builderCode,
      adminCode: legacy && !!cfg.adminCode,
      /** proximity media enabled (the device check is skipped without it) */
      media: cfg.flags.media !== false,
      remembered:
        cfg.authMode === 'access-code' && !!verify(req.cookies[ID_COOKIE], cfg.sessionSecret, 'id'),
      /** invite-only accounts: Account page, People page for the owner */
      passkeys: cfg.authMode === 'passkey',
    };
  });

  /**
   * Unlock build mode (BUILDER_CODE) or platform admin (ADMIN_CODE) for this session
   * (re-issues the session cookie).
   */
  const UnlockBody = z.object({ code: z.string().min(1).max(200) });
  const unlockTries = new Map<string, { n: number; at: number }>();
  const same = (x: string, y: string | undefined) => {
    if (!y) return false;
    const a = Buffer.from(x);
    const b = Buffer.from(y);
    return a.length === b.length && timingSafeEqual(a, b);
  };
  app.post('/api/builder/unlock', async (req, reply) => {
    const s = req.auth;
    if (!s) return reply.code(401).send({ error: 'unauthenticated' });
    const body = UnlockBody.safeParse(req.body);
    if (!body.success || cfg.authMode === 'passkey' || !(cfg.builderCode || cfg.adminCode))
      return reply.code(400).send({ error: 'bad_request' });
    const t = unlockTries.get(req.ip) ?? { n: 0, at: Date.now() };
    if (Date.now() - t.at > 60_000) Object.assign(t, { n: 0, at: Date.now() });
    if (++t.n > 5) return reply.code(429).send({ error: 'rate_limited' });
    unlockTries.set(req.ip, t);
    const admin = same(body.data.code, cfg.adminCode);
    const builder = admin || same(body.data.code, cfg.builderCode);
    if (!builder) return reply.code(403).send({ error: 'bad_code' });
    // A new session id for the stronger session (never upgrade a cookie in place).
    const g = s.session.grants;
    await sessions.issue(req, reply, s.account.uid, {
      shared: s.session.shared,
      grants: { builder: g.builder || !!cfg.builderCode, admin: g.admin || admin },
    });
    return { ok: true, admin };
  });

  /** Short-lived token for the realtime socket (ARCHITECTURE §7). */
  app.post('/api/session/realtime-token', async (req, reply) => {
    const s = req.auth;
    if (!s) return reply.code(401).send({ error: 'unauthenticated' });
    return {
      token: sign(
        {
          uid: s.account.uid,
          name: s.account.name,
          typ: 'rt',
          exp: Date.now() + 60_000,
          sid: s.session.id,
          b: s.session.grants.builder,
          a: s.session.grants.admin,
        },
        cfg.sessionSecret,
      ),
    };
  });

  // ── My sessions ("my devices", P2.12; the Account page comes with P2.17)
  app.get('/api/me/sessions', async (req, reply) => {
    const s = req.auth;
    if (!s) return reply.code(401).send({ error: 'unauthenticated' });
    const list = await store.listSessions(s.account.uid);
    return {
      sessions: list
        .filter((x) => x.expiresAt > Date.now())
        .map((x) => ({
          id: x.id,
          createdAt: x.createdAt,
          lastUsedAt: x.lastUsedAt,
          expiresAt: x.expiresAt,
          shared: x.shared,
          userAgent: x.userAgent,
          ip: x.ip,
          current: x.id === s.session.id,
        })),
    };
  });
  app.delete<{ Params: { id: string } }>('/api/me/sessions/:id', async (req, reply) => {
    const s = req.auth;
    if (!s) return reply.code(401).send({ error: 'unauthenticated' });
    const id = String(req.params.id).slice(0, 64);
    const mine = (await store.listSessions(s.account.uid)).some((x) => x.id === id);
    if (!mine) return reply.code(404).send({ error: 'not_found' });
    await sessions.revoke(id, 'signed_out_by_user');
    if (id === s.session.id) sessions.clearCookie(reply);
    return { ok: true };
  });
  app.post('/api/me/sessions/revoke-others', async (req, reply) => {
    const s = req.auth;
    if (!s) return reply.code(401).send({ error: 'unauthenticated' });
    const n = await sessions.revokeUser(s.account.uid, s.session.id, 'signed_out_by_user');
    return { ok: true, revoked: n };
  });

  /** Kept for old clients: the default space's map. */
  app.get('/api/maps/hq', async (req, reply) => {
    if (!req.auth) return reply.code(401).send({ error: 'unauthenticated' });
    reply.type('application/json').header('Cache-Control', 'no-store');
    reply.header('X-Map-Rev', String(room.mapRev));
    return room.tmjJson();
  });

  const invites = registerSpaceRoutes(app, { cfg, store, spaces, actorOf });
  // Invite-only accounts (ADR-032): passkeys, links, People and Account APIs
  const ceremonies = new Ceremonies(cfg);
  registerAuthRoutes(app, { cfg, store, sessions, spaces, ceremonies, log: app.log });
  registerPeopleRoutes(app, { cfg, store, sessions, spaces, actorOf, log: app.log });

  // ── Realtime world socket
  const Query = z.object({
    token: z.string(),
    space: z.string().max(64).default(DEFAULT_SPACE),
    resume: z.string().max(64).optional(),
    avatar: z.string().max(500).optional(),
  });
  app.get('/world', { websocket: true }, async (socket, req) => {
    const q = Query.safeParse(req.query);
    const claims = q.success ? verify(q.data.token, cfg.sessionSecret, 'rt') : null;
    if (!q.success || !claims?.sid) {
      socket.close(4401, 'unauthenticated');
      return;
    }
    let avatar;
    try {
      avatar = q.data.avatar ? AvatarSchema.parse(JSON.parse(q.data.avatar)) : undefined;
    } catch {
      avatar = undefined;
    }
    const conn = {
      send: (m: S2CMsg) => {
        if (socket.readyState === socket.OPEN) socket.send(JSON.stringify(m));
      },
      close: (code?: number, reason?: string) => socket.close(code, reason),
    };
    // Buffer messages that arrive before join resolves.
    const early: unknown[] = [];
    const seat: { player?: Player; room?: SpaceRoom } = {};
    let closed = false;
    const sid = claims.sid;
    /** The session ended or rights changed: free the seat at once, no grace window. */
    const detach = sessions.attach(sid, claims.uid, {
      close: (code, reason) => {
        if (seat.player) seat.room!.remove(seat.player);
        socket.close(code, reason);
      },
    });
    socket.on('message', (data) => {
      let parsed: unknown;
      try {
        parsed = JSON.parse(String(data));
      } catch {
        return;
      }
      if (seat.player) seat.room!.handle(seat.player, parsed);
      else early.push(parsed);
    });
    socket.on('close', () => {
      closed = true;
      detach();
      if (seat.player) seat.room!.disconnect(seat.player);
    });
    // Still signed in? The token outlives a revoked session by up to 60 s.
    const account = await store.getAccount(claims.uid).catch(() => null);
    if (!account || !(await sessions.isLive(sid, claims.uid))) {
      socket.close(4401, 'unauthenticated');
      return;
    }
    // Which space, and may this person enter it? (server decides, P2.3, P2.12)
    const actor: Actor = {
      uid: claims.uid,
      role: roleFor(claims.uid, account.role, { builder: claims.b, admin: claims.a }),
    };
    const space = await spaces.get(q.data.space).catch(() => null);
    if (!space) {
      conn.send({ t: 'error', code: 'space_not_found' });
      socket.close(4404, 'space_not_found');
      return;
    }
    if (!(await spaces.allowed(space, actor, 'enter'))) {
      conn.send({ t: 'error', code: 'space_forbidden' });
      socket.close(4405, 'space_forbidden');
      return;
    }
    const [r, member, builder, admin] = await Promise.all([
      spaces.room(space),
      store.getMember(space.id, claims.uid).catch(() => null),
      spaces.allowed(space, actor, 'build'),
      spaces.allowed(space, actor, 'settings'),
    ]);
    if (closed) return;
    const accountName = account.name;
    const player = await r.join(
      conn,
      {
        uid: claims.uid,
        name: member?.displayName || accountName,
        accountName,
        builder,
        // the characters' brain view (P15.3): everyone in development, space admins otherwise
        npcDebug: cfg.env !== 'production' || admin,
      },
      q.data.resume,
      avatar,
    );
    if (!player) {
      conn.send({ t: 'error', code: 'space_full' });
      socket.close(4403, 'space_full');
      return;
    }
    seat.player = player;
    seat.room = r;
    if (socket.readyState !== socket.OPEN) r.disconnect(player);
    for (const m of early) r.handle(player, m);
  });

  // ── Static web build with SPA fallback
  const staticDir = findPath([
    cfg.staticDir,
    join(here, '../../web/dist'),
    join(here, '../public'),
    '/app/public',
  ]);
  if (staticDir) {
    await app.register(fastifyStatic, { root: staticDir, wildcard: false, index: ['index.html'] });
    app.setNotFoundHandler((req, reply) => {
      if (req.method === 'GET' && !req.url.startsWith('/api/') && !req.url.startsWith('/world'))
        return reply.type('text/html').sendFile('index.html');
      return reply.code(404).send({ error: 'not_found' });
    });
    app.log.info({ staticDir }, 'serving web build');
  } else app.log.warn('no web build found; run the Vite dev server (pnpm dev) for the UI');
  const stale = staticDir && cfg.env !== 'production' ? staleWebBuild(staticDir) : undefined;
  if (stale)
    console.error(
      `[agora] port ${cfg.port} serves an OLD web build (${stale.toLocaleString()}): its pages miss recent changes.\n` +
        `[agora] Use http://localhost:5173 (Vite), or run \`pnpm build\` to update the build.`,
    );

  return { app, room, spaces, store, sessions, cfg, staleWebBuild: stale };
}
