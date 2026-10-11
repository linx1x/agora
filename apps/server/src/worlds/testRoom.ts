import { emptySim, randomAvatar, cellKey, type S2CMsg } from '@agora/shared';
import { FakeConn, waitFor } from './testWorld';
import { WorldHub, type WorldActRequest, type WorldMember, type WorldRoom } from './worldRoom';
import type { WorldStore } from './worldStore';

/**
 * Room helpers for the world tests (P17.25, P17.26): a hub on a fake clock, people who join a room over
 * a fake connection, the action sender and the reply reader, and the store readers. The world is `w1`.
 */

/** The cell east of the spawn: where the tests build, buy, ship and farm. */
export const EAST = { x: 1, y: 0 };
export const EAST_KEY = cellKey(EAST.x, EAST.y);

export function hubOn(store: WorldStore, clock: { t: number }): WorldHub {
  return new WorldHub(store, undefined, undefined, undefined, { now: () => clock.t, autoTick: false });
}

export class Who {
  constructor(
    readonly c: FakeConn,
    readonly m: WorldMember,
  ) {}
}

export async function join(room: WorldRoom, id: string, uid: string): Promise<Who> {
  const c = new FakeConn();
  const m = room.join(c, { id, uid, name: id, avatar: randomAvatar() });
  await waitFor(() => c.of('world:inv').length > 0);
  return new Who(c, m);
}

export function act(room: WorldRoom, who: Who, op: number, key: string, kind: WorldActRequest['kind'], item?: string, at = EAST, target?: string) {
  room.act(who.m, { t: 'world:act', op, kind, item, at, target, key } as WorldActRequest);
}

export async function reply(c: FakeConn, op: number): Promise<S2CMsg> {
  const answer = (m: S2CMsg) => (m.t === 'world:acted' || m.t === 'world:refused') && m.op === op;
  await waitFor(() => c.msgs.some(answer));
  return c.msgs.find(answer)!;
}

export const account = (store: WorldStore, uid: string) => store.withTxn((tx) => tx.accountOf(uid, false));
export const ledger = (store: WorldStore, key: string) => store.withTxn((tx) => tx.ledgerOf(key));
/** The farm of the world (an empty farm when nothing has been written yet). */
export const sim = async (store: WorldStore) => (await store.withTxn((tx) => tx.simOf('w1', false)))?.state ?? emptySim(0);

