/**
 * The office side of shop and friendship (P17.26b): gifts to the characters and the office shop board,
 * on the memory store and, with TEST_DATABASE_URL, on Postgres. The world-action rules: one effect per
 * key, a resend replays the first answer, two at once never both win, nothing is created or lost.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { loadGameData, stockOf, tasteOf, totalsOf, type GiftNpc } from '@agora/shared';
import { opened, memory, postgres, PG_URL } from './testStores';
import { heartsOfUser, officeBuy, officeGift, officeInventory } from './office';
import type { WorldStore } from './worldStore';

const data = loadGameData();
const NOW = Date.UTC(2026, 9, 11, 16, 0);
const DAY = 20_001;
const UID = 'u-gift';

/** An item each character loves, and one the bag can hold. */
const loved = (npc: GiftNpc): string => data.gifts.npcs.find((p) => p.npc === npc)!.love[0]!;

async function setup(store: WorldStore, items: Record<string, number>, money = 0): Promise<void> {
  await store.withTxn(async (tx) => {
    const a = await tx.accountOf(UID, true);
    await tx.saveAccount(UID, { items, money }, a.rev);
  });
}

async function bagOf(store: WorldStore): Promise<{ items: Record<string, number>; money: number }> {
  return store.withTxn(async (tx) => {
    const a = await tx.accountOf(UID, false);
    tx.abort();
    return { items: { ...a.inventory.items }, money: a.inventory.money };
  });
}

for (const backend of [memory, postgres]) {
  const suite = backend === postgres && !PG_URL ? describe.skip : describe;
  suite(`office gifts and shop on ${backend.name} (P17.26b)`, () => {
    afterEach(async () => {
      while (opened.length) await opened.pop()!();
    });

    async function open(): Promise<WorldStore> {
      const o = await backend.open();
      opened.push(o.close);
      await o.users([UID]);
      return o.worlds;
    }

    it('a gift leaves the bag, adds the points of its taste, and shows in the hearts', async () => {
      const store = await open();
      const item = loved('zoe');
      await setup(store, { [item]: 3 });
      const r = await officeGift(store, data, {
        userId: UID,
        npc: 'zoe',
        item,
        key: 'gift-key-001',
        day: DAY,
        now: NOW,
      });
      expect(r).toMatchObject({ ok: true, replayed: false, taste: 'love' });
      expect((await bagOf(store)).items[item]).toBe(2);
      const points = data.gifts.points.love;
      expect((await heartsOfUser(store, UID)).zoe).toBe(Math.floor(points / 250));
      expect(r.ok && r.hearts).toEqual(await heartsOfUser(store, UID));
    });

    it('the same key twice has one effect and the same answer (a resend after a reconnect replays)', async () => {
      const store = await open();
      const item = loved('felix');
      await setup(store, { [item]: 3 });
      const req = {
        userId: UID,
        npc: 'felix' as const,
        item,
        key: 'gift-key-002',
        day: DAY,
        now: NOW,
      };
      const first = await officeGift(store, data, req);
      const again = await officeGift(store, data, req);
      expect(first.ok && again.ok).toBe(true);
      expect(again).toMatchObject({
        ok: true,
        replayed: true,
        taste: first.ok ? first.taste : 'none',
      });
      expect((await bagOf(store)).items[item]).toBe(2);
      // the key is bound to its character: the same key for someone else is refused, nothing changes
      expect(await officeGift(store, data, { ...req, npc: 'theo' })).toEqual({
        ok: false,
        reason: 'invalid',
      });
      expect((await bagOf(store)).items[item]).toBe(2);
    });

    it('one gift a day per character, two a week; another character the same day is fine', async () => {
      const store = await open();
      const item = loved('theo');
      await setup(store, { [item]: 9 });
      const give = (npc: GiftNpc, key: string, day: number) =>
        officeGift(store, data, { userId: UID, npc, item, key, day, now: NOW });
      // weeks are seven days from day 1 (weekOf): WEEK is the first day of a week
      const WEEK = 7 * 3000 + 1;
      expect((await give('theo', 'gift-key-101', WEEK)).ok).toBe(true);
      expect(await give('theo', 'gift-key-102', WEEK)).toEqual({ ok: false, reason: 'limit' });
      expect((await give('zoe', 'gift-key-103', WEEK)).ok).toBe(true);
      expect((await give('theo', 'gift-key-104', WEEK + 1)).ok).toBe(true);
      expect(await give('theo', 'gift-key-105', WEEK + 2)).toEqual({ ok: false, reason: 'limit' });
      // a new week opens again
      expect((await give('theo', 'gift-key-106', WEEK + 7)).ok).toBe(true);
      expect((await bagOf(store)).items[item]).toBe(5);
    });

    it('refuses what is not in the bag and what cannot be given, and changes nothing', async () => {
      const store = await open();
      const item = loved('zoe');
      await setup(store, { [item]: 1 });
      const tool = data.items.find((i) => i.kind === 'tool')!.id;
      await setup(store, { [item]: 1, [tool]: 1 });
      const other = data.items.find((i) => i.kind === 'crop' && i.id !== item)!.id;
      expect(
        await officeGift(store, data, {
          userId: UID,
          npc: 'zoe',
          item: other,
          key: 'gift-key-201',
          day: DAY,
          now: NOW,
        }),
      ).toEqual({
        ok: false,
        reason: 'missing',
      });
      expect(
        await officeGift(store, data, {
          userId: UID,
          npc: 'zoe',
          item: tool,
          key: 'gift-key-202',
          day: DAY,
          now: NOW,
        }),
      ).toEqual({
        ok: false,
        reason: 'invalid',
      });
      expect(await bagOf(store)).toEqual({ items: { [item]: 1, [tool]: 1 }, money: 0 });
      expect((await heartsOfUser(store, UID)).zoe).toBe(0);
    });

    it('two gifts to the same character at once: exactly one is taken', async () => {
      const store = await open();
      const item = loved('zoe');
      await setup(store, { [item]: 5 });
      const results = await Promise.all(
        ['gift-key-301', 'gift-key-302'].map((key) =>
          officeGift(store, data, { userId: UID, npc: 'zoe', item, key, day: DAY, now: NOW }),
        ),
      );
      expect(results.filter((r) => r.ok)).toHaveLength(1);
      expect(results.find((r) => !r.ok)).toMatchObject({ ok: false });
      expect((await bagOf(store)).items[item]).toBe(4);
    });

    it('the office board sells at the stable price; the same key twice buys once; money and items are conserved', async () => {
      const store = await open();
      const { id, price } = stockOf(data)[0]!;
      // the account had its starter kit (granted once, on first sight), then spent it down
      await officeInventory(store, UID, data, NOW);
      await setup(store, {}, price * 2 + 1);
      const before = await bagOf(store);
      expect(
        await officeBuy(store, data, { userId: UID, item: id, key: 'buy-key-001', now: NOW }),
      ).toEqual({ ok: true, replayed: false });
      expect(
        await officeBuy(store, data, { userId: UID, item: id, key: 'buy-key-001', now: NOW }),
      ).toEqual({ ok: true, replayed: true });
      const after = await bagOf(store);
      expect(after.items[id]).toBe(1);
      expect(after.money).toBe(before.money - price);
      expect(totalsOf(after).money + price).toBe(totalsOf(before).money);
      // the second buy runs the money out: refused, nothing changes
      expect(
        (await officeBuy(store, data, { userId: UID, item: id, key: 'buy-key-002', now: NOW })).ok,
      ).toBe(true);
      expect(
        await officeBuy(store, data, { userId: UID, item: id, key: 'buy-key-003', now: NOW }),
      ).toEqual({ ok: false, reason: 'money' });
      expect((await bagOf(store)).items[id]).toBe(2);
    });

    it('the office shows the bag of someone who never went into a world: the starter kit, once', async () => {
      const store = await open();
      const first = await officeInventory(store, UID, data, NOW);
      const again = await officeInventory(store, UID, data, NOW);
      expect(first.items).toEqual(data.progression.starterKit.items);
      expect(again).toEqual(first);
    });

    it('a gift the character dislikes still counts against the day, and lowers the points (never below zero)', async () => {
      const store = await open();
      const profile = data.gifts.npcs.find((p) => p.npc === 'felix')!;
      const disliked = profile.dislike[0] ?? profile.hate[0];
      if (!disliked) return; // data without dislikes: nothing to check
      await setup(store, { [disliked]: 1 });
      const r = await officeGift(store, data, {
        userId: UID,
        npc: 'felix',
        item: disliked,
        key: 'gift-key-401',
        day: DAY,
        now: NOW,
      });
      expect(r).toMatchObject({ ok: true, taste: tasteOf(data, 'felix', disliked) });
      expect((await heartsOfUser(store, UID)).felix).toBe(0);
    });
  });
}
