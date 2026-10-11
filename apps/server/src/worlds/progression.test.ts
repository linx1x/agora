import { describe, expect, it } from 'vitest';
import { loadGameData, randomAvatar, type S2CMsg } from '@agora/shared';
import { memory, postgres, PG_URL } from './testStores';
import type { WorldStore } from './worldStore';
import { WorldHub, type WorldActRequest, type WorldMember, type WorldRoom } from './worldRoom';
import {
  FakeConn,
  GUEST,
  OWNER,
  feetCell,
  grant,
  openWorld,
  setCells,
  setSkills,
  waitFor,
} from './testWorld';

/**
 * Progression (P17.31) through the room and the store, on the memory store and, with
 * TEST_DATABASE_URL, on Postgres. A locked tool is refused and writes nothing. The xp of an action
 * reaches the actor's own skills. A visitor is judged by the visitor's own xp: the owner's level opens
 * nothing for them, and the owner is never written. The badge shows only a level that is earned.
 */

const P = loadGameData().progression;
const LEVEL = P.levelXp;

async function joinRoom(
  room: WorldRoom,
  uid: string,
  id: string,
): Promise<{ m: WorldMember; c: FakeConn }> {
  const c = new FakeConn();
  const m = room.join(c, { id, uid, name: id, avatar: randomAvatar() });
  await waitFor(() => c.of('world:inv').length > 0);
  return { m, c };
}

function act(
  room: WorldRoom,
  m: WorldMember,
  op: number,
  key: string,
  kind: WorldActRequest['kind'],
  item: string,
  at: { x: number; y: number },
) {
  room.act(m, { t: 'world:act', op, kind, item, at, key } as WorldActRequest);
}

/** The reply to the request with this op. */
async function reply(c: FakeConn, op: number): Promise<S2CMsg> {
  const answer = (m: S2CMsg) => (m.t === 'world:acted' || m.t === 'world:refused') && m.op === op;
  await waitFor(() => c.msgs.some(answer));
  return c.msgs.find(answer)!;
}

const progressOf = (store: WorldStore, uid: string) =>
  store.withTxn((tx) => tx.progressOf(uid, false));

for (const backend of [memory, postgres]) {
  const suite = backend === postgres && !PG_URL ? describe.skip : describe;
  suite(`progression on the ${backend.name} (P17.31)`, () => {
    it('a tier-2 hoe is refused as locked until the farming level is earned, and nothing is written meanwhile', async () => {
      const store = await openWorld(backend);
      await grant(store, OWNER, { hoe_2: 1 });
      const hub = new WorldHub(store);
      const room = (await hub.enter('w1'))!;
      const { m, c } = await joinRoom(room, OWNER, 'owner');
      const at = feetCell(m);
      await setCells(store, { [`${at.x},${at.y}`]: { block: 'meadow_grass', decor: '' } });

      act(room, m, 1, 'k-locked', 'till', 'hoe_2', at);
      expect(await reply(c, 1)).toEqual({ t: 'world:refused', op: 1, reason: 'locked' });
      expect(await store.withTxn((tx) => tx.ledgerOf('k-locked'))).toBeNull();
      expect(await store.withTxn((tx) => tx.simOf('w1', false))).toBeNull();

      await setSkills(store, OWNER, { farming: LEVEL[0]! });
      act(room, m, 2, 'k-open', 'till', 'hoe_2', at);
      expect(await reply(c, 2)).toEqual({
        t: 'world:acted',
        op: 2,
        changes: { items: {}, money: 0, energy: -3, xp: {} },
      });
      room.leave(m);
    });

    it('the xp of a chop reaches the stored skills of the one who chopped', async () => {
      const store = await openWorld(backend);
      const hub = new WorldHub(store);
      const room = (await hub.enter('w1'))!;
      const { m, c } = await joinRoom(room, OWNER, 'owner');
      const at = feetCell(m);
      await setCells(store, { [`${at.x},${at.y}`]: { block: 'meadow_grass', decor: 'oak_tree' } });

      act(room, m, 1, 'k-chop', 'chop', 'axe_1', at);
      expect(await reply(c, 1)).toMatchObject({
        t: 'world:acted',
        op: 1,
        changes: { xp: { foraging: P.xp.chop.amount } },
      });
      expect((await progressOf(store, OWNER))?.skills).toEqual({ foraging: P.xp.chop.amount });
      room.leave(m);
    });

    it('a visitor is judged by the visitor own xp: the owner level opens no tool for them, and the owner is not written', async () => {
      const store = await openWorld(backend);
      await setSkills(store, OWNER, { farming: LEVEL[9]! });
      await grant(store, GUEST, { can_2: 1 });
      const hub = new WorldHub(store);
      const room = (await hub.enter('w1'))!;
      const owner = await joinRoom(room, OWNER, 'owner');
      const at = feetCell(owner.m);
      await setCells(store, { [`${at.x},${at.y}`]: { block: 'meadow_grass', decor: '' } });
      act(room, owner.m, 1, 'k-owner-till', 'till', 'hoe_1', at);
      expect(await reply(owner.c, 1)).toMatchObject({ t: 'world:acted', op: 1 });
      const ownerBefore = await progressOf(store, OWNER);

      // the visitor stands on the owner's cell (in reach) and waters it with a tier-2 can
      const guest = await joinRoom(room, GUEST, 'guest');
      Object.assign(guest.m, { x: owner.m.x, y: owner.m.y });
      act(room, guest.m, 1, 'k-guest-locked', 'water', 'can_2', at);
      expect(await reply(guest.c, 1)).toEqual({ t: 'world:refused', op: 1, reason: 'locked' });

      await setSkills(store, GUEST, { farming: LEVEL[0]! });
      act(room, guest.m, 2, 'k-guest-open', 'water', 'can_2', at);
      expect(await reply(guest.c, 2)).toMatchObject({ t: 'world:acted', op: 2 });
      expect((await progressOf(store, GUEST))?.skills).toEqual({ farming: LEVEL[0]! });
      expect(await progressOf(store, OWNER)).toEqual(ownerBefore);
      room.leave(guest.m);
      room.leave(owner.m);
    });

    it('the badge shows the chosen skill at the level the own xp has earned, and only then', async () => {
      const store = await openWorld(backend);
      expect(await store.setShowOff(OWNER, 'farming', P)).toBeUndefined();
      await setSkills(store, OWNER, { farming: LEVEL[0]!, mining: LEVEL[9]! });
      const before = await progressOf(store, OWNER);

      expect(await store.badgeOf(OWNER, P)).toEqual({ skill: 'farming', level: 1 });
      expect(await store.setShowOff(OWNER, 'mining', P)).toEqual({ skill: 'mining', level: 10 });
      expect(await store.setShowOff(OWNER, 'fishing', P)).toBeUndefined();
      expect(await store.setShowOff(OWNER, null, P)).toBeUndefined();
      expect(await store.badgeOf(OWNER, P)).toBeUndefined();
      // choosing a badge leaves the person's progress row alone
      expect(await progressOf(store, OWNER)).toEqual(before);
    });
  });
}
