import { afterEach, describe, expect, it } from 'vitest';
import WebSocket from 'ws';
import type { S2CMsg } from '@agora/shared';
import { buildApp, type App } from '../app';
import { loadConfig } from '../config';

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

/** A tiny cookie jar around fastify.inject. */
class Client {
  jar = new Map<string, string>();
  constructor(private a: App) {}
  async req(method: 'GET' | 'POST' | 'PATCH' | 'DELETE', url: string, payload?: object) {
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
    return { status: r.statusCode, body: r.body ? (JSON.parse(r.body) as any) : null }; // eslint-disable-line @typescript-eslint/no-explicit-any
  }
}

const dev = async (a: App, i: number) => {
  const c = new Client(a);
  expect((await c.req('POST', '/api/auth/login', { name: 'x', devUser: i })).status).toBe(200);
  return c;
};

describe('identity (ADR-028)', () => {
  it('keeps the same uid for a returning browser, unless asked not to', async () => {
    const a = await make({ AUTH_MODE: 'access-code', ACCESS_CODE: 'sesame' });
    const c = new Client(a);
    const first = await c.req('POST', '/api/auth/login', { name: 'Zoé', code: 'sesame' });
    expect(first.status).toBe(200);
    await c.req('POST', '/api/auth/logout');
    expect((await c.req('GET', '/api/me')).status).toBe(401);
    const again = await c.req('POST', '/api/auth/login', { name: 'Zoé', code: 'sesame' });
    expect(again.body.uid).toBe(first.body.uid);
    const shared = await c.req('POST', '/api/auth/login', {
      name: 'Zoé',
      code: 'sesame',
      remember: false,
    });
    expect(shared.body.uid).toBe(first.body.uid); // this login still used it…
    const later = await c.req('POST', '/api/auth/login', { name: 'Zoé', code: 'sesame' });
    expect(later.body.uid).not.toBe(first.body.uid); // …but it was forgotten
  });

  it('forgets the device on logout with forget=true and refuses a bad code', async () => {
    const a = await make({ AUTH_MODE: 'access-code', ACCESS_CODE: 'sesame' });
    const c = new Client(a);
    expect((await c.req('POST', '/api/auth/login', { name: 'Zoé', code: 'nope' })).status).toBe(
      401,
    );
    const first = await c.req('POST', '/api/auth/login', { name: 'Zoé', code: 'sesame' });
    await c.req('POST', '/api/auth/logout', { forget: true });
    const again = await c.req('POST', '/api/auth/login', { name: 'Zoé', code: 'sesame' });
    expect(again.body.uid).not.toBe(first.body.uid);
  });
});

describe('platform admin code', () => {
  it('unlocks admin for the session with ADMIN_CODE, and builder with BUILDER_CODE', async () => {
    const a = await make({ ADMIN_CODE: 'admin-code-123', BUILDER_CODE: 'build-123' });
    const bob = await dev(a, 1);
    expect((await bob.req('GET', '/api/spaces/hq')).body.canManage).toBe(false);
    expect((await bob.req('POST', '/api/builder/unlock', { code: 'nope' })).status).toBe(403);
    const b = await bob.req('POST', '/api/builder/unlock', { code: 'build-123' });
    expect(b.body).toEqual({ ok: true, admin: false });
    expect((await bob.req('GET', '/api/spaces/hq')).body).toMatchObject({
      role: 'builder',
      canManage: false,
    });
    const ad = await bob.req('POST', '/api/builder/unlock', { code: 'admin-code-123' });
    expect(ad.body).toEqual({ ok: true, admin: true });
    expect((await bob.req('GET', '/api/me')).body).toMatchObject({ admin: true, builder: true });
    expect((await bob.req('GET', '/api/spaces/hq')).body.canManage).toBe(true);
  });
});

describe('spaces (P2.3)', () => {
  it('has an open default space everyone can see and enter', async () => {
    const a = await make();
    const bob = await dev(a, 1);
    const list = await bob.req('GET', '/api/spaces');
    expect(list.body.spaces.map((s: { slug: string }) => s.slug)).toEqual(['hq']);
    expect(list.body.canCreate).toBe(true);
    const hq = await bob.req('GET', '/api/spaces/hq');
    expect(hq.body).toMatchObject({ slug: 'hq', access: 'open', canManage: false, role: null });
    expect((await bob.req('GET', '/api/spaces/hq/map')).status).toBe(200);
    expect((await new Client(a).req('GET', '/api/spaces')).status).toBe(401);
  });

  it('creates invite-only spaces that only members see; owners manage settings', async () => {
    const a = await make();
    const alice = await dev(a, 0);
    const bob = await dev(a, 1);
    const made = await alice.req('POST', '/api/spaces', { name: 'Équipe Ventes', slug: 'ventes' });
    expect(made.status).toBe(201);
    expect(made.body).toMatchObject({ slug: 'ventes', role: 'owner', canManage: true });
    expect(made.body.settings.access).toBe('invite');
    expect((await bob.req('POST', '/api/spaces', { name: 'Autre', slug: 'ventes' })).status).toBe(
      409,
    );
    expect((await bob.req('POST', '/api/spaces', { name: 'API', slug: 'api' })).status).toBe(400);
    expect((await bob.req('POST', '/api/spaces', { name: 'Bad', slug: 'Bad Slug' })).status).toBe(
      400,
    );

    const bobList = await bob.req('GET', '/api/spaces');
    expect(bobList.body.spaces.map((s: { slug: string }) => s.slug)).toEqual(['hq']);
    expect((await bob.req('GET', '/api/spaces/ventes')).status).toBe(403);
    expect((await bob.req('GET', '/api/spaces/ventes/map')).status).toBe(403);
    expect((await bob.req('GET', '/api/spaces/nope')).status).toBe(404);

    const settings = { ...made.body.settings, name: 'Ventes', connectR: 4, disconnectR: 5 };
    expect((await bob.req('PATCH', '/api/spaces/ventes', settings)).status).toBe(403);
    const patched = await alice.req('PATCH', '/api/spaces/ventes', settings);
    expect(patched.body.settings).toMatchObject({ name: 'Ventes', connectR: 4, disconnectR: 5 });
    const bad = await alice.req('PATCH', '/api/spaces/ventes', { ...settings, disconnectR: 3 });
    expect(bad.status).toBe(400);
  });

  it('applies settings live to the loaded room and keeps the default space open', async () => {
    const a = await make({ ADMIN_IDS: 'dev-chloe' });
    const chloe = await dev(a, 2);
    const hq = (await chloe.req('GET', '/api/spaces/hq')).body;
    expect(hq.canManage).toBe(true);
    const r = await chloe.req('PATCH', '/api/spaces/hq', {
      ...hq.settings,
      access: 'invite',
      videoCap: 4,
      name: 'Siège',
    });
    expect(r.body.settings).toMatchObject({ access: 'open', videoCap: 4, name: 'Siège' });
    expect(
      (a.room as unknown as { opts: { clientConfig: { videoCap: number } } }).opts.clientConfig
        .videoCap,
    ).toBe(4);
  });

  it('limits how many spaces a person owns and can restrict creation to admins', async () => {
    const a = await make();
    const bob = await dev(a, 1);
    for (let i = 0; i < 5; i++)
      expect(
        (await bob.req('POST', '/api/spaces', { name: `S${i}`, slug: `bob-${i}` })).status,
      ).toBe(201);
    expect((await bob.req('POST', '/api/spaces', { name: 'S5', slug: 'bob-5' })).body.error).toBe(
      'too_many_spaces',
    );
    const b = await make({ SPACE_CREATION: 'admins', ADMIN_IDS: 'dev-alice' });
    expect((await (await dev(b, 1)).req('GET', '/api/spaces')).body.canCreate).toBe(false);
    expect(
      (await (await dev(b, 1)).req('POST', '/api/spaces', { name: 'x', slug: 'xyz' })).status,
    ).toBe(403);
    expect(
      (await (await dev(b, 0)).req('POST', '/api/spaces', { name: 'x', slug: 'xyz' })).status,
    ).toBe(201);
  });
});

describe('invites (P2.4)', () => {
  async function setup() {
    const a = await make({ AUTH_MODE: 'access-code', ACCESS_CODE: 'sesame' });
    const owner = new Client(a);
    await owner.req('POST', '/api/auth/login', { name: 'Owner', code: 'sesame' });
    await owner.req('POST', '/api/spaces', { name: 'Projet X', slug: 'projet-x' });
    return { a, owner };
  }

  it('lets a person with a link sign in without the access code and join with its role', async () => {
    const { a, owner } = await setup();
    const inv = await owner.req('POST', '/api/spaces/projet-x/invites', {
      role: 'builder',
      maxUses: 1,
      expiresInHours: 24,
    });
    expect(inv.status).toBe(201);
    const token: string = inv.body.token;
    expect(inv.body.path).toBe(`/join/${token}`);

    const guest = new Client(a);
    const preview = await guest.req('GET', `/api/invites/${token}`);
    expect(preview.body).toMatchObject({ spaceName: 'Projet X', slug: 'projet-x', valid: true });
    expect((await guest.req('POST', `/api/invites/${token}/accept`)).status).toBe(401);
    expect(
      (await guest.req('POST', '/api/auth/login', { name: 'Invitée', invite: 'wrong' })).status,
    ).toBe(401);
    expect(
      (await guest.req('POST', '/api/auth/login', { name: 'Invitée', invite: token })).status,
    ).toBe(200);
    const acc = await guest.req('POST', `/api/invites/${token}/accept`);
    expect(acc.body).toEqual({ slug: 'projet-x', role: 'builder' });
    const detail = await guest.req('GET', '/api/spaces/projet-x');
    expect(detail.body).toMatchObject({ role: 'builder', canManage: false });
    // accepting again is a no-op and does not use the link up further
    expect((await guest.req('POST', `/api/invites/${token}/accept`)).status).toBe(200);

    const late = new Client(a);
    await late.req('POST', '/api/auth/login', { name: 'Late', code: 'sesame' });
    expect((await late.req('GET', `/api/invites/${token}`)).body).toMatchObject({
      valid: false,
      reason: 'used_up',
    });
    expect((await late.req('POST', `/api/invites/${token}/accept`)).status).toBe(410);
    expect((await late.req('GET', '/api/spaces/projet-x')).status).toBe(403);
    // a used-up link no longer replaces the access code
    expect(
      (await new Client(a).req('POST', '/api/auth/login', { name: 'X', invite: token })).status,
    ).toBe(401);
  });

  it('lists and revokes invites, and only managers can', async () => {
    const { a, owner } = await setup();
    const inv = await owner.req('POST', '/api/spaces/projet-x/invites', { label: 'Pilote' });
    const list = await owner.req('GET', '/api/spaces/projet-x/invites');
    expect(list.body.invites).toHaveLength(1);
    expect(list.body.invites[0]).toMatchObject({ label: 'Pilote', role: 'member', active: true });
    expect(JSON.stringify(list.body)).not.toContain(inv.body.token);

    const member = new Client(a);
    await member.req('POST', '/api/auth/login', { name: 'M', invite: inv.body.token });
    await member.req('POST', `/api/invites/${inv.body.token}/accept`);
    expect((await member.req('GET', '/api/spaces/projet-x/invites')).status).toBe(403);
    expect((await member.req('POST', '/api/spaces/projet-x/invites', {})).status).toBe(403);

    const id = inv.body.invite.id;
    expect((await member.req('DELETE', `/api/spaces/projet-x/invites/${id}`)).status).toBe(403);
    expect((await owner.req('DELETE', `/api/spaces/projet-x/invites/${id}`)).status).toBe(200);
    expect((await owner.req('DELETE', `/api/spaces/projet-x/invites/${id}`)).status).toBe(404);
    expect((await owner.req('GET', `/api/invites/${inv.body.token}`)).body.reason).toBe('revoked');
  });

  it('never grants a role stronger than the inviter has', async () => {
    const { a, owner } = await setup();
    const adminLink = await owner.req('POST', '/api/spaces/projet-x/invites', { role: 'admin' });
    const adm = new Client(a);
    await adm.req('POST', '/api/auth/login', { name: 'Adm', invite: adminLink.body.token });
    await adm.req('POST', `/api/invites/${adminLink.body.token}/accept`);
    expect((await adm.req('GET', '/api/spaces/projet-x')).body.canManage).toBe(true);
    expect((await adm.req('POST', '/api/spaces/projet-x/invites', { role: 'owner' })).status).toBe(
      400,
    );
    expect((await adm.req('POST', '/api/spaces/projet-x/invites', { role: 'admin' })).status).toBe(
      201,
    );
  });

  it('sets a per-space display name that the room uses', async () => {
    const { owner } = await setup();
    const r = await owner.req('PATCH', '/api/spaces/projet-x/me', { displayName: 'Chef' });
    expect(r.body.displayName).toBe('Chef');
    const cleared = await owner.req('PATCH', '/api/spaces/projet-x/me', { displayName: '' });
    expect(cleared.body.displayName).toBeNull();
  });
});

describe('world socket: space access is decided by the server', () => {
  it('refuses non-members of an invite-only space and admits members', async () => {
    const a = await make();
    await a.app.listen({ port: 0, host: '127.0.0.1' });
    const port = (a.app.server.address() as { port: number }).port;
    const alice = await dev(a, 0);
    const bob = await dev(a, 1);
    await alice.req('POST', '/api/spaces', { name: 'Privé', slug: 'prive' });

    const connect = async (c: Client, space: string) => {
      const { token } = (await c.req('POST', '/api/session/realtime-token')).body;
      const ws = new WebSocket(`ws://127.0.0.1:${port}/world?token=${token}&space=${space}`);
      return new Promise<{ first: S2CMsg; code?: number }>((resolve) => {
        let first: S2CMsg | undefined;
        ws.on('message', (d) => {
          first ??= JSON.parse(String(d)) as S2CMsg;
          if (first.t === 'welcome') {
            resolve({ first });
            ws.close();
          }
        });
        ws.on('close', (code) => resolve({ first: first!, code }));
      });
    };
    const refused = await connect(bob, 'prive');
    expect(refused.first).toEqual({ t: 'error', code: 'space_forbidden' });
    expect(refused.code).toBe(4405);
    expect((await connect(bob, 'nowhere')).code).toBe(4404);
    const ok = await connect(alice, 'prive');
    expect(ok.first.t).toBe('welcome');
    expect((ok.first as Extract<S2CMsg, { t: 'welcome' }>).spaceName).toBe('Privé');
    expect((await connect(bob, 'hq')).first.t).toBe('welcome');
  });
});
