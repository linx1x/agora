import { expect } from 'vitest';
import { localIndexOf, chunkOfCell, WORLD_CELL_PX, worldTime, type ChunkDelta, type S2CMsg } from '@agora/shared';
import { opened, type Backend } from './testStores';
import type { WorldStore } from './worldStore';
import type { WorldMember } from './worldRoom';

/**
 * Helpers for the world tests that drive a room (test-only; nothing in the server imports this).
 * A world is `w1` with the seed the tests share and the owner `uid-owner`.
 */

export const SEED = 3560865791;
export const OWNER = 'uid-owner';
export const GUEST = 'uid-guest';
export const NEIGHBOUR = 'uid-neighbour';

/** A connection that keeps what the room sends it. */
export class FakeConn {
  msgs: S2CMsg[] = [];
  send(m: S2CMsg) {
    this.msgs.push(m);
  }
  of<T extends S2CMsg['t']>(t: T) {
    return this.msgs.filter((m): m is Extract<S2CMsg, { t: T }> => m.t === t);
  }
}

/** Polls (the database answers between checks, so this is not a busy loop on a microtask). */
export async function waitFor(cond: () => boolean): Promise<void> {
  for (let i = 0; i < 1000; i++) {
    if (cond()) return;
    await new Promise((resolve) => setTimeout(resolve, 2));
  }
  throw new Error('timed out waiting for the room');
}

/** Opens a store on the backend and creates world w1 for the owner, with no edits. */
export async function openWorld(backend: Backend, settings: Record<string, unknown> = { grants: [] }): Promise<WorldStore> {
  const h = await backend.open();
  opened.push(h.close);
  await h.users([OWNER, GUEST, NEIGHBOUR]);
  await h.worlds.createWorld({ id: 'w1', ownerId: OWNER, seed: SEED, genVersion: 1, createdAt: 0, lastDay: 0, settings });
  return h.worlds;
}

/** Sets cells' block and decor in the stored deltas of a world (default w1), one transaction per chunk. */
export async function setCells(
  store: WorldStore,
  cells: Record<string, { block?: string; decor?: string }>,
  worldId = 'w1',
): Promise<void> {
  const byChunk = new Map<string, { cx: number; cy: number; cells: [number, number, object][] }>();
  for (const [key, patch] of Object.entries(cells)) {
    const [x, y] = key.split(',').map(Number) as [number, number];
    const { cx, cy } = chunkOfCell(x, y);
    const entry = byChunk.get(`${cx},${cy}`) ?? { cx, cy, cells: [] };
    entry.cells.push([x, y, patch]);
    byChunk.set(`${cx},${cy}`, entry);
  }
  for (const { cx, cy, cells: list } of byChunk.values()) {
    await store.withTxn(async (tx) => {
      const [cur] = await tx.chunksOf(worldId, [{ cx, cy }]);
      const delta: ChunkDelta = { ...(cur?.delta ?? {}) };
      for (const [x, y, patch] of list) {
        const index = localIndexOf(x, y);
        delta[index] = { ...((delta[index] as object | undefined) ?? {}), ...patch };
      }
      const saved = await tx.saveChunk(worldId, cx, cy, delta, cur?.rev ?? 0, 40_000);
      expect(saved.ok).toBe(true);
    });
  }
}

/** Gives the account these items, on top of what it holds. */
export async function grant(store: WorldStore, uid: string, items: Record<string, number>): Promise<void> {
  await store.withTxn(async (tx) => {
    const acc = await tx.accountOf(uid, true);
    const merged = { ...acc.inventory.items };
    for (const [id, n] of Object.entries(items)) merged[id] = (merged[id] ?? 0) + n;
    await tx.saveAccount(uid, { ...acc.inventory, items: merged }, acc.rev);
  });
}

/**
 * Sets a person's energy, settled to `day` (default: the day of the real clock, which the hubs
 * in these tests read unless they are given a fake one), with no rest.
 */
export async function setEnergy(store: WorldStore, uid: string, energy: number, day = worldTime(0, Date.now()).day): Promise<void> {
  await store.withTxn((tx) => tx.saveProgress(uid, { skills: {}, energy, day, rest: null }));
}

/** The cell the person stands on: always within reach of them. */
export const feetCell = (m: WorldMember) => ({ x: Math.floor(m.x / WORLD_CELL_PX), y: Math.floor(m.y / WORLD_CELL_PX) });
