import { describe, expect, it } from 'vitest';
import { randomAvatar, type S2CMsg } from '@agora/shared';
import { PG_URL, memory, postgres } from './testStores';
import { WorldHub, type WorldActRequest, type WorldMember, type WorldRoom } from './worldRoom';
import { FakeConn, GUEST, NEIGHBOUR, OWNER, SEED, feetCell, openWorld, setCells, waitFor } from './testWorld';

/**
 * P17.21b: the swing a tool makes is seen by the others in the same world, and by nobody else.
 * The actor draws their own swing from the click, so it never gets `world:swing` back.
 */

const DAY_MS = 20 * 60 * 1000;

async function reply(c: FakeConn, op: number): Promise<S2CMsg> {
  const answer = (m: S2CMsg) => (m.t === 'world:acted' || m.t === 'world:refused') && m.op === op;
  await waitFor(() => c.msgs.some(answer));
  return c.msgs.find(answer)!;
}

function act(room: WorldRoom, m: WorldMember, op: number, key: string, kind: WorldActRequest['kind'], item: string | undefined, at?: { x: number; y: number }) {
  room.act(m, { t: 'world:act', op, kind, item, at, key } as WorldActRequest);
}

async function join(room: WorldRoom, id: string, uid: string) {
  const c = new FakeConn();
  const m = room.join(c, { id, uid, name: id, avatar: randomAvatar() });
  await waitFor(() => c.of('world:inv').length > 0);
  return { c, m };
}

const swings = (c: FakeConn) => c.of('world:swing');

for (const backend of [memory, postgres]) {
  const suite = backend === postgres && !PG_URL ? describe.skip : describe;
  suite(`world:swing on the ${backend.name} (P17.21b)`, () => {
    it('reaches the others in the world with the tool tier, never the actor, and not on a refusal or a resend', async () => {
      const store = await openWorld(backend);
      const clock = { t: DAY_MS + 2_000 };
      const hub = new WorldHub(store, undefined, undefined, undefined, { now: () => clock.t, autoTick: false });
      const room = (await hub.enter('w1'))!;
      const owner = await join(room, 'owner', OWNER);
      const near = await join(room, 'near', NEIGHBOUR);
      const spot = feetCell(owner.m);
      await setCells(store, { [`${spot.x},${spot.y}`]: { block: 'meadow_grass', decor: '' } });

      act(room, owner.m, 1, 'swing-till-1', 'till', 'hoe_1', spot);
      expect((await reply(owner.c, 1)).t).toBe('world:acted');
      await waitFor(() => swings(near.c).length === 1);
      expect(swings(near.c)[0]).toEqual({ t: 'world:swing', id: 'owner', dir: owner.m.d, tier: 1 });
      expect(swings(owner.c)).toHaveLength(0);
      expect(owner.c.of('world:action')).toHaveLength(0);

      expect(near.c.of('world:action')).toEqual([{t:'world:action',id:'owner',kind:'till',dir:owner.m.d,at:spot,tier:1,speed:1}]);

      // a refused action (a seed is not a tool for tilling) swings nothing
      act(room, owner.m, 2, 'swing-refused', 'till', 'dawn_radish_seed', spot);
      expect(await reply(owner.c, 2)).toMatchObject({ t: 'world:refused', reason: 'tool' });
      // a resend of the accepted key replays its reply and swings nothing new
      act(room, owner.m, 3, 'swing-till-1', 'till', 'hoe_1', spot);
      expect(await reply(owner.c, 3)).toMatchObject({ t: 'world:acted', op: 3 });
      expect(swings(near.c)).toHaveLength(1);

      expect(near.c.of('world:action')).toHaveLength(1);

      // a seed is planted by hand, not swung: no tool, no swing
      act(room, owner.m, 4, 'swing-plant', 'plant', 'dawn_radish_seed', spot);
      expect((await reply(owner.c, 4)).t).toBe('world:acted');
      expect(swings(near.c)).toHaveLength(1);
      expect(near.c.of('world:action')).toHaveLength(2);
      expect(near.c.of('world:action')[1]).toMatchObject({kind:'plant',at:spot});
      room.leave(near.m);
      room.leave(owner.m);
    });

    it('does not reach anyone in another world', async () => {
      const store = await openWorld(backend);
      await store.createWorld({ id: 'w2', ownerId: GUEST, seed: SEED + 1, genVersion: 1, createdAt: 0, lastDay: 0, settings: { grants: [] } });
      const clock = { t: DAY_MS + 2_000 };
      const hub = new WorldHub(store, undefined, undefined, undefined, { now: () => clock.t, autoTick: false });
      const room = (await hub.enter('w1'))!;
      const other = (await hub.enter('w2'))!;
      const owner = await join(room, 'owner', OWNER);
      const guest = await join(other, 'guest', GUEST);
      const spot = feetCell(owner.m);
      await setCells(store, { [`${spot.x},${spot.y}`]: { block: 'meadow_grass', decor: '' } });

      act(room, owner.m, 1, 'swing-w1-only', 'till', 'hoe_1', spot);
      expect((await reply(owner.c, 1)).t).toBe('world:acted');
      expect(swings(guest.c)).toHaveLength(0);
      expect(guest.c.of('world:action')).toHaveLength(0);
      expect(swings(owner.c)).toHaveLength(0);
      room.leave(owner.m);
      other.leave(guest.m);
    });
  });
}
