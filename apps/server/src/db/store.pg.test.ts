import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PgStore } from './store';

/** Runs against a real Postgres when TEST_DATABASE_URL is set (skipped otherwise). */
const url = process.env.TEST_DATABASE_URL;

describe.skipIf(!url)('PgStore (Postgres)', () => {
  let store: PgStore;
  beforeAll(async () => {
    const c = new pg.Client({ connectionString: url });
    await c.connect();
    await c.query(
      'DROP TABLE IF EXISTS messages, desks, space_desks, maps, presence_sessions, users, spaces, space_members, invites, sessions, passkeys, tickets CASCADE',
    );
    // A pre-spaces database: old desks table with one claimed desk.
    await c.query(`CREATE TABLE desks (desk_id TEXT PRIMARY KEY, owner_id TEXT NOT NULL UNIQUE,
      owner_name TEXT NOT NULL, access TEXT NOT NULL DEFAULT 'open',
      decor_json JSONB NOT NULL DEFAULT '{}'::jsonb, updated_at TIMESTAMPTZ NOT NULL DEFAULT now())`);
    await c.query(
      `INSERT INTO desks (desk_id, owner_id, owner_name) VALUES ('jungle-1', 'u1', 'Ann')`,
    );
    await c.end();
    store = new PgStore(url!);
    await store.init();
    await store.init(); // idempotent
  });
  afterAll(async () => store?.close());

  it('migrates old desks into the default space and scopes desks per space', async () => {
    expect((await store.loadDesks('hq')).map((d) => d.deskId)).toEqual(['jungle-1']);
    const decor = { plant: 0, lamp: 0, poster: 0, plate: '' } as never;
    await store.saveDesk('s-1', {
      deskId: 'jungle-1',
      ownerUid: 'u2',
      ownerName: 'Bo',
      access: 'open',
      decor,
    });
    await store.saveDesk('s-1', {
      deskId: 'jungle-2',
      ownerUid: 'u2',
      ownerName: 'Bo',
      access: 'open',
      decor,
    });
    expect((await store.loadDesks('s-1')).map((d) => d.deskId)).toEqual(['jungle-2']);
    expect((await store.loadDesks('hq')).map((d) => d.ownerUid)).toEqual(['u1']);
  });

  it('scopes Everyone chat per space', async () => {
    const m = {
      id: 'm1',
      scope: 'everyone' as const,
      from: 'p',
      name: 'A',
      body: 'salut',
      at: Date.now(),
      zoneId: null,
    };
    await store.saveMessage('hq', m);
    await store.saveMessage('s-1', { ...m, id: 'm2', body: 'ailleurs' });
    expect((await store.recentMessages('hq')).map((x) => x.body)).toEqual(['salut']);
    expect((await store.recentMessages('s-1')).map((x) => x.body)).toEqual(['ailleurs']);
  });

  it('stores spaces, members and invites with atomic use counting', async () => {
    const s = {
      id: 's-1',
      slug: 'ventes',
      name: 'Ventes',
      ownerUid: 'u2',
      template: 'hq' as const,
      settings: { access: 'invite' as const },
      createdAt: Date.now(),
      archivedAt: null,
    };
    expect(await store.createSpace(s)).toBe(true);
    expect(await store.createSpace({ ...s, id: 's-2' })).toBe(false);
    await store.updateSpace('s-1', {
      name: 'Ventes QC',
      settings: { access: 'open', videoCap: 4 },
    });
    expect(await store.getSpaceBySlug('ventes')).toMatchObject({
      name: 'Ventes QC',
      settings: { videoCap: 4 },
    });
    await store.upsertMember({ spaceId: 's-1', uid: 'u3', role: 'member', displayName: null });
    await store.upsertMember({ spaceId: 's-1', uid: 'u3', role: 'builder', displayName: 'Trois' });
    expect(await store.getMember('s-1', 'u3')).toEqual({
      spaceId: 's-1',
      uid: 'u3',
      role: 'builder',
      displayName: 'Trois',
    });
    expect(await store.membershipsOf('u3')).toHaveLength(1);

    const inv = {
      id: 'i1',
      spaceId: 's-1',
      tokenHash: 'h1',
      role: 'member' as const,
      label: '',
      expiresAt: Date.now() + 60_000,
      maxUses: 2,
      uses: 0,
      createdBy: 'u2',
      createdAt: Date.now(),
      revokedAt: null,
    };
    await store.createInvite(inv);
    const uses = await Promise.all([1, 2, 3, 4].map(() => store.consumeInvite('i1')));
    expect(uses.filter(Boolean)).toHaveLength(2);
    expect((await store.getInviteByHash('h1'))?.uses).toBe(2);
    await store.createInvite({ ...inv, id: 'i2', tokenHash: 'h2', expiresAt: Date.now() - 1 });
    expect(await store.consumeInvite('i2')).toBe(false);
    expect(await store.revokeInvite('s-1', 'i1')).toBe(true);
    expect(await store.revokeInvite('s-1', 'i1')).toBe(false);
    expect((await store.listInvites('s-1')).map((i) => i.id).sort()).toEqual(['i1', 'i2']);
  });

  it('keeps platform roles, one owner, and server-side sessions (P2.12)', async () => {
    for (const u of ['r1', 'r2']) await store.upsertUser({ uid: u, name: u, avatar: null });
    expect((await store.getAccount('r1'))?.role).toBe('member');
    expect(await store.setRole('r1', 'owner')).toBe(true);
    expect(await store.setRole('r2', 'owner')).toBe(false); // users_single_owner
    expect(await store.setRole('r2', 'moderator')).toBe(true);
    expect(await store.setRole('ghost', 'member')).toBe(false);
    // a later name change does not touch the role
    await store.upsertUser({ uid: 'r1', name: 'Renamed', avatar: null });
    expect(await store.getAccount('r1')).toMatchObject({ name: 'Renamed', role: 'owner' });

    const now = Date.now();
    const base = {
      uid: 'r2',
      createdAt: now,
      lastUsedAt: now,
      expiresAt: now + 60_000,
      shared: false,
      userAgent: 'UA',
      ip: '10.0.0.0/24',
      grants: { builder: true },
    };
    await store.createSession({ ...base, id: 'sa', tokenHash: 'ha' });
    await store.createSession({ ...base, id: 'sb', tokenHash: 'hb' });
    await store.createSession({ ...base, id: 'sc', tokenHash: 'hc', expiresAt: now - 1 });
    expect(await store.getSessionByHash('ha')).toMatchObject({
      id: 'sa',
      grants: { builder: true },
    });
    await store.touchSession('sa', now + 5, now + 120_000);
    expect((await store.getSessionByHash('ha'))?.expiresAt).toBe(now + 120_000);
    await store.purgeSessions(now);
    expect((await store.listSessions('r2')).map((x) => x.id).sort()).toEqual(['sa', 'sb']);
    expect(await store.deleteSessionsOf('r2', 'sa')).toEqual(['sb']);
    expect((await store.deleteSession('sa'))?.id).toBe('sa');
    expect(await store.deleteSession('sa')).toBeNull();
  });

  it('stores passkeys and redeems tickets atomically (P2.13–P2.17)', async () => {
    const now = Date.now();
    const ticket = {
      id: 't1',
      kind: 'invite' as const,
      tokenHash: 'th1',
      pinHash: 'ph',
      name: 'Zoé',
      note: '',
      role: 'builder' as const,
      spaces: ['s-1'],
      targetUid: null,
      pilotUid: null,
      expiresAt: now + 60_000,
      createdBy: 'r1',
      createdAt: now,
      revokedAt: null,
      usedAt: null,
      usedBy: null,
      pinFailures: 0,
      lockedAt: null,
    };
    await store.createTicket(ticket);
    expect(await store.getTicketByHash('th1')).toMatchObject({ id: 't1', spaces: ['s-1'] });
    expect(await store.failPin('t1', 2)).toEqual({ failures: 1, locked: false });
    const passkey = {
      id: 'cred-1',
      uid: 'zoe',
      publicKey: 'pk',
      counter: 0,
      transports: ['internal'],
      deviceType: 'multiDevice',
      backedUp: true,
      label: 'Chrome',
      createdAt: now,
      lastUsedAt: now,
    };
    const redeem = {
      ticketId: 't1',
      now,
      uid: 'zoe',
      account: { name: 'Zoé T.', role: 'builder' as const, invitedName: 'Zoé' },
      passkey,
      spaces: ['s-1'],
    };
    const both = await Promise.all([store.redeemTicket(redeem), store.redeemTicket(redeem)]);
    expect(both.filter(Boolean)).toHaveLength(1);
    expect(await store.getAccount('zoe')).toMatchObject({
      name: 'Zoé T.',
      role: 'builder',
      invitedName: 'Zoé',
    });
    expect(await store.getMember('s-1', 'zoe')).toMatchObject({ role: 'member' });
    expect(await store.getPasskey('cred-1')).toMatchObject({ uid: 'zoe', backedUp: true });
    await store.usePasskey('cred-1', 7, now + 1, false);
    expect((await store.listPasskeys('zoe'))[0]).toMatchObject({ counter: 7, backedUp: false });
    expect(await store.renamePasskey('other', 'cred-1', 'x')).toBe(false);
    expect(await store.renamePasskey('zoe', 'cred-1', 'Pixel')).toBe(true);

    // a setup ticket cannot make a second owner: the whole redemption rolls back
    await store.createTicket({
      ...ticket,
      id: 't2',
      tokenHash: 'th2',
      kind: 'setup',
      role: 'owner',
    });
    const second = await store.redeemTicket({
      ...redeem,
      ticketId: 't2',
      uid: 'mallory',
      account: { name: 'M', role: 'owner', invitedName: null },
      passkey: { ...passkey, id: 'cred-2', uid: 'mallory' },
    });
    expect(second).toBe(false);
    expect(await store.getTicket('t2')).toMatchObject({ usedAt: null });
    expect(await store.getPasskey('cred-2')).toBeNull();

    await store.revokeTickets('setup');
    expect((await store.getTicket('t2'))?.revokedAt).not.toBeNull();
    expect(await store.failPin('t2', 2)).toMatchObject({ failures: 1 });
    expect(await store.failPin('t2', 2)).toEqual({ failures: 2, locked: true });

    await store.setDisabled('zoe', now);
    expect((await store.getAccount('zoe'))?.disabledAt).toBe(now);
    expect(await store.deletePasskeysOf('zoe')).toBe(1);
    expect((await store.listAccounts()).map((a) => a.uid)).toContain('zoe');
    await store.deleteUser('zoe');
    expect(await store.getAccount('zoe')).toBeNull();
    expect(await store.ownerUid()).toBe('r1');
  });
});
