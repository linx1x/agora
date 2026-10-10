import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  DEFAULT_FLAGS,
  TICK_HZ,
  TILE,
  cellPos,
  collides,
  parseMap,
  zoneAt,
  type S2CMsg,
  type Tmj,
} from '@agora/shared';
import { MemoryStore, roomStore } from '../db/store';
import type { OfficeCat } from './pets';
import { SpaceRoom, type Player } from './room';

const tmj = JSON.parse(
  readFileSync(new URL('../../../../packages/maps/hq.tmj', import.meta.url), 'utf8'),
) as Tmj;
const map = parseMap(tmj);
const silent = { info: () => {}, warn: () => {} };
const cell = (cx: number, cy: number) => ({ x: cx * TILE + 16, y: cy * TILE + 26 });
const STEP = 1000 / TICK_HZ;

/** Small deterministic generator so a failure can be replayed. */
function seeded(seed: number) {
  let s = seed >>> 0 || 1;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 2 ** 32;
  };
}

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

function makeRoom(opts: { pets?: boolean; seed?: number } = {}) {
  const room = new SpaceRoom(
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
        flags: { ...DEFAULT_FLAGS, pets: opts.pets ?? true },
      },
      petRng: seeded(opts.seed ?? 1),
    },
    roomStore(new MemoryStore(), 'hq'),
    silent,
  );
  return room;
}

const catOf = (room: SpaceRoom) => (room as unknown as { officeCat: OfficeCat }).officeCat;

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

/** Run the room for `seconds`, calling `each` after every tick. */
function run(room: SpaceRoom, from: number, seconds: number, each: (now: number) => void) {
  let now = from;
  for (let i = 0; i < seconds * TICK_HZ; i++) {
    now += STEP;
    room.tick(now);
    each(now);
  }
  return now;
}

describe('office cat (ADR-040)', () => {
  it('is off unless the flag is on', async () => {
    const room = makeRoom({ pets: false });
    const conn = new FakeConn();
    await room.join(conn, { uid: 'ua', name: 'A' });
    run(room, 1000, 5, () => {});
    expect(conn.of('pet:state')).toHaveLength(0);
  });

  it('is sent on join and then only when it changed', async () => {
    const room = makeRoom();
    const conn = new FakeConn();
    await room.join(conn, { uid: 'ua', name: 'A' });
    expect(conn.of('pet:state')).toHaveLength(1);
    expect(conn.of('pet:state')[0]!.pets[0]).toMatchObject({ id: 'cat:office', kind: 'office' });
    // Sitting still between walks sends nothing new.
    const cat = catOf(room);
    cat.state.a = 'sit';
    (cat as unknown as { restUntil: number }).restUntil = Number.MAX_SAFE_INTEGER;
    room.tick(5000);
    const n = conn.of('pet:state').length;
    run(room, 5000, 2, () => {});
    expect(conn.of('pet:state')).toHaveLength(n);
  });

  it('roams the map and never stands inside a wall or off the map', async () => {
    for (const seed of [1, 2, 3]) {
      const room = makeRoom({ seed });
      await room.join(new FakeConn(), { uid: 'ua', name: 'A' });
      const cat = catOf(room);
      const start = { x: cat.state.x, y: cat.state.y };
      let travelled = 0;
      let last = { ...start };
      run(room, 1000, 120, () => {
        const { x, y } = cat.state;
        // on a sofa or a desk top the cat is inside a solid cell by design
        if (!cat.perched) expect(collides(map, x, y), `seed ${seed} at ${x},${y}`).toBe(false);
        expect(x).toBeGreaterThan(0);
        expect(y).toBeGreaterThan(0);
        expect(x).toBeLessThan(map.pxWidth);
        expect(y).toBeLessThan(map.pxHeight);
        travelled += Math.hypot(x - last.x, y - last.y);
        last = { x, y };
      });
      expect(travelled).toBeGreaterThan(TILE * 10);
    }
  });

  it('walks slower than an avatar', async () => {
    const room = makeRoom();
    await room.join(new FakeConn(), { uid: 'ua', name: 'A' });
    const cat = catOf(room);
    let max = 0;
    let last = { x: cat.state.x, y: cat.state.y };
    run(room, 1000, 60, () => {
      max = Math.max(max, Math.hypot(cat.state.x - last.x, cat.state.y - last.y));
      last = { x: cat.state.x, y: cat.state.y };
    });
    // 4 tiles per second for an avatar, about 60% for the cat
    expect(max).toBeLessThanOrEqual((4 * TILE * 0.6) / TICK_HZ + 0.5);
  });

  describe('desk pods', () => {
    const spot = map.desks.find((d) => d.id === 'jungle-1')!;

    async function withOwner() {
      const room = makeRoom();
      const owner = (await room.join(new FakeConn(), { uid: 'ua', name: 'Alice' }))!;
      place(room, owner, cellPos(map, spot.chair), 'sit');
      room.handle(owner, { t: 'desk:claim', deskId: 'jungle-1' });
      return { room, owner };
    }

    /** Start the cat at the pod's entrance, wander for a while; did it ever stand inside? */
    function entersPod(room: SpaceRoom, seeds: number[]) {
      const cat = catOf(room);
      let inside = 0;
      for (const seed of seeds) {
        (cat as unknown as { rng: () => number }).rng = seeded(seed);
        const at = cellPos(map, spot.entrance);
        Object.assign(cat.state, at);
        (cat as unknown as { path: unknown[] }).path = [];
        (cat as unknown as { restUntil: number }).restUntil = 0;
        run(room, seed * 100_000, 40, () => {
          if (zoneAt(map, cat.state.x, cat.state.y)?.id === 'jungle-1') inside++;
        });
      }
      return inside;
    }

    const seeds = Array.from({ length: 40 }, (_, i) => i + 1);

    it('control: a cat does wander into an open pod', async () => {
      const { room } = await withOwner();
      expect(entersPod(room, seeds)).toBeGreaterThan(0);
    });

    it('never enters a locked or knock-only pod', async () => {
      for (const access of ['closed', 'knock'] as const) {
        const { room, owner } = await withOwner();
        room.handle(owner, { t: 'desk:update', access });
        expect(entersPod(room, seeds), access).toBe(0);
      }
    });

    it('is moved out within one tick when the pod it is in gets locked', async () => {
      const { room, owner } = await withOwner();
      const cat = catOf(room);
      Object.assign(cat.state, cellPos(map, spot.guest));
      expect(zoneAt(map, cat.state.x, cat.state.y)?.id).toBe('jungle-1');
      room.handle(owner, { t: 'desk:update', access: 'closed' });
      room.tick(2000);
      expect(zoneAt(map, cat.state.x, cat.state.y)?.id).not.toBe('jungle-1');
      expect(collides(map, cat.state.x, cat.state.y)).toBe(false);
    });
  });

  describe('presence and media', () => {
    it('is never a player, a link, a peer or a position', async () => {
      const room = makeRoom();
      const ca = new FakeConn();
      const cb = new FakeConn();
      const a = (await room.join(ca, { uid: 'ua', name: 'A' }))!;
      const b = (await room.join(cb, { uid: 'ub', name: 'B' }))!;
      // A and B stand together with the cat between them
      place(room, a, cell(41, 16));
      place(room, b, cell(42, 16));
      Object.assign(catOf(room).state, cell(41, 16));
      run(room, 1000, 10, () => {});
      expect(room.players.size).toBe(2);
      expect([...room.links].every((k) => !k.includes('cat'))).toBe(true);
      expect(room.links.size).toBe(1); // A and B only
      for (const conn of [ca, cb]) {
        expect(conn.of('peers').every((m) => m.peers.every((id) => !id.includes('cat')))).toBe(
          true,
        );
        expect(conn.of('state').every((m) => m.positions.every((p) => !p.id.includes('cat')))).toBe(
          true,
        );
        expect(conn.of('welcome')[0]!.profiles.every((p) => !p.id.includes('cat'))).toBe(true);
      }
    });

    it('a cat next to someone creates no link, and a private room with only a cat is empty', async () => {
      const room = makeRoom();
      const ca = new FakeConn();
      const a = (await room.join(ca, { uid: 'ua', name: 'A' }))!;
      // A stands alone; the cat sits right beside A inside a private room (hub meeting room)
      place(room, a, cell(41, 16));
      Object.assign(catOf(room).state, cell(42, 16));
      run(room, 1000, 5, () => {});
      expect(room.links.size).toBe(0);
      expect(ca.of('peers').at(-1)?.peers ?? []).toEqual([]);
      // someone outside the wall gets no link with the person inside, cat or not
      const cc = new FakeConn();
      const c = (await room.join(cc, { uid: 'uc', name: 'C' }))!;
      place(room, c, cell(38, 14));
      run(room, 100_000, 2, () => {});
      expect(room.links.size).toBe(0);
      expect(cc.of('peers').at(-1)?.peers ?? []).toEqual([]);
      expect(a.zone?.kind).toBe('private');
    });
  });
});
