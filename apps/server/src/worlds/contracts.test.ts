import { describe, expect, it } from 'vitest';
import { loadGameData, type S2CMsg } from '@agora/shared';
import { PG_URL, memory, postgres } from './testStores';
import { hubOn, join, act, reply, account, ledger, type Who } from './testRoom';
import { GUEST, NEIGHBOUR, OWNER, flatYard, openWorld, setCells, waitFor } from './testWorld';
import { contractIdOf, openContracts, postContract, workContract } from './contracts';
import type { WorldRoom } from './worldRoom';
import type { WorldStore } from './worldStore';

/**
 * World contracts (P17.28, ADR-053, skill agora-world-action): the reward is escrowed when the owner
 * posts, counted per accepted action, paid once to the first worker at the goal, refunded once on
 * cancel. Money is conserved. Every test runs on the memory store and, with TEST_DATABASE_URL, Postgres.
 */
const data = loadGameData();
const DAY_MS = 20 * 60 * 1000;
const TREES = { '1,0': { decor: 'oak_tree' }, '-1,0': { decor: 'oak_tree' }, '0,1': { decor: 'oak_tree' }, '0,-1': { decor: 'oak_tree' } };

const money = async (store: WorldStore, uid: string) => (await account(store, uid)).inventory.money;
const lastOf = <T extends S2CMsg['t']>(who: Who, t: T) =>
  who.c.msgs.filter((m): m is Extract<S2CMsg, { t: T }> => m.t === t).at(-1);

async function post(room: WorldRoom, owner: Who, key: string, kind: 'chop' | 'water', goal: number, reward: number) {
  const before = owner.c.msgs.length;
  room.contract(owner.m, { t: 'contract:post', kind, goal, reward, key });
  await waitFor(() => owner.c.msgs.slice(before).some((m) => m.t === 'contract:result'));
  return owner.c.msgs.slice(before).find((m) => m.t === 'contract:result')!;
}

for (const backend of [memory, postgres]) {
  const suite = backend === postgres && !PG_URL ? describe.skip : describe;
  suite(`world contracts on ${backend.name} (P17.28)`, () => {
    async function scene() {
      const store = await openWorld(backend, { grants: [] });
      await flatYard(store);
      await setCells(store, TREES);
      const clock = { t: DAY_MS + 2_000 };
      const room = (await hubOn(store, clock).enter('w1'))!;
      const owner = await join(room, 'owner', OWNER);
      const guest = await join(room, 'guest', GUEST);
      return { store, room, owner, guest };
    }

    it('posting escrows the reward: it leaves the owner, the ledger has it, a resend is one contract, everyone sees it', async () => {
      const { store, room, owner, guest } = await scene();
      const before = await money(store, OWNER);
      expect(await post(room, owner, 'k-post-1', 'chop', 2, 120)).toMatchObject({ ok: true, op: 'post' });
      expect(await post(room, owner, 'k-post-1', 'chop', 2, 120)).toMatchObject({ ok: true });
      expect(await money(store, OWNER)).toBe(before - 120);
      expect(await ledger(store, 'k-post-1')).toMatchObject({ kind: 'contract:post', delta: { money: -120 } });
      expect(await openContracts(store, 'w1')).toHaveLength(1);
      await waitFor(() => (lastOf(guest, 'world:contracts')?.contracts.length ?? 0) === 1);
      expect(lastOf(guest, 'world:contracts')!.contracts[0]).toEqual({
        id: contractIdOf('w1', 'k-post-1'),
        kind: 'chop',
        goal: 2,
        reward: 120,
        mine: 0,
        best: 0,
      });
      room.leave(owner.m);
      room.leave(guest.m);
    });

    it('refuses a post beyond the money or the open limit, and a visitor’s post; nothing moves', async () => {
      const { store, room, owner, guest } = await scene();
      const before = await money(store, OWNER);
      expect(await post(room, owner, 'k-post-rich', 'chop', 2, before + 1)).toMatchObject({ ok: false, reason: 'money' });
      for (const k of ['a', 'b', 'c']) expect(await post(room, owner, `k-post-${k}0000`, 'water', 2, 10)).toMatchObject({ ok: true });
      expect(await post(room, owner, 'k-post-d0000', 'water', 2, 10)).toMatchObject({ ok: false, reason: 'limit' });
      expect(await money(store, OWNER)).toBe(before - 30);
      const g0 = await money(store, GUEST);
      room.contract(guest.m, { t: 'contract:post', kind: 'chop', goal: 1, reward: 10, key: 'k-guest-post' });
      await waitFor(() => !!lastOf(guest, 'contract:result'));
      expect(lastOf(guest, 'contract:result')).toMatchObject({ ok: false, reason: 'forbidden' });
      expect(await money(store, GUEST)).toBe(g0);
      room.leave(owner.m);
      room.leave(guest.m);
    });

    it('a wood contract opens chopping to visitors, counts each accepted chop, pays the reward once at the goal, and closes', async () => {
      const { store, room, owner, guest } = await scene();
      act(room, guest, 1, 'k-chop-before', 'chop', 'axe_1', { x: 1, y: 0 });
      expect(await reply(guest.c, 1)).toMatchObject({ t: 'world:refused', reason: 'forbidden' });

      const o0 = await money(store, OWNER);
      const g0 = await money(store, GUEST);
      await post(room, owner, 'k-post-wood', 'chop', 2, 150);
      act(room, guest, 2, 'k-chop-1', 'chop', 'axe_1', { x: 1, y: 0 });
      expect(await reply(guest.c, 2)).toMatchObject({ t: 'world:acted' });
      await waitFor(() => lastOf(guest, 'world:contracts')?.contracts[0]?.mine === 1);
      // a resend of the same action counts nothing more
      act(room, guest, 3, 'k-chop-1', 'chop', 'axe_1', { x: 1, y: 0 });
      await reply(guest.c, 3);
      // the owner's own chop never counts
      act(room, owner, 4, 'k-owner-chop', 'chop', 'axe_1', { x: 0, y: -1 });
      await reply(owner.c, 4);
      expect((await openContracts(store, 'w1'))[0]?.progress).toEqual({ [GUEST]: 1 });

      act(room, guest, 5, 'k-chop-2', 'chop', 'axe_1', { x: -1, y: 0 });
      expect(await reply(guest.c, 5)).toMatchObject({ t: 'world:acted' });
      await waitFor(() => !!lastOf(guest, 'contract:paid'));
      expect(lastOf(guest, 'contract:paid')).toMatchObject({ kind: 'chop', reward: 150 });
      expect(await money(store, GUEST)).toBe(g0 + 150);
      expect(await money(store, OWNER)).toBe(o0 - 150);
      expect(await ledger(store, `contract-pay-${contractIdOf('w1', 'k-post-wood')}`)).toMatchObject({ actor: GUEST, kind: 'contract:pay' });
      expect(await openContracts(store, 'w1')).toEqual([]);
      await waitFor(() => lastOf(owner, 'world:contracts')?.contracts.length === 0);

      // closed: chopping is closed to visitors again
      act(room, guest, 6, 'k-chop-after', 'chop', 'axe_1', { x: 0, y: 1 });
      expect(await reply(guest.c, 6)).toMatchObject({ t: 'world:refused', reason: 'forbidden' });
      room.leave(owner.m);
      room.leave(guest.m);
    });

    it('cancel gives the reward back once; a second cancel finds nothing', async () => {
      const { store, room, owner, guest } = await scene();
      const o0 = await money(store, OWNER);
      await post(room, owner, 'k-post-cancel', 'water', 5, 80);
      const id = contractIdOf('w1', 'k-post-cancel');
      const cancel = async () => {
        const before = owner.c.msgs.length;
        room.contract(owner.m, { t: 'contract:cancel', id });
        await waitFor(() => owner.c.msgs.slice(before).some((m) => m.t === 'contract:result'));
        return owner.c.msgs.slice(before).find((m) => m.t === 'contract:result');
      };
      expect(await cancel()).toMatchObject({ ok: true, op: 'cancel' });
      expect(await cancel()).toMatchObject({ ok: false, reason: 'gone' });
      expect(await money(store, OWNER)).toBe(o0);
      // a visitor cannot cancel
      room.contract(guest.m, { t: 'contract:cancel', id });
      await waitFor(() => !!lastOf(guest, 'contract:result'));
      expect(lastOf(guest, 'contract:result')).toMatchObject({ ok: false, reason: 'forbidden' });
      room.leave(owner.m);
      room.leave(guest.m);
    });

    it('two workers reaching the goal at once: exactly one is paid, and money is conserved', async () => {
      const store = await openWorld(backend, { grants: [] });
      const now = DAY_MS;
      await store.withTxn(async (tx) => {
        const a = await tx.accountOf(OWNER, true);
        await tx.saveAccount(OWNER, { items: {}, money: 1000 }, a.rev);
      });
      const posted = await postContract(store, data, { worldId: 'w1', ownerId: OWNER, kind: 'water', goal: 1, reward: 200, key: 'k-post-race', now });
      expect(posted.ok).toBe(true);
      const total = async () => (await money(store, OWNER)) + (await money(store, GUEST)) + (await money(store, NEIGHBOUR));
      const before = (await total()) + 200; // the escrow
      const results = await Promise.all([
        workContract(store, data, { worldId: 'w1', actor: GUEST, kind: 'water', key: 'k-w-guest', now }),
        workContract(store, data, { worldId: 'w1', actor: NEIGHBOUR, kind: 'water', key: 'k-w-neighbour', now }),
      ]);
      expect(results.filter((r) => r.paid === 200)).toHaveLength(1);
      expect(await total()).toBe(before);
      expect(await openContracts(store, 'w1')).toEqual([]);
    });
  });
}
