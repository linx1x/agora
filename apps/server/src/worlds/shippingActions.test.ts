import { describe, expect, it } from 'vitest';
import { loadGameData, passOutFine, sellShipping } from '@agora/shared';
import { PG_URL, memory, postgres } from './testStores';
import { catchUpFarm } from './farm';
import { EAST_KEY, account, act, hubOn, join, ledger, reply, sim } from './testRoom';
import { GUEST, OWNER, flatYard, grant, openWorld, paintCells } from './testWorld';

/**
 * P17.26 (ADR-053, skill agora-world-action): the shipping bin. A stack put in the bin leaves the bag at
 * once and is sold at the next day change (06:00): the owner is paid once, with one ledger row for the
 * day. The sale happens on the first action of the day, or on the room's own catch-up at the day change.
 * Every test runs on the memory store and, when TEST_DATABASE_URL is set, on Postgres.
 */

const DAY_MS = 20 * 60 * 1000;
const data = loadGameData();
const CROP = 'dawn_radish';
const PEA = 'honey_pea';
const BIN = { [EAST_KEY]: { decor: 'shipping_bin' } };

for (const backend of [memory, postgres]) {
  const suite = backend === postgres && !PG_URL ? describe.skip : describe;
  suite(`the shipping bin on ${backend.name} (P17.26, ADR-053)`, () => {
    it('a stack leaves the bag into the bin; the day change pays the owner once, with a ledger row, and a resend is one shipment', async () => {
      const store = await openWorld(backend, { grants: [] });
      await flatYard(store);
      await paintCells(store, BIN);
      await grant(store, OWNER, { [CROP]: 3, [PEA]: 1 });
      const clock = { t: DAY_MS + 2_000 };
      const room = (await hubOn(store, clock).enter('w1'))!;
      const owner = await join(room, 'owner', OWNER);

      act(room, owner, 1, 'k-ship-1', 'ship', CROP);
      expect(await reply(owner.c, 1)).toMatchObject({ t: 'world:acted', op: 1, changes: { items: { [CROP]: -3 } } });
      expect((await sim(store)).shipping).toEqual({ [CROP]: 3 });
      // the same key again is the same shipment: nothing leaves the bag twice
      act(room, owner, 2, 'k-ship-1', 'ship', CROP);
      expect(await reply(owner.c, 2)).toMatchObject({ t: 'world:acted', op: 2, changes: { items: { [CROP]: -3 } } });
      expect((await account(store, OWNER)).inventory.items[CROP]).toBeUndefined();
      expect((await sim(store)).shipping).toEqual({ [CROP]: 3 });

      // the next day: the first action sells the bin, then ships the pea into the new bin
      clock.t += DAY_MS;
      const moneyBefore = (await account(store, OWNER)).inventory.money;
      act(room, owner, 3, 'k-ship-2', 'ship', PEA);
      expect(await reply(owner.c, 3)).toMatchObject({ t: 'world:acted', op: 3, changes: { items: { [PEA]: -1 } } });
      const sold = sellShipping({ [CROP]: 3 }, data)!.money;
      expect(sold).toBeGreaterThan(0);
      // the day change finds the owner in the world, away from home: the pass-out fine (P17.23) comes off the money too
      const { moneyPct, moneyCap } = data.progression.passOut;
      const fine = passOutFine(moneyBefore + sold, moneyPct, moneyCap);
      expect((await account(store, OWNER)).inventory.money).toBe(moneyBefore + sold - fine);
      expect((await sim(store)).shipping).toEqual({ [PEA]: 1 });
      const day = (await sim(store)).day;
      expect(await ledger(store, `ship:w1:${day}`)).toMatchObject({ kind: 'ship', actor: OWNER, delta: { money: sold } });
      room.leave(owner.m);
    });

    it('the room catches up at the day change without an action: the bin is sold to the owner, and a second catch-up that day sells nothing', async () => {
      const store = await openWorld(backend, { grants: [] });
      await flatYard(store);
      await paintCells(store, BIN);
      await grant(store, OWNER, { [CROP]: 2 });
      const clock = { t: DAY_MS + 2_000 };
      const room = (await hubOn(store, clock).enter('w1'))!;
      const owner = await join(room, 'owner', OWNER);
      act(room, owner, 1, 'k-ship-c', 'ship', CROP);
      expect(await reply(owner.c, 1)).toMatchObject({ t: 'world:acted', op: 1 });
      room.leave(owner.m);

      const moneyBefore = (await account(store, OWNER)).inventory.money;
      const day = (await sim(store)).day + 1;
      const at = clock.t + DAY_MS;
      const world = { id: 'w1', ownerId: OWNER };
      const after = await catchUpFarm(store, world, day, data, 1, at);
      expect(after?.shipping ?? {}).toEqual({});
      const sold = sellShipping({ [CROP]: 2 }, data)!.money;
      expect((await account(store, OWNER)).inventory.money).toBe(moneyBefore + sold);
      expect(await ledger(store, `ship:w1:${day}`)).toMatchObject({ kind: 'ship', actor: OWNER, delta: { money: sold } });

      // the same day again: the bin is empty, so nothing is paid twice
      await catchUpFarm(store, world, day, data, 1, at);
      expect((await account(store, OWNER)).inventory.money).toBe(moneyBefore + sold);
    });

    it('a visitor cannot ship: forbidden, and neither the bag nor the bin changes', async () => {
      const store = await openWorld(backend, { grants: [] });
      await flatYard(store);
      await paintCells(store, BIN);
      await grant(store, OWNER, { [CROP]: 1 });
      await grant(store, GUEST, { [CROP]: 1 });
      const clock = { t: DAY_MS + 2_000 };
      const room = (await hubOn(store, clock).enter('w1'))!;
      const owner = await join(room, 'owner', OWNER);
      const guest = await join(room, 'guest', GUEST);
      const guestBefore = await account(store, GUEST);

      act(room, guest, 1, 'k-guest-ship', 'ship', CROP);
      expect(await reply(guest.c, 1)).toEqual({ t: 'world:refused', op: 1, reason: 'forbidden' });
      expect(await account(store, GUEST)).toEqual(guestBefore);
      expect((await sim(store)).shipping ?? {}).toEqual({});
      expect(await ledger(store, 'k-guest-ship')).toBeNull();
      room.leave(owner.m);
      room.leave(guest.m);
    });

    it('a bin with no produce on the cell refuses: nothing is shipped from a plain cell', async () => {
      const store = await openWorld(backend, { grants: [] });
      await flatYard(store);
      await grant(store, OWNER, { [CROP]: 1 });
      const clock = { t: DAY_MS + 2_000 };
      const room = (await hubOn(store, clock).enter('w1'))!;
      const owner = await join(room, 'owner', OWNER);
      act(room, owner, 1, 'k-ship-plain', 'ship', CROP);
      expect(await reply(owner.c, 1)).toEqual({ t: 'world:refused', op: 1, reason: 'invalid' });
      expect((await account(store, OWNER)).inventory.items[CROP]).toBe(1);
      room.leave(owner.m);
    });
  });
}
