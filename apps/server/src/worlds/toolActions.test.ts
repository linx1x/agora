import { describe, expect, it } from 'vitest';
import { localIndexOf, randomAvatar, chunkOfCell, worldTime, type S2CMsg } from '@agora/shared';
import { memory, postgres, PG_URL } from './testStores';
import type { WorldStore } from './worldStore';
import { WorldHub, type WorldActRequest, type WorldMember, type WorldRoom } from './worldRoom';
import { FakeConn, OWNER, feetCell, grant, openWorld, setCells, setEnergy, waitFor } from './testWorld';

/**
 * Tools through the room with the real rules (P17.21): till and water change the farm layer, axe and
 * pick change the chunk and the bag. Runs on the memory store and, with TEST_DATABASE_URL, on Postgres.
 * Target cells are set through the store after the person joins, so they stand on the cell they
 * are in (always within reach): the room reads chunks fresh inside each transaction.
 */

const ENERGY_MAX = 270;

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
    const store = await openWorld(backend);
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
    const store = await openWorld(backend);
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
    const store = await openWorld(backend);
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
    const store = await openWorld(backend);
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
    const store = await openWorld(backend);
    const { room, m, c } = await enter(store);
    const at = feetCell(m);
    await setCells(store, { [`${at.x},${at.y}`]: { block: 'meadow_grass', decor: 'boulder' } });
    act(room, m, 1, 'k-mine', 'mine', 'pick_1', at);
    const out = await reply(c, 1);
    expect(out).toMatchObject({ t: 'world:acted', op: 1, changes: { energy: -3, xp: { mining: 4 } } });
    room.leave(m);
  });

  it('refuses a tool not in the bag as missing, and an empty energy bar as energy, with nothing written', async () => {
    const store = await openWorld(backend);
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
