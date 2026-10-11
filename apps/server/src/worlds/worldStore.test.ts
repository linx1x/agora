import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { ChunkDelta } from '@agora/shared';
import { MemoryStore, PgStore, type Store } from '../db/store';
import type { StoredWorld } from './worldStore';

/**
 * Runs the Postgres half against a real database when TEST_DATABASE_URL is set (skipped otherwise).
 * Each run gets a schema of its own, dropped afterwards, so it can share the database.
 */
const url = process.env.TEST_DATABASE_URL;

const SEED = 3560865791; // above 2^31: the seed column must hold an unsigned 32-bit value

function worldOf(owner: string): StoredWorld {
  return {
    id: `u:${owner}`,
    ownerId: owner,
    seed: SEED,
    genVersion: 1,
    createdAt: 1_700_000_000_000,
    lastDay: 0,
    settings: { visitors: 'open' },
  };
}

function patches(count: number, block = 'tilled_soil'): ChunkDelta {
  const delta: ChunkDelta = {};
  for (let i = 0; i < count; i++) delta[String(i)] = { block };
  return delta;
}

/** The contract every world store must meet, run on the memory and the Postgres store. */
function worldStoreContract(
  name: string,
  open: () => Promise<{ store: Store; close(): Promise<void> }>,
  skip = false,
) {
  const suite = skip ? describe.skip : describe;
  suite(`world store (${name})`, () => {
    let store: Store;
    let close: () => Promise<void>;
    beforeAll(async () => {
      const h = await open();
      store = h.store;
      close = h.close;
    });
    afterAll(async () => close?.());

    const user = (uid: string) => store.upsertUser({ uid, name: uid, avatar: null });

    it('creates one world per owner and per id', async () => {
      await user('w-a');
      expect(await store.worlds.createWorld(worldOf('w-a'))).toBe(true);
      expect(await store.worlds.createWorld({ ...worldOf('w-a'), id: 'u:other' })).toBe(false);
      const got = await store.worlds.worldOf('w-a');
      expect(got).toMatchObject({ id: 'u:w-a', seed: SEED, genVersion: 1, lastDay: 0, settings: { visitors: 'open' } });
      expect(await store.worlds.getWorld('u:w-a')).toEqual(got);
    });

    it('records the last simulated day', async () => {
      await store.worlds.setLastDay('u:w-a', 42);
      expect((await store.worlds.getWorld('u:w-a'))?.lastDay).toBe(42);
    });

    it('saves a chunk only from the current revision', async () => {
      expect(await store.worlds.saveChunk('u:w-a', 0, 0, patches(2), 0)).toEqual({ ok: true, rev: 1 });
      expect(await store.worlds.saveChunk('u:w-a', 0, 0, patches(3), 0)).toEqual({ ok: false, reason: 'conflict' });
      expect(await store.worlds.saveChunk('u:w-a', 0, 0, patches(3), 1)).toEqual({ ok: true, rev: 2 });
    });

    it('loads only the stored chunks among those asked for', async () => {
      const chunks = await store.worlds.loadChunks('u:w-a', [
        { cx: 0, cy: 0 },
        { cx: 5, cy: 5 },
      ]);
      expect(chunks).toHaveLength(1);
      expect(chunks[0]).toMatchObject({ cx: 0, cy: 0, cells: 3, rev: 2 });
      expect(Object.keys(chunks[0]?.delta ?? {})).toHaveLength(3);
      expect(await store.worlds.loadChunks('u:w-a', [])).toEqual([]);
    });

    it('refuses a save that would pass the cell cap, counting every chunk of the world', async () => {
      await user('w-cap');
      await store.worlds.createWorld(worldOf('w-cap'));
      expect(await store.worlds.saveChunk('u:w-cap', 0, 0, patches(6), 0, 10)).toEqual({ ok: true, rev: 1 });
      expect(await store.worlds.saveChunk('u:w-cap', 1, 0, patches(5), 0, 10)).toEqual({ ok: false, reason: 'cap' });
      expect(await store.worlds.saveChunk('u:w-cap', 1, 0, patches(4), 0, 10)).toEqual({ ok: true, rev: 1 });
      // shrinking the first chunk frees room for the second
      expect(await store.worlds.saveChunk('u:w-cap', 0, 0, patches(1), 1, 10)).toEqual({ ok: true, rev: 2 });
      expect(await store.worlds.saveChunk('u:w-cap', 1, 0, patches(9), 1, 10)).toEqual({ ok: true, rev: 2 });
    });

    it('refuses a save into a world that does not exist', async () => {
      expect(await store.worlds.saveChunk('u:nobody', 0, 0, patches(1), 0)).toEqual({ ok: false, reason: 'no_world' });
    });

    it('two saves from the same revision: exactly one wins', async () => {
      await user('w-race');
      await store.worlds.createWorld(worldOf('w-race'));
      const [a, b] = await Promise.all([
        store.worlds.saveChunk('u:w-race', 2, 2, patches(1, 'meadow_dirt'), 0),
        store.worlds.saveChunk('u:w-race', 2, 2, patches(1, 'tilled_soil'), 0),
      ]);
      expect([a.ok, b.ok].filter(Boolean)).toHaveLength(1);
      expect((await store.worlds.loadChunks('u:w-race', [{ cx: 2, cy: 2 }]))[0]?.rev).toBe(1);
    });

    it('loads every stored chunk of one world, and none of another', async () => {
      await user('w-all');
      await store.worlds.createWorld(worldOf('w-all'));
      await store.worlds.saveChunk('u:w-all', -1, 4, patches(1), 0);
      await store.worlds.saveChunk('u:w-all', 2, 2, patches(2), 0);
      const all = await store.worlds.loadAllChunks('u:w-all');
      expect(all.map((c) => `${c.cx},${c.cy}`).sort()).toEqual(['-1,4', '2,2']);
      expect(await store.worlds.loadAllChunks('u:nobody')).toEqual([]);
    });

    it('deleting the owner removes the world and its chunks', async () => {
      await user('w-gone');
      await store.worlds.createWorld(worldOf('w-gone'));
      await store.worlds.saveChunk('u:w-gone', 0, 0, patches(2), 0);
      await store.deleteUser('w-gone');
      expect(await store.worlds.worldOf('w-gone')).toBeNull();
      expect(await store.worlds.loadChunks('u:w-gone', [{ cx: 0, cy: 0 }])).toEqual([]);
      // the same owner may start a fresh world afterwards
      await user('w-gone');
      expect(await store.worlds.createWorld(worldOf('w-gone'))).toBe(true);
    });

    // P17.20: transactions over the world, the account and the ledger

    it('publishes a transaction when it returns, and writes nothing when it aborts or throws', async () => {
      await user('tx-a');
      await store.worlds.createWorld(worldOf('tx-a'));
      const row = (key: string) => ({
        key,
        actor: 'tx-a',
        worldId: 'u:tx-a',
        kind: 'probe',
        delta: { items: { stone: 1 }, money: 0, energy: 0, xp: {} },
        at: 1_700_000_000_000,
      });
      await store.worlds.withTxn(async (tx) => {
        expect(await tx.lockWorld('u:tx-a')).toBe(true);
        expect(await tx.insertLedger(row('tx-commit'))).toBe(true);
      });
      await store.worlds.withTxn(async (tx) => {
        expect(await tx.insertLedger(row('tx-abort'))).toBe(true);
        tx.abort();
      });
      await expect(
        store.worlds.withTxn(async (tx) => {
          await tx.insertLedger(row('tx-throw'));
          throw new Error('boom');
        }),
      ).rejects.toThrow('boom');
      await store.worlds.withTxn(async (tx) => {
        expect((await tx.ledgerOf('tx-commit'))?.delta.items).toEqual({ stone: 1 });
        expect(await tx.ledgerOf('tx-abort')).toBeNull();
        expect(await tx.ledgerOf('tx-throw')).toBeNull();
      });
    });

    it('keeps a ledger key unique: the second write of a key says no and changes nothing', async () => {
      await user('tx-k');
      const row = {
        key: 'tx-key-1',
        actor: 'tx-k',
        worldId: null,
        kind: 'starter',
        delta: { items: { hoe_1: 1 }, money: 500, energy: 0, xp: {} },
        at: 1_700_000_000_000,
      };
      await store.worlds.withTxn(async (tx) => {
        expect(await tx.insertLedger(row)).toBe(true);
        expect(await tx.insertLedger({ ...row, delta: { ...row.delta, money: 9999 } })).toBe(false);
      });
      await store.worlds.withTxn(async (tx) => {
        expect((await tx.ledgerOf('tx-key-1'))?.delta.money).toBe(500);
      });
    });

    it('replaces an inventory only at the revision it was read at', async () => {
      await user('tx-inv');
      await store.worlds.withTxn(async (tx) => {
        const first = await tx.accountOf('tx-inv', true);
        expect(first.rev).toBe(0);
        expect(await tx.saveAccount('tx-inv', { items: { hoe_1: 1 }, money: 500 }, first.rev)).toBe(1);
        // a stale revision (0 again) is refused, and the stored inventory is the first write
        expect(await tx.saveAccount('tx-inv', { items: {}, money: 0 }, 0)).toBeNull();
        expect(await tx.saveAccount('tx-inv', { items: { hoe_1: 1, can_1: 1 }, money: 450 }, 1)).toBe(2);
      });
      await store.worlds.withTxn(async (tx) => {
        expect(await tx.accountOf('tx-inv', false)).toEqual({ inventory: { items: { hoe_1: 1, can_1: 1 }, money: 450 }, rev: 2 });
      });
    });

    it('replaces the farm state only at the revision it was read at, and keeps its day', async () => {
      await user('tx-sim');
      await store.worlds.createWorld({ ...worldOf('tx-sim'), id: 'u:tx-sim' });
      const sim = { day: 3, plots: { '1,1': { tilled: true, wateredOn: 0, crop: null, sprinkler: null } }, animals: [], machines: [] };
      await store.worlds.withTxn(async (tx) => {
        expect(await tx.simOf('u:tx-sim', true)).toBeNull();
        expect(await tx.saveSim('u:tx-sim', sim, 0)).toBe(1);
        expect(await tx.saveSim('u:tx-sim', { ...sim, day: 4 }, 0)).toBeNull();
      });
      await store.worlds.withTxn(async (tx) => {
        expect(await tx.simOf('u:tx-sim', false)).toEqual({ state: sim, rev: 1 });
      });
    });

    it('says a world does not exist when its row is missing', async () => {
      await store.worlds.withTxn(async (tx) => {
        expect(await tx.lockWorld('u:no-such-world')).toBe(false);
      });
    });
  });
}

worldStoreContract('memory', async () => {
  const store = new MemoryStore();
  await store.init();
  return { store, close: async () => {} };
});

worldStoreContract(
  'postgres',
  async () => {
    // a schema of its own: this file runs beside the other Postgres tests on the same database
    const schema = `worlds_${process.pid}_${Math.random().toString(36).slice(2, 10)}`;
    const admin = new pg.Client({ connectionString: url });
    await admin.connect();
    await admin.query(`CREATE SCHEMA ${schema}`);
    await admin.end();
    const sep = url!.includes('?') ? '&' : '?';
    const store = new PgStore(`${url}${sep}options=${encodeURIComponent(`-c search_path=${schema}`)}`);
    await store.init();
    await store.init(); // idempotent
    return {
      store,
      close: async () => {
        await store.close();
        const drop = new pg.Client({ connectionString: url });
        await drop.connect();
        await drop.query(`DROP SCHEMA ${schema} CASCADE`);
        await drop.end();
      },
    };
  },
  !url,
);
