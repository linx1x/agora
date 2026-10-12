/**
 * The marketplace board (P17.30, skill agora-world-action): listing escrows the items and takes the
 * fee; a buy is atomic and happens once; expiry and cancel give the items back once; limits per day
 * grow with the account's age. Memory store and, with TEST_DATABASE_URL, Postgres.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { MARKET_ACTIVE_MAX, MARKET_EXPIRY_MS, listingFee, loadGameData } from '@agora/shared';
import { opened, memory, postgres, PG_URL } from './testStores';
import { boardOf, buyListing, cancelListing, listItem, listingIdOf, sweepExpired } from './market';
import type { WorldStore } from './worldStore';

const data = loadGameData();
const S = 'u-seller';
const B = 'u-buyer';
const C = 'u-other';
const CROP = data.items.find((i) => i.category === 'open' && i.kind === 'crop')!.id;
const TOOL = data.items.find((i) => i.category === 'restricted')!.id;
const DAY = 86_400_000;
const T0 = Date.UTC(2026, 9, 11, 16, 0);

async function setBag(store: WorldStore, uid: string, items: Record<string, number>, money: number) {
  await store.withTxn(async (tx) => {
    // first sight in the economy: the starter kit row, so the account's age starts now
    await tx.insertLedger({ key: `seen-${uid}`, actor: uid, worldId: null, kind: 'seen', delta: { items: {}, money: 0 } as never, at: T0 - 30 * DAY });
    await tx.insertLedger({ key: `starter:${uid}`, actor: uid, worldId: null, kind: 'starter', delta: { items: {}, money: 0 } as never, at: T0 - 30 * DAY });
    const a = await tx.accountOf(uid, true);
    await tx.saveAccount(uid, { items, money }, a.rev);
  });
}
const bag = (store: WorldStore, uid: string) =>
  store.withTxn(async (tx) => {
    const a = await tx.accountOf(uid, false);
    tx.abort();
    return a.inventory;
  });

for (const backend of [memory, postgres]) {
  const suite = backend === postgres && !PG_URL ? describe.skip : describe;
  suite(`marketplace board on ${backend.name} (P17.30)`, () => {
    afterEach(async () => {
      while (opened.length) await opened.pop()!();
    });
    async function open(): Promise<WorldStore> {
      const o = await backend.open();
      opened.push(o.close);
      await o.users([S, B, C, 'u-new']);
      await setBag(o.worlds, S, { [CROP]: 10, [TOOL]: 1 }, 100);
      await setBag(o.worlds, B, {}, 500);
      await setBag(o.worlds, C, {}, 500);
      return o.worlds;
    }

    it('listing holds the items and takes the fee; a buy pays the seller and gives the items, once; money is conserved', async () => {
      const store = await open();
      const fee = listingFee(80);
      const listed = await listItem(store, data, { userId: S, item: CROP, qty: 4, price: 80, key: 'list-key-01', now: T0 });
      expect(listed).toMatchObject({ ok: true, listing: { state: 'open', fee } });
      expect(await bag(store, S)).toEqual({ items: { [CROP]: 6, [TOOL]: 1 }, money: 100 - fee });
      // the same key again is the same listing
      expect(await listItem(store, data, { userId: S, item: CROP, qty: 4, price: 80, key: 'list-key-01', now: T0 })).toMatchObject({ ok: true });
      expect((await bag(store, S)).items[CROP]).toBe(6);

      const id = listingIdOf('list-key-01');
      const board = await boardOf(store, B, T0 + 1);
      expect(board.listings).toEqual([{ id, item: CROP, qty: 4, price: 80, expiresAt: T0 + MARKET_EXPIRY_MS, mine: false }]);
      expect(JSON.stringify(board)).not.toContain(S);

      const before = (await bag(store, S)).money + (await bag(store, B)).money;
      expect(await buyListing(store, data, { userId: B, id, key: 'buy-key-001', now: T0 + 2 })).toMatchObject({ ok: true });
      expect(await buyListing(store, data, { userId: B, id, key: 'buy-key-001', now: T0 + 3 })).toMatchObject({ ok: true });
      expect(await buyListing(store, data, { userId: C, id, key: 'buy-key-002', now: T0 + 3 })).toEqual({ ok: false, reason: 'gone' });
      expect(await bag(store, B)).toEqual({ items: { [CROP]: 4 }, money: 420 });
      expect((await bag(store, S)).money).toBe(100 - fee + 80);
      expect((await bag(store, S)).money + (await bag(store, B)).money).toBe(before);
      expect((await boardOf(store, B, T0 + 4)).listings).toEqual([]);
    });

    it('two buyers at once: exactly one gets the listing', async () => {
      const store = await open();
      await listItem(store, data, { userId: S, item: CROP, qty: 2, price: 50, key: 'list-key-02', now: T0 });
      const id = listingIdOf('list-key-02');
      const results = await Promise.all([
        buyListing(store, data, { userId: B, id, key: 'buy-key-101', now: T0 + 1 }),
        buyListing(store, data, { userId: C, id, key: 'buy-key-102', now: T0 + 1 }),
      ]);
      expect(results.filter((r) => r.ok)).toHaveLength(1);
      const got = ((await bag(store, B)).items[CROP] ?? 0) + ((await bag(store, C)).items[CROP] ?? 0);
      expect(got).toBe(2);
      expect((await bag(store, B)).money + (await bag(store, C)).money).toBe(950);
    });

    it('refuses a restricted item, my own listing, too little money, and too many open listings', async () => {
      const store = await open();
      expect(await listItem(store, data, { userId: S, item: TOOL, qty: 1, price: 10, key: 'list-key-03', now: T0 })).toEqual({
        ok: false,
        reason: 'restricted',
      });
      expect(await listItem(store, data, { userId: S, item: CROP, qty: 11, price: 10, key: 'list-key-04', now: T0 })).toEqual({
        ok: false,
        reason: 'missing',
      });
      await listItem(store, data, { userId: S, item: CROP, qty: 1, price: 900, key: 'list-key-05', now: T0 });
      const id = listingIdOf('list-key-05');
      expect(await buyListing(store, data, { userId: S, id, key: 'buy-key-201', now: T0 + 1 })).toEqual({ ok: false, reason: 'own' });
      expect(await buyListing(store, data, { userId: B, id, key: 'buy-key-202', now: T0 + 1 })).toEqual({ ok: false, reason: 'money' });
      for (let i = 1; i < MARKET_ACTIVE_MAX; i++)
        expect((await listItem(store, data, { userId: S, item: CROP, qty: 1, price: 5, key: `list-key-1${i}`, now: T0 + i })).ok).toBe(true);
      expect(await listItem(store, data, { userId: S, item: CROP, qty: 1, price: 5, key: 'list-key-199', now: T0 + 9 })).toEqual({
        ok: false,
        reason: 'active',
      });
    });

    it('a new account lists twice a day; an older one more', async () => {
      const store = await open();
      const NEW = 'u-new';
      await store.withTxn(async (tx) => {
        await tx.insertLedger({ key: 'seen-new', actor: NEW, worldId: null, kind: 'seen', delta: { items: {}, money: 0 } as never, at: T0 });
        await tx.insertLedger({ key: `starter:${NEW}`, actor: NEW, worldId: null, kind: 'starter', delta: { items: {}, money: 0 } as never, at: T0 });
        const a = await tx.accountOf(NEW, true);
        await tx.saveAccount(NEW, { items: { [CROP]: 10 }, money: 100 }, a.rev);
      });
      const list = (uid: string, key: string) => listItem(store, data, { userId: uid, item: CROP, qty: 1, price: 5, key, now: T0 + 1000 });
      expect((await list(NEW, 'list-key-n1')).ok).toBe(true);
      expect((await list(NEW, 'list-key-n2')).ok).toBe(true);
      expect(await list(NEW, 'list-key-n3')).toEqual({ ok: false, reason: 'daily' });
      // the seller has been around for 30 days: more listings a day
      for (const k of ['s1', 's2', 's3']) expect((await list(S, `list-key-${k}`)).ok).toBe(true);
      expect((await boardOf(store, S, T0 + 2000)).limits).toEqual({ list: 10, buy: 30 });
    });

    it('an expired listing gives its items back once, and cannot be bought; a cancel gives them back too', async () => {
      const store = await open();
      await listItem(store, data, { userId: S, item: CROP, qty: 3, price: 30, key: 'list-key-06', now: T0 });
      await listItem(store, data, { userId: S, item: CROP, qty: 2, price: 30, key: 'list-key-07', now: T0 });
      const later = T0 + MARKET_EXPIRY_MS + 1;
      expect(await buyListing(store, data, { userId: B, id: listingIdOf('list-key-06'), key: 'buy-key-301', now: later })).toEqual({
        ok: false,
        reason: 'gone',
      });
      await sweepExpired(store, data, later);
      await sweepExpired(store, data, later + 1);
      expect((await bag(store, S)).items[CROP]).toBe(10);
      expect(await cancelListing(store, data, { userId: S, id: listingIdOf('list-key-06'), now: later })).toEqual({ ok: false, reason: 'gone' });

      await listItem(store, data, { userId: S, item: CROP, qty: 5, price: 30, key: 'list-key-08', now: later });
      expect(await cancelListing(store, data, { userId: B, id: listingIdOf('list-key-08'), now: later + 1 })).toEqual({ ok: false, reason: 'own' });
      expect((await cancelListing(store, data, { userId: S, id: listingIdOf('list-key-08'), now: later + 1 })).ok).toBe(true);
      expect((await bag(store, S)).items[CROP]).toBe(10);
    });
  });
}
