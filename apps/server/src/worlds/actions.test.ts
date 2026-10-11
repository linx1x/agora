import pg from 'pg';
import { afterEach, describe, expect, it } from 'vitest';
import {
  loadGameData,
  localIndexOf,
  noChanges,
  randomAvatar,
  refuse,
  type ActionPlanner,
  type S2CMsg,
} from '@agora/shared';
import { PgStore } from '../db/store';
import { MemoryWorldStore, type WorldStore } from './worldStore';
import { WorldHub, type WorldActRequest, type WorldMember, type WorldRoom } from './worldRoom';
import { starterKey } from './inventory';

/**
 * World actions through the room (P17.20, skill agora-world-action): the pipeline with a probe rule
 * in place of the real ones (P17.21 adds those). Every test runs on the memory store and, when
 * TEST_DATABASE_URL is set, on Postgres in a schema of its own (dropped afterwards), so the
 * transaction and ledger semantics are checked on both.
 */

const SEED = 3560865791;
const data = loadGameData();
const KIT = data.progression.starterKit;
const OWNER = 'uid-owner';
const GUEST = 'uid-guest';
/** a tree stands on each of these cells, all in chunk (0, 0) and all within reach of the spawn */
const TREES = [
  { x: 1, y: 0 },
  { x: 0, y: 1 },
  { x: 1, y: 1 },
];
const TREE = TREES[0]!;
const CHANGES = { ...noChanges(), items: { stone: 1 }, money: 5 };

/** A probe rule: a tree (decor oak_tree) is cut for one stone and five coins. */
const probeCut: ActionPlanner = (view, req) => {
  if (!req.at) return refuse('invalid');
  if (view.cell(req.at.x, req.at.y).decor !== 'oak_tree') return refuse('gone');
  return {
    ok: true,
    plan: {
      changes: CHANGES,
      edits: [{ x: req.at.x, y: req.at.y, patch: { decor: '' } }],
      sim: view.sim,
    },
  };
};
const PROBE = { harvest: probeCut, chop: probeCut };

class FakeConn {
  msgs: S2CMsg[] = [];
  send(m: S2CMsg) {
    this.msgs.push(m);
  }
  of<T extends S2CMsg['t']>(t: T) {
    return this.msgs.filter((m): m is Extract<S2CMsg, { t: T }> => m.t === t);
  }
}

const who = (id: string) => ({ id, uid: `uid-${id}`, name: id, avatar: randomAvatar() });

interface Opened {
  worlds: WorldStore;
  users(uids: string[]): Promise<void>;
  close(): Promise<void>;
}
interface Backend {
  name: string;
  open(): Promise<Opened>;
}

const memory: Backend = {
  name: 'memory store',
  async open() {
    return { worlds: new MemoryWorldStore(), users: async () => {}, close: async () => {} };
  },
};

const PG_URL = process.env.TEST_DATABASE_URL;
const postgres: Backend = {
  name: 'postgres',
  async open() {
    const schema = `actions_${process.pid}_${Math.random().toString(36).slice(2, 10)}`;
    const admin = new pg.Client({ connectionString: PG_URL });
    await admin.connect();
    await admin.query(`CREATE SCHEMA ${schema}`);
    await admin.end();
    const sep = PG_URL!.includes('?') ? '&' : '?';
    const store = new PgStore(`${PG_URL}${sep}options=${encodeURIComponent(`-c search_path=${schema}`)}`);
    await store.init();
    return {
      worlds: store.worlds,
      async users(uids) {
        for (const uid of uids) await store.upsertUser({ uid, name: uid, avatar: null });
      },
      async close() {
        await store.close();
        const drop = new pg.Client({ connectionString: PG_URL });
        await drop.connect();
        await drop.query(`DROP SCHEMA ${schema} CASCADE`);
        await drop.end();
      },
    };
  },
};

/** the stores opened by the running test, closed after it */
const opened: Array<() => Promise<void>> = [];

async function world(backend: Backend): Promise<WorldStore> {
  const h = await backend.open();
  opened.push(h.close);
  await h.users([OWNER, GUEST]);
  const store = h.worlds;
  await store.createWorld({
    id: 'w1',
    ownerId: OWNER,
    seed: SEED,
    genVersion: 1,
    createdAt: 0,
    lastDay: 0,
    settings: { grants: ['harvest'] },
  });
  const delta = Object.fromEntries(TREES.map((t) => [localIndexOf(t.x, t.y), { decor: 'oak_tree' }]));
  const saved = await store.withTxn((tx) => tx.saveChunk('w1', 0, 0, delta, 0));
  expect(saved.ok).toBe(true);
  return store;
}

function join(room: WorldRoom, id: string): { m: WorldMember; c: FakeConn } {
  const c = new FakeConn();
  return { m: room.join(c, who(id)), c };
}

function act(room: WorldRoom, m: WorldMember, op: number, key: string, kind: WorldActRequest['kind'] = 'harvest', at = TREE) {
  room.act(m, { t: 'world:act', op, kind, at, key } as WorldActRequest);
}

/** polls, so that real database round trips can finish between checks */
async function waitFor(cond: () => boolean): Promise<void> {
  for (let i = 0; i < 1000; i++) {
    if (cond()) return;
    await new Promise((resolve) => setTimeout(resolve, 2));
  }
  throw new Error('timed out waiting for the room');
}

const replies = (c: FakeConn) => c.of('world:acted').length + c.of('world:refused').length;

async function account(store: WorldStore, uid: string) {
  return store.withTxn((tx) => tx.accountOf(uid, false));
}

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((r) => (resolve = r));
  return { promise, resolve };
}

for (const backend of [memory, postgres]) {
const suite = backend === postgres && !PG_URL ? describe.skip : describe;
suite(`world actions on ${backend.name}: the pipeline (P17.20, ADR-053)`, () => {
  afterEach(async () => {
    while (opened.length) await opened.pop()!();
  });

  it('an approved action changes the inventory, the chunk and the ledger together', async () => {
    const store = await world(backend);
    const room = (await new WorldHub(store, undefined, PROBE).enter('w1'))!;
    const owner = join(room, 'owner');
    await waitFor(() => owner.c.of('world:inv').length > 0);
    act(room, owner.m, 1, 'k-1');
    await waitFor(() => replies(owner.c) > 0);

    expect(owner.c.of('world:acted')).toEqual([{ t: 'world:acted', op: 1, changes: CHANGES }]);
    const inv = owner.c.of('world:inv').at(-1)!;
    expect(inv).toMatchObject({ items: { stone: 1 }, money: KIT.money + 5, maxEnergy: data.progression.energy.max });
    expect(await account(store, OWNER)).toMatchObject({ inventory: { items: { stone: 1 }, money: KIT.money + 5 } });
    expect(room.terrain.cellAt(TREE.x, TREE.y).decor).toBe('');
    const ledger = await store.withTxn((tx) => tx.ledgerOf('k-1'));
    expect(ledger).toMatchObject({ actor: OWNER, worldId: 'w1', kind: 'harvest', delta: CHANGES });
    const chunk = (await store.loadChunks('w1', [{ cx: 0, cy: 0 }]))[0]!;
    expect(chunk.rev).toBe(2);
    expect(chunk.delta[localIndexOf(TREE.x, TREE.y)]).toEqual({ decor: '' });
  });

  it('the same key twice has one effect and the same reply', async () => {
    const store = await world(backend);
    const room = (await new WorldHub(store, undefined, PROBE).enter('w1'))!;
    const owner = join(room, 'owner');
    await waitFor(() => owner.c.of('world:inv').length > 0);
    act(room, owner.m, 1, 'k-dup');
    await waitFor(() => replies(owner.c) > 0);
    // the tree is gone now: a re-run would be refused as gone, so a second acted reply is a replay
    act(room, owner.m, 1, 'k-dup');
    await waitFor(() => replies(owner.c) > 1);

    expect(owner.c.of('world:refused')).toEqual([]);
    expect(owner.c.of('world:acted')).toEqual([
      { t: 'world:acted', op: 1, changes: CHANGES },
      { t: 'world:acted', op: 1, changes: CHANGES },
    ]);
    expect(await account(store, OWNER)).toMatchObject({ inventory: { items: { stone: 1 }, money: KIT.money + 5 } });
  });

  it('a resend after a lost reply, on a new connection, has one effect', async () => {
    const store = await world(backend);
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
    const hub = new WorldHub(held, undefined, PROBE);
    const room = (await hub.enter('w1'))!;
    const first = join(room, 'owner');
    await waitFor(() => first.c.of('world:inv').length > 0);

    armed = true;
    act(room, first.m, 1, 'k-lost');
    await started.promise;
    room.leave(first.m); // the connection drops with the reply still to send
    release.resolve();
    await waitFor(() => room.disposed); // the action finished and nobody is left

    expect(first.c.of('world:acted')).toEqual([]);
    const again = (await hub.enter('w1'))!;
    const second = join(again, 'owner');
    act(again, second.m, 2, 'k-lost');
    await waitFor(() => replies(second.c) > 0);

    expect(second.c.of('world:refused')).toEqual([]);
    expect(second.c.of('world:acted')).toEqual([{ t: 'world:acted', op: 2, changes: CHANGES }]);
    expect(await account(store, OWNER)).toMatchObject({ inventory: { items: { stone: 1 }, money: KIT.money + 5 } });
  });

  it('two people acting on the same tree in the same tick: one wins, the other is told gone', async () => {
    const store = await world(backend);
    const room = (await new WorldHub(store, undefined, PROBE).enter('w1'))!;
    const owner = join(room, 'owner');
    const guest = join(room, 'guest');
    await waitFor(() => owner.c.of('world:inv').length > 0 && guest.c.of('world:inv').length > 0);
    act(room, owner.m, 1, 'k-own');
    act(room, guest.m, 1, 'k-guest');
    await waitFor(() => replies(owner.c) > 0 && replies(guest.c) > 0);

    expect(owner.c.of('world:acted')).toHaveLength(1);
    expect(guest.c.of('world:refused')).toEqual([{ t: 'world:refused', op: 1, reason: 'gone' }]);
    expect((await account(store, OWNER)).inventory.items.stone).toBe(1);
    expect((await account(store, GUEST)).inventory.items.stone).toBeUndefined();
  });

  it('a visitor without permission is refused, and nothing changes', async () => {
    const store = await world(backend);
    const room = (await new WorldHub(store, undefined, PROBE).enter('w1'))!;
    const guest = join(room, 'guest');
    await waitFor(() => guest.c.of('world:inv').length > 0);
    const before = await account(store, GUEST);
    act(room, guest.m, 1, 'k-denied', 'chop');
    await waitFor(() => replies(guest.c) > 0);

    expect(guest.c.of('world:refused')).toEqual([{ t: 'world:refused', op: 1, reason: 'forbidden' }]);
    expect(await account(store, GUEST)).toEqual(before);
    const tree = (await store.loadChunks('w1', [{ cx: 0, cy: 0 }]))[0]!;
    expect(tree.rev).toBe(1);
    expect(await store.withTxn((tx) => tx.ledgerOf('k-denied'))).toBeNull();
  });

  it('refuses a target out of reach, and a kind with no rule, without writing', async () => {
    const store = await world(backend);
    const room = (await new WorldHub(store, undefined, PROBE).enter('w1'))!;
    const owner = join(room, 'owner');
    await waitFor(() => owner.c.of('world:inv').length > 0);
    act(room, owner.m, 1, 'k-far', 'harvest', { x: 20, y: 20 });
    act(room, owner.m, 2, 'k-none', 'eat', TREE);
    await waitFor(() => owner.c.of('world:refused').length === 2);

    expect(owner.c.of('world:refused')).toEqual([
      { t: 'world:refused', op: 1, reason: 'far' },
      { t: 'world:refused', op: 2, reason: 'invalid' },
    ]);
    expect(await store.withTxn((tx) => tx.ledgerOf('k-far'))).toBeNull();
  });

  it('a key that belongs to someone else is refused as key_taken, and does nothing', async () => {
    const store = await world(backend);
    const room = (await new WorldHub(store, undefined, PROBE).enter('w1'))!;
    const owner = join(room, 'owner');
    const guest = join(room, 'guest');
    await waitFor(() => owner.c.of('world:inv').length > 0 && guest.c.of('world:inv').length > 0);
    act(room, owner.m, 1, 'k-shared');
    await waitFor(() => replies(owner.c) > 0);
    act(room, guest.m, 1, 'k-shared');
    await waitFor(() => replies(guest.c) > 0);

    expect(guest.c.of('world:refused')).toEqual([{ t: 'world:refused', op: 1, reason: 'key_taken' }]);
    expect((await account(store, GUEST)).inventory.items.stone).toBeUndefined();
  });

  it('the starter kit is granted once per account, however often they join', async () => {
    const store = await world(backend);
    const hub = new WorldHub(store, undefined, PROBE);
    const room = (await hub.enter('w1'))!;
    const first = join(room, 'owner');
    await waitFor(() => first.c.of('world:inv').length > 0);
    room.leave(first.m);
    const again = (await hub.enter('w1'))!;
    const second = join(again, 'owner');
    await waitFor(() => second.c.of('world:inv').length > 0);

    expect(second.c.of('world:inv').at(-1)).toMatchObject({ items: KIT_ITEMS(), money: KIT.money });
    expect(await store.withTxn((tx) => tx.ledgerOf(starterKey(OWNER)))).toMatchObject({ kind: 'starter' });
  });

  it('the room stays open until its last action has finished', async () => {
    const store = await world(backend);
    const hub = new WorldHub(store, undefined, PROBE);
    const room = (await hub.enter('w1'))!;
    const owner = join(room, 'owner');
    act(room, owner.m, 1, 'k-open');
    room.leave(owner.m);
    expect(room.disposed).toBe(false);
    await waitFor(() => room.disposed);
  });

  it('conserves items and money: the account reconciles with its ledger rows', async () => {
    const store = await world(backend);
    const room = (await new WorldHub(store, undefined, PROBE).enter('w1'))!;
    const owner = join(room, 'owner');
    await waitFor(() => owner.c.of('world:inv').length > 0);
    const keys = ['k-c1', 'k-c2', 'k-c3'];
    for (const [i, t] of TREES.entries()) act(room, owner.m, i + 1, keys[i] ?? 'k-c1', 'harvest', t);
    act(room, owner.m, 4, 'k-c4', 'harvest', TREE); // already cut: refused, writes nothing
    await waitFor(() => replies(owner.c) === 4);

    const acct = await account(store, OWNER);
    const rows = await store.withTxn(async (tx) => {
      const out = [await tx.ledgerOf(starterKey(OWNER))];
      for (const key of keys) out.push(await tx.ledgerOf(key));
      return out;
    });
    const sum = { items: 0, money: 0 };
    for (const row of rows) {
      if (!row) continue;
      for (const qty of Object.values(row.delta.items)) sum.items += qty;
      sum.money += row.delta.money;
    }
    const held = Object.values(acct.inventory.items).reduce((a, b) => a + b, 0);
    expect(held).toBe(sum.items);
    expect(acct.inventory.money).toBe(sum.money);
    expect(acct.inventory.items.stone).toBe(3);
    expect(owner.c.of('world:refused')).toEqual([{ t: 'world:refused', op: 4, reason: 'gone' }]);
  });
});
}

function KIT_ITEMS(): Record<string, number> {
  return { ...KIT.items };
}
