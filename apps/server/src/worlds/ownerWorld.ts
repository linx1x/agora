/**
 * The owner's personal world, created the first time they step through their desk (P17.14).
 * Nothing else creates a world row: a desk without a world refuses with `no_world` until then.
 * The seed is derived from the account (ADR-053: `worldSeedFor`), so a world always has the same
 * layout whoever creates its row; the id is random and stays the same for the life of the world.
 */
import { randomUUID } from 'node:crypto';
import { WORLDGEN, worldSeedFor } from '@agora/shared';
import type { StoredWorld, WorldStore } from './worldStore';

/** The owner's world, created when missing. Null only when the store refuses to create it. */
export async function ensureOwnerWorld(
  store: WorldStore,
  ownerId: string,
  now: number,
): Promise<StoredWorld | null> {
  const have = await store.worldOf(ownerId);
  if (have) return have;
  const world: StoredWorld = {
    id: randomUUID(),
    ownerId,
    seed: worldSeedFor(ownerId),
    genVersion: WORLDGEN.genVersion,
    createdAt: now,
    lastDay: 1,
    settings: {},
  };
  // two first entries at once: the second create is refused (one world per owner), so read back
  if (await store.createWorld(world)) return world;
  return store.worldOf(ownerId);
}
