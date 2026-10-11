/**
 * The swap of a direct trade (P17.29): both sides or nothing, once per trade id, on the memory store
 * and, with TEST_DATABASE_URL, on Postgres. Duplication, missing items, full bags, and two trades of
 * the same single item at once.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { INVENTORY_SLOTS, loadGameData, totalsOf } from '@agora/shared';
import { opened, memory, postgres, PG_URL } from './testStores';
import { executeTrade } from './trade';
import type { WorldStore } from './worldStore';

const data = loadGameData();
const A = 'u-trade-a';
const B = 'u-trade-b';
const C = 'u-trade-c';
const CROP = data.items.find((i) => i.category === 'open' && i.kind === 'crop')!.id;
const FISH = data.items.find((i) => i.category === 'open' && i.kind === 'fish')!.id;
const TOOL = data.items.find((i) => i.category === 'restricted' && i.kind === 'tool')!.id;
const NOW = Date.UTC(2026, 9, 11);

async function setBag(store: WorldStore, uid: string, items: Record<string, number>, money: number) {
  await store.withTxn(async (tx) => {
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
  suite(`trade swap on ${backend.name} (P17.29)`, () => {
    afterEach(async () => {
      while (opened.length) await opened.pop()!();
    });
    async function open(): Promise<WorldStore> {
      const o = await backend.open();
      opened.push(o.close);
      await o.users([A, B, C]);
      return o.worlds;
    }

    it('swaps both sides at once, writes a ledger row per side, and conserves items and money', async () => {
      const store = await open();
      await setBag(store, A, { [CROP]: 5 }, 100);
      await setBag(store, B, { [FISH]: 2 }, 300);
      const before = [totalsOf(await bag(store, A)), totalsOf(await bag(store, B))];
      const r = await executeTrade(store, data, {
        id: 'aaaaaaaaaaaa',
        a: { uid: A, offer: { items: { [CROP]: 3 }, money: 0 } },
        b: { uid: B, offer: { items: { [FISH]: 1 }, money: 50 } },
        now: NOW,
      });
      expect(r).toEqual({ ok: true });
      expect(await bag(store, A)).toEqual({ items: { [CROP]: 2, [FISH]: 1 }, money: 150 });
      expect(await bag(store, B)).toEqual({ items: { [FISH]: 1, [CROP]: 3 }, money: 250 });
      const after = [totalsOf(await bag(store, A)), totalsOf(await bag(store, B))];
      expect(after[0]!.money + after[1]!.money).toBe(before[0]!.money + before[1]!.money);
      const rows = await store.withTxn((tx) => Promise.all([tx.ledgerOf(`trade-aaaaaaaaaaaa-${A}`), tx.ledgerOf(`trade-aaaaaaaaaaaa-${B}`)]));
      expect(rows[0]).toMatchObject({ actor: A, kind: 'trade', delta: { items: { [CROP]: -3, [FISH]: 1 }, money: 50 } });
      expect(rows[1]).toMatchObject({ actor: B, kind: 'trade', delta: { items: { [FISH]: -1, [CROP]: 3 }, money: -50 } });
    });

    it('the same trade twice swaps once (a resent confirm after a reconnect duplicates nothing)', async () => {
      const store = await open();
      await setBag(store, A, { [CROP]: 5 }, 0);
      await setBag(store, B, {}, 100);
      const req = {
        id: 'bbbbbbbbbbbb',
        a: { uid: A, offer: { items: { [CROP]: 5 }, money: 0 } },
        b: { uid: B, offer: { items: {}, money: 100 } },
        now: NOW,
      };
      const both = await Promise.all([executeTrade(store, data, req), executeTrade(store, data, req)]);
      expect(both.filter((r) => r.ok)).toHaveLength(1);
      expect(await executeTrade(store, data, req)).toEqual({ ok: false, reason: 'gone' });
      expect(await bag(store, A)).toEqual({ items: {}, money: 100 });
      expect(await bag(store, B)).toEqual({ items: { [CROP]: 5 }, money: 0 });
    });

    it('refuses what a side does not hold, and a restricted item; nothing moves', async () => {
      const store = await open();
      await setBag(store, A, { [CROP]: 1, [TOOL]: 1 }, 10);
      await setBag(store, B, {}, 10);
      const missing = await executeTrade(store, data, {
        id: 'cccccccccccc',
        a: { uid: A, offer: { items: { [CROP]: 2 }, money: 0 } },
        b: { uid: B, offer: { items: {}, money: 5 } },
        now: NOW,
      });
      expect(missing).toEqual({ ok: false, reason: 'missing' });
      const broke = await executeTrade(store, data, {
        id: 'cccccccccccd',
        a: { uid: A, offer: { items: { [CROP]: 1 }, money: 0 } },
        b: { uid: B, offer: { items: {}, money: 11 } },
        now: NOW,
      });
      expect(broke).toEqual({ ok: false, reason: 'missing' });
      const tool = await executeTrade(store, data, {
        id: 'ccccccccccce',
        a: { uid: A, offer: { items: { [TOOL]: 1 }, money: 0 } },
        b: { uid: B, offer: { items: {}, money: 5 } },
        now: NOW,
      });
      expect(tool).toEqual({ ok: false, reason: 'restricted' });
      expect(await bag(store, A)).toEqual({ items: { [CROP]: 1, [TOOL]: 1 }, money: 10 });
      expect(await bag(store, B)).toEqual({ items: {}, money: 10 });
    });

    it('refuses a side whose bag is full, and moves nothing', async () => {
      const store = await open();
      const open36 = data.items.filter((i) => i.category === 'open' && i.id !== CROP).slice(0, INVENTORY_SLOTS);
      await setBag(store, B, Object.fromEntries(open36.map((i) => [i.id, 1])), 0);
      await setBag(store, A, { [CROP]: 1 }, 0);
      const r = await executeTrade(store, data, {
        id: 'dddddddddddd',
        a: { uid: A, offer: { items: { [CROP]: 1 }, money: 0 } },
        b: { uid: B, offer: { items: {}, money: 0 } },
        now: NOW,
      });
      expect(r).toEqual({ ok: false, reason: 'full' });
      expect((await bag(store, A)).items[CROP]).toBe(1);
    });

    it('two trades of the same single item at once: exactly one goes through', async () => {
      const store = await open();
      await setBag(store, A, { [FISH]: 1 }, 0);
      await setBag(store, B, {}, 50);
      await setBag(store, C, {}, 50);
      const results = await Promise.all([
        executeTrade(store, data, {
          id: 'eeeeeeeeeee1',
          a: { uid: A, offer: { items: { [FISH]: 1 }, money: 0 } },
          b: { uid: B, offer: { items: {}, money: 50 } },
          now: NOW,
        }),
        executeTrade(store, data, {
          id: 'eeeeeeeeeee2',
          a: { uid: A, offer: { items: { [FISH]: 1 }, money: 0 } },
          b: { uid: C, offer: { items: {}, money: 50 } },
          now: NOW,
        }),
      ]);
      expect(results.filter((r) => r.ok)).toHaveLength(1);
      const fish = ((await bag(store, B)).items[FISH] ?? 0) + ((await bag(store, C)).items[FISH] ?? 0);
      expect(fish).toBe(1);
      expect((await bag(store, A)).money).toBe(50);
      expect((await bag(store, B)).money + (await bag(store, C)).money).toBe(50);
    });
  });
}
