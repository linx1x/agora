import { describe, expect, it } from 'vitest';
import {
  WORLDGEN,
  chunkIndex,
  chunkOfPoint,
  feetCell,
  findWorldPath,
  randomAvatar,
  worldCollides,
  worldGenParamsFor,
  type S2CMsg,
  type WorldGenParams,
  CAVE_ARRIVAL,
  WORLD_CELL_PX,
  CAVE_EXIT,
  caveIdOf,
  cellFeet,
  parseCaveId,
  DEFAULT_DAY_MS,
  weatherForecast,
} from '@agora/shared';
import { MemoryWorldStore, type WorldStore } from './worldStore';
import { setCells } from './testWorld';
import { WorldHub, type WorldMember, type WorldRoom, worldSpawn } from './worldRoom';
import { defaultStarter } from './starter';
import type { SfuApi } from '../media/gate';

const SEED = 3560865791;
const P: WorldGenParams = worldGenParamsFor(WORLDGEN, 1);

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

/** A store with one world per id (owners are the ids too, so they are unique). */
async function storeWith(...ids: string[]): Promise<MemoryWorldStore> {
  const store = new MemoryWorldStore();
  for (const id of ids)
    await store.createWorld({
      id,
      ownerId: `owner-${id}`,
      seed: SEED,
      genVersion: 1,
      createdAt: 0,
      lastDay: 0,
      settings: {},
    });
  return store;
}

/** Walk in 8 px steps (each one validated by the room). Returns false at the first refusal. */
function walkTo(room: WorldRoom, m: WorldMember, x: number, y: number, seq: { n: number }): boolean {
  for (let i = 0; i < 600; i++) {
    const dx = x - m.x;
    const dy = y - m.y;
    const d = Math.hypot(dx, dy);
    if (d < 1) return true;
    const step = Math.min(d, 8);
    m.lastMoveAt = Date.now() - 100;
    const before = { x: m.x, y: m.y };
    room.move(m, { x: m.x + (dx / d) * step, y: m.y + (dy / d) * step, dir: 'right', seq: seq.n++ });
    if (m.x === before.x && m.y === before.y) return false;
  }
  return false;
}

describe('WorldHub: lazy load and unload', () => {
  it('sends everyone the same daily forecast, including visitors arriving after rollover', async () => {
    let now = 4 * DEFAULT_DAY_MS;
    const hub = new WorldHub(await storeWith('w1'), undefined, undefined, undefined, { now: () => now, autoTick: false });
    const room = (await hub.enter('w1'))!;
    const a = new FakeConn();
    const b = new FakeConn();
    const ma = room.join(a, who('a'));
    const mb = room.join(b, who('b'));
    expect(a.of('world:time')[0]?.weather).toEqual(weatherForecast(SEED, 5));
    expect(b.of('world:time')[0]?.weather).toEqual(a.of('world:time')[0]?.weather);
    now += DEFAULT_DAY_MS;
    room.tick();
    expect(a.of('world:time').at(-1)?.weather).toEqual(weatherForecast(SEED, 6));
    const c = new FakeConn();
    const mc = room.join(c, who('c'));
    expect(c.of('world:time')[0]?.weather).toEqual(a.of('world:time').at(-1)?.weather);
    room.leave(ma); room.leave(mb); room.leave(mc);
  });
  it('loads a world once for everyone who arrives together, and closes it when the last person leaves', async () => {
    const store = await storeWith('w1');
    let loads = 0;
    const counting = Object.assign(Object.create(store) as WorldStore, {
      loadAllChunks: (id: string) => {
        loads++;
        return store.loadAllChunks(id);
      },
    });
    const hub = new WorldHub(counting);
    const [a, b] = await Promise.all([hub.enter('w1'), hub.enter('w1')]);
    expect(a).not.toBeNull();
    expect(a).toBe(b);
    expect(loads).toBe(1);
    const c1 = new FakeConn();
    const c2 = new FakeConn();
    const m1 = a!.join(c1, who('p1'));
    const m2 = a!.join(c2, who('p2'));
    a!.leave(m1);
    expect(a!.disposed).toBe(false);
    a!.leave(m2);
    expect(a!.disposed).toBe(true);
    const again = await hub.enter('w1');
    expect(again).not.toBe(a);
    expect(loads).toBe(2);
  });

  it('does not open an unknown world, or one whose generator version is unknown', async () => {
    const store = await storeWith('w1');
    await store.createWorld({
      id: 'w9',
      ownerId: 'owner-w9',
      seed: SEED,
      genVersion: 9,
      createdAt: 0,
      lastDay: 0,
      settings: {},
    });
    const hub = new WorldHub(store);
    expect(await hub.enter('nope')).toBeNull();
    expect(await hub.enter('w9')).toBeNull();
  });
});

describe('WorldRoom: joining and the view', () => {
  it('the welcome carries the seed and the generator, and the arrival point is free ground', async () => {
    const room = (await new WorldHub(await storeWith('w1')).enter('w1'))!;
    const c1 = new FakeConn();
    const m1 = room.join(c1, who('p1'), undefined, 'Alice Tremblay');
    expect(c1.of('world:welcome')[0]).toMatchObject({
      worldId: 'w1',
      owner: 'Alice Tremblay',
      you: 'p1',
      seed: SEED,
      genVersion: 1,
      params: P,
    });
    expect(worldCollides(room.terrain, m1.x, m1.y)).toBe(false);
    expect(worldSpawn(room.terrain)).toEqual({ x: m1.x, y: m1.y });
  });

  it('streams the 5 by 5 chunks around the person with their stored edits and revision', async () => {
    const store = await storeWith('w2');
    await store.saveChunk('w2', 1, 0, { '5': { block: 'tilled_soil' } }, 0);
    const room = (await new WorldHub(store).enter('w2'))!;
    const c1 = new FakeConn();
    room.join(c1, who('p1'));
    const first = c1.of('world:chunks')[0]!;
    expect(first.add).toHaveLength(25);
    expect(first.drop).toEqual([]);
    expect(first.add.find((c) => c.cx === 1 && c.cy === 0)).toEqual({
      cx: 1,
      cy: 0,
      rev: 1,
      delta: { '5': { block: 'tilled_soil' } },
    });
    // a chunk with nothing stored still carries the starter stamp (the origin is flattened ground)
    const origin = first.add.find((c) => c.cx === 0 && c.cy === 0)!;
    expect(origin.rev).toBe(0);
    expect(origin.delta[String(chunkIndex(0, 0))]).toEqual({ level: 2, block: 'meadow_dirt', decor: '' });
  });

  it('walking into the next chunk streams the chunks that came into view and the ones that left', async () => {
    const room = (await new WorldHub(await storeWith('w1')).enter('w1'))!;
    const c1 = new FakeConn();
    const m1 = room.join(c1, who('p1'));
    // a free cell in chunk (1, 0), reachable from the arrival point
    let path: ReturnType<typeof findWorldPath> = null;
    for (let cy = 0; cy < 32 && !path; cy++)
      for (let cx = 32; cx < 64 && !path; cx++) {
        if (worldCollides(room.terrain, cx * 32 + 16, cy * 32 + 26)) continue;
        path = findWorldPath(room.terrain, feetCell(m1.x, m1.y), { cx, cy });
      }
    expect(path).not.toBeNull();
    const seq = { n: 1 };
    for (const cell of path!)
      expect(walkTo(room, m1, cell.cx * 32 + 16, cell.cy * 32 + 26, seq)).toBe(true);
    expect(chunkOfPoint(m1.x, m1.y)).toEqual({ cx: 1, cy: 0 });
    const streamed = c1.of('world:chunks').slice(1);
    expect(streamed.some((m) => m.add.length > 0 && m.drop.length > 0)).toBe(true);
  });
});

describe('WorldRoom: moves are decided by the server, with the stored edits', () => {
  it('refuses a move into a cell that a stored edit made solid, and says where the person really stands', async () => {
    const store = await storeWith('w3');
    const spawn = (await new WorldHub(store).enter('w3'))!.spawn();
    // a wood wall in the cell just east of the arrival point (stored, so the room must load it)
    const sx = Math.floor(spawn.x / 32);
    const sy = Math.floor(spawn.y / 32);
    const wall = chunkOfPoint((sx + 1) * 32, sy * 32);
    const local = chunkIndex(sx + 1 - wall.cx * 32, sy - wall.cy * 32);
    await store.saveChunk('w3', wall.cx, wall.cy, { [String(local)]: { decor: 'wood_wall' } }, 0);
    const room = (await new WorldHub(store).enter('w3'))!;
    const c1 = new FakeConn();
    const m1 = room.join(c1, who('p1'));
    const x0 = m1.x;
    m1.lastMoveAt = Date.now() - 100;
    room.move(m1, { x: m1.x + 8, y: m1.y, dir: 'right', seq: 1 });
    expect(m1.x).toBe(x0 + 8);
    m1.lastMoveAt = Date.now() - 100;
    room.move(m1, { x: m1.x + 8, y: m1.y, dir: 'right', seq: 2 });
    expect(c1.of('world:correction').at(-1)).toEqual({
      t: 'world:correction',
      x: x0 + 8,
      y: m1.y,
      seq: 2,
      reason: 'collision',
    });
    expect(m1.x).toBe(x0 + 8);
  });
});

describe('WorldRoom: presence stays inside its world', () => {
  it('people in one world hear each other; people in another world hear nothing of it', async () => {
    const store = await storeWith('w4', 'w5');
    const hub = new WorldHub(store);
    const r4 = (await hub.enter('w4'))!;
    const r5 = (await hub.enter('w5'))!;
    const c1 = new FakeConn();
    const c2 = new FakeConn();
    const c3 = new FakeConn();
    const m1 = r4.join(c1, who('p1'));
    r4.join(c2, who('p2'));
    r5.join(c3, who('p3'));
    expect(c1.of('world:join').at(-1)?.person.id).toBe('p2');
    expect(c3.of('world:join')).toHaveLength(0);
    const seen = c3.msgs.length;
    r4.move(m1, { x: m1.x, y: m1.y, dir: 'down', seq: 1 });
    expect(c2.of('world:pos')).toMatchObject([{ t: 'world:pos', id: 'p1' }]);
    expect(c3.msgs.length).toBe(seen);
  });

  it('the others hear a departure, and nobody hears a person who has already left', async () => {
    const room = (await new WorldHub(await storeWith('w6')).enter('w6'))!;
    const c1 = new FakeConn();
    const c2 = new FakeConn();
    const m1 = room.join(c1, who('p1'));
    const m2 = room.join(c2, who('p2'));
    room.leave(m1);
    expect(c2.of('world:depart')).toEqual([{ t: 'world:depart', id: 'p1' }]);
    const seen = c1.msgs.length;
    room.move(m2, { x: m2.x, y: m2.y, dir: 'down', seq: 1 });
    expect(c1.msgs.length).toBe(seen);
    room.move(m1, { x: m1.x, y: m1.y, dir: 'down', seq: 1 }); // a departed person's move goes nowhere
    expect(c2.of('world:pos')).toHaveLength(1);
  });
});

describe('WorldRoom: the starter stamp (P17.10, ADR-053)', () => {
  it('the server reads the shipped starter from the repo, and its return pad is where the file says', () => {
    expect(defaultStarter().ret).toEqual({ x: -1, y: 3 });
  });

  it('the stamp reaches the client with the chunks it covers, even when nothing is stored', async () => {
    const room = (await new WorldHub(await storeWith('s1')).enter('s1'))!;
    const c1 = new FakeConn();
    room.join(c1, who('p1'));
    // the return pad is cell (-1, 3): chunk (-1, 0), local (31, 3)
    const west = c1.of('world:chunks')[0]!.add.find((c) => c.cx === -1 && c.cy === 0)!;
    expect(west.rev).toBe(0);
    expect(west.delta[String(chunkIndex(31, 3))]).toEqual({ level: 2, block: 'return_pad', decor: '' });
  });

  it('a stored edit goes over the stamp: the edited cell keeps its level, the rest of the stamp stays', async () => {
    const store = await storeWith('s2');
    await store.saveChunk('s2', 0, 0, { '0': { block: 'tilled_soil' } }, 0);
    const room = (await new WorldHub(store).enter('s2'))!;
    expect(room.terrain.cellAt(0, 0)).toMatchObject({ level: 2, block: 'tilled_soil', decor: '' });
    expect(room.terrain.cellAt(1, 0)).toMatchObject({ level: 2, block: 'meadow_dirt', decor: '' });
    const c1 = new FakeConn();
    room.join(c1, who('p1'));
    const origin = c1.of('world:chunks')[0]!.add.find((c) => c.cx === 0 && c.cy === 0)!;
    expect(origin.rev).toBe(1);
    expect(origin.delta['0']).toEqual({ level: 2, block: 'tilled_soil', decor: '' });
  });

  it('the house bed, walls and the shipping bin block walking; the farm and the pad do not', async () => {
    const room = (await new WorldHub(await storeWith('s3')).enter('s3'))!;
    const feet = (cx: number, cy: number) => ({ x: cx * 32 + 16, y: cy * 32 + 26 });
    const blocked = (cx: number, cy: number) => worldCollides(room.terrain, feet(cx, cy).x, feet(cx, cy).y);
    expect(blocked(-5, -5)).toBe(true); // the bed
    expect(blocked(-6, -4)).toBe(true); // a wall
    expect(blocked(0, 1)).toBe(true); // the shipping bin
    expect(blocked(6, 0)).toBe(false); // the farm plot
    expect(blocked(-1, 3)).toBe(false); // the return pad
  });

  it('only the return pad is a way back: a person off the pad is refused, on it they leave the world', async () => {
    const room = (await new WorldHub(await storeWith('s4')).enter('s4'))!;
    const c1 = new FakeConn();
    const m1 = room.join(c1, who('p1'));
    expect(room.atReturn(m1)).toBe(false);
    // a walk from the arrival point to the pad, cell by cell (each step validated by the room)
    const path = findWorldPath(room.terrain, feetCell(m1.x, m1.y), { cx: -1, cy: 3 });
    expect(path).not.toBeNull();
    const seq = { n: 1 };
    for (const cell of path!) expect(walkTo(room, m1, cell.cx * 32 + 16, cell.cy * 32 + 26, seq)).toBe(true);
    expect(room.atReturn(m1)).toBe(true);
  });
});

/** A stand-in SFU for a world's room: records every call and hands out readable tokens. */
class RecordingSfu implements SfuApi {
  calls: string[] = [];
  async mint(room: string, identity: string, _name: string, canPublish: boolean) {
    this.calls.push(`mint ${room} ${identity} ${canPublish ? 'pub' : 'sub'}`);
    return `tok|${room}|${identity}`;
  }
  async setPublish(room: string, identity: string, canPublish: boolean) {
    this.calls.push(`perm ${room} ${identity} ${canPublish ? 'pub' : 'sub'}`);
  }
  async remove(room: string, identity: string) {
    this.calls.push(`remove ${room} ${identity}`);
  }
  async rooms(): Promise<string[]> {
    return [];
  }
  async participants(): Promise<{ identity: string; canPublish: boolean }[]> {
    return [];
  }
}

const mediaOf = (sfu: RecordingSfu) => ({
  api: sfu,
  url: 'wss://sfu.test',
  prefix: 'agora',
  log: { warn: () => {} },
});
const flush = () => new Promise((r) => setTimeout(r, 0));

describe('WorldRoom: media and chat stay inside the world (P17.11, ADR-053)', () => {
  it('peers: everyone in a world is linked to the others there, and never to the people of another world', async () => {
    const hub = new WorldHub(await storeWith('w1', 'w2'));
    const w1 = (await hub.enter('w1'))!;
    const w2 = (await hub.enter('w2'))!;
    const c1 = new FakeConn();
    const c2 = new FakeConn();
    const c3 = new FakeConn();
    w1.join(c1, who('p1'));
    const m2 = w1.join(c2, who('p2'));
    w2.join(c3, who('p3'));
    expect(c1.of('peers').at(-1)?.peers).toEqual(['p2']);
    expect(c2.of('peers').at(-1)?.peers).toEqual(['p1']);
    expect(c3.of('peers').at(-1)?.peers).toEqual([]);
    expect(c1.of('peers').flatMap((p) => p.peers)).not.toContain('p3');
    expect(c3.of('world:join')).toEqual([]);
    expect(c3.of('world:pos')).toEqual([]);
    w1.leave(m2);
    expect(c1.of('peers').at(-1)?.peers).toEqual([]);
  });

  it('chat: a nearby line reaches every person in its world, wherever they stand, and never another world', async () => {
    const hub = new WorldHub(await storeWith('w1', 'w2'));
    const w1 = (await hub.enter('w1'))!;
    const w2 = (await hub.enter('w2'))!;
    const c1 = new FakeConn();
    const c2 = new FakeConn();
    const c3 = new FakeConn();
    const m1 = w1.join(c1, who('p1'));
    const m2 = w1.join(c2, who('p2'));
    w2.join(c3, who('p3'));
    m2.x += 800; // far from the speaker: the world is one private scope, so distance does not count
    w1.chat(m1, 'bonjour');
    expect(c1.of('chat').at(-1)?.msg).toMatchObject({
      from: 'p1',
      name: 'p1',
      body: 'bonjour',
      scope: 'nearby',
      zoneId: 'world:w1',
    });
    expect(c2.of('chat').at(-1)?.msg.body).toBe('bonjour');
    expect(c3.of('chat')).toEqual([]);
  });

  it('SFU: a member gets a token for the world room only, with no floor; the token is taken back on leave', async () => {
    const sfu = new RecordingSfu();
    const hub = new WorldHub(await storeWith('w1', 'w2'));
    const w1 = (await hub.enter('w1'))!;
    const w2 = (await hub.enter('w2'))!;
    const c1 = new FakeConn();
    const c2 = new FakeConn();
    const m1 = w1.join(c1, who('p1'), mediaOf(sfu));
    await flush();
    expect(c1.of('media:grant').at(-1)).toEqual({
      t: 'media:grant',
      url: 'wss://sfu.test',
      floor: null,
      zone: { room: 'agora:world:w1', token: 'tok|agora:world:w1|p1' },
      publish: 'zone',
    });
    expect(sfu.calls).toEqual(['mint agora:world:w1 p1 pub']);
    w2.join(c2, who('p2'), mediaOf(sfu));
    await flush();
    expect(c2.of('media:grant').at(-1)?.zone?.room).toBe('agora:world:w2');
    expect(c1.of('media:grant')).toHaveLength(1); // nothing of the other world reached the first member
    w1.refreshMedia(m1);
    await flush();
    expect(c1.of('media:grant')).toHaveLength(2);
    w1.leave(m1);
    await flush();
    expect(sfu.calls).toContain('remove agora:world:w1 p1');
    expect(sfu.calls.filter((c) => c.includes('agora:world:w2'))).toEqual(['mint agora:world:w2 p2 pub']);
  });

  it('SFU: someone who leaves before their token is minted is sent none', async () => {
    const sfu = new RecordingSfu();
    const hub = new WorldHub(await storeWith('w1'));
    const w1 = (await hub.enter('w1'))!;
    const c1 = new FakeConn();
    const m1 = w1.join(c1, who('p1'), mediaOf(sfu));
    w1.leave(m1);
    await flush();
    expect(c1.of('media:grant')).toEqual([]);
    expect(sfu.calls).toContain('remove agora:world:w1 p1');
  });

  it('P2P: a signal is relayed to a member of the same world only; nobody else hears it', async () => {
    const hub = new WorldHub(await storeWith('w1', 'w2'));
    const w1 = (await hub.enter('w1'))!;
    const w2 = (await hub.enter('w2'))!;
    const c1 = new FakeConn();
    const c2 = new FakeConn();
    const c3 = new FakeConn();
    const m1 = w1.join(c1, who('p1'));
    w1.join(c2, who('p2'));
    w2.join(c3, who('p3'));
    const data = { kind: 'offer', sdp: 'v=0' } as const;
    expect(w1.signal(m1, 'p2', data)).toBe('ok');
    expect(c2.of('rtc')).toEqual([{ t: 'rtc', from: 'p1', data }]);
    expect(w1.signal(m1, 'p3', data)).toBe('not_linked'); // a person of another world
    expect(w1.signal(m1, 'nobody', data)).toBe('not_linked');
    expect(w1.signal(m1, 'p1', data)).toBe('not_linked'); // not to oneself
    expect(c1.of('rtc')).toEqual([]);
    expect(c3.of('rtc')).toEqual([]);
  });

  it('SFU: signalling is off inside a world, as it is in the office', async () => {
    const sfu = new RecordingSfu();
    const hub = new WorldHub(await storeWith('w1'));
    const w1 = (await hub.enter('w1'))!;
    const c1 = new FakeConn();
    const c2 = new FakeConn();
    const m1 = w1.join(c1, who('p1'), mediaOf(sfu));
    w1.join(c2, who('p2'), mediaOf(sfu));
    expect(w1.signal(m1, 'p2', { kind: 'ice', candidate: {} })).toBe('off');
    expect(c2.of('rtc')).toEqual([]);
  });
});

describe('WorldRoom: a cave room (P17.32, ADR-053)', () => {
  const MOUTH = { x: 20, y: 4 };
  const CAVE = caveIdOf('w1', MOUTH.x, MOUTH.y);
  const mouthFeet = cellFeet(MOUTH.x, MOUTH.y);

  /** The world w1 with a cave mouth in its stored edits, its hub, and the cave opened from it. */
  async function caveOf() {
    const store = await storeWith('w1');
    await setCells(store, { [`${MOUTH.x},${MOUTH.y}`]: { decor: 'cave_mouth' } });
    const hub = new WorldHub(store);
    const world = (await hub.enter('w1'))!;
    const cave = (await hub.enter(CAVE))!;
    return { store, hub, world, cave };
  }

  it('opens from its world under its own id, with the same seed and generator and no stored edits', async () => {
    const { cave } = await caveOf();
    expect(cave.id).toBe(CAVE);
    expect(cave.cave).toEqual({ worldId: 'w1', mouthX: MOUTH.x, mouthY: MOUTH.y });
    expect(cave.seed).toBe(SEED);
    expect(cave.genVersion).toBe(1);
    expect(parseCaveId(cave.id)?.worldId).toBe('w1');
  });

  it('a cave whose world does not exist opens nothing', async () => {
    const hub = new WorldHub(await storeWith('w1'));
    expect(await hub.enter(caveIdOf('nope', 1, 1))).toBeNull();
  });

  it('a visitor is welcomed on the cave floor, with the world seed, and the exit pad is its way out', async () => {
    const { cave } = await caveOf();
    const conn = new FakeConn();
    const m = cave.join(conn, who('p1'));
    expect(conn.of('world:welcome')[0]).toMatchObject({ worldId: CAVE, seed: SEED, genVersion: 1, you: 'p1' });
    expect(conn.of('world:time')[0]?.weather).toBeUndefined();
    expect({ x: m.x, y: m.y }).toEqual(cellFeet(CAVE_ARRIVAL.x, CAVE_ARRIVAL.y));
    expect(cave.atReturn(m)).toBe(false);
    const exit = cellFeet(CAVE_EXIT.x, CAVE_EXIT.y);
    m.x = exit.x;
    m.y = exit.y;
    expect(cave.atReturn(m)).toBe(true);
  });

  it('its terrain is the cave: rock around it, and the exit is a mouth; no farm reaches it', async () => {
    const { cave } = await caveOf();
    const conn = new FakeConn();
    cave.join(conn, who('p1'));
    await flush();
    expect(cave.terrain.cellAt(0, 0).block).toBe('cave_rock');
    expect(cave.terrain.cellAt(CAVE_EXIT.x, CAVE_EXIT.y).decor).toBe('cave_mouth');
    expect(conn.of('world:farm')).toEqual([]);
  });

  it('a cave refuses every world action as forbidden', async () => {
    const { cave } = await caveOf();
    const conn = new FakeConn();
    const m = cave.join(conn, who('p1'));
    cave.act(m, { t: 'world:act', op: 4, kind: 'eat', key: 'k-cave-0001' });
    await flush();
    expect(conn.of('world:refused')).toEqual([{ t: 'world:refused', op: 4, reason: 'forbidden' }]);
    expect(conn.of('world:acted')).toEqual([]);
  });

  it('the mouth is found under the feet of a person in the world, and only there', async () => {
    const { world } = await caveOf();
    const m = world.join(new FakeConn(), who('p1'));
    m.x = mouthFeet.x;
    m.y = mouthFeet.y;
    expect(world.caveMouthAt(m)).toBe(CAVE);
    m.x = mouthFeet.x + WORLD_CELL_PX;
    expect(world.caveMouthAt(m)).toBeNull();
    expect(world.cave).toBeNull();
  });

  it('coming back out lands on free ground beside the mouth, never on the mouth', async () => {
    const { world } = await caveOf();
    const at = world.arrivalNextTo(MOUTH.x, MOUTH.y);
    const cx = Math.floor(at.x / WORLD_CELL_PX);
    const cy = Math.floor(at.y / WORLD_CELL_PX);
    expect(Math.max(Math.abs(cx - MOUTH.x), Math.abs(cy - MOUTH.y))).toBe(1);
    expect(world.terrain.cellAt(cx, cy).decor).not.toBe('cave_mouth');
    expect(worldCollides(world.terrain, at.x, at.y)).toBe(false);
  });

  it('media: a cave has its own SFU room, which the world it opens from does not share', async () => {
    const { world, cave } = await caveOf();
    const sfu = new RecordingSfu();
    const outside = new FakeConn();
    const inside = new FakeConn();
    world.join(outside, who('p1'), mediaOf(sfu));
    await flush();
    cave.join(inside, who('p2'), mediaOf(sfu));
    await flush();
    expect(outside.of('media:grant').at(-1)?.zone?.room).toBe('agora:world:w1');
    expect(inside.of('media:grant').at(-1)?.zone?.room).toBe(`agora:world:${CAVE}`);
    expect(outside.of('media:grant')).toHaveLength(1);
  });
});

