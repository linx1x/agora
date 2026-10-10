import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { ChunkDelta } from '@agora/shared';
import { MemoryStore, PgStore, type Store } from '../db/store';
import type { StoredWorld } from './worldStore';

/**
 * Runs the Postgres half against a real database when TEST_DATABASE_URL is set (skipped otherwise).
 * It drops the world tables first, so point it at a throwaway database only (as store.pg.test.ts does).
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
    const admin = new pg.Client({ connectionString: url });
    await admin.connect();
    await admin.query('DROP TABLE IF EXISTS world_chunks, worlds CASCADE');
    await admin.end();
    const store = new PgStore(url!);
    await store.init();
    await store.init(); // idempotent
    return { store, close: () => store.close() };
  },
  !url,
);
