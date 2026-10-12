import { describe, expect, it } from 'vitest';
import { WORLDGEN, worldSeedFor } from '@agora/shared';
import { MemoryWorldStore } from './worldStore';
import { ensureOwnerWorld } from './ownerWorld';

describe('ensureOwnerWorld (P17.14)', () => {
  it('creates the owner world on the first call, with the account seed and the shipped generator', async () => {
    const store = new MemoryWorldStore();
    const w = await ensureOwnerWorld(store, 'dev-alice', 1_700_000_000_000);
    expect(w).not.toBeNull();
    expect(w!.ownerId).toBe('dev-alice');
    expect(w!.seed).toBe(worldSeedFor('dev-alice'));
    expect(w!.genVersion).toBe(WORLDGEN.genVersion);
    expect(await store.getWorld(w!.id)).toEqual(w);
  });

  it('returns the same world on every later call (the id and seed never change)', async () => {
    const store = new MemoryWorldStore();
    const first = await ensureOwnerWorld(store, 'dev-alice', 1);
    const again = await ensureOwnerWorld(store, 'dev-alice', 2);
    expect(again?.id).toBe(first?.id);
    expect(again?.createdAt).toBe(1);
  });

  it('gives two owners two worlds with different seeds', async () => {
    const store = new MemoryWorldStore();
    const a = await ensureOwnerWorld(store, 'dev-alice', 1);
    const b = await ensureOwnerWorld(store, 'dev-benoit', 1);
    expect(a?.id).not.toBe(b?.id);
    expect(a?.seed).not.toBe(b?.seed);
  });

  it('two first entries at once still leave one world', async () => {
    const store = new MemoryWorldStore();
    const [x, y] = await Promise.all([
      ensureOwnerWorld(store, 'dev-alice', 1),
      ensureOwnerWorld(store, 'dev-alice', 2),
    ]);
    expect(x?.id).toBe(y?.id);
    expect(await store.worldOf('dev-alice')).toEqual(x);
  });
});
