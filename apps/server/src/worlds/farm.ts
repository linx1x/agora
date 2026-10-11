/**
 * The farm layer on the server (ADR-053, P17.22). The world's `WorldSimState` is read, brought up to
 * the world's day with the night rules of clock.ts, and written back in the same transaction that
 * uses it. Advancing is idempotent: a state already at today comes back as the same object, and an
 * empty farm that nobody has touched is not written at all.
 */
import { emptySim, simulateDays, type GameData, type WorldSimState } from '@agora/shared';
import { ConflictError } from './inventory';
import type { SimRow, WorldTxn } from './worldTxn';
import type { WorldStore } from './worldStore';

export interface FarmRead {
  /** the stored row, or null when the world has no farm yet */
  readonly stored: SimRow | null;
  /** what is stored (or an empty farm at today when nothing is) */
  readonly base: WorldSimState;
  /** `base` advanced to today; the same object as `base` when there is nothing to advance */
  readonly state: WorldSimState;
}

/** Advances a farm to `day` (no-op when it is there already). `seed` drives the retention rolls. */
export function advanceFarm(base: WorldSimState, day: number, data: GameData, seed: number): WorldSimState {
  return base.day >= day ? base : simulateDays(base, base.day, day, data, seed);
}

/** Whether a farm has anything on it worth a row. */
export const farmHasContent = (s: WorldSimState): boolean => Object.keys(s.plots).length > 0 || s.animals.length > 0 || s.machines.length > 0;

/** Reads the farm of a world (locked when `lock`) and advances it to `day`. */
export async function readFarm(tx: WorldTxn, worldId: string, day: number, data: GameData, seed: number, lock: boolean): Promise<FarmRead> {
  const stored = await tx.simOf(worldId, lock);
  const base = stored?.state ?? emptySim(day);
  return { stored, base, state: advanceFarm(base, day, data, seed) };
}

/**
 * Writes the farm when `next` differs from what was read. Returns the new state and revision, or null
 * when nothing was written. A revision that moved since the read is a conflict.
 */
export async function saveFarm(
  tx: WorldTxn,
  worldId: string,
  read: FarmRead,
  next: WorldSimState,
): Promise<{ state: WorldSimState; rev: number } | null> {
  if (next === read.base) return null;
  if (read.stored === null && !farmHasContent(next)) return null;
  const rev = await tx.saveSim(worldId, next, read.stored?.rev ?? 0);
  if (rev === null) throw new ConflictError();
  return { state: next, rev };
}

/**
 * The night's catch-up, run by a room on load and at each new day (no action involved). Returns the
 * farm as it now is, or null when the world is gone.
 */
export async function catchUpFarm(store: WorldStore, worldId: string, day: number, data: GameData, seed: number): Promise<WorldSimState | null> {
  return store.withTxn(async (tx) => {
    if (!(await tx.lockWorld(worldId))) {
      tx.abort();
      return null;
    }
    const read = await readFarm(tx, worldId, day, data, seed, true);
    await saveFarm(tx, worldId, read, read.state);
    return read.state;
  });
}
