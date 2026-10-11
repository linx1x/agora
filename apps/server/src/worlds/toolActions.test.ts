import { describe, expect, it } from 'vitest';
import {
  WORLD_CELL_PX,
  chunkOfCell,
  localIndexOf,
  randomAvatar,
  worldTime,
  type ChunkDelta,
  type S2CMsg,
} from '@agora/shared';
import { opened, memory, postgres, PG_URL, type Backend } from './testStores';
import type { WorldStore } from './worldStore';
import { WorldHub, type WorldActRequest, type WorldMember, type WorldRoom } from './worldRoom';

/**
 * Tools through the room with the real rules (P17.21): till and water change the farm layer, axe and
 * pick change the chunk and the bag. Runs on the memory store and, with TEST_DATABASE_URL, on Postgres.
 * Target cells are set through the store after the person joins, so they stand on the cell they
 * are in (always within reach): the room reads chunks fresh inside each transaction.
 */

const SEED = 3560865791;
const OWNER = 'uid-owner';
const ENERGY_MAX = 270;

class FakeConn {
  msgs: S2CMsg[] = [];
  send(m: S2CMsg) {
    this.msgs.push(m);
  }
  of<T extends S2CMsg['t']>(t: T) {
    return this.msgs.filter((m): m is Extract<S2CMsg, { t: T }> => m.t === t);
  }
}

async function waitFor(cond: () => boolean): Promise<void> {
  for (let i = 0; i < 1000; i++) {
    if (cond()) return;
    await new Promise((resolve) => setTimeout(resolve, 2));
  }
  throw new Error('timed out waiting for the room');
}

async function world(backend: Backend): Promise<WorldStore> {
  const h = await backend.open();
  opened.push(h.close);
  await h.users([OWNER]);
  await h.worlds.createWorld({
    id: 'w1',
    ownerId: OWNER,
    seed: SEED,
    genVersion: 1,
    createdAt: 0,
    lastDay: 0,
    settings: { grants: [] },
  });
  return h.worlds;
}

/** Sets cells' block and decor in the stored deltas, one transaction per chunk. */
async function setCells(store: WorldStore, cells: Record<string, { block?: string; decor?: string }>): Promise<void> {
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
      const [cur] = await tx.chunksOf('w1', [{ cx, cy }]);
      const delta: ChunkDelta = { ...(cur?.delta ?? {}) };
      for (const [x, y, patch] of list) {
        const index = localIndexOf(x, y);
        delta[index] = { ...((delta[index] as object | undefined) ?? {}), ...patch };
      }
      const saved = await tx.saveChunk('w1', cx, cy, delta, cur?.rev ?? 0, 40_000);
      expect(saved.ok).toBe(true);
    });
  }
}

/** Gives the account these items, on top of what it holds. */
async function grant(store: WorldStore, uid: string, items: Record<string, number>): Promise<void> {
  await store.withTxn(async (tx) => {
    const acc = await tx.accountOf(uid, true);
    const merged = { ...acc.inventory.items };
    for (const [id, n] of Object.entries(items)) merged[id] = (merged[id] ?? 0) + n;
    await tx.saveAccount(uid, { ...acc.inventory, items: merged }, acc.rev);
  });
}

async function setEnergy(store: WorldStore, uid: string, energy: number): Promise<void> {
  await store.withTxn((tx) => tx.saveProgress(uid, { skills: {}, energy }));
}

/** The cell the person stands on: always within reach of them. */
const feetCell = (m: WorldMember) => ({ x: Math.floor(m.x / WORLD_CELL_PX), y: Math.floor(m.y / WORLD_CELL_PX) });

function act(room: WorldRoom, m: WorldMember, op: number, key: string, kind: WorldActRequest['kind'], item: string, at: { x: number; y: number }) {
  room.act(m, { t: 'world:act', op, kind, item, at, key } as WorldActRequest);
}

/** The reply to the request with this op. */
async function reply(c: FakeConn, op: number): Promise<S2CMsg> {
  const answer = (m: S2CMsg) => (m.t === 'world:acted' || m.t === 'world:refused') && m.op === op;
  await waitFor(() => c.msgs.some(answer));
  return c.msgs.find(answer)!;
}

async function enter(store: WorldStore) {
  const hub = new WorldHub(store);
  const room = (await hub.enter('w1'))!;
  const c = new FakeConn();
  const m = room.join(c, { id: 'owner', uid: OWNER, name: 'owner', avatar: randomAvatar() });
  await waitFor(() => c.of('world:inv').length > 0);
  return { room, m, c };
}

const latestEnergy = (c: FakeConn) => c.of('world:inv').at(-1)?.energy;

for (const backend of [memory, postgres]) {
const suite = backend === postgres && !PG_URL ? describe.skip : describe;
suite(`tools through the room on the ${backend.name} (P17.21)`, () => {
  it('a hoe tills the farm layer, pays its energy and writes the ledger', async () => {
    const store = await world(backend);
    const { room, m, c } = await enter(store);
    const at = feetCell(m);
    await setCells(store, { [`${at.x},${at.y}`]: { block: 'meadow_grass', decor: '' } });

    act(room, m, 1, 'k-till', 'till', 'hoe_1', at);
    const out = await reply(c, 1);
    expect(out).toEqual({ t: 'world:acted', op: 1, changes: { items: {}, money: 0, energy: -2, xp: {} } });
    expect(latestEnergy(c)).toBe(ENERGY_MAX - 2);

    const sim = await store.withTxn((tx) => tx.simOf('w1', false));
    expect(sim?.state.plots[`${at.x},${at.y}`]).toMatchObject({ tilled: true, wateredOn: 0, crop: null });
    expect(await store.withTxn((tx) => tx.ledgerOf('k-till'))).toMatchObject({ kind: 'till', actor: OWNER });
    room.leave(m);
  });

  it('a can waters the tilled plot for tomorrow', async () => {
    const store = await world(backend);
    const { room, m, c } = await enter(store);
    const at = feetCell(m);
    await setCells(store, { [`${at.x},${at.y}`]: { block: 'meadow_grass', decor: '' } });
    act(room, m, 1, 'k-till', 'till', 'hoe_1', at);
    await reply(c, 1);
    act(room, m, 2, 'k-water', 'water', 'can_1', at);
    expect(await reply(c, 2)).toMatchObject({ t: 'world:acted', op: 2 });

    const day = worldTime(0, Date.now()).day;
    const sim = await store.withTxn((tx) => tx.simOf('w1', false));
    expect(sim?.state.plots[`${at.x},${at.y}`]?.wateredOn).toBe(day + 1);
    expect(latestEnergy(c)).toBe(ENERGY_MAX - 4);
    room.leave(m);
  });

  it('an axe fells a tree: the cell is cleared in its chunk, the drops reach the bag, energy and xp are paid', async () => {
    const store = await world(backend);
    const { room, m, c } = await enter(store);
    const at = feetCell(m);
    await setCells(store, { [`${at.x},${at.y}`]: { block: 'meadow_grass', decor: 'oak_tree' } });

    act(room, m, 1, 'k-chop', 'chop', 'axe_1', at);
    const out = await reply(c, 1);
    expect(out.t).toBe('world:acted');
    if (out.t !== 'world:acted') return;
    const softwood = out.changes.items.softwood ?? 0;
    expect(softwood).toBeGreaterThanOrEqual(2);
    expect(softwood).toBeLessThanOrEqual(4);
    expect(out.changes).toMatchObject({ money: 0, energy: -3, xp: { foraging: 4 } });

    const { cx, cy } = chunkOfCell(at.x, at.y);
    const [chunk] = await store.withTxn((tx) => tx.chunksOf('w1', [{ cx, cy }]));
    expect(chunk?.delta[localIndexOf(at.x, at.y)]).toMatchObject({ decor: '' });
    expect(c.of('world:chunks').length).toBeGreaterThan(0);
    const account = await store.withTxn((tx) => tx.accountOf(OWNER, false));
    expect(account.inventory.items.softwood).toBe(softwood);
    expect(latestEnergy(c)).toBe(ENERGY_MAX - 3);
    room.leave(m);
  });

  it('a tier-1 axe is refused on a jungle tree, and a tier-2 axe fells it', async () => {
    const store = await world(backend);
    await grant(store, OWNER, { axe_2: 1 });
    const { room, m, c } = await enter(store);
    const at = feetCell(m);
    await setCells(store, { [`${at.x},${at.y}`]: { block: 'meadow_grass', decor: 'jungle_tree' } });

    act(room, m, 1, 'k-low', 'chop', 'axe_1', at);
    expect(await reply(c, 1)).toEqual({ t: 'world:refused', op: 1, reason: 'tier' });

    act(room, m, 2, 'k-high', 'chop', 'axe_2', at);
    const out = await reply(c, 2);
    expect(out).toMatchObject({ t: 'world:acted', op: 2, changes: { energy: -4 } });
    expect(out.t === 'world:acted' && (out.changes.items.hardwood ?? 0) >= 3).toBe(true);
    room.leave(m);
  });

  it('a pick breaks a boulder into stone', async () => {
    const store = await world(backend);
    const { room, m, c } = await enter(store);
    const at = feetCell(m);
    await setCells(store, { [`${at.x},${at.y}`]: { block: 'meadow_grass', decor: 'boulder' } });
    act(room, m, 1, 'k-mine', 'mine', 'pick_1', at);
    const out = await reply(c, 1);
    expect(out).toMatchObject({ t: 'world:acted', op: 1, changes: { energy: -3, xp: { mining: 4 } } });
    room.leave(m);
  });

  it('refuses a tool not in the bag as missing, and an empty energy bar as energy, with nothing written', async () => {
    const store = await world(backend);
    const { room, m, c } = await enter(store);
    const at = feetCell(m);
    await setCells(store, { [`${at.x},${at.y}`]: { block: 'meadow_grass', decor: '' } });

    act(room, m, 1, 'k-none', 'till', 'hoe_3', at);
    expect(await reply(c, 1)).toEqual({ t: 'world:refused', op: 1, reason: 'missing' });

    await setEnergy(store, OWNER, 1);
    act(room, m, 2, 'k-tired', 'till', 'hoe_1', at);
    expect(await reply(c, 2)).toEqual({ t: 'world:refused', op: 2, reason: 'energy' });
    expect(await store.withTxn((tx) => tx.ledgerOf('k-tired'))).toBeNull();
    const sim = await store.withTxn((tx) => tx.simOf('w1', false));
    expect(sim).toBeNull();
    room.leave(m);
  });
});
}
