import { describe, expect, it } from 'vitest';
import { loadGameData, localIndexOf, randomAvatar, chunkOfCell, cellKey, type S2CMsg } from '@agora/shared';
import { PG_URL, memory, postgres } from './testStores';
import { WorldHub, type WorldActRequest, type WorldMember, type WorldRoom } from './worldRoom';
import type { WorldStore } from './worldStore';
import { FakeConn, GUEST, OWNER, flatYard, grant, openWorld, paintCells, waitFor } from './testWorld';

/**
 * P17.25 (ADR-053, skill agora-world-action): the shop board, livestock, crafting at a bench and in a
 * furnace, through the room with the real rules. A day change is a later clock: each test moves the
 * clock by a day and the next action runs the night (the farm catches up on the way in). Every test
 * runs on the memory store and, when TEST_DATABASE_URL is set, on Postgres.
 */

const DAY_MS = 20 * 60 * 1000;
const data = loadGameData();
const KIT = data.progression.starterKit.items;
/** the cell east of the spawn, where each test builds, buys and farms */
const EAST = { x: 1, y: 0 };
const EAST_KEY = cellKey(EAST.x, EAST.y);

function hubOn(store: WorldStore, clock: { t: number }): WorldHub {
  return new WorldHub(store, undefined, undefined, undefined, { now: () => clock.t, autoTick: false });
}

class Who {
  constructor(
    readonly c: FakeConn,
    readonly m: WorldMember,
  ) {}
}

async function join(room: WorldRoom, id: string, uid: string): Promise<Who> {
  const c = new FakeConn();
  const m = room.join(c, { id, uid, name: id, avatar: randomAvatar() });
  await waitFor(() => c.of('world:inv').length > 0);
  return new Who(c, m);
}

function act(room: WorldRoom, who: Who, op: number, key: string, kind: WorldActRequest['kind'], item?: string, at = EAST, target?: string) {
  room.act(who.m, { t: 'world:act', op, kind, item, at, target, key } as WorldActRequest);
}

async function reply(c: FakeConn, op: number): Promise<S2CMsg> {
  const answer = (m: S2CMsg) => (m.t === 'world:acted' || m.t === 'world:refused') && m.op === op;
  await waitFor(() => c.msgs.some(answer));
  return c.msgs.find(answer)!;
}

const account = (store: WorldStore, uid: string) => store.withTxn((tx) => tx.accountOf(uid, false));
const ledger = (store: WorldStore, key: string) => store.withTxn((tx) => tx.ledgerOf(key));
const sim = async (store: WorldStore) => (await store.withTxn((tx) => tx.simOf('w1', false)))!.state;

/** The shop board on the east cell (the starter has one further off). */
const SHOP = { [EAST_KEY]: { decor: 'shop_board' } };

for (const backend of [memory, postgres]) {
  const suite = backend === postgres && !PG_URL ? describe.skip : describe;
  suite(`the shop, livestock and crafting on ${backend.name} (P17.25, ADR-053)`, () => {
    it('buys a seed at the shop board: the money leaves, the seed comes in, the ledger has the row, and a resend is one purchase', async () => {
      const store = await openWorld(backend, { grants: [] });
      await flatYard(store);
      await paintCells(store, SHOP);
      const clock = { t: DAY_MS + 2_000 };
      const room = (await hubOn(store, clock).enter('w1'))!;
      const owner = await join(room, 'owner', OWNER);
      const before = (await account(store, OWNER)).inventory;
      const price = data.itemsById.get('dawn_radish_seed')!.buy!;

      act(room, owner, 1, 'k-buy', 'buy', 'dawn_radish_seed');
      expect(await reply(owner.c, 1)).toEqual({ t: 'world:acted', op: 1, changes: expect.objectContaining({ money: -price }) });
      act(room, owner, 2, 'k-buy', 'buy', 'dawn_radish_seed');
      expect(await reply(owner.c, 2)).toMatchObject({ t: 'world:acted', op: 2 });

      const after = (await account(store, OWNER)).inventory;
      expect(after.money).toBe(before.money - price);
      expect(after.items.dawn_radish_seed).toBe((KIT.dawn_radish_seed ?? 0) + 1);
      expect(await ledger(store, 'k-buy')).toMatchObject({ kind: 'buy', delta: { items: { dawn_radish_seed: 1 }, money: -price } });
      room.leave(owner.m);
    });

    it('refuses a purchase with too little money (money), and a visitor (forbidden); nothing changes', async () => {
      const store = await openWorld(backend, { grants: [] });
      await flatYard(store);
      await paintCells(store, SHOP);
      const clock = { t: DAY_MS + 2_000 };
      const room = (await hubOn(store, clock).enter('w1'))!;
      const owner = await join(room, 'owner', OWNER);
      const guest = await join(room, 'guest', GUEST);
      const guestBefore = await account(store, GUEST);

      act(room, owner, 1, 'k-hen-broke', 'buy', 'plume_hen'); // 800 against the starter 500
      expect(await reply(owner.c, 1)).toEqual({ t: 'world:refused', op: 1, reason: 'money' });
      act(room, guest, 1, 'k-guest-buy', 'buy', 'dawn_radish_seed');
      expect(await reply(guest.c, 1)).toEqual({ t: 'world:refused', op: 1, reason: 'forbidden' });
      expect(await account(store, GUEST)).toEqual(guestBefore);
      expect(await ledger(store, 'k-hen-broke')).toBeNull();
      room.leave(owner.m);
      room.leave(guest.m);
    });

    it('a coop keeps a hen: the hen goes in, is fed for the night, and lays an egg for the bag the next day', async () => {
      const store = await openWorld(backend, { grants: [] });
      await flatYard(store);
      await grant(store, OWNER, { coop: 1, plume_hen: 1, fodder: 2 });
      const clock = { t: DAY_MS + 2_000 };
      const hub = hubOn(store, clock);
      const room = (await hub.enter('w1'))!;
      const owner = await join(room, 'owner', OWNER);

      act(room, owner, 1, 'k-coop', 'place', 'coop');
      expect(await reply(owner.c, 1)).toMatchObject({ t: 'world:acted', op: 1, changes: { items: { coop: -1 } } });
      act(room, owner, 2, 'k-hen', 'place', 'plume_hen');
      expect(await reply(owner.c, 2)).toMatchObject({ t: 'world:acted', op: 2, changes: { items: { plume_hen: -1 } } });
      expect((await sim(store)).animals).toEqual([expect.objectContaining({ id: 'a1', animal: 'plume_hen', cell: EAST_KEY, pending: 0 })]);

      act(room, owner, 3, 'k-feed', 'feed', 'fodder');
      expect(await reply(owner.c, 3)).toMatchObject({ t: 'world:acted', op: 3, changes: { items: { fodder: -1 } } });
      const today = (await sim(store)).day;
      expect((await sim(store)).animals[0]).toMatchObject({ fedOn: today + 1 });
      // a second feed the same day has nothing to do
      act(room, owner, 4, 'k-feed-2', 'feed', 'fodder');
      expect(await reply(owner.c, 4)).toEqual({ t: 'world:refused', op: 4, reason: 'gone' });
      // the animals' state reaches the people in the world, whole, with the farm message
      expect(owner.c.of('world:farm').at(-1)).toMatchObject({ animals: [expect.objectContaining({ cell: EAST_KEY })] });

      clock.t += DAY_MS;
      act(room, owner, 5, 'k-egg', 'collect', undefined, EAST);
      expect(await reply(owner.c, 5)).toMatchObject({ t: 'world:acted', op: 5, changes: { items: { plume_egg: 1 } } });
      expect((await account(store, OWNER)).inventory.items.plume_egg).toBe(1);
      expect(await ledger(store, 'k-egg')).toMatchObject({ kind: 'collect', delta: { items: { plume_egg: 1 } } });
      // nothing waits now: a second collect is gone
      act(room, owner, 6, 'k-egg-2', 'collect', undefined, EAST);
      expect(await reply(owner.c, 6)).toEqual({ t: 'world:refused', op: 6, reason: 'gone' });
      room.leave(owner.m);
    });

    it('a furnace holds one bar batch for a day, then the bar comes into the bag', async () => {
      const store = await openWorld(backend, { grants: [] });
      await flatYard(store);
      await grant(store, OWNER, { furnace: 1, dull_ore: 2, softwood: 1 });
      const clock = { t: DAY_MS + 2_000 };
      const room = (await hubOn(store, clock).enter('w1'))!;
      const owner = await join(room, 'owner', OWNER);

      act(room, owner, 1, 'k-furnace', 'place', 'furnace');
      expect(await reply(owner.c, 1)).toMatchObject({ t: 'world:acted', op: 1 });
      act(room, owner, 2, 'k-smelt', 'craft', undefined, EAST, 'smelt_dull');
      expect(await reply(owner.c, 2)).toMatchObject({ t: 'world:acted', op: 2, changes: { items: { dull_ore: -2, softwood: -1 } } });
      expect((await account(store, OWNER)).inventory.items.dull_bar).toBeUndefined();
      expect((await sim(store)).machines).toEqual([expect.objectContaining({ cell: EAST_KEY, output: 'dull_bar', qty: 1, daysLeft: 1 })]);

      // the furnace is busy until the day changes: a second batch and an early collect are refused
      act(room, owner, 3, 'k-smelt-2', 'craft', undefined, EAST, 'smelt_dull');
      expect(await reply(owner.c, 3)).toEqual({ t: 'world:refused', op: 3, reason: 'busy' });
      act(room, owner, 4, 'k-early', 'collect', undefined, EAST);
      expect(await reply(owner.c, 4)).toEqual({ t: 'world:refused', op: 4, reason: 'busy' });

      clock.t += DAY_MS;
      act(room, owner, 5, 'k-bar', 'collect', undefined, EAST);
      expect(await reply(owner.c, 5)).toMatchObject({ t: 'world:acted', op: 5, changes: { items: { dull_bar: 1 } } });
      expect((await account(store, OWNER)).inventory.items.dull_bar).toBe(1);
      expect((await sim(store)).machines).toEqual([]);
      room.leave(owner.m);
    });

    it('the bench makes a fence from the bag at once, and a visitor cannot craft, feed or collect', async () => {
      const store = await openWorld(backend, { grants: [] });
      await flatYard(store);
      await grant(store, OWNER, { softwood: 2, fiber: 1 });
      const clock = { t: DAY_MS + 2_000 };
      const room = (await hubOn(store, clock).enter('w1'))!;
      const owner = await join(room, 'owner', OWNER);
      const guest = await join(room, 'guest', GUEST);

      act(room, owner, 1, 'k-bench', 'place', 'workbench');
      expect(await reply(owner.c, 1)).toMatchObject({ t: 'world:acted', op: 1 });
      act(room, owner, 2, 'k-fence', 'craft', undefined, EAST, 'fence');
      expect(await reply(owner.c, 2)).toMatchObject({ t: 'world:acted', op: 2, changes: { items: { softwood: -2, fiber: -1, fence: 1 } } });
      expect((await account(store, OWNER)).inventory.items.fence).toBe(1);

      act(room, guest, 1, 'k-guest-craft', 'craft', undefined, EAST, 'fence');
      expect(await reply(guest.c, 1)).toEqual({ t: 'world:refused', op: 1, reason: 'forbidden' });
      act(room, guest, 2, 'k-guest-feed', 'feed', 'fodder', EAST);
      expect(await reply(guest.c, 2)).toEqual({ t: 'world:refused', op: 2, reason: 'forbidden' });
      act(room, guest, 3, 'k-guest-collect', 'collect', undefined, EAST);
      expect(await reply(guest.c, 3)).toEqual({ t: 'world:refused', op: 3, reason: 'forbidden' });
      room.leave(owner.m);
      room.leave(guest.m);
    });

    it('a bench is a decor edit in its chunk, so the chunk delta and the live terrain both show it', async () => {
      const store = await openWorld(backend, { grants: [] });
      await flatYard(store);
      await grant(store, OWNER, { workbench: 1 });
      const clock = { t: DAY_MS + 2_000 };
      const room = (await hubOn(store, clock).enter('w1'))!;
      const owner = await join(room, 'owner', OWNER);
      act(room, owner, 1, 'k-bench-2', 'place', 'workbench');
      expect(await reply(owner.c, 1)).toMatchObject({ t: 'world:acted', op: 1 });
      const chunk = (await store.loadChunks('w1', [chunkOfCell(EAST.x, EAST.y)]))[0]!;
      expect(chunk.delta[localIndexOf(EAST.x, EAST.y)]).toMatchObject({ decor: 'workbench' });
      expect(room.terrain.cellAt(EAST.x, EAST.y).decor).toBe('workbench');
      room.leave(owner.m);
    });
  });
}
