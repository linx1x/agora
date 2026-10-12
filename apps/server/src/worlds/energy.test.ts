import { describe, expect, it } from 'vitest';
import { WORLD_CELL_PX, foodRestore, loadGameData, randomAvatar, type S2CMsg } from '@agora/shared';
import { PG_URL, memory, postgres } from './testStores';
import type { WorldStore } from './worldStore';
import { WorldHub, type WorldActRequest, type WorldMember, type WorldRoom } from './worldRoom';
import { passOutKey } from './energy';
import { FakeConn, GUEST, OWNER, grant, openWorld, setCells, setEnergy, waitFor } from './testWorld';

/**
 * Energy across the day's end through the room (P17.23): the bed, the pass-out, the fine away from
 * home, food, the asleep refusal, the settle of someone who was away, and the world clock on the
 * wire. A fake clock: the test moves it and calls `tick`, as the room's timer would. Runs on the
 * memory store and, with TEST_DATABASE_URL, on Postgres.
 */

const DAY_MS = 20 * 60 * 1000;
/** a time inside game day `day`; day 1 starts at 06:00 (`into` is milliseconds from that start) */
const inDay = (day: number, into = 0) => (day - 1) * DAY_MS + into;
/** the milliseconds from 06:00 to a clock time on the same game day (1 game minute per second) */
const at = (hour: number, minute = 0) => ((hour < 6 ? hour + 24 : hour) * 60 + minute - 360) * 1000;
const HOME = { x: -4, y: -4 };
const AWAY = { x: 20, y: 20 };
const RADISH = loadGameData().items.find((i) => i.id === 'dawn_radish')!;

async function reply(c: FakeConn, op: number): Promise<S2CMsg> {
  const answer = (m: S2CMsg) => (m.t === 'world:acted' || m.t === 'world:refused') && m.op === op;
  await waitFor(() => c.msgs.some(answer));
  return c.msgs.find(answer)!;
}

function act(room: WorldRoom, m: WorldMember, op: number, key: string, kind: WorldActRequest['kind'], item: string | undefined, cell?: { x: number; y: number }) {
  room.act(m, { t: 'world:act', op, kind, item, at: cell, key } as WorldActRequest);
}

/** A hub on a fake clock with its own timer off. */
function hubAt(store: WorldStore, clock: { t: number }) {
  return new WorldHub(store, undefined, undefined, undefined, { now: () => clock.t, autoTick: false });
}

async function join(room: WorldRoom, id: string, uid: string, cell: { x: number; y: number }) {
  const c = new FakeConn();
  const m = room.join(c, { id, uid, name: id, avatar: randomAvatar() });
  m.x = cell.x * WORLD_CELL_PX + WORLD_CELL_PX / 2;
  m.y = cell.y * WORLD_CELL_PX + WORLD_CELL_PX / 2;
  await waitFor(() => c.of('world:inv').length > 0);
  return { c, m };
}

/** The last inventory the person was sent (money and energy). */
const lastInv = (c: FakeConn) => c.of('world:inv').at(-1) as Extract<S2CMsg, { t: 'world:inv' }> | undefined;

for (const backend of [memory, postgres]) {
  const suite = backend === postgres && !PG_URL ? describe.skip : describe;
  suite(`energy across the day on the ${backend.name} (P17.23)`, () => {
    it('a bed restores the whole energy at the rollover, and nothing can be done meanwhile', async () => {
      const store = await openWorld(backend);
      const clock = { t: inDay(1, at(23, 30)) };
      const room = (await hubAt(store, clock).enter('w1'))!;
      await setEnergy(store, OWNER, 50, 1);
      const { c, m } = await join(room, 'owner', OWNER, AWAY);
      await setCells(store, { [`${AWAY.x},${AWAY.y}`]: { block: 'meadow_grass', decor: 'bed' } });

      act(room, m, 1, 'k-sleep', 'sleep', undefined, AWAY);
      expect(await reply(c, 1)).toEqual({ t: 'world:acted', op: 1, changes: { items: {}, money: 0, energy: 0, xp: {} } });
      act(room, m, 2, 'k-till', 'till', 'hoe_1', AWAY);
      expect(await reply(c, 2)).toEqual({ t: 'world:refused', op: 2, reason: 'asleep' });

      clock.t = inDay(2, 0);
      room.tick();
      await waitFor(() => lastInv(c)?.energy === 270);
      // in bed: no pass-out fine, even away from home
      expect(lastInv(c)).toMatchObject({ money: 500, energy: 270 });
      room.leave(m);
    });

    it('a person still up at the rollover passes out to half their energy, a quarter at none, at home for free', async () => {
      const store = await openWorld(backend);
      const clock = { t: inDay(1, at(22)) };
      const room = (await hubAt(store, clock).enter('w1'))!;
      await setEnergy(store, OWNER, 100, 1);
      await setEnergy(store, GUEST, 0, 1);
      const owner = await join(room, 'owner', OWNER, HOME);
      const guest = await join(room, 'guest', GUEST, HOME);

      clock.t = inDay(2, 0);
      room.tick();
      await waitFor(() => lastInv(owner.c)?.energy === 135 && lastInv(guest.c)?.energy === 68);
      expect(lastInv(owner.c)).toMatchObject({ money: 500 });
      expect(lastInv(guest.c)).toMatchObject({ money: 500 });
      room.leave(owner.m);
      room.leave(guest.m);
    });

    it('passing out away from home costs a tenth of the money, once for the day, in the ledger', async () => {
      const store = await openWorld(backend);
      const clock = { t: inDay(1, at(22)) };
      const room = (await hubAt(store, clock).enter('w1'))!;
      await setEnergy(store, OWNER, 100, 1);
      const { c, m } = await join(room, 'owner', OWNER, AWAY);

      clock.t = inDay(2, 0);
      room.tick();
      await waitFor(() => lastInv(c)?.energy === 135);
      expect(lastInv(c)).toMatchObject({ money: 450 });
      const fine = await store.withTxn((tx) => tx.ledgerOf(passOutKey(OWNER, 2)));
      expect(fine).toMatchObject({ actor: OWNER, delta: { money: -50, energy: 0 } });
      room.leave(m);
    });

    it('someone who was away at the rollover is settled when they come back, with no money lost', async () => {
      const store = await openWorld(backend);
      const clock = { t: inDay(1, at(22)) };
      const room = (await hubAt(store, clock).enter('w1'))!;
      await setEnergy(store, GUEST, 100, 1);
      const owner = await join(room, 'owner', OWNER, HOME);

      clock.t = inDay(3, at(7));
      room.tick();
      const back = await join(room, 'guest', GUEST, HOME);
      await waitFor(() => lastInv(back.c) !== undefined);
      // two rollovers while away: the first passes out (half), the second passes out again (half)
      expect(lastInv(back.c)).toMatchObject({ money: 500, energy: 135 });
      room.leave(owner.m);
      room.leave(back.m);
    });

    it('food restores its energy, more for a better quality, and never above max', async () => {
      const store = await openWorld(backend);
      const clock = { t: inDay(1, at(10)) };
      const room = (await hubAt(store, clock).enter('w1'))!;
      await setEnergy(store, OWNER, 100, 1);
      await grant(store, OWNER, { 'dawn_radish~2': 1, dawn_radish: 1 });
      const { c, m } = await join(room, 'owner', OWNER, HOME);

      act(room, m, 1, 'k-eat-gold', 'eat', 'dawn_radish~2', undefined);
      expect(await reply(c, 1)).toMatchObject({ t: 'world:acted', op: 1, changes: { items: { 'dawn_radish~2': -1 }, energy: foodRestore(RADISH.edibility!, 2) } });
      expect(lastInv(c)).toMatchObject({ energy: 100 + foodRestore(RADISH.edibility!, 2) });

      act(room, m, 2, 'k-eat-plain', 'eat', 'dawn_radish', undefined);
      expect(await reply(c, 2)).toMatchObject({ t: 'world:acted', op: 2, changes: { energy: foodRestore(RADISH.edibility!, 0) } });
      room.leave(m);
    });

    it('the world time goes to each person on arrival and then every 10 game minutes', async () => {
      const store = await openWorld(backend);
      const clock = { t: inDay(1, at(6)) };
      const room = (await hubAt(store, clock).enter('w1'))!;
      const { c, m } = await join(room, 'owner', OWNER, HOME);
      expect(c.of('world:time')).toEqual([expect.objectContaining({ t: 'world:time', time: expect.objectContaining({ day: 1, hour: 6, minute: 0 }) })]);

      clock.t = inDay(1, at(6, 9));
      room.tick();
      expect(c.of('world:time')).toHaveLength(1);

      clock.t = inDay(1, at(6, 10));
      room.tick();
      expect(c.of('world:time')).toHaveLength(2);
      expect(c.of('world:time')[1]).toMatchObject({ time: { day: 1, hour: 6, minute: 10 } });

      clock.t = inDay(1, at(6, 10) + 500);
      room.tick();
      expect(c.of('world:time')).toHaveLength(2);
      room.leave(m);
    });
  });
}
