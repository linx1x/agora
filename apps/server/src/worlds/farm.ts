/**
 * The farm layer on the server (ADR-053, P17.22). The world's `WorldSimState` is read, brought up to
 * the world's day with the night rules of clock.ts, and written back in the same transaction that
 * uses it. Advancing is idempotent: a state already at today comes back as the same object, and an
 * empty farm that nobody has touched is not written at all.
 */
import { emptySim, noChanges, parseCaveId, sellShipping, simulateDays, waterFromWeather, type GameData, type WorldSimState } from '@agora/shared';
import { ConflictError } from './inventory';
import type { SimRow, WorldTxn } from './worldTxn';
import type { WorldStore } from './worldStore';

/** What the shipping bin sold at a day change: the money it fetched and the units it took (P17.26). */
export interface FarmSale {
  readonly money: number;
  readonly units: number;
}

export interface FarmRead {
  /** the stored row, or null when the world has no farm yet */
  readonly stored: SimRow | null;
  /** what is stored (or an empty farm at today when nothing is) */
  readonly base: WorldSimState;
  /** `base` advanced to today, its shipping bin emptied when it was sold; the same object as `base` when there is nothing to advance */
  readonly state: WorldSimState;
  /** the shipping bin's sale at this day change, or null when the bin was empty or the day did not change */
  readonly sale: FarmSale | null;
}

/** Advances the farm and applies today's rain idempotently. `seed` drives weather and retention. */
export function advanceFarm(base: WorldSimState, day: number, data: GameData, seed: number, outdoors = true): WorldSimState {
  return base.day >= day ? (outdoors ? waterFromWeather(base, seed) : base) : simulateDays(base, base.day, day, data, seed, outdoors);
}

/** Whether a farm has anything on it worth a row: plots, animals, machines, a chest (empty or not), or stock in the bin. */
export const farmHasContent = (s: WorldSimState): boolean =>
  Object.keys(s.plots).length > 0 ||
  s.animals.length > 0 ||
  s.machines.length > 0 ||
  Object.keys(s.chests ?? {}).length > 0 ||
  Object.keys(s.shipping ?? {}).length > 0;

/**
 * Reads the farm of a world (locked when `lock`) and advances it to `day`. The shipping bin is sold at
 * the first day change after its stacks were put in (every stack in it was put in during `base.day`).
 */
export async function readFarm(tx: WorldTxn, worldId: string, day: number, data: GameData, seed: number, lock: boolean): Promise<FarmRead> {
  const stored = await tx.simOf(worldId, lock);
  const base = stored?.state ?? emptySim(day);
  const crossed = base.day < day && Object.keys(base.shipping ?? {}).length > 0;
  const advanced = advanceFarm(base, day, data, seed, parseCaveId(worldId) === null);
  return {
    stored,
    base,
    state: crossed ? { ...advanced, shipping: {} } : advanced,
    sale: crossed ? sellShipping(base.shipping ?? {}, data) : null,
  };
}

/**
 * Pays a shipping sale to the world's owner: the money goes onto the owner's account, and one ledger row
 * records it under `ship:<world>:<day>`, so a day is paid once. Runs in the transaction that read the sale.
 */
export async function paySale(tx: WorldTxn, world: { id: string; ownerId: string }, day: number, sale: FarmSale, at: number): Promise<void> {
  if (sale.money <= 0) return;
  const owner = await tx.accountOf(world.ownerId, true);
  if ((await tx.saveAccount(world.ownerId, { ...owner.inventory, money: owner.inventory.money + sale.money }, owner.rev)) === null) {
    throw new ConflictError();
  }
  const row = await tx.insertLedger({
    key: `ship:${world.id}:${day}`,
    actor: world.ownerId,
    worldId: world.id,
    kind: 'ship',
    delta: { ...noChanges(), money: sale.money },
    at,
  });
  if (!row) throw new ConflictError();
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
 * The night's catch-up, run by a room on load and at each new day (no action involved). A shipping sale
 * at the day change is paid to the owner here too. Returns the farm as it now is, or null when the world is gone.
 */
export async function catchUpFarm(
  store: WorldStore,
  world: { id: string; ownerId: string },
  day: number,
  data: GameData,
  seed: number,
  at: number,
): Promise<WorldSimState | null> {
  return store.withTxn(async (tx) => {
    if (!(await tx.lockWorld(world.id))) {
      tx.abort();
      return null;
    }
    const read = await readFarm(tx, world.id, day, data, seed, true);
    if (read.sale !== null) await paySale(tx, world, day, read.sale, at);
    await saveFarm(tx, world.id, read, read.state);
    return read.state;
  });
}
