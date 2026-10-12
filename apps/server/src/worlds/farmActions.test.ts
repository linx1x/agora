import { describe, expect, it } from 'vitest';
import { baseItemOf, randomAvatar, rainWaters, weatherForDay, type S2CMsg } from '@agora/shared';
import { PG_URL, memory, postgres } from './testStores';
import type { WorldStore } from './worldStore';
import { WorldHub, type WorldActRequest, type WorldMember, type WorldRoom } from './worldRoom';
import { FakeConn, NEIGHBOUR, OWNER, SEED, feetCell, openWorld, setCells, waitFor } from './testWorld';

/**
 * The farm through the room (P17.22): plant, water and harvest over real nights. The clock is
 * a fake one: each night the test moves it to the next day and calls `tick`, as the room's own
 * timer would. Runs on the memory store and, with TEST_DATABASE_URL, on Postgres.
 */

const DAY_MS = 20 * 60 * 1000;
/** a time inside game day `day` (day 1 is the first day of the world, in spring) */
const inDay = (day: number, into = 2_000) => (day - 1) * DAY_MS + into;

async function reply(c: FakeConn, op: number): Promise<S2CMsg> {
  const answer = (m: S2CMsg) => (m.t === 'world:acted' || m.t === 'world:refused') && m.op === op;
  await waitFor(() => c.msgs.some(answer));
  return c.msgs.find(answer)!;
}

function act(room: WorldRoom, m: WorldMember, op: number, key: string, kind: WorldActRequest['kind'], item: string | undefined, at?: { x: number; y: number }) {
  room.act(m, { t: 'world:act', op, kind, item, at, key } as WorldActRequest);
}

/** A hub on a fake clock, with its own timer off: the test ticks the day itself. */
function hubAt(store: WorldStore, clock: { t: number }) {
  return new WorldHub(store, undefined, undefined, undefined, { now: () => clock.t, autoTick: false });
}

async function join(room: WorldRoom, id: string, uid: string) {
  const c = new FakeConn();
  const m = room.join(c, { id, uid, name: id, avatar: randomAvatar() });
  await waitFor(() => c.of('world:inv').length > 0);
  return { c, m };
}

const plotOf = async (store: WorldStore, x: number, y: number) =>
  (await store.withTxn((tx) => tx.simOf('w1', false)))?.state.plots[`${x},${y}`];

for (const backend of [memory, postgres]) {
  const suite = backend === postgres && !PG_URL ? describe.skip : describe;
  suite(`the farm through the room on the ${backend.name} (P17.22)`, () => {
    it('a crop grows on each night it is watered, is ripe after its days, and is harvested to the bag', async () => {
      const store = await openWorld(backend);
      const clock = { t: inDay(1) };
      const room = (await hubAt(store, clock).enter('w1'))!;
      const { c, m } = await join(room, 'owner', OWNER);
      const spot = feetCell(m);
      const k = `${spot.x},${spot.y}`;
      await setCells(store, { [k]: { block: 'meadow_grass', decor: '' } });

      act(room, m, 1, 'k-till', 'till', 'hoe_1', spot);
      expect((await reply(c, 1)).t).toBe('world:acted');
      act(room, m, 2, 'k-plant', 'plant', 'dawn_radish_seed', spot);
      expect(await reply(c, 2)).toMatchObject({ t: 'world:acted', op: 2, changes: { items: { dawn_radish_seed: -1 } } });

      // seven nights of watering: dawn radish is 3 + 4 days
      let op = 3;
      for (let day = 1; day <= 8; day++) {
        clock.t = inDay(day);
        act(room, m, op, `k-water-${day}`, 'water', 'can_1', spot);
        const answer = await reply(c, op);
        if (rainWaters(weatherForDay(SEED, day))) {
          expect(answer).toMatchObject({ t: 'world:refused', reason: 'invalid' });
          expect((await plotOf(store, spot.x, spot.y))?.wateredOn).toBe(day + 1);
        } else expect(answer.t).toBe('world:acted');
        op++;
        clock.t = inDay(day + 1, 1_000);
        room.tick();
        await waitFor(() => c.of('world:farm').at(-1)?.day === day + 1);
      }
      expect(await plotOf(store, spot.x, spot.y)).toMatchObject({ tilled: true, crop: { crop: 'dawn_radish', ripe: true, stage: 1 } });

      clock.t = inDay(9);
      act(room, m, op, 'k-harvest', 'harvest', undefined, spot);
      const out = await reply(c, op);
      expect(out.t).toBe('world:acted');
      if (out.t !== 'world:acted') return;
      expect(Object.values(out.changes.items)).toEqual([1]);
      expect(Object.keys(out.changes.items).map(baseItemOf)).toEqual(['dawn_radish']);
      expect(out.changes.xp).toEqual({ farming: 8 });
      expect(c.of('world:farm').at(-1)?.plots[k]).toMatchObject({ tilled: true, crop: null });
      const account = await store.withTxn((tx) => tx.accountOf(OWNER, false));
      expect(Object.values(account.inventory.items).reduce((a, n) => a + n, 0)).toBeGreaterThan(0);
      // energy: the player never sleeps, so each night's rollover passes them out to half of max
      // (135) whatever they had left; the harvest costs no energy
      expect(c.of('world:inv').at(-1)?.energy).toBe(135);
      room.leave(m);
    });

    it('a person in view hears about the farm; the farm on the server keeps the day it was brought to', async () => {
      const store = await openWorld(backend);
      const clock = { t: inDay(1) };
      const room = (await hubAt(store, clock).enter('w1'))!;
      const owner = await join(room, 'owner', OWNER);
      const neighbour = await join(room, 'neighbour', NEIGHBOUR);
      const spot = feetCell(owner.m);
      const k = `${spot.x},${spot.y}`;
      await setCells(store, { [k]: { block: 'meadow_grass', decor: '' } });

      act(room, owner.m, 1, 'k-till', 'till', 'hoe_1', spot);
      await reply(owner.c, 1);
      await waitFor(() => neighbour.c.of('world:farm').some((f) => f.plots[k] !== undefined && f.plots[k] !== null));
      expect(neighbour.c.of('world:farm').at(-1)?.plots[k]).toMatchObject({ tilled: true });
      room.leave(owner.m);
      room.leave(neighbour.m);
    });

    it('a farm left for several nights is brought up on load: only the watered nights grow it', async () => {
      const store = await openWorld(backend);
      const clock = { t: inDay(1) };
      const first = (await hubAt(store, clock).enter('w1'))!;
      const { c, m } = await join(first, 'owner', OWNER);
      const spot = feetCell(m);
      const k = `${spot.x},${spot.y}`;
      await setCells(store, { [k]: { block: 'meadow_grass', decor: '' } });
      act(first, m, 1, 'k-till', 'till', 'hoe_1', spot);
      act(first, m, 2, 'k-plant', 'plant', 'dawn_radish_seed', spot);
      act(first, m, 3, 'k-water', 'water', 'can_1', spot);
      await reply(c, 3);
      first.leave(m);
      await waitFor(() => first.disposed);

      // four days pass with nobody there: only the night of day 1 to 2 was watered
      clock.t = inDay(5);
      const later = (await hubAt(store, clock).enter('w1'))!;
      const back = await join(later, 'owner', OWNER);
      await waitFor(() => back.c.of('world:farm').length > 0);
      const plot = await plotOf(store, spot.x, spot.y);
      expect(plot?.crop).toMatchObject({ crop: 'dawn_radish', daysInStage: 1, stage: 0 });
      expect((await store.withTxn((tx) => tx.simOf('w1', false)))?.state.day).toBe(5);
      expect(back.c.of('world:farm')[0]).toMatchObject({ day: 5 });
      later.leave(back.m);
    });
  });
}
