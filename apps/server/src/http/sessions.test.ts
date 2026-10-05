import { createHash, randomBytes } from 'node:crypto';
import { afterEach, describe, expect, it } from 'vitest';
import WebSocket from 'ws';
import type { PlatformRole, S2CMsg } from '@agora/shared';
import { buildApp, type App } from '../app';
import { loadConfig } from '../config';
import { MemoryStore } from '../db/store';
import { Sessions, coarseIp } from './sessions';

const SECRET = 'x'.repeat(40);
const apps: App[] = [];
afterEach(async () => {
  while (apps.length) await apps.pop()!.app.close();
});

async function make(env: Record<string, string> = {}) {
  const a = await buildApp(
    loadConfig({
      NODE_ENV: 'test',
      LOG_LEVEL: 'silent',
      SESSION_SECRET: SECRET,
      AUTH_MODE: 'dev',
      ...env,
    }),
  );
  apps.push(a);
  return a;
}

type Res = { status: number; body: any; cookies: { name: string; maxAge?: number }[] }; // eslint-disable-line @typescript-eslint/no-explicit-any

/** A tiny cookie jar around fastify.inject. */
class Client {
  jar = new Map<string, string>();
  constructor(
    private a: App,
    private headers: Record<string, string> = {},
  ) {}
  async req(
    method: 'GET' | 'POST' | 'PATCH' | 'DELETE',
    url: string,
    payload?: object,
    headers: Record<string, string> = {},
  ): Promise<Res> {
    const r = await this.a.app.inject({
      method,
      url,
      payload,
      headers: {
        ...this.headers,
        ...headers,
        cookie: [...this.jar].map(([k, v]) => `${k}=${v}`).join('; '),
      },
    });
    for (const c of r.cookies) {
      if (!c.value || (c.maxAge !== undefined && c.maxAge <= 0) || c.expires?.getTime() === 0)
        this.jar.delete(c.name);
      else this.jar.set(c.name, c.value);
    }
    return {
      status: r.statusCode,
      body: r.body ? JSON.parse(r.body) : null,
      cookies: r.cookies,
    };
  }
}

const dev = async (a: App, i: number, extra: object = {}) => {
  const c = new Client(a);
  const r = await c.req('POST', '/api/auth/login', { name: 'x', devUser: i, ...extra });
  expect(r.status).toBe(200);
  return c;
};

/**
 * Passkey mode has no sign-in route until P2.14: create the account and a session row
 * directly, the way the passkey ceremony will.
 */
async function signInAs(a: App, uid: string, role: PlatformRole) {
  await a.store.upsertUser({ uid, name: uid, avatar: null });
  expect(await a.store.setRole(uid, role)).toBe(true);
  const token = randomBytes(32).toString('base64url');
  const now = Date.now();
  await a.store.createSession({
    id: `s-${uid}`,
    tokenHash: createHash('sha256').update(token).digest('base64url'),
    uid,
    createdAt: now,
    lastUsedAt: now,
    expiresAt: now + 86400_000,
    shared: false,
    userAgent: 'test',
    ip: '',
    grants: {},
  });
  const c = new Client(a);
  c.jar.set(a.sessions.cookieName, token);
  return c;
}

async function listen(a: App) {
  await a.app.listen({ port: 0, host: '127.0.0.1' });
  return (a.app.server.address() as { port: number }).port;
}

/** Open the world socket; resolves on welcome (socket kept open) or on close. */
async function world(port: number, c: Client, space = 'hq') {
  const { token } = (await c.req('POST', '/api/session/realtime-token')).body;
  const ws = new WebSocket(`ws://127.0.0.1:${port}/world?token=${token}&space=${space}`);
  const closed = new Promise<number>((resolve) => ws.on('close', (code) => resolve(code)));
  const first = await new Promise<S2CMsg | { closed: number }>((resolve) => {
    ws.once('message', (d) => resolve(JSON.parse(String(d)) as S2CMsg));
    void closed.then((code) => resolve({ closed: code }));
  });
  return { ws, first, closed };
}

describe('server-side sessions (P2.12)', () => {
  it('stores only a hash, and a cookie stops working after logout', async () => {
    const a = await make();
    const c = await dev(a, 0);
    const token = c.jar.get('agora_session')!;
    expect(token).toBeTruthy();
    const rows = await a.store.listSessions('dev-alice');
    expect(rows).toHaveLength(1);
    expect(rows[0]!.tokenHash).not.toContain(token);
    expect((await c.req('GET', '/api/me')).status).toBe(200);
    await c.req('POST', '/api/auth/logout');
    expect(await a.store.listSessions('dev-alice')).toHaveLength(0);
    // replaying the old cookie (stolen, or kept by a careless browser) fails
    const replay = new Client(a);
    replay.jar.set('agora_session', token);
    expect((await replay.req('GET', '/api/me')).status).toBe(401);
  });

  it('gives a fresh session id on every sign-in', async () => {
    const a = await make();
    const c = await dev(a, 0);
    const first = c.jar.get('agora_session')!;
    await c.req('POST', '/api/auth/login', { name: 'x', devUser: 0 });
    expect(c.jar.get('agora_session')).not.toBe(first);
    expect(await a.store.listSessions('dev-alice')).toHaveLength(1);
    const old = new Client(a);
    old.jar.set('agora_session', first);
    expect((await old.req('GET', '/api/me')).status).toBe(401);
  });

  it('uses 30-day persistent sessions, or 12 h browser sessions on a shared computer', async () => {
    const a = await make({ AUTH_MODE: 'access-code', ACCESS_CODE: 'sesame' });
    const long = new Client(a);
    const r1 = await long.req('POST', '/api/auth/login', { name: 'Zoé', code: 'sesame' });
    const c1 = r1.cookies.find((c) => c.name === 'agora_session')!;
    expect(c1.maxAge).toBeGreaterThan(29 * 86400);
    const shared = new Client(a);
    const r2 = await shared.req('POST', '/api/auth/login', {
      name: 'Léa',
      code: 'sesame',
      remember: false,
    });
    const c2 = r2.cookies.find((c) => c.name === 'agora_session')!;
    expect(c2.maxAge).toBeUndefined();
    const s = (await a.store.listSessions(r2.body.uid))[0]!;
    expect(s.shared).toBe(true);
    expect(s.expiresAt - s.createdAt).toBe(12 * 3600_000);
  });

  it('uses a __Host- cookie over https', async () => {
    const a = await make({ COOKIE_SECURE: 'true' });
    const c = new Client(a);
    const r = await c.req('POST', '/api/auth/login', { name: 'x', devUser: 0 });
    expect(r.cookies.map((x) => x.name)).toContain('__Host-agora_session');
    expect((await c.req('GET', '/api/me')).status).toBe(200);
  });

  it('lists my sessions and signs out my other devices', async () => {
    const a = await make();
    const laptop = await dev(a, 0);
    const phone = await dev(a, 0);
    const list = (await laptop.req('GET', '/api/me/sessions')).body.sessions;
    expect(list).toHaveLength(2);
    expect(list.filter((s: { current: boolean }) => s.current)).toHaveLength(1);
    expect(list[0]).not.toHaveProperty('tokenHash');
    const r = await laptop.req('POST', '/api/me/sessions/revoke-others');
    expect(r.body.revoked).toBe(1);
    expect((await phone.req('GET', '/api/me')).status).toBe(401);
    expect((await laptop.req('GET', '/api/me')).status).toBe(200);
  });

  it("cannot end someone else's session", async () => {
    const a = await make();
    const alice = await dev(a, 0);
    const bob = await dev(a, 1);
    const [bobs] = await a.store.listSessions('dev-benoit');
    expect((await alice.req('DELETE', `/api/me/sessions/${bobs!.id}`)).status).toBe(404);
    expect((await bob.req('GET', '/api/me')).status).toBe(200);
  });

  it('refuses a disabled account', async () => {
    const a = await make({ AUTH_MODE: 'passkey' });
    const c = await signInAs(a, 'u-dis', 'member');
    expect((await c.req('GET', '/api/me')).status).toBe(200);
    (a.store as MemoryStore)['roles'].get('u-dis')!.disabledAt = Date.now();
    a.sessions.rightsChanged('u-dis');
    expect((await c.req('GET', '/api/me')).status).toBe(401);
  });
});

describe('revocation reaches the world at once (P2.12)', () => {
  it('closes the socket with 4401 and frees the seat when the session ends', async () => {
    const a = await make();
    const port = await listen(a);
    const laptop = await dev(a, 0);
    const phone = await dev(a, 0);
    const w = await world(port, phone);
    expect((w.first as S2CMsg).t).toBe('welcome');
    expect(a.room.connectedCount).toBe(1);
    await laptop.req('POST', '/api/me/sessions/revoke-others');
    expect(await w.closed).toBe(4401);
    expect([...a.room['players'].values()]).toHaveLength(0); // no grace-window ghost
  });

  it('refuses a realtime token minted before logout', async () => {
    const a = await make();
    const port = await listen(a);
    const c = await dev(a, 0);
    const { token } = (await c.req('POST', '/api/session/realtime-token')).body;
    await c.req('POST', '/api/auth/logout');
    const ws = new WebSocket(`ws://127.0.0.1:${port}/world?token=${token}&space=hq`);
    expect(await new Promise((r) => ws.on('close', (code) => r(code)))).toBe(4401);
  });

  it('closes with 4409 when rights change, so the client reconnects with new ones', async () => {
    const a = await make({ AUTH_MODE: 'passkey' });
    const port = await listen(a);
    const c = await signInAs(a, 'u-m', 'member');
    const w = await world(port, c);
    expect((w.first as Extract<S2CMsg, { t: 'welcome' }>).builder).toBe(false);
    await a.store.setRole('u-m', 'builder');
    a.sessions.rightsChanged('u-m');
    expect(await w.closed).toBe(4409);
    const again = await world(port, c);
    expect((again.first as Extract<S2CMsg, { t: 'welcome' }>).builder).toBe(true);
    again.ws.close();
  });
});

describe('cross-site requests are refused (P2.12)', () => {
  it('checks Origin on state-changing API calls', async () => {
    const a = await make({ PUBLIC_ORIGIN: 'https://agora.example.com' });
    const c = new Client(a, { host: 'localhost:3000' });
    const login = (origin?: string, site?: string) =>
      c.req(
        'POST',
        '/api/auth/login',
        { name: 'x', devUser: 0 },
        {
          ...(origin ? { origin } : {}),
          ...(site ? { 'sec-fetch-site': site } : {}),
        },
      );
    expect((await login('https://evil.example')).status).toBe(403);
    expect((await login('null')).status).toBe(403);
    expect((await login(undefined, 'cross-site')).status).toBe(403);
    expect((await login('http://localhost:3000')).status).toBe(200);
    expect((await login('https://agora.example.com')).status).toBe(200);
    expect((await login(undefined, 'same-origin')).status).toBe(200);
    // reads are not state-changing
    expect(
      (await c.req('GET', '/api/me', undefined, { origin: 'https://evil.example' })).status,
    ).toBe(200);
  });
});

describe('passkey mode: the platform role decides (P2.12, ADR-032)', () => {
  it('has no name-and-code sign-in, and ignores env grants', async () => {
    const a = await make({ AUTH_MODE: 'passkey', ADMIN_IDS: 'u-mem', BUILDER_IDS: 'u-mem' });
    expect(
      (await new Client(a).req('POST', '/api/auth/login', { name: 'x', devUser: 0 })).body,
    ).toEqual({ error: 'use_passkey' });
    const m = await signInAs(a, 'u-mem', 'member');
    const me = (await m.req('GET', '/api/me')).body;
    expect(me).toMatchObject({ role: 'member', admin: false, builder: false, adminCode: false });
    expect((await m.req('POST', '/api/builder/unlock', { code: 'whatever-long' })).status).toBe(
      400,
    );
  });

  it('lets only the owner create spaces and invites; moderators edit settings', async () => {
    const a = await make({ AUTH_MODE: 'passkey' });
    const owner = await signInAs(a, 'u-own', 'owner');
    const mod = await signInAs(a, 'u-mod', 'moderator');
    const mem = await signInAs(a, 'u-mem', 'member');
    expect((await mem.req('POST', '/api/spaces', { name: 'X', slug: 'xx' })).status).toBe(403);
    expect((await mod.req('POST', '/api/spaces', { name: 'X', slug: 'xx' })).status).toBe(403);
    const created = await owner.req('POST', '/api/spaces', {
      name: 'Équipe',
      slug: 'equipe',
      access: 'open',
    });
    expect(created.status).toBe(201);
    expect(created.body).toMatchObject({ canManage: true, canInvite: true });

    const settings = { ...created.body.settings, name: 'Équipe 2' };
    expect((await mem.req('PATCH', '/api/spaces/equipe', settings)).status).toBe(403);
    expect((await mod.req('PATCH', '/api/spaces/equipe', settings)).status).toBe(200);
    expect((await mod.req('GET', '/api/spaces/equipe')).body).toMatchObject({
      canManage: true,
      canInvite: false,
    });
    expect((await mod.req('POST', '/api/spaces/equipe/invites', {})).status).toBe(403);
    expect((await mem.req('POST', '/api/spaces/equipe/invites', {})).status).toBe(403);
    expect((await owner.req('POST', '/api/spaces/equipe/invites', {})).status).toBe(201);
  });

  it('a space list entry only grants entry, never powers', async () => {
    const a = await make({ AUTH_MODE: 'passkey' });
    const owner = await signInAs(a, 'u-own', 'owner');
    const mem = await signInAs(a, 'u-mem', 'member');
    const out = await signInAs(a, 'u-out', 'member');
    const created = await owner.req('POST', '/api/spaces', { name: 'Privé', slug: 'prive' });
    const sp = (await a.store.getSpaceBySlug('prive'))!;
    // a pilot-era "admin" row: in passkey mode it only puts u-mem on the list
    await a.store.upsertMember({ spaceId: sp.id, uid: 'u-mem', role: 'admin', displayName: null });
    expect((await out.req('GET', '/api/spaces/prive')).status).toBe(403);
    const d = (await mem.req('GET', '/api/spaces/prive')).body;
    expect(d).toMatchObject({ canManage: false, canInvite: false });
    const settings = { ...created.body.settings, name: 'Pris' };
    expect((await mem.req('PATCH', '/api/spaces/prive', settings)).status).toBe(403);
    // the owner enters everything
    expect(
      (await owner.req('GET', '/api/spaces')).body.spaces.map((s: { slug: string }) => s.slug),
    ).toContain('prive');
  });

  it('build mode follows the role in the world', async () => {
    const a = await make({ AUTH_MODE: 'passkey' });
    const port = await listen(a);
    const b = await signInAs(a, 'u-b', 'builder');
    const m = await signInAs(a, 'u-m', 'member');
    const wb = await world(port, b);
    const wm = await world(port, m);
    expect((wb.first as Extract<S2CMsg, { t: 'welcome' }>).builder).toBe(true);
    expect((wm.first as Extract<S2CMsg, { t: 'welcome' }>).builder).toBe(false);
    wb.ws.close();
    wm.ws.close();
  });
});

describe('pilot modes keep their env grants (ADR-029)', () => {
  it('ADMIN_IDS act as owner, BUILDER_IDS as builder', async () => {
    const a = await make({ ADMIN_IDS: 'dev-alice', BUILDER_IDS: 'dev-benoit' });
    expect((await (await dev(a, 0)).req('GET', '/api/me')).body).toMatchObject({
      role: 'owner',
      admin: true,
    });
    expect((await (await dev(a, 1)).req('GET', '/api/me')).body).toMatchObject({
      role: 'builder',
      builder: true,
      admin: false,
    });
    expect((await (await dev(a, 2)).req('GET', '/api/me')).body.role).toBe('member');
  });
});

describe('Sessions unit', () => {
  const cfg = loadConfig({ NODE_ENV: 'test', SESSION_SECRET: SECRET, AUTH_MODE: 'dev' });
  const fakeReply = () => {
    const set: { name: string; value: string; maxAge?: number }[] = [];
    return {
      set,
      setCookie: (name: string, value: string, o: { maxAge?: number }) =>
        set.push({ name, value, maxAge: o.maxAge }),
      clearCookie: () => {},
    };
  };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const fakeReq = (cookie?: string): any => ({
    cookies: cookie ? { agora_session: cookie } : {},
    headers: { 'user-agent': 'UA' },
    ip: '203.0.113.7',
    auth: null,
  });

  it('slides the expiry forward when used, but not for shared sessions', async () => {
    const store = new MemoryStore();
    await store.upsertUser({ uid: 'u', name: 'U', avatar: null });
    let now = 1_000_000_000_000;
    const s = new Sessions(cfg, store, { info: () => {} }, () => now);
    const r = fakeReply();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const row = await s.issue(fakeReq(), r as any, 'u', { shared: false });
    expect(row.ip).toBe('203.0.113.0/24');
    const token = r.set[0]!.value;
    now += 20 * 86400_000; // 20 days later, still inside 30
    const r2 = fakeReply();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const auth = await s.resolve(fakeReq(token), r2 as any);
    expect(auth?.session.expiresAt).toBe(now + 30 * 86400_000);
    expect(r2.set[0]?.maxAge).toBe(30 * 86400); // cookie pushed forward too
    now += 31 * 86400_000; // unused for 31 days: gone
    expect(await s.resolve(fakeReq(token))).toBeNull();
    expect(await store.listSessions('u')).toHaveLength(0);

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const sh = await s.issue(fakeReq(), fakeReply() as any, 'u', { shared: true });
    now += 13 * 3600_000;
    expect(await s.isLive(sh.id, 'u')).toBe(false);
  });

  it('coarsens addresses', () => {
    expect(coarseIp('::ffff:10.1.2.3')).toBe('10.1.2.0/24');
    expect(coarseIp('2001:db8:abcd:12::1')).toBe('2001:db8:abcd::/48');
    expect(coarseIp(undefined)).toBe('');
  });

  it('keeps a single owner', async () => {
    const store = new MemoryStore();
    for (const u of ['a', 'b']) await store.upsertUser({ uid: u, name: u, avatar: null });
    expect(await store.setRole('a', 'owner')).toBe(true);
    expect(await store.setRole('b', 'owner')).toBe(false);
    expect(await store.setRole('a', 'owner')).toBe(true);
    expect(await store.setRole('ghost', 'member')).toBe(false);
    expect((await store.getAccount('b'))!.role).toBe('member');
  });
});
