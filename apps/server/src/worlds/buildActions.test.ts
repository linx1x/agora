import { describe, expect, it } from 'vitest';
import { chunkOfCell, loadGameData, localIndexOf, randomAvatar, type S2CMsg } from '@agora/shared';
import { PG_URL, memory, postgres } from './testStores';
import { WorldHub, type WorldActRequest, type WorldMember, type WorldRoom } from './worldRoom';
import type { WorldStore } from './worldStore';
import { FakeConn, GUEST, OWNER, feetCell, flatYard, grant, openWorld, paintCells, waitFor } from './testWorld';

/**
 * P17.24 (ADR-053, skill agora-world-action): placing and removing blocks, raising and lowering the
 * ground, and chests, through the room with the real rules. Every test runs on the memory store and,
 * when TEST_DATABASE_URL is set, on Postgres. The yard is painted flat before the room opens, so the
 * spawn (the origin cell, next to which every test acts) stands on flat meadow.
 */

const data = loadGameData();
const KIT = data.progression.starterKit.items;
const CLOCK = { now: () => 20 * 60 * 1000 + 2_000, autoTick: false };
/** the spawn cell: every person joins here, and it is where each test stands */
const SPAWN = { x: 0, y: 0 };
/** the cell east of the spawn: where each test builds, digs or stashes */
const EAST = { x: 1, y: 0 };
const EAST_KEY = `${EAST.x},${EAST.y}`;
const KALE = 'meadow_kale_seed';
const PEA = 'honey_pea_seed';

function hub(store: WorldStore): WorldHub {
  return new WorldHub(store, undefined, undefined, undefined, CLOCK);
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

function act(room: WorldRoom, who: Who, op: number, key: string, kind: WorldActRequest['kind'], item?: string, at?: { x: number; y: number }) {
  room.act(who.m, { t: 'world:act', op, kind, item, at, key } as WorldActRequest);
}

async function reply(c: FakeConn, op: number): Promise<S2CMsg> {
  const answer = (m: S2CMsg) => (m.t === 'world:acted' || m.t === 'world:refused') && m.op === op;
  await waitFor(() => c.msgs.some(answer));
  return c.msgs.find(answer)!;
}

async function account(store: WorldStore, uid: string) {
  return store.withTxn((tx) => tx.accountOf(uid, false));
}

async function sim(store: WorldStore) {
  return (await store.withTxn((tx) => tx.simOf('w1', false)))!.state;
}

const ledger = (store: WorldStore, key: string) => store.withTxn((tx) => tx.ledgerOf(key));

/** The bag and the chest together, stack by stack: what conservation must keep. */
function totalOf(items: Record<string, number>, chest: Record<string, number>): Record<string, number> {
  const out: Record<string, number> = {};
  for (const [k, n] of [...Object.entries(items), ...Object.entries(chest)]) out[k] = (out[k] ?? 0) + n;
  return out;
}

for (const backend of [memory, postgres]) {
  const suite = backend === postgres && !PG_URL ? describe.skip : describe;
  suite(`build actions on ${backend.name} (P17.24, ADR-053)`, () => {
    it('a wall comes out of the bag onto the ground, and goes back into it when removed', async () => {
      const store = await openWorld(backend, { grants: [] });
      await flatYard(store);
      const room = (await hub(store).enter('w1'))!;
      const owner = await join(room, 'owner', OWNER);
      expect(feetCell(owner.m)).toEqual(SPAWN);
      const start = KIT.wood_wall ?? 0;

      act(room, owner, 1, 'k-wall', 'place', 'wood_wall', EAST);
      expect(await reply(owner.c, 1)).toEqual({ t: 'world:acted', op: 1, changes: expect.objectContaining({ items: { wood_wall: -1 } }) });
      expect(room.terrain.cellAt(EAST.x, EAST.y).decor).toBe('wood_wall');
      expect((await account(store, OWNER)).inventory.items.wood_wall).toBe(start - 1);
      expect(await ledger(store, 'k-wall')).toMatchObject({ actor: OWNER, worldId: 'w1', kind: 'place', delta: { items: { wood_wall: -1 } } });
      const chunk = (await store.loadChunks('w1', [chunkOfCell(EAST.x, EAST.y)]))[0]!;
      expect(chunk.delta[localIndexOf(EAST.x, EAST.y)]).toMatchObject({ decor: 'wood_wall' });

      act(room, owner, 2, 'k-unwall', 'remove', undefined, EAST);
      expect(await reply(owner.c, 2)).toMatchObject({ t: 'world:acted', op: 2, changes: { items: { wood_wall: 1 } } });
      expect(room.terrain.cellAt(EAST.x, EAST.y).decor).toBe('');
      expect((await account(store, OWNER)).inventory.items.wood_wall).toBe(start);
      room.leave(owner.m);
    });

    it('the same key twice has one effect and the same reply', async () => {
      const store = await openWorld(backend, { grants: [] });
      await flatYard(store);
      const room = (await hub(store).enter('w1'))!;
      const owner = await join(room, 'owner', OWNER);

      act(room, owner, 1, 'k-dup', 'place', 'wood_wall', EAST);
      await reply(owner.c, 1);
      // the wall is there now: a re-run would be refused as gone, so an acted reply is a replay
      act(room, owner, 2, 'k-dup', 'place', 'wood_wall', EAST);
      expect(await reply(owner.c, 2)).toMatchObject({ t: 'world:acted', op: 2, changes: { items: { wood_wall: -1 } } });
      expect(owner.c.of('world:refused')).toEqual([]);
      expect((await account(store, OWNER)).inventory.items.wood_wall).toBe((KIT.wood_wall ?? 0) - 1);
      room.leave(owner.m);
    });

    it('a resend after a lost reply, on a new connection, has one effect', async () => {
      const store = await openWorld(backend, { grants: [] });
      await flatYard(store);
      const started = deferred();
      const release = deferred();
      let armed = false;
      // holds the first action's transaction open after its change is written, so the reply is lost
      const held = Object.create(store) as WorldStore;
      held.withTxn = (fn) =>
        store.withTxn(async (tx) => {
          const value = await fn(tx);
          if (armed) {
            armed = false;
            started.resolve();
            await release.promise;
          }
          return value;
        });
      const firstHub = hub(held);
      const room = (await firstHub.enter('w1'))!;
      const first = await join(room, 'owner', OWNER);

      armed = true;
      act(room, first, 1, 'k-lost', 'place', 'wood_wall', EAST);
      await started.promise;
      room.leave(first.m);
      release.resolve();
      await waitFor(() => room.disposed);

      expect(first.c.of('world:acted')).toEqual([]);
      const again = (await firstHub.enter('w1'))!;
      const second = await join(again, 'owner', OWNER);
      act(again, second, 2, 'k-lost', 'place', 'wood_wall', EAST);
      expect(await reply(second.c, 2)).toMatchObject({ t: 'world:acted', op: 2, changes: { items: { wood_wall: -1 } } });
      expect(second.c.of('world:refused')).toEqual([]);
      expect((await account(store, OWNER)).inventory.items.wood_wall).toBe((KIT.wood_wall ?? 0) - 1);
      expect(again.terrain.cellAt(EAST.x, EAST.y).decor).toBe('wood_wall');
      again.leave(second.m);
    });

    it('two people taking the same stack in the same tick: one wins, the other is told gone', async () => {
      const store = await openWorld(backend, { grants: ['take'] });
      await flatYard(store);
      await grant(store, OWNER, { [KALE]: 4 });
      const room = (await hub(store).enter('w1'))!;
      const owner = await join(room, 'owner', OWNER);
      const guest = await join(room, 'guest', GUEST);

      act(room, owner, 1, 'k-chest', 'place', 'chest', EAST);
      await reply(owner.c, 1);
      act(room, owner, 2, 'k-stash', 'stash', KALE, EAST);
      await reply(owner.c, 2);

      act(room, owner, 3, 'k-take-o', 'take', KALE, EAST);
      act(room, guest, 1, 'k-take-g', 'take', KALE, EAST);
      expect(await reply(owner.c, 3)).toMatchObject({ t: 'world:acted', op: 3 });
      expect(await reply(guest.c, 1)).toEqual({ t: 'world:refused', op: 1, reason: 'gone' });

      expect((await account(store, OWNER)).inventory.items[KALE]).toBe(4);
      expect((await account(store, GUEST)).inventory.items[KALE]).toBeUndefined();
      expect((await sim(store)).chests?.[EAST_KEY]).toEqual({});
      // the contents go to the actor alone, and only when they open or change the chest
      expect(owner.c.of('world:chest').at(-1)).toEqual({ t: 'world:chest', at: EAST, items: {} });
      expect(guest.c.of('world:chest')).toEqual([]);
      room.leave(owner.m);
      room.leave(guest.m);
    });

    it('stashing and taking back conserves every item: the bag and the chest hold the same stacks', async () => {
      const store = await openWorld(backend, { grants: [] });
      await flatYard(store);
      await grant(store, OWNER, { [PEA]: 4 });
      const room = (await hub(store).enter('w1'))!;
      const owner = await join(room, 'owner', OWNER);
      act(room, owner, 1, 'k-chest2', 'place', 'chest', EAST);
      await reply(owner.c, 1);

      const before = totalOf((await account(store, OWNER)).inventory.items, {});
      act(room, owner, 2, 'k-in', 'stash', PEA, EAST);
      expect(await reply(owner.c, 2)).toMatchObject({ t: 'world:acted', op: 2, changes: { items: { [PEA]: -4 } } });
      expect((await account(store, OWNER)).inventory.items[PEA]).toBeUndefined();
      expect((await sim(store)).chests?.[EAST_KEY]).toEqual({ [PEA]: 4 });

      act(room, owner, 3, 'k-out', 'take', PEA, EAST);
      expect(await reply(owner.c, 3)).toMatchObject({ t: 'world:acted', op: 3, changes: { items: { [PEA]: 4 } } });
      const after = totalOf((await account(store, OWNER)).inventory.items, (await sim(store)).chests?.[EAST_KEY] ?? {});
      expect(after).toEqual(before);
      expect(await ledger(store, 'k-in')).toMatchObject({ delta: { items: { [PEA]: -4 } } });
      expect(await ledger(store, 'k-out')).toMatchObject({ delta: { items: { [PEA]: 4 } } });
      room.leave(owner.m);
    });

    it('a visitor without a grant is forbidden to raise, place or open, and nothing changes', async () => {
      const store = await openWorld(backend, { grants: [] });
      await flatYard(store);
      const room = (await hub(store).enter('w1'))!;
      const owner = await join(room, 'owner', OWNER);
      act(room, owner, 1, 'k-chest3', 'place', 'chest', EAST);
      await reply(owner.c, 1);
      const guest = await join(room, 'guest', GUEST);
      const before = await account(store, GUEST);
      const rev = (await store.loadChunks('w1', [chunkOfCell(EAST.x, EAST.y)]))[0]!.rev;

      act(room, guest, 1, 'k-g-raise', 'raise', 'shovel_1', { x: 0, y: 1 });
      act(room, guest, 2, 'k-g-place', 'place', 'wood_wall', { x: 0, y: 1 });
      act(room, guest, 3, 'k-g-open', 'open', undefined, EAST);
      expect(await reply(guest.c, 1)).toEqual({ t: 'world:refused', op: 1, reason: 'forbidden' });
      expect(await reply(guest.c, 2)).toEqual({ t: 'world:refused', op: 2, reason: 'forbidden' });
      expect(await reply(guest.c, 3)).toEqual({ t: 'world:refused', op: 3, reason: 'forbidden' });

      expect(await account(store, GUEST)).toEqual(before);
      expect(await store.loadChunks('w1', [chunkOfCell(EAST.x, EAST.y)]).then((c) => c[0]!.rev)).toBe(rev);
      expect(await ledger(store, 'k-g-raise')).toBeNull();
      expect(guest.c.of('world:chest')).toEqual([]);
      room.leave(owner.m);
      room.leave(guest.m);
    });

    it('a visitor with the open grant sees the contents alone, and the owner is not told', async () => {
      const store = await openWorld(backend, { grants: ['open'] });
      await flatYard(store);
      await grant(store, OWNER, { [PEA]: 4 });
      const room = (await hub(store).enter('w1'))!;
      const owner = await join(room, 'owner', OWNER);
      act(room, owner, 1, 'k-chest4', 'place', 'chest', EAST);
      await reply(owner.c, 1);
      act(room, owner, 2, 'k-in4', 'stash', PEA, EAST);
      await reply(owner.c, 2);
      const guest = await join(room, 'guest', GUEST);
      const ownerSeen = owner.c.of('world:chest').length;

      act(room, guest, 1, 'k-open', 'open', undefined, EAST);
      expect(await reply(guest.c, 1)).toEqual({ t: 'world:acted', op: 1, changes: expect.anything() });
      expect(guest.c.of('world:chest')).toEqual([{ t: 'world:chest', at: EAST, items: { [PEA]: 4 } }]);
      expect(owner.c.of('world:chest')).toHaveLength(ownerSeen);
      expect((await sim(store)).chests?.[EAST_KEY]).toEqual({ [PEA]: 4 });
      room.leave(owner.m);
      room.leave(guest.m);
    });

    it('nobody builds on a cell someone stands on: the owner cannot wall in their own feet', async () => {
      const store = await openWorld(backend, { grants: [] });
      await flatYard(store);
      const room = (await hub(store).enter('w1'))!;
      const owner = await join(room, 'owner', OWNER);

      act(room, owner, 1, 'k-feet', 'place', 'wood_wall', SPAWN);
      expect(await reply(owner.c, 1)).toEqual({ t: 'world:refused', op: 1, reason: 'occupied' });
      expect(await ledger(store, 'k-feet')).toBeNull();
      expect(room.terrain.cellAt(SPAWN.x, SPAWN.y).decor).toBe('');
      room.leave(owner.m);
    });

    it('the shovel raises flat ground one level for its energy, and a step that would trap a neighbour is refused', async () => {
      const store = await openWorld(backend, { grants: [] });
      await flatYard(store);
      await paintCells(store, { [EAST_KEY]: { level: 1 } });
      const room = (await hub(store).enter('w1'))!;
      const owner = await join(room, 'owner', OWNER);
      const energy = owner.c.of('world:inv').at(-1)!.energy;

      // a cell one level above flat ground: raising it again would leave the flat neighbours two levels down
      act(room, owner, 1, 'k-trap', 'raise', 'shovel_1', EAST);
      expect(await reply(owner.c, 1)).toEqual({ t: 'world:refused', op: 1, reason: 'trap' });
      expect(room.terrain.cellAt(EAST.x, EAST.y).level).toBe(1);
      expect(await ledger(store, 'k-trap')).toBeNull();

      // lowering it back is one level, and nobody is trapped by it
      act(room, owner, 2, 'k-lower', 'lower', 'shovel_1', EAST);
      expect(await reply(owner.c, 2)).toMatchObject({ t: 'world:acted', op: 2, changes: { energy: -3 } });
      expect(room.terrain.cellAt(EAST.x, EAST.y).level).toBe(0);
      expect(owner.c.of('world:inv').at(-1)!.energy).toBe(energy - 3);

      // and raising flat ground by one level works as well
      act(room, owner, 3, 'k-raise', 'raise', 'shovel_1', EAST);
      expect(await reply(owner.c, 3)).toMatchObject({ t: 'world:acted', op: 3 });
      expect(room.terrain.cellAt(EAST.x, EAST.y).level).toBe(1);
      expect(await ledger(store, 'k-raise')).toMatchObject({ kind: 'raise', delta: { energy: -3 } });
      room.leave(owner.m);
    });
  });
}

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((r) => (resolve = r));
  return { promise, resolve };
}
