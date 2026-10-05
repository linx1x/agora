import { afterEach, describe, expect, it } from 'vitest';
import WebSocket from 'ws';
import type { CreatedLink, PersonSummary, S2CMsg } from '@agora/shared';
import { buildApp, type App } from '../app';
import { ConfigError, loadConfig } from '../config';
import { ensureSetupLink, ownerRecoveryLink } from './bootstrap';
import { SoftAuthenticator } from './softAuthenticator';

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
      AUTH_MODE: 'passkey',
      ...env,
    }),
  );
  apps.push(a);
  return a;
}

type Res = { status: number; body: any }; // eslint-disable-line @typescript-eslint/no-explicit-any

/** A browser: cookie jar + its own passkeys. */
class Browser {
  jar = new Map<string, string>();
  key: SoftAuthenticator;
  constructor(
    private a: App,
    key?: SoftAuthenticator,
  ) {
    this.key = key ?? new SoftAuthenticator();
  }
  async req(
    method: 'GET' | 'POST' | 'PATCH' | 'DELETE',
    url: string,
    payload?: object,
  ): Promise<Res> {
    const r = await this.a.app.inject({
      method,
      url,
      payload,
      headers: { cookie: [...this.jar].map(([k, v]) => `${k}=${v}`).join('; ') },
    });
    for (const c of r.cookies) {
      if (!c.value || (c.maxAge !== undefined && c.maxAge <= 0) || c.expires?.getTime() === 0)
        this.jar.delete(c.name);
      else this.jar.set(c.name, c.value);
    }
    return { status: r.statusCode, body: r.body ? JSON.parse(r.body) : null };
  }

  /** open a link (/join#token…), type the PIN, make a passkey */
  async claim(path: string, pin?: string | null, name?: string, shared = false) {
    const token = path.split('#')[1]!;
    const opts = await this.req('POST', '/api/tickets/options', {
      token,
      ...(pin ? { pin } : {}),
      ...(name ? { name } : {}),
    });
    if (opts.status !== 200) return opts;
    const response = this.key.create(opts.body.options);
    return this.req('POST', '/api/tickets/verify', {
      flowId: opts.body.flowId,
      response,
      shared,
      ...(name ? { name } : {}),
    });
  }

  /** "Se connecter avec une clé d'accès" */
  async signIn(shared = false) {
    const o = await this.req('POST', '/api/auth/passkey/options');
    const response = this.key.get(o.body.options);
    return this.req('POST', '/api/auth/passkey/verify', {
      flowId: o.body.flowId,
      response,
      shared,
    });
  }
}

/** First boot: the console link makes the owner. */
async function owner(a: App) {
  const link = await ensureSetupLinkFor(a);
  const b = new Browser(a);
  const r = await b.claim(link, null, 'Camille');
  expect(r.status).toBe(200);
  return b;
}
async function ensureSetupLinkFor(a: App) {
  const url = await ensureSetupLink(a.cfg, a.store);
  return new URL(url!).pathname + new URL(url!).hash;
}

async function invite(owner: Browser, body: object = {}) {
  const r = await owner.req('POST', '/api/admin/invites', { name: 'Zoé Tremblay', ...body });
  expect(r.status).toBe(201);
  return r.body as CreatedLink;
}

describe('owner bootstrap (P2.13)', () => {
  it('makes the owner from the setup link, once', async () => {
    const a = await make();
    const first = await ensureSetupLinkFor(a);
    const link = await ensureSetupLinkFor(a); // a restart replaces the link
    const b = new Browser(a);
    expect((await b.claim(first, null, 'Camille')).status).toBe(404);
    expect((await b.claim(link, null, 'Camille')).body).toMatchObject({ ok: true, kind: 'setup' });
    expect((await b.req('GET', '/api/me')).body).toMatchObject({ role: 'owner', name: 'Camille' });
    // used, and no new link while an owner exists
    expect((await new Browser(a).claim(link, null, 'Mallory')).status).toBe(404);
    expect(await ensureSetupLink(a.cfg, a.store)).toBeNull();
  });

  it('owner:recover adds a passkey to the owner from a new device', async () => {
    const a = await make();
    const o = await owner(a);
    const r = await ownerRecoveryLink(a.cfg, a.store);
    expect(r.kind).toBe('recovery');
    const laptop = new Browser(a);
    const u = new URL(r.url);
    expect((await laptop.claim(u.pathname + u.hash)).body).toMatchObject({ kind: 'recovery' });
    expect((await laptop.req('GET', '/api/me')).body.role).toBe('owner');
    expect((await o.req('GET', '/api/me/passkeys')).body.passkeys).toHaveLength(2);
  });

  it('there is never a second owner', async () => {
    const a = await make();
    await owner(a);
    const uid = 'u-x';
    await a.store.upsertUser({ uid, name: 'X', avatar: null });
    expect(await a.store.setRole(uid, 'owner')).toBe(false);
  });
});

describe('passkey sign-in (P2.14)', () => {
  it('signs in with a passkey and nothing else', async () => {
    const a = await make();
    const o = await owner(a);
    const phone = new Browser(a, o.key); // same synced passkey, new browser
    const r = await phone.signIn();
    expect(r.status).toBe(200);
    expect((await phone.req('GET', '/api/me')).body.role).toBe('owner');
    // name + code sign-in does not exist here
    expect((await new Browser(a).req('POST', '/api/auth/login', { name: 'x' })).status).toBe(403);
  });

  it('refuses unknown passkeys, a replayed answer and a wrong origin', async () => {
    const a = await make();
    const o = await owner(a);
    const stranger = new Browser(a);
    stranger.key.create({
      rp: { id: 'localhost' },
      user: { id: 'dS14' },
      challenge: 'x',
    });
    expect((await stranger.signIn()).status).toBe(401);

    const b = new Browser(a, o.key);
    const opts = await b.req('POST', '/api/auth/passkey/options');
    const response = o.key.get(opts.body.options);
    const flow = { flowId: opts.body.flowId, response };
    expect((await b.req('POST', '/api/auth/passkey/verify', flow)).status).toBe(200);
    expect((await b.req('POST', '/api/auth/passkey/verify', flow)).status).toBe(401);

    const evil = new Browser(a, o.key);
    o.key.origin = 'https://evil.example';
    expect((await evil.signIn()).status).toBe(401);
    o.key.origin = 'http://localhost:80';
  });

  it('requires user verification, not just a tap', async () => {
    const a = await make();
    const link = await ensureSetupLinkFor(a);
    const b = new Browser(a, new SoftAuthenticator('http://localhost:80', false));
    expect((await b.claim(link, null, 'Camille')).status).toBe(400);
  });

  it('keeps a shared-computer sign-in short', async () => {
    const a = await make();
    const o = await owner(a);
    const kiosk = new Browser(a, o.key);
    await kiosk.signIn(true);
    const sessions = (await kiosk.req('GET', '/api/me/sessions')).body.sessions;
    const mine = sessions.find((s: { current: boolean }) => s.current);
    expect(mine.shared).toBe(true);
    expect(mine.expiresAt - mine.createdAt).toBe(12 * 3600_000);
  });
});

describe('invites (P2.15)', () => {
  it('PIN invite: the name shows after the PIN, five wrong PINs lock it', async () => {
    const a = await make();
    const o = await owner(a);
    const inv = await invite(o);
    expect(inv.pin).toMatch(/^\d{6}$/);
    expect(inv.path.startsWith('/join#')).toBe(true);
    const token = inv.path.split('#')[1]!;
    const z = new Browser(a);
    const pv = await z.req('POST', '/api/tickets/preview', { token });
    expect(pv.body).toMatchObject({ kind: 'invite', needsPin: true, name: '' });
    const wrong = inv.pin === '000000' ? '111111' : '000000';
    const r1 = await z.req('POST', '/api/tickets/check', { token, pin: wrong });
    expect(r1.body).toEqual({ error: 'bad_pin', left: 4 });
    for (let i = 0; i < 3; i++) await z.req('POST', '/api/tickets/check', { token, pin: wrong });
    expect((await z.req('POST', '/api/tickets/check', { token, pin: wrong })).body.error).toBe(
      'invalid',
    );
    // locked for good, even with the right PIN
    expect((await z.req('POST', '/api/tickets/check', { token, pin: inv.pin })).status).toBe(404);
    const list = (await o.req('GET', '/api/admin/invites')).body.invites;
    expect(list[0].status).toBe('locked');
  });

  it('claims with the PIN: role, spaces, chosen name; the link then is dead', async () => {
    const a = await make();
    const o = await owner(a);
    await o.req('POST', '/api/spaces', { name: 'Projet X', slug: 'projet-x', access: 'invite' });
    const sp = (await a.store.getSpaceBySlug('projet-x'))!;
    const inv = await invite(o, { role: 'builder', spaces: [sp.id, 'nope'] });
    expect(inv.invite.spaces).toEqual([sp.id]);
    const z = new Browser(a);
    const token = inv.path.split('#')[1]!;
    expect((await z.req('POST', '/api/tickets/check', { token, pin: inv.pin })).body.name).toBe(
      'Zoé Tremblay',
    );
    expect((await z.claim(inv.path)).body.error).toBe('pin_required');
    const r = await z.claim(inv.path, inv.pin, 'Zoé T.');
    expect(r.body).toMatchObject({ ok: true, kind: 'invite' });
    expect((await z.req('GET', '/api/me')).body).toMatchObject({
      role: 'builder',
      name: 'Zoé T.',
      invitedName: 'Zoé Tremblay',
    });
    expect((await z.req('GET', '/api/spaces/projet-x')).status).toBe(200);
    expect((await new Browser(a).claim(inv.path, inv.pin)).status).toBe(404);
    const people: PersonSummary[] = (await o.req('GET', '/api/admin/people')).body.people;
    expect(people.find((p) => p.name === 'Zoé T.')).toMatchObject({
      invitedName: 'Zoé Tremblay',
      spaces: [sp.id],
      passkeys: 1,
      pilot: false,
    });
  });

  it('open link: no PIN, first come; revoked and expired links fail', async () => {
    const a = await make();
    const o = await owner(a);
    const open = await invite(o, { protection: 'open' });
    expect(open.pin).toBeNull();
    expect((await new Browser(a).claim(open.path)).status).toBe(200);

    const revoked = await invite(o, { protection: 'open' });
    expect((await o.req('DELETE', `/api/admin/invites/${revoked.invite.id}`)).status).toBe(200);
    expect((await new Browser(a).claim(revoked.path)).status).toBe(404);

    const old = await invite(o, { protection: 'open', expiresInHours: 1 });
    const t = (await a.store.getTicket(old.invite.id))!;
    await a.store.createTicket({ ...t, id: 't-old', tokenHash: 'h-old' }); // unrelated row
    (a.store as unknown as { tickets: Map<string, { expiresAt: number }> }).tickets.get(
      old.invite.id,
    )!.expiresAt = Date.now() - 1;
    expect((await new Browser(a).claim(old.path)).status).toBe(404);
  });

  it('only the owner invites', async () => {
    const a = await make();
    const o = await owner(a);
    const mod = new Browser(a);
    await mod.claim((await invite(o, { role: 'moderator', protection: 'open' })).path);
    expect((await mod.req('GET', '/api/me')).body.role).toBe('moderator');
    expect((await mod.req('POST', '/api/admin/invites', { name: 'X' })).status).toBe(403);
    expect((await mod.req('GET', '/api/admin/people')).status).toBe(403);
    expect((await mod.req('GET', '/api/admin/invites')).status).toBe(403);
    // and nobody can invite an owner
    expect((await o.req('POST', '/api/admin/invites', { name: 'X', role: 'owner' })).status).toBe(
      400,
    );
  });

  it('claims a pilot identity: same uid, its old sessions end', async () => {
    const a = await make();
    const o = await owner(a);
    const pilot = 'u-pilot';
    await a.store.upsertUser({ uid: pilot, name: 'Ancien nom', avatar: null });
    await a.store.saveDesk('hq', {
      deskId: 'd1',
      ownerUid: pilot,
      ownerName: 'Ancien nom',
      access: 'open',
      decor: {} as never,
    });
    await a.store.createSession({
      id: 's-old',
      tokenHash: 'old',
      uid: pilot,
      createdAt: Date.now(),
      lastUsedAt: Date.now(),
      expiresAt: Date.now() + 1e6,
      shared: false,
      userAgent: '',
      ip: '',
      grants: {},
    });
    const people: PersonSummary[] = (await o.req('GET', '/api/admin/people')).body.people;
    expect(people.find((p) => p.uid === pilot)?.pilot).toBe(true);
    const inv = await invite(o, { pilotUid: pilot, protection: 'open', name: 'Léa' });
    const r = await new Browser(a).claim(inv.path);
    expect(r.body.uid).toBe(pilot);
    expect(await a.store.listSessions(pilot)).toHaveLength(1); // only the new one
    expect((await a.store.loadDesks('hq'))[0]?.ownerUid).toBe(pilot);
    // claimed once: a second invite for it is refused
    expect(
      (await o.req('POST', '/api/admin/invites', { name: 'Léa', pilotUid: pilot })).status,
    ).toBe(409);
  });
});

describe('people page (P2.16)', () => {
  async function withMember(a: App) {
    const o = await owner(a);
    const z = new Browser(a);
    const r = await z.claim((await invite(o, { protection: 'open' })).path);
    return { o, z, uid: r.body.uid as string };
  }

  it('changes role and name; their socket reconnects with the new rights', async () => {
    const a = await make();
    const { o, z, uid } = await withMember(a);
    await a.app.listen({ port: 0, host: '127.0.0.1' });
    const port = (a.app.server.address() as { port: number }).port;
    const { token } = (await z.req('POST', '/api/session/realtime-token')).body;
    const ws = new WebSocket(`ws://127.0.0.1:${port}/world?token=${token}&space=hq`);
    const first = await new Promise<S2CMsg>((r) =>
      ws.once('message', (d) => r(JSON.parse(String(d)))),
    );
    expect((first as Extract<S2CMsg, { t: 'welcome' }>).builder).toBe(false);
    const closed = new Promise<number>((r) => ws.on('close', (c) => r(c)));
    const p = await o.req('PATCH', `/api/admin/people/${uid}`, { role: 'builder', name: 'Zed' });
    expect(p.body).toMatchObject({ role: 'builder', name: 'Zed', invitedName: 'Zoé Tremblay' });
    expect(await closed).toBe(4409);
    expect((await z.req('GET', '/api/me')).body).toMatchObject({ role: 'builder', name: 'Zed' });
  });

  it('never touches the owner', async () => {
    const a = await make();
    const { o } = await withMember(a);
    const me = (await o.req('GET', '/api/me')).body.uid;
    expect((await o.req('PATCH', `/api/admin/people/${me}`, { role: 'member' })).status).toBe(404);
    expect((await o.req('DELETE', `/api/admin/people/${me}`)).status).toBe(404);
    expect((await o.req('POST', `/api/admin/people/${me}/recovery`, {})).status).toBe(404);
  });

  it('recovery link: optionally ends their sessions and passkeys, then adds a new one', async () => {
    const a = await make();
    const { o, z, uid } = await withMember(a);
    const r = await o.req('POST', `/api/admin/people/${uid}/recovery`, { revokeExisting: true });
    expect(r.status).toBe(201);
    expect(r.body.path.startsWith('/recover#')).toBe(true);
    expect((await z.req('GET', '/api/me')).status).toBe(401);
    expect(await a.store.listPasskeys(uid)).toHaveLength(0);
    const newPhone = new Browser(a);
    expect((await newPhone.claim(r.body.path)).body.error).toBe('pin_required');
    const done = await newPhone.claim(r.body.path, r.body.pin);
    expect(done.body).toMatchObject({ kind: 'recovery', uid });
    expect((await newPhone.req('GET', '/api/me')).body.uid).toBe(uid);
    // the old passkey is gone for good
    expect((await new Browser(a, z.key).signIn()).status).toBe(401);
  });

  it('removing someone ends everything at once', async () => {
    const a = await make();
    const { o, z, uid } = await withMember(a);
    expect((await o.req('DELETE', `/api/admin/people/${uid}`)).status).toBe(200);
    expect((await z.req('GET', '/api/me')).status).toBe(401);
    expect((await new Browser(a, z.key).signIn()).status).toBe(401);
    const people: PersonSummary[] = (await o.req('GET', '/api/admin/people')).body.people;
    expect(people.some((p) => p.uid === uid)).toBe(false);
  });

  it('lists and ends their sessions', async () => {
    const a = await make();
    const { o, z, uid } = await withMember(a);
    const list = (await o.req('GET', `/api/admin/people/${uid}/sessions`)).body.sessions;
    expect(list).toHaveLength(1);
    expect((await o.req('DELETE', `/api/admin/people/${uid}/sessions/${list[0].id}`)).status).toBe(
      200,
    );
    expect((await z.req('GET', '/api/me')).status).toBe(401);
  });
});

describe('my passkeys (P2.17)', () => {
  it('adds, renames and removes passkeys, but never the last one', async () => {
    const a = await make();
    const o = await owner(a);
    const keys = (await o.req('GET', '/api/me/passkeys')).body.passkeys;
    expect(keys).toHaveLength(1);
    expect((await o.req('DELETE', `/api/me/passkeys/${keys[0].id}`)).body.error).toBe(
      'last_passkey',
    );
    // add a second device (another authenticator, same session)
    const phone = new SoftAuthenticator();
    const opts = await o.req('POST', '/api/me/passkeys/options');
    expect(opts.body.options.excludeCredentials).toHaveLength(1);
    const added = await o.req('POST', '/api/me/passkeys/verify', {
      flowId: opts.body.flowId,
      response: phone.create(opts.body.options),
    });
    expect(added.status).toBe(201);
    expect(
      (await o.req('PATCH', `/api/me/passkeys/${added.body.id}`, { label: 'Téléphone' })).status,
    ).toBe(200);
    expect((await o.req('DELETE', `/api/me/passkeys/${keys[0].id}`)).status).toBe(200);
    expect((await new Browser(a, phone).signIn()).status).toBe(200);
  });

  it('asks for a fresh passkey check when the sign-in is old (stolen cookie)', async () => {
    const a = await make();
    const o = await owner(a);
    const uid = (await o.req('GET', '/api/me')).body.uid;
    // a 2-hour-old session for the owner, e.g. a cookie copied off a laptop
    const token = 'stolen-cookie-secret-0123456789abcdefghijklmnop';
    const { createHash } = await import('node:crypto');
    await a.store.createSession({
      id: 's-old',
      tokenHash: createHash('sha256').update(token).digest('base64url'),
      uid,
      createdAt: Date.now() - 2 * 3600_000,
      lastUsedAt: Date.now(),
      expiresAt: Date.now() + 86400_000,
      shared: false,
      userAgent: '',
      ip: '',
      grants: {},
    });
    const thief = new Browser(a);
    thief.jar.set(a.sessions.cookieName, token);
    expect((await thief.req('GET', '/api/me')).status).toBe(200);
    expect((await thief.req('POST', '/api/me/passkeys/options')).body.error).toBe(
      'reauth_required',
    );
    const key = (await thief.req('GET', '/api/me/passkeys')).body.passkeys[0].id;
    expect((await thief.req('DELETE', `/api/me/passkeys/${key}`)).body.error).toBe(
      'reauth_required',
    );
    // without the owner's passkey the thief cannot pass the check…
    const o1 = await thief.req('POST', '/api/auth/passkey/options');
    const fake = new SoftAuthenticator();
    fake.create({
      rp: { id: 'localhost' },
      user: { id: Buffer.from(uid).toString('base64url') },
      challenge: 'x',
    });
    expect(
      (
        await thief.req('POST', '/api/auth/passkey/reauth', {
          flowId: o1.body.flowId,
          response: fake.get(o1.body.options),
        })
      ).status,
    ).toBe(401);
    // …the owner can, on the same session
    const owned = new Browser(a, o.key);
    owned.jar.set(a.sessions.cookieName, token);
    const o2 = await owned.req('POST', '/api/auth/passkey/options');
    expect(
      (
        await owned.req('POST', '/api/auth/passkey/reauth', {
          flowId: o2.body.flowId,
          response: o.key.get(o2.body.options),
        })
      ).status,
    ).toBe(200);
    expect((await owned.req('POST', '/api/me/passkeys/options')).status).toBe(200);
  });

  it("cannot finish someone else's add-passkey flow", async () => {
    const a = await make();
    const o = await owner(a);
    const z = new Browser(a);
    await z.claim((await invite(o, { protection: 'open' })).path);
    const opts = await o.req('POST', '/api/me/passkeys/options');
    const r = await z.req('POST', '/api/me/passkeys/verify', {
      flowId: opts.body.flowId,
      response: z.key.create(opts.body.options),
    });
    expect(r.status).toBe(400);
  });
});

describe('config for passkey mode in production', () => {
  const prod = (env: Record<string, string>) => () =>
    loadConfig({
      NODE_ENV: 'production',
      AUTH_MODE: 'passkey',
      SESSION_SECRET: SECRET,
      PUBLIC_ORIGIN: 'https://agora.example.com',
      ...env,
    });
  it('needs PUBLIC_ORIGIN and a real secret, refuses env roles, checks the RP ID', () => {
    expect(prod({})().passkeyRpId).toBe('agora.example.com');
    expect(prod({ PUBLIC_ORIGIN: '' })).toThrow(ConfigError);
    expect(prod({ SESSION_SECRET: 'short' })).toThrow(ConfigError);
    expect(prod({ ADMIN_IDS: 'u1' })).toThrow(ConfigError);
    expect(prod({ PASSKEY_RP_ID: 'other.com' })).toThrow(ConfigError);
    expect(prod({ PASSKEY_RP_ID: 'example.com' })().passkeyRpId).toBe('example.com');
  });
});
