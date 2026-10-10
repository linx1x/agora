import { readFileSync } from 'node:fs';
import { beforeEach, describe, expect, it } from 'vitest';
import {
  C2S,
  TILE,
  WORLDGEN,
  cellPos,
  parseMap,
  remapTmj,
  worldGenParamsFor,
  type S2CMsg,
  type Tmj,
} from '@agora/shared';
import { MemoryStore, roomStore } from '../db/store';
import { SpaceRoom, type Player } from './room';

const tmj = JSON.parse(
  readFileSync(new URL('../../../../packages/maps/hq.tmj', import.meta.url), 'utf8'),
) as Tmj;
const map = parseMap(tmj);
const silent = { info: () => {}, warn: () => {} };
/** Global cell → feet position (inside one tile). */
const cell = (cx: number, cy: number) => ({ x: cx * TILE + 16, y: cy * TILE + 26 });

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

function makeRoom(store = new MemoryStore(), capacity = 4) {
  return new SpaceRoom(
    map,
    {
      mapId: 'hq',
      capacity,
      connectR: 5,
      disconnectR: 6,
      clientConfig: {
        mediaBackend: 'p2p',
        iceServers: [],
        connectR: 5,
        disconnectR: 6,
        videoCap: 9,
        flags: {} as never,
      },
      reconnectGraceMs: 50,
    },
    roomStore(store, 'hq'),
    silent,
  );
}

/** Test helper: teleport a player (bypasses movement validation, keeps zone rules). */
function place(
  room: SpaceRoom,
  p: Player,
  pos: { x: number; y: number },
  pose: 'stand' | 'sit' = 'stand',
) {
  p.x = pos.x;
  p.y = pos.y;
  p.zone = undefined;
  room.handle(p, { t: 'move', x: pos.x, y: pos.y, dir: 'down', moving: false, pose, seq: 0 });
}
/** Walk in small valid steps (each validated by the server). */
function walk(room: SpaceRoom, p: Player, to: { x: number; y: number }) {
  for (let i = 0; i < 200; i++) {
    const dx = to.x - p.x;
    const dy = to.y - p.y;
    const d = Math.hypot(dx, dy);
    if (d < 1) return true;
    const step = Math.min(d, 8);
    p.lastMoveAt = Date.now() - 100;
    const before = { x: p.x, y: p.y };
    room.handle(p, {
      t: 'move',
      x: p.x + (dx / d) * step,
      y: p.y + (dy / d) * step,
      dir: 'up',
      moving: true,
      pose: 'stand',
      seq: i,
    });
    if (p.x === before.x && p.y === before.y) return false;
  }
  return false;
}

describe('SpaceRoom: rooms, chat, media', () => {
  let room: SpaceRoom;
  let ca: FakeConn, cb: FakeConn, cc: FakeConn;
  let a: Player, b: Player, c: Player;
  beforeEach(async () => {
    room = makeRoom(new MemoryStore(), 3);
    await room.init();
    ca = new FakeConn();
    cb = new FakeConn();
    cc = new FakeConn();
    a = (await room.join(ca, { uid: 'ua', name: 'A' }))!;
    b = (await room.join(cb, { uid: 'ub', name: 'B' }))!;
    c = (await room.join(cc, { uid: 'uc', name: 'C' }))!;
    // A and B inside hub meeting room "salle-a" (global x 40..45, y 10..18); C in the lane right outside its wall.
    place(room, a, cell(41, 16));
    place(room, b, cell(44, 12));
    place(room, c, cell(38, 14));
    room.tick();
  });

  it('welcomes with config, desks and history', () => {
    const w = ca.of('welcome')[0]!;
    expect(w.you).toBe(a.id);
    expect(w.desks).toHaveLength(32);
    expect(w.myDesk).toBeNull();
  });

  it('enforces capacity', async () => {
    expect(await room.join(new FakeConn(), { uid: 'ud', name: 'D' })).toBeNull();
  });

  it('computes zones server-side', () => {
    expect(a.zone?.id).toBe('salle-a');
    expect(b.zone?.id).toBe('salle-a');
    expect(c.zone?.kind).not.toBe('private');
  });

  it('isolation: C next to the wall is not linked to A/B; A and B are linked', () => {
    expect(ca.of('peers').at(-1)?.peers).toEqual([b.id]);
    expect(cc.of('peers').at(-1)?.peers ?? []).toEqual([]);
  });

  it('isolation: C cannot signal A (forged rtc refused)', () => {
    room.handle(c, { t: 'rtc', to: a.id, data: { kind: 'offer', sdp: 'v=0' } });
    expect(ca.of('rtc')).toHaveLength(0);
    expect(cc.of('error').at(-1)?.code).toBe('rtc_not_linked');
    room.handle(a, { t: 'rtc', to: b.id, data: { kind: 'offer', sdp: 'v=0' } });
    expect(cb.of('rtc')).toHaveLength(1);
  });

  it('isolation: nearby chat inside a private room never reaches C, and vice versa', () => {
    room.handle(a, { t: 'chat', scope: 'nearby', body: 'confidential' });
    expect(cb.of('chat').map((m) => m.msg.body)).toContain('confidential');
    expect(cc.of('chat')).toHaveLength(0);
    room.handle(c, { t: 'chat', scope: 'nearby', body: 'hello?' });
    expect(ca.of('chat').map((m) => m.msg.body)).not.toContain('hello?');
  });

  it('everyone chat reaches everybody and is kept in history', async () => {
    room.handle(c, { t: 'chat', scope: 'everyone', body: 'bonjour' });
    expect(ca.of('chat')).toHaveLength(1);
    room.players.delete(c.id);
    const late = new FakeConn();
    await room.join(late, { uid: 'ue', name: 'E' });
    expect(late.of('welcome')[0]?.history.map((m) => m.body)).toEqual(['bonjour']);
  });

  it('leaving the room removes media access on the next tick', () => {
    place(room, a, cell(42, 20));
    place(room, c, cell(41, 20));
    room.tick();
    expect(cb.of('peers').at(-1)?.peers).toEqual([]);
    expect(ca.of('peers').at(-1)?.peers).toEqual([c.id]);
  });

  it('corrects a forged move through a wall', () => {
    const before = { x: c.x, y: c.y };
    room.handle(c, {
      t: 'move',
      ...cell(40, 14),
      dir: 'right',
      moving: true,
      pose: 'stand',
      seq: 7,
    });
    expect(cc.of('correction').at(-1)).toMatchObject({ x: before.x, y: before.y, seq: 7 });
    expect(c.zone?.kind).not.toBe('private');
  });

  it('rejects malformed messages', () => {
    room.handle(a, { t: 'chat', scope: 'nearby', body: '' });
    room.handle(a, { t: 'nope' });
    expect(ca.of('error').length).toBeGreaterThanOrEqual(2);
  });

  it('keeps the seat during the grace window, then removes', async () => {
    room.disconnect(c);
    const resumed = await room.join(new FakeConn(), { uid: 'uc', name: 'C' }, c.id);
    expect(resumed?.id).toBe(c.id);
    room.disconnect(c);
    await new Promise((r) => setTimeout(r, 80));
    room.tick();
    expect(room.players.has(c.id)).toBe(false);
    expect(ca.of('leave').at(-1)?.id).toBe(c.id);
  });

  it('broadcasts mic, camera, push-to-talk and low-bandwidth state; drops them on disconnect', () => {
    room.handle(a, { t: 'media', mic: true, cam: true, ptt: true, lowBw: true });
    expect(cb.of('profile').at(-1)?.profile).toMatchObject({
      id: a.id,
      mic: true,
      cam: true,
      ptt: true,
      lowBw: true,
    });
    room.handle(a, { t: 'media', mic: true, cam: false });
    expect(cb.of('profile').at(-1)?.profile).toMatchObject({ ptt: false, lowBw: false });
    room.handle(a, { t: 'media', mic: true, cam: true, ptt: true });
    room.disconnect(a);
    expect(cb.of('profile').at(-1)?.profile).toMatchObject({ mic: false, cam: false, ptt: false });
  });

  it('a deliberate leave frees the seat at once and drops media links', () => {
    expect(room.links.size).toBeGreaterThan(0);
    room.handle(a, { t: 'leave' });
    expect(room.players.has(a.id)).toBe(false);
    expect(cb.of('leave').at(-1)?.id).toBe(a.id);
    expect([...room.links].some((k) => k.includes(a.id))).toBe(false);
    room.disconnect(a); // the socket closing afterwards is harmless
    expect(room.players.has(a.id)).toBe(false);
  });
});

describe('SpaceRoom: sitting, desks, knock, teleport, call over', () => {
  const spot = map.desks.find((d) => d.id === 'jungle-1')!;
  let store: MemoryStore;
  let room: SpaceRoom;
  let ca: FakeConn, cc: FakeConn, cb: FakeConn;
  let a: Player, c: Player, b: Player;

  beforeEach(async () => {
    store = new MemoryStore();
    room = makeRoom(store);
    await room.init();
    ca = new FakeConn();
    cc = new FakeConn();
    cb = new FakeConn();
    a = (await room.join(ca, { uid: 'ua', name: 'Alice' }))!;
    c = (await room.join(cc, { uid: 'uc', name: 'Chloé' }))!;
    b = (await room.join(cb, { uid: 'ub', name: 'Benoît' }))!;
    // Alice sits at jungle-1's chair and claims it.
    place(room, a, cellPos(map, spot.chair), 'sit');
    room.handle(a, { t: 'desk:claim', deskId: 'jungle-1' });
  });

  it('sitting is only accepted on a chair and faces the chair direction', () => {
    expect(a.pose).toBe('sit');
    expect(a.dir).toBe(spot.chair.face);
    place(room, b, cellPos(map, spot.entrance), 'sit');
    expect(b.pose).toBe('stand');
  });

  it('claim requires sitting in that pod, persists, and is broadcast', async () => {
    expect(ca.of('myDesk').at(-1)?.deskId).toBe('jungle-1');
    expect(
      cc
        .of('desks')
        .at(-1)
        ?.desks.find((d) => d.id === 'jungle-1')?.ownerName,
    ).toBe('Alice');
    expect((await store.loadDesks('hq')).map((d) => d.deskId)).toEqual(['jungle-1']);
    // Chloé standing in another pod cannot claim it
    place(room, c, cellPos(map, map.desks.find((d) => d.id === 'jungle-2')!.guest));
    room.handle(c, { t: 'desk:claim', deskId: 'jungle-2' });
    expect(cc.of('error').at(-1)?.code).toBe('desk_sit_first');
    // and cannot take Alice's
    room.handle(c, { t: 'desk:claim', deskId: 'jungle-1' });
    expect(cc.of('error').at(-1)?.code).toBe('desk_taken');
  });

  it('owner spawns at their desk next time (persisted)', async () => {
    const room2 = makeRoom(store);
    await room2.init();
    const again = (await room2.join(new FakeConn(), { uid: 'ua', name: 'Alice' }))!;
    expect(again.zone?.id).toBe('jungle-1');
  });

  it('pod voice: people inside the pod are linked; someone right outside is not', () => {
    place(room, c, cellPos(map, spot.guest));
    place(room, b, cellPos(map, spot.entrance));
    room.tick();
    expect(ca.of('peers').at(-1)?.peers).toEqual([c.id]);
    expect(cb.of('peers').at(-1)?.peers ?? []).toEqual([]);
    room.handle(a, { t: 'chat', scope: 'nearby', body: 'pod only' });
    expect(cc.of('chat').map((m) => m.msg.body)).toContain('pod only');
    expect(cb.of('chat')).toHaveLength(0);
  });

  it.each(['jungle', 'oasis', 'boreal', 'zen'])(
    'neighbouring pods (one tile apart) stay isolated from each other in the %s',
    (region) => {
      const pairs = map.desks
        .filter((p) => p.region === region)
        .flatMap((p) =>
          map.desks
            .filter((q) => q.region === p.region && q.id !== p.id)
            .map((q) => [p, q] as const),
        );
      const free = (cx: number, cy: number) => !map.solid[cy * map.width + cx];
      /** First (pod, pod, row) where two zones face each other across a lane of at most one tile. */
      const find = () => {
        for (const [p, q] of pairs) {
          const gap = q.zone.x - (p.zone.x + p.zone.w);
          if (gap < 0 || gap > TILE) continue;
          const ex = (p.zone.x + p.zone.w) / TILE - 1;
          const qx = q.zone.x / TILE;
          const lo = Math.max(p.zone.y, q.zone.y) / TILE;
          const hi = Math.min(p.zone.y + p.zone.h, q.zone.y + q.zone.h) / TILE - 1;
          for (let y = lo; y <= hi; y++)
            if (free(ex, y) && free(qx, y) && free(ex + 1, y) && free(ex + 1, y + 1))
              return { p, q, row: y, edgeP: ex, edgeQ: qx };
        }
        return undefined;
      };
      const found = find();
      expect(found, `the ${region} layout has pods one tile apart`).toBeDefined();
      const { p, q, row, edgeP, edgeQ } = found!;
      // two people on either side of the one-tile lane, 2 tiles apart: closer than the link radius
      place(room, b, cell(edgeP, row));
      place(room, c, cell(edgeQ, row));
      room.tick();
      expect(b.zone?.id).toBe(p.id);
      expect(c.zone?.id).toBe(q.id);
      expect(cb.of('peers').at(-1)?.peers ?? []).toEqual([]);
      expect(cc.of('peers').at(-1)?.peers ?? []).toEqual([]);
      room.handle(b, { t: 'chat', scope: 'nearby', body: 'next door' });
      expect(cc.of('chat')).toHaveLength(0);
      // control: the same two people in the open lane do link, so the test is not vacuous
      place(room, b, cell(edgeP + 1, row));
      place(room, c, cell(edgeP + 1, row + 1));
      room.tick();
      expect(cb.of('peers').at(-1)?.peers).toEqual([c.id]);
    },
  );

  it('knock access: visitor is blocked, knocks, owner accepts, visitor walks in; admission ends when they leave', () => {
    room.handle(a, { t: 'desk:update', access: 'knock' });
    place(room, c, cellPos(map, spot.entrance));
    const inside = cellPos(map, spot.guest);
    expect(walk(room, c, inside)).toBe(false);
    expect(cc.of('correction').at(-1)?.reason).toBe('blocked');
    expect(c.zone?.kind).not.toBe('desk');

    room.handle(c, { t: 'knock', deskId: 'jungle-1' });
    expect(cc.of('knock:result').at(-1)?.result).toBe('pending');
    expect(ca.of('knock').at(-1)).toMatchObject({ from: c.id, deskId: 'jungle-1' });
    room.handle(a, { t: 'knock:answer', visitor: c.id, accept: true });
    expect(cc.of('knock:result').at(-1)?.result).toBe('accepted');
    expect(walk(room, c, inside)).toBe(true);
    expect(c.zone?.id).toBe('jungle-1');
    expect(ca.of('visitor').at(-1)?.id).toBe(c.id);

    expect(walk(room, c, cellPos(map, spot.entrance))).toBe(true);
    expect(c.admitted.has('jungle-1')).toBe(false);
    expect(walk(room, c, inside)).toBe(false);
  });

  it('closed access refuses knocks; open access needs no knock', () => {
    room.handle(a, { t: 'desk:update', access: 'closed' });
    place(room, c, cellPos(map, spot.entrance));
    room.handle(c, { t: 'knock', deskId: 'jungle-1' });
    expect(cc.of('knock:result').at(-1)?.result).toBe('busy');
    room.handle(a, { t: 'desk:update', access: 'open' });
    expect(walk(room, c, cellPos(map, spot.guest))).toBe(true);
  });

  it('only the owner can change a desk; decor is validated and broadcast', () => {
    room.handle(c, { t: 'desk:update', access: 'closed' });
    expect(cc.of('error').at(-1)?.code).toBe('no_desk');
    room.handle(a, {
      t: 'desk:update',
      decor: { plant: 2, lamp: 3, poster: 1, message: 'Café ☕' },
    });
    expect(
      cb
        .of('desks')
        .at(-1)
        ?.desks.find((d) => d.id === 'jungle-1')?.decor,
    ).toMatchObject({ lamp: 3, message: 'Café ☕' });
    room.handle(a, { t: 'desk:update', decor: { plant: 99, lamp: 0, poster: 0, message: '' } });
    expect(ca.of('error').at(-1)?.code).toBe('bad_message');
  });

  it('teleport only works from a portal pad and lands in the destination region', () => {
    place(room, c, cell(50, 50));
    room.handle(c, { t: 'teleport', to: 'jungle' });
    expect(cc.of('error').at(-1)?.code).toBe('teleport_refused');
    const pad = map.zones.find((z) => z.id === 'portal-hub-jungle')!;
    place(room, c, { x: pad.x + 16, y: pad.y + 26 });
    room.handle(c, { t: 'teleport', to: 'jungle' });
    const corr = cc.of('correction').at(-1)!;
    expect(corr.reason).toBe('teleport');
    expect(map.regions.find((r) => r.id === 'jungle')).toMatchObject({});
    expect(c.x).toBeLessThan(36 * TILE);
  });

  it('call over reaches the target, respects DND and a cooldown', () => {
    room.handle(c, { t: 'callover', to: a.id });
    expect(ca.of('callover').at(-1)).toMatchObject({ from: c.id, name: 'Chloé' });
    room.handle(c, { t: 'callover', to: a.id });
    expect(cc.of('error').at(-1)?.code).toBe('rate_limited');
    room.handle(b, { t: 'status', status: 'dnd', msg: '' });
    room.handle(c, { t: 'callover', to: b.id });
    expect(cc.of('error').at(-1)?.code).toBe('callover_dnd');
    expect(cb.of('callover')).toHaveLength(0);
  });
});

describe('SpaceRoom: owner with two tabs', () => {
  it('knocks reach every session of the owner', async () => {
    const room = makeRoom(new MemoryStore(), 5);
    await room.init();
    const spot = map.desks.find((d) => d.id === 'boreal-2')!;
    const t1 = new FakeConn();
    const t2 = new FakeConn();
    const cv = new FakeConn();
    const o1 = (await room.join(t1, { uid: 'uo', name: 'Owner' }))!;
    await room.join(t2, { uid: 'uo', name: 'Owner' });
    const v = (await room.join(cv, { uid: 'uv', name: 'Visitor' }))!;
    place(room, o1, cellPos(map, spot.chair), 'sit');
    room.handle(o1, { t: 'desk:claim', deskId: 'boreal-2' });
    room.handle(o1, { t: 'desk:update', access: 'knock' });
    place(room, v, cellPos(map, spot.entrance));
    room.handle(v, { t: 'knock', deskId: 'boreal-2' });
    expect(t1.of('knock')).toHaveLength(1);
    expect(t2.of('knock')).toHaveLength(1);
  });
});

describe('SpaceRoom: build mode', () => {
  const fresh = () => JSON.parse(JSON.stringify(tmj)) as Tmj;
  function buildRoom(store = new MemoryStore()) {
    const t = fresh();
    return new SpaceRoom(
      parseMap(t),
      {
        mapId: 'hq',
        capacity: 5,
        connectR: 5,
        disconnectR: 6,
        clientConfig: {
          mediaBackend: 'p2p',
          iceServers: [],
          connectR: 5,
          disconnectR: 6,
          videoCap: 9,
          flags: { builder: true } as never,
        },
        tmj: t,
        baseTmj: fresh,
        mapSaveMs: 0,
      },
      roomStore(store, 'hq'),
      silent,
    );
  }

  it('lets builders edit, broadcasts the change and persists the map', async () => {
    const store = new MemoryStore();
    const room = buildRoom(store);
    await room.init();
    const cb = new FakeConn();
    const cv = new FakeConn();
    const builder = (await room.join(cb, { uid: 'ub', name: 'B', builder: true }))!;
    await room.join(cv, { uid: 'uv', name: 'V' });
    expect(cb.of('welcome')[0]!.builder).toBe(true);
    expect(cv.of('welcome')[0]!.builder).toBe(false);
    room.handle(builder, {
      t: 'map:edit',
      op: 1,
      cells: [{ l: 'furniture', x: 5, y: 9, t: 'jungle.plantA' }],
    });
    expect(room.mapRev).toBe(1);
    expect(cv.of('map:edit').at(-1)).toMatchObject({ rev: 1, op: 1, by: builder.id });
    expect(room.map.solid[9 * room.map.width + 5]).toBe(1);
    expect(JSON.parse(room.tmjJson()).layers[2].data[9 * room.map.width + 5]).toBeGreaterThan(0);
    await room.flushMap();
    expect((await store.loadMap('hq'))?.rev).toBe(1);
  });

  it('places several props on one desk cell, sends them to everyone and saves them (P9.16)', async () => {
    const store = new MemoryStore();
    const room = buildRoom(store);
    await room.init();
    const cb = new FakeConn();
    const cv = new FakeConn();
    const builder = (await room.join(cb, { uid: 'ub', name: 'B', builder: true }))!;
    await room.join(cv, { uid: 'uv', name: 'V' });
    const msg = C2S.parse({
      t: 'map:edit',
      op: 1,
      cells: [
        { l: 'furniture', x: 5, y: 9, t: 'jungle.deskH' },
        { l: 'prop', id: 'lamp01', p: { t: 'prop.lampOn', x: 5 * TILE + 7, y: 9 * TILE + 14 } },
        {
          l: 'prop',
          id: 'mug001',
          p: { t: 'prop.coffee', x: 5 * TILE + 24, y: 9 * TILE + 18, f: true },
        },
      ],
    });
    room.handle(builder, msg);
    expect(cb.of('map:refused')).toHaveLength(0);
    expect(room.map.props.map((p) => p.id)).toEqual(['lamp01', 'mug001']);
    expect(cv.of('map:edit').at(-1)!.changes).toHaveLength(3);
    const layer = JSON.parse(room.tmjJson()).layers.find(
      (l: { name: string }) => l.name === 'props',
    );
    expect(layer.type).toBe('objectgroup');
    expect(layer.objects).toHaveLength(2);
    await room.flushMap();
    const saved = (await store.loadMap('hq'))!.tmj as Tmj;
    expect(parseMap(remapTmj(saved, saved.tilesets[0]!)).props).toEqual(room.map.props);
    // a prop in the air is refused, and nothing changes
    room.handle(builder, {
      t: 'map:edit',
      op: 2,
      cells: [
        {
          l: 'prop',
          id: 'mug002',
          p: { t: 'prop.coffee', x: 5 * TILE + 16, y: 11 * TILE + 16, z: 0, f: false },
        },
      ],
    });
    expect(cb.of('map:refused').at(-1)).toMatchObject({ op: 2, reason: 'no_surface' });
    expect(room.map.props).toHaveLength(2);
  });

  it('refuses edits from non-builders and edits that block a desk', async () => {
    const room = buildRoom();
    await room.init();
    const cv = new FakeConn();
    const cb = new FakeConn();
    const v = (await room.join(cv, { uid: 'uv', name: 'V' }))!;
    const b = (await room.join(cb, { uid: 'ub', name: 'B', builder: true }))!;
    room.handle(v, {
      t: 'map:edit',
      op: 1,
      cells: [{ l: 'furniture', x: 5, y: 9, t: 'jungle.plantA' }],
    });
    expect(cv.of('error').at(-1)?.code).toBe('not_builder');
    const d = room.map.desks[0]!;
    room.handle(b, {
      t: 'map:edit',
      op: 2,
      cells: [{ l: 'walls', x: d.entrance.cx, y: d.entrance.cy, t: 'jungle.wallTop' }],
    });
    expect(cb.of('map:refused').at(-1)).toMatchObject({ op: 2, reason: 'blocks_access' });
    expect(room.mapRev).toBe(0);
  });

  it('moves people out of a cell that just became solid', async () => {
    const room = buildRoom();
    await room.init();
    const cb = new FakeConn();
    const cw = new FakeConn();
    const b = (await room.join(cb, { uid: 'ub', name: 'B', builder: true }))!;
    const w = (await room.join(cw, { uid: 'uw', name: 'W' }))!;
    place(room, w, cell(5, 9));
    room.handle(b, {
      t: 'map:edit',
      op: 1,
      cells: [{ l: 'furniture', x: 5, y: 9, t: 'jungle.plantA' }],
    });
    expect(cw.of('correction').at(-1)?.reason).toBe('spawn');
    expect(Math.floor(w.x / TILE) !== 5 || Math.floor((w.y - 1) / TILE) !== 9).toBe(true);
  });

  it('resets to the generated map', async () => {
    const store = new MemoryStore();
    const room = buildRoom(store);
    await room.init();
    const cb = new FakeConn();
    const b = (await room.join(cb, { uid: 'ub', name: 'B', builder: true }))!;
    room.handle(b, {
      t: 'map:edit',
      op: 1,
      cells: [{ l: 'furniture', x: 5, y: 9, t: 'jungle.plantA' }],
    });
    await room.flushMap();
    room.handle(b, { t: 'map:reset' });
    expect(cb.of('map:reload').at(-1)?.rev).toBe(2);
    expect(room.map.solid[9 * room.map.width + 5]).toBe(0);
    await new Promise((r) => setTimeout(r, 5));
    expect(await store.loadMap('hq')).toBeNull();
  });
});

describe('SpaceRoom: portals into worlds (P17.8, ADR-053)', () => {
  const spot = map.desks.find((d) => d.id === 'jungle-1')!;
  const OWNER = 'owner-7731';
  const WORLD = 'world-7f3k';
  /** the portal handler awaits a world lookup: let it finish */
  const settle = () => new Promise((r) => setTimeout(r, 0));
  let store: MemoryStore;
  let room: SpaceRoom;
  let co: FakeConn, cc: FakeConn, cb: FakeConn;
  let owner: Player, c: Player;

  const enter = async (p: Player, id = 'desk:jungle-1') => {
    room.handle(p, { t: 'portal:enter', id });
    await settle();
  };
  const reasonOf = (conn: FakeConn) => conn.of('portal:refused').at(-1)?.reason;

  beforeEach(async () => {
    store = new MemoryStore();
    room = makeRoom(store);
    await room.init();
    co = new FakeConn();
    cc = new FakeConn();
    cb = new FakeConn();
    owner = (await room.join(co, { uid: OWNER, name: 'Alice' }))!;
    c = (await room.join(cc, { uid: 'uc', name: 'Chloé' }))!;
    await room.join(cb, { uid: 'ub', name: 'Benoît' });
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

  it('refused outside the trigger, even for the owner, and answered only to the person who asked', async () => {
    place(room, owner, cellPos(map, spot.entrance));
    const seen = [cc.msgs.length, cb.msgs.length];
    await enter(owner);
    expect(reasonOf(co)).toBe('outside');
    expect(co.of('portal:go')).toHaveLength(0);
    expect([cc.msgs.length, cb.msgs.length]).toEqual(seen);
  });

  it('the owner steps through to their own world; the office sees them leave and no office link stays', async () => {
    await enter(owner);
    expect(co.of('portal:go')).toMatchObject([
      { t: 'portal:go', id: 'desk:jungle-1', worldId: WORLD },
    ]);
    expect(co.of('world:welcome')).toHaveLength(1);
    expect(co.of('peers').at(-1)?.peers).toEqual([]);
    expect(cc.of('leave').at(-1)?.id).toBe(owner.id);
    expect(cb.of('leave').at(-1)?.id).toBe(owner.id);
    expect(room.players.has(owner.id)).toBe(false);
    expect([...room.links].filter((key) => key.includes(owner.id))).toEqual([]);
    // the owner's user id never leaves the server
    expect(JSON.stringify([co.of('portal:go'), co.of('world:welcome')])).not.toContain(OWNER);
  });

  it('refused with no_world when the owner has no world (none made, or removed)', async () => {
    await store.worlds.deleteWorldOf(OWNER);
    await enter(owner);
    expect(reasonOf(co)).toBe('no_world');
    expect(co.of('portal:go')).toHaveLength(0);
  });

  it('an unclaimed pod has no world, and ids that name no desk are unknown', async () => {
    const free = map.desks.find((d) => d.id === 'jungle-2')!;
    place(room, c, cellPos(map, free.guest));
    await enter(c, 'desk:jungle-2');
    expect(reasonOf(cc)).toBe('no_world');
    await enter(c, 'desk:nope');
    expect(reasonOf(cc)).toBe('unknown');
    await enter(c, 'portal-hub-jungle');
    expect(reasonOf(cc)).toBe('unknown');
  });

  it('knock: a visitor at the door is refused, then goes through to the world once admitted', async () => {
    room.handle(owner, { t: 'desk:update', access: 'knock' });
    place(room, c, cellPos(map, spot.entrance));
    await enter(c);
    expect(reasonOf(cc)).toBe('outside');
    room.handle(c, { t: 'knock', deskId: 'jungle-1' });
    room.handle(owner, { t: 'knock:answer', visitor: c.id, accept: true });
    expect(walk(room, c, cellPos(map, spot.guest))).toBe(true);
    await enter(c);
    expect(cc.of('portal:go')).toHaveLength(1);
    expect(room.players.has(c.id)).toBe(false);
  });

  it('refused without permission inside a knock-only pod for someone not admitted; the refusal carries no world', async () => {
    place(room, c, cellPos(map, spot.guest)); // standing inside while the pod was open
    room.handle(owner, { t: 'desk:update', access: 'knock' });
    await enter(c);
    expect(reasonOf(cc)).toBe('no_permission');
    expect(cc.msgs.some((m) => 'worldId' in m)).toBe(false);
  });

  it('a closed pod takes the owner only: a visitor inside is refused, the owner goes through', async () => {
    place(room, c, cellPos(map, spot.guest));
    room.handle(owner, { t: 'desk:update', access: 'closed' });
    await enter(c);
    expect(reasonOf(cc)).toBe('no_permission');
    await enter(owner);
    expect(co.of('portal:go')).toHaveLength(1);
    expect(cb.of('portal:go')).toHaveLength(0);
  });
});

describe('SpaceRoom: personal worlds (P17.9, ADR-053)', () => {
  const spot = map.desks.find((d) => d.id === 'jungle-1')!;
  const OWNER = 'owner-7731';
  const WORLD = 'world-7f3k';
  const SEED = 3560865791;
  const settle = () => new Promise((r) => setTimeout(r, 0));
  let store: MemoryStore;
  let room: SpaceRoom;
  let co: FakeConn, cc: FakeConn, cb: FakeConn;
  let owner: Player, c: Player;

  const enter = async (p: Player, id = 'desk:jungle-1') => {
    room.handle(p, { t: 'portal:enter', id });
    await settle();
  };

  beforeEach(async () => {
    store = new MemoryStore();
    room = makeRoom(store);
    await room.init();
    co = new FakeConn();
    cc = new FakeConn();
    cb = new FakeConn();
    owner = (await room.join(co, { uid: OWNER, name: 'Alice' }))!;
    c = (await room.join(cc, { uid: 'uc', name: 'Chloé' }))!;
    await room.join(cb, { uid: 'ub', name: 'Benoît' });
    place(room, owner, cellPos(map, spot.chair), 'sit');
    room.handle(owner, { t: 'desk:claim', deskId: 'jungle-1' });
    await store.worlds.createWorld({
      id: WORLD,
      ownerId: OWNER,
      seed: SEED,
      genVersion: 1,
      createdAt: 0,
      lastDay: 0,
      settings: {},
    });
  });

  it('the welcome names the seed and the generator, and lists people without their user ids', async () => {
    await enter(owner);
    const welcome = co.of('world:welcome').at(-1)!;
    expect(welcome).toMatchObject({ worldId: WORLD, you: owner.id, seed: SEED, genVersion: 1 });
    expect(welcome.params).toEqual(worldGenParamsFor(WORLDGEN, 1));
    expect(welcome.people).toEqual([expect.objectContaining({ id: owner.id, name: 'Alice' })]);
    expect(welcome.people[0]).not.toHaveProperty('uid');
    // the chunks around the person come with the welcome
    expect(co.of('world:chunks').at(-1)?.add.length).toBe(25);
  });

  it('people in the same world see each other; office people and other worlds see nothing of it', async () => {
    await enter(owner);
    place(room, c, cellPos(map, spot.guest)); // an open pod: the visitor steps in too
    await enter(c);
    expect(co.of('world:join').at(-1)?.person.id).toBe(c.id);
    expect(cc.of('world:welcome')).toHaveLength(1);
    const before = cb.msgs.length;
    // the world knows the person at its arrival point (the office position stays the office's)
    const me = co.of('world:welcome').at(-1)!.people.find((q) => q.id === owner.id)!;
    room.handle(owner, { t: 'move', x: me.x, y: me.y, dir: 'down', moving: false, pose: 'stand', seq: 1 });
    expect(cc.of('world:pos').at(-1)).toMatchObject({ id: owner.id });
    expect(co.of('world:pos').at(-1)).toMatchObject({ id: owner.id });
    expect(cb.msgs.slice(before).filter((m) => m.t.startsWith('world:'))).toEqual([]);
  });

  it('a person in a world hears no office chat, and office people hear nothing said in the world', async () => {
    await enter(owner);
    room.handle(c, { t: 'chat', scope: 'everyone', body: 'office only' });
    expect(co.of('chat').map((m) => m.msg.body)).not.toContain('office only');
    room.handle(owner, { t: 'chat', scope: 'everyone', body: 'from the world' });
    expect(cc.of('chat').map((m) => m.msg.body)).not.toContain('from the world');
    expect(cb.of('chat').map((m) => m.msg.body)).not.toContain('from the world');
  });

  it('office-only messages do nothing inside a world', async () => {
    await enter(owner);
    const seen = cc.msgs.length;
    room.handle(owner, { t: 'status', status: 'dnd', msg: '' });
    expect(owner.profile.status).toBe('available');
    expect(cc.msgs.length).toBe(seen); // nothing is broadcast from inside the world
  });

  it('world:leave brings the person back to their desk, where the office sees them again', async () => {
    await enter(owner);
    room.handle(owner, { t: 'world:leave' });
    expect(co.of('world:exit')).toHaveLength(1);
    expect(room.players.has(owner.id)).toBe(true);
    expect(owner.zone?.id).toBe('jungle-1');
    expect(cc.of('profile').at(-1)?.profile.id).toBe(owner.id);
  });

  it('a socket that closes inside a world returns the person to the office seat until the grace ends', async () => {
    await enter(owner);
    room.disconnect(owner);
    expect(room.players.has(owner.id)).toBe(true);
    expect(owner.conn).toBeNull();
    expect(owner.world).toBeUndefined();
  });

  it('leaving the space from inside a world takes the person out of the office as well', async () => {
    await enter(owner);
    room.remove(owner);
    expect(room.players.has(owner.id)).toBe(false);
    expect(cc.of('leave').at(-1)?.id).toBe(owner.id);
    expect(owner.world).toBeUndefined();
  });
});
