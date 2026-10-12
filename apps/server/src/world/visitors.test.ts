/**
 * The visitor matrix and the away rule in the room (P17.27, ADR-053 "Visitors"). Privacy: the matrix
 * reaches the owner alone, a visitor hears only what they may do, user ids never reach a client, and
 * nobody but the owner can change a world's matrix.
 */
import { readFileSync } from 'node:fs';
import { beforeEach, describe, expect, it } from 'vitest';
import { cellPos, parseMap, type C2SMsg, type S2CMsg, type Tmj } from '@agora/shared';
import { MemoryStore, roomStore } from '../db/store';
import { SpaceRoom, type Player } from './room';

const tmj = JSON.parse(
  readFileSync(new URL('../../../../packages/maps/hq.tmj', import.meta.url), 'utf8'),
) as Tmj;
const map = parseMap(tmj);
const silent = { info: () => {}, warn: () => {} };
const settle = async () => {
  for (let i = 0; i < 8; i++) await new Promise((r) => setTimeout(r, 0));
};

class FakeConn {
  msgs: S2CMsg[] = [];
  send(m: S2CMsg) {
    this.msgs.push(m);
  }
  close() {}
  of<T extends S2CMsg['t']>(t: T) {
    return this.msgs.filter((m): m is Extract<S2CMsg, { t: T }> => m.t === t);
  }
}

function place(room: SpaceRoom, p: Player, pos: { x: number; y: number }, pose: 'stand' | 'sit' = 'stand') {
  p.x = pos.x;
  p.y = pos.y;
  p.zone = undefined;
  room.handle(p, { t: 'move', x: pos.x, y: pos.y, dir: 'down', moving: false, pose, seq: 0 });
}

const spot = map.desks.find((d) => d.id === 'jungle-1')!;
const OWNER = 'owner-7731';
const WORLD = 'world-7f3k';

describe('the visitor matrix (P17.27)', () => {
  let store: MemoryStore;
  let room: SpaceRoom;
  let co: FakeConn, cc: FakeConn, cb: FakeConn;
  let owner: Player, c: Player, b: Player;

  const enter = async (p: Player) => {
    room.handle(p, { t: 'portal:enter', id: 'desk:jungle-1' });
    await settle();
  };
  const set = async (p: Player, edit: Extract<C2SMsg, { t: 'world:visitors:set' }>['edit']) => {
    room.handle(p, { t: 'world:visitors:set', edit });
    await settle();
  };
  const harvest = async (p: Player, op: number) => {
    room.handle(p, { t: 'world:act', op, kind: 'harvest', at: { x: 1, y: 0 }, key: `k-harvest-${op}` });
    await settle();
    await settle();
  };
  const answer = (conn: FakeConn, op: number) =>
    conn.msgs.find((m) => (m.t === 'world:acted' || m.t === 'world:refused') && m.op === op);

  beforeEach(async () => {
    store = new MemoryStore();
    room = new SpaceRoom(
      map,
      {
        mapId: 'hq',
        capacity: 6,
        connectR: 5,
        disconnectR: 6,
        clientConfig: {
          mediaBackend: 'p2p',
          iceServers: [],
          connectR: 5,
          disconnectR: 6,
          videoCap: 9,
          flags: { worlds: true } as never,
        },
        reconnectGraceMs: 50,
      },
      roomStore(store, 'hq'),
      silent,
    );
    await room.init();
    co = new FakeConn();
    cc = new FakeConn();
    cb = new FakeConn();
    owner = (await room.join(co, { uid: OWNER, name: 'Alice' }))!;
    c = (await room.join(cc, { uid: 'uc', name: 'Chloé' }))!;
    b = (await room.join(cb, { uid: 'ub', name: 'Benoît' }))!;
    place(room, owner, cellPos(map, spot.chair), 'sit');
    room.handle(owner, { t: 'desk:claim', deskId: 'jungle-1' });
    await store.worlds.createWorld({
      id: WORLD,
      ownerId: OWNER,
      seed: 3560865791,
      genVersion: 1,
      createdAt: 0,
      lastDay: 0,
      settings: {},
    });
  });

  it('the owner reads the matrix: the defaults, and the visitors here by an opaque ref, never a user id', async () => {
    await enter(owner);
    place(room, c, cellPos(map, spot.guest));
    await enter(c);
    room.handle(owner, { t: 'world:visitors' });
    await settle();
    const view = co.of('world:visitors').at(-1)!;
    expect(view).toMatchObject({ away: 'nobody', grants: [] });
    expect(view.people).toEqual([
      { ref: expect.stringMatching(/^[a-f0-9]{16}$/), name: 'Chloé', grants: null, listed: false, here: true },
    ]);
    expect(JSON.stringify(view)).not.toContain('uc');
    expect(JSON.stringify(view)).not.toContain(OWNER);
    // the visitor and the office hear nothing of it
    expect(cc.of('world:visitors')).toEqual([]);
    expect(cb.of('world:visitors')).toEqual([]);
  });

  it('a grant for one visitor opens that kind for them at once, and for nobody else', async () => {
    await room.handle(owner, { t: 'desk:update', access: 'open' });
    place(room, c, cellPos(map, spot.guest));
    await enter(c);
    place(room, b, cellPos(map, spot.guest));
    await enter(b);
    expect(cc.of('world:perms').at(-1)?.kinds).not.toContain('harvest');
    await harvest(c, 1);
    expect(answer(cc, 1)).toMatchObject({ t: 'world:refused', reason: 'forbidden' });

    // the owner grants harvest to Chloé, from the office, by her session id
    await set(owner, { op: 'person', player: c.id, grants: ['harvest'] });
    expect(cc.of('world:perms').at(-1)?.kinds).toContain('harvest');
    expect(cb.of('world:perms').at(-1)?.kinds).not.toContain('harvest');
    await harvest(c, 2);
    expect(answer(cc, 2)).not.toMatchObject({ reason: 'forbidden' });
    await harvest(b, 3);
    expect(answer(cb, 3)).toMatchObject({ t: 'world:refused', reason: 'forbidden' });
    // each visitor hears only their own permissions, never the matrix
    expect(cb.of('world:visitors')).toEqual([]);
    expect(cc.of('world:visitors')).toEqual([]);

    // back to the default: closed again
    const ref = co.of('world:visitors').at(-1)!.people.find((q) => q.name === 'Chloé')!.ref;
    await set(owner, { op: 'person', ref, grants: null });
    await harvest(c, 4);
    expect(answer(cc, 4)).toMatchObject({ t: 'world:refused', reason: 'forbidden' });
  });

  it('a grant can never open a closed kind', async () => {
    await set(owner, { op: 'defaults', grants: ['till', 'chop', 'mine', 'harvest'] });
    const view = co.of('world:visitors').at(-1)!;
    expect(view.grants).toEqual(['harvest']);
    const stored = await store.worlds.getWorld(WORLD);
    expect(stored?.settings.grants).toEqual(['harvest']);
  });

  it('nobody but the owner changes a world: a visitor’s change goes to their own world (they have none)', async () => {
    place(room, c, cellPos(map, spot.guest));
    await enter(c);
    await set(c, { op: 'defaults', grants: ['harvest'] });
    expect(cc.of('world:visitors:refused').at(-1)?.reason).toBe('no_world');
    await set(c, { op: 'list', player: c.id, on: true });
    expect(cc.of('world:visitors:refused').at(-1)?.reason).toBe('no_world');
    expect((await store.worlds.getWorld(WORLD))?.settings).toEqual({});
  });

  it('refuses the owner naming themselves or someone unknown', async () => {
    await set(owner, { op: 'list', player: owner.id, on: true });
    expect(co.of('world:visitors:refused').at(-1)?.reason).toBe('self');
    await set(owner, { op: 'forget', ref: '0123456789abcdef' });
    expect(co.of('world:visitors:refused').at(-1)?.reason).toBe('unknown');
    await set(owner, { op: 'list', player: 'nobody-here', on: true });
    expect(co.of('world:visitors:refused').at(-1)?.reason).toBe('unknown');
  });

  it('the away rule: with the owner gone, a listed person is let in; anyone else hears away', async () => {
    room.handle(owner, { t: 'desk:update', access: 'knock' });
    await set(owner, { op: 'list', player: b.id, on: true });
    await set(owner, { op: 'away', rule: 'list' });
    expect(co.of('world:visitors').at(-1)).toMatchObject({
      away: 'list',
      people: [expect.objectContaining({ name: 'Benoît', listed: true, here: false })],
    });
    room.handle(owner, { t: 'leave' });
    await settle();
    const door = cellPos(map, spot.entrance);
    place(room, c, door);
    room.handle(c, { t: 'knock', deskId: 'jungle-1' });
    await settle();
    expect(cc.of('knock:result').at(-1)?.result).toBe('away');
    place(room, b, door);
    room.handle(b, { t: 'knock', deskId: 'jungle-1' });
    await settle();
    expect(cb.of('knock:result').at(-1)?.result).toBe('accepted');
    expect(b.admitted.has('jungle-1')).toBe(true);
    expect(c.admitted.has('jungle-1')).toBe(false);
  });

  it('the away rule `nobody` (the default) lets nobody in, even someone on the list', async () => {
    room.handle(owner, { t: 'desk:update', access: 'knock' });
    await set(owner, { op: 'list', player: b.id, on: true });
    room.handle(owner, { t: 'leave' });
    await settle();
    place(room, b, cellPos(map, spot.entrance));
    room.handle(b, { t: 'knock', deskId: 'jungle-1' });
    await settle();
    expect(cb.of('knock:result').at(-1)?.result).toBe('away');
  });

  it('an owner in their world hears a knock and answers it from there (ask to visit)', async () => {
    room.handle(owner, { t: 'desk:update', access: 'knock' });
    await enter(owner);
    place(room, b, cellPos(map, spot.entrance));
    room.handle(b, { t: 'knock', deskId: 'jungle-1' });
    await settle();
    expect(cb.of('knock:result').at(-1)?.result).toBe('pending');
    const knock = co.of('knock').at(-1)!;
    expect(knock).toMatchObject({ from: b.id, name: 'Benoît', deskId: 'jungle-1' });
    room.handle(owner, { t: 'knock:answer', visitor: b.id, accept: true });
    expect(cb.of('knock:result').at(-1)?.result).toBe('accepted');
    // the office around the visitor heard nothing of the owner's world
    expect(cc.msgs.filter((m) => m.t.startsWith('world:'))).toEqual([]);
  });

  it('forgetting a person removes them from the list and their grants', async () => {
    await set(owner, { op: 'person', player: c.id, grants: ['take'] });
    const ref = co.of('world:visitors').at(-1)!.people[0]!.ref;
    await set(owner, { op: 'forget', ref });
    expect(co.of('world:visitors').at(-1)!.people).toEqual([]);
    expect((await store.worlds.getWorld(WORLD))?.settings.visitors).toEqual({});
  });
});
