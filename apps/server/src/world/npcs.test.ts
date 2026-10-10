import { mkdtempSync, readFileSync, readdirSync, writeFileSync, utimesSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  DEFAULT_FLAGS,
  NPC_FORBIDDEN,
  NpcPersonaSchema,
  TICK_HZ,
  TILE,
  npcAllowedAt,
  parseMap,
  regionAt,
  regionSpawn,
  zoneAt,
  type NpcPersona,
  type S2CMsg,
  type Tmj,
} from '@agora/shared';
import { MemoryStore, roomStore } from '../db/store';
import { Brain, fakeDecider, type DecideRequest } from '../npc-brain/decide';
import { DecisionLog, type DecisionRecord } from '../npc-brain/log';
import { DEFAULT_NPCS, NpcPersonas } from './npc-personas';
import type { NpcBrainLink, NpcDirector } from './npcs';
import { SpaceRoom, type Player } from './room';

const tmj = JSON.parse(
  readFileSync(new URL('../../../../packages/maps/hq.tmj', import.meta.url), 'utf8'),
) as Tmj;
const map = parseMap(tmj);
const silent = { info: () => {}, warn: () => {} };
const STEP = 1000 / TICK_HZ;
const hm = (s: string) => Number(s.slice(0, 2)) * 60 + Number(s.slice(3));

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

/** A room with the characters on, a clock the test moves by hand. */
function makeRoom(
  opts: {
    npcs?: boolean;
    seed?: number;
    cast?: NpcPersona[];
    at?: string;
    link?: NpcBrainLink;
  } = {},
) {
  const clock = { minute: hm(opts.at ?? '10:30'), calls: 0 };
  let cast = opts.cast ?? DEFAULT_NPCS;
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
        flags: { ...DEFAULT_FLAGS, npcs: opts.npcs ?? true },
      },
      npcs: {
        personas: () => cast,
        clock: () => {
          clock.calls++;
          return clock.minute;
        },
        rng: seeded(opts.seed ?? 1),
        link: opts.link,
      },
    },
    roomStore(new MemoryStore(), 'hq'),
    silent,
  );
  return { room, clock, setCast: (c: NpcPersona[]) => (cast = c) };
}

const director = (room: SpaceRoom) => (room as unknown as { npcDirector: NpcDirector }).npcDirector;
const npc = (room: SpaceRoom, id: string) => director(room).all.find((n) => n.persona.id === id)!;

/** Run the room for `seconds`, the clock advancing `rate` game minutes per real second. */
function run(
  room: SpaceRoom,
  clock: { minute: number },
  from: number,
  seconds: number,
  each: (now: number) => void = () => {},
  rate = 0,
) {
  let now = from;
  for (let i = 0; i < seconds * TICK_HZ; i++) {
    now += STEP;
    clock.minute += rate / TICK_HZ;
    room.tick(now);
    each(now);
  }
  return now;
}

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

const forbiddenAt = (x: number, y: number) =>
  map.zones.some(
    (z) => NPC_FORBIDDEN.includes(z.kind) && zoneAt({ ...map, zones: [z] }, x, y) !== undefined,
  );

describe('characters (ADR-042, P15.2)', () => {
  it('are off unless the flag is on', async () => {
    const { room, clock } = makeRoom({ npcs: false });
    const conn = new FakeConn();
    await room.join(conn, { uid: 'ua', name: 'A' });
    run(room, clock, 1000, 3);
    expect(conn.of('npc:state')).toHaveLength(0);
    expect(director(room)).toBeUndefined();
  });

  it('sleep while nobody is connected: no ticks, no clock, nothing sent', () => {
    const { room, clock } = makeRoom();
    const calls = clock.calls;
    run(room, clock, 1000, 5);
    expect(clock.calls).toBe(calls);
  });

  it('appear where their schedule puts them when someone arrives, marked as present', async () => {
    const { room, clock } = makeRoom({ at: '10:30' });
    const conn = new FakeConn();
    await room.join(conn, { uid: 'ua', name: 'A' });
    room.tick(1000);
    const last = conn.of('npc:state').at(-1)!.npcs;
    expect(last.map((n) => n.id).sort()).toEqual(['npc:felix', 'npc:theo', 'npc:zoe']);
    const theo = last.find((n) => n.id === 'npc:theo')!;
    expect(theo).toMatchObject({ name: 'Théo', act: 'desk', p: 'sit' });
    expect(regionAt(map, theo.x, theo.y)?.id).toBe('jungle');
    expect(clock.calls).toBeGreaterThan(0);
  });

  it('are away before arriving and after leaving', async () => {
    const { room, clock } = makeRoom({ at: '07:00' });
    const conn = new FakeConn();
    await room.join(conn, { uid: 'ua', name: 'A' });
    room.tick(1000);
    expect(director(room).snapshot()).toEqual([]);
    clock.minute = hm('09:00');
    run(room, clock, 1000, 1);
    expect(
      director(room)
        .snapshot()
        .map((n) => n.id),
    ).toEqual(['npc:zoe', 'npc:felix']);
  });

  it('walk their day across wings and never stand in a private room, pod or quiet zone', async () => {
    for (const seed of [1, 2, 3]) {
      const { room, clock } = makeRoom({ seed, at: '09:30' });
      await room.join(new FakeConn(), { uid: 'ua', name: 'A' });
      const visited = new Set<string>();
      // 09:30 → about 13:30 of game time in 4 real minutes
      run(
        room,
        clock,
        1000,
        240,
        () => {
          for (const n of director(room).all) {
            if (!n.present) continue;
            const { x, y } = n.state;
            expect(forbiddenAt(x, y), `seed ${seed} ${n.persona.id} at ${x},${y}`).toBe(false);
            expect(npcAllowedAt(map, x, y), `seed ${seed} ${n.persona.id} at ${x},${y}`).toBe(true);
            visited.add(`${n.persona.id}:${regionAt(map, x, y)?.id}:${n.state.act}`);
          }
        },
        1,
      );
      // Théo goes from his Jungle desk to the lounge at noon: he crossed a teleporter
      expect([...visited], `seed ${seed}`).toContain('theo:jungle:desk');
      expect([...visited], `seed ${seed}`).toContain('theo:hub:lounge');
    }
  }, 30_000);

  it('are never Players: not in placed(), links, peers or state positions', async () => {
    const { room, clock } = makeRoom({ at: '10:30' });
    const a = new FakeConn();
    const pa = (await room.join(a, { uid: 'ua', name: 'A' }))!;
    room.tick(1000);
    // stand right next to Théo, on the open floor
    const theo = npc(room, 'theo').state;
    place(room, pa, { x: theo.x + TILE, y: theo.y });
    run(room, clock, 1000, 2);
    expect([...room.players.keys()].some((id) => id.startsWith('npc:'))).toBe(false);
    expect([...room.links].some((k) => k.includes('npc:'))).toBe(false);
    for (const m of a.of('peers')) expect(m.peers.some((p) => p.startsWith('npc:'))).toBe(false);
    for (const m of a.of('state'))
      expect(m.positions.some((p) => p.id.startsWith('npc:'))).toBe(false);
  });

  it('are moved out of a desk pod within one tick (open floor: left alone, negative control)', async () => {
    const { room, clock } = makeRoom({ at: '10:30' });
    await room.join(new FakeConn(), { uid: 'ua', name: 'A' });
    room.tick(1000);
    const zoe = npc(room, 'zoe');
    const pod = map.desks[0]!.zone;
    zoe.state.x = pod.x + pod.w / 2;
    zoe.state.y = pod.y + pod.h / 2;
    expect(npcAllowedAt(map, zoe.state.x, zoe.state.y)).toBe(false);
    run(room, clock, 1000, 1 / TICK_HZ);
    expect(npcAllowedAt(map, zoe.state.x, zoe.state.y)).toBe(true);
    // control: standing on the open floor, nothing moves it
    const before = { ...npc(room, 'theo').state };
    run(room, clock, 1100, 1 / TICK_HZ);
    expect(npc(room, 'theo').state.x).toBe(before.x);
    expect(npc(room, 'theo').state.y).toBe(before.y);
  });

  it('do not take a chair someone is sitting on', async () => {
    const { room, clock } = makeRoom({ at: '10:30', cast: [DEFAULT_NPCS[2]!] });
    const a = new FakeConn();
    const pa = (await room.join(a, { uid: 'ua', name: 'A' }))!;
    room.tick(1000);
    const seat = { x: npc(room, 'theo').state.x, y: npc(room, 'theo').state.y };
    // Théo leaves for coffee; Vincent sits on his chair; Théo comes back to another one
    clock.minute = hm('09:55');
    run(room, clock, 1000, 1);
    place(room, pa, seat, 'sit');
    expect(pa.pose).toBe('sit');
    clock.minute = hm('10:30');
    run(room, clock, 1000, 60);
    const t = npc(room, 'theo').state;
    expect(Math.hypot(t.x - seat.x, t.y - seat.y)).toBeGreaterThan(TILE / 2);
  });

  it('follow edits of their files: renamed, removed', async () => {
    const { room, clock, setCast } = makeRoom({ at: '10:30' });
    const conn = new FakeConn();
    await room.join(conn, { uid: 'ua', name: 'A' });
    room.tick(1000);
    setCast(
      DEFAULT_NPCS.filter((p) => p.id !== 'felix').map((p) =>
        p.id === 'theo' ? { ...p, name: 'Théodore' } : p,
      ),
    );
    run(room, clock, 1000, 1);
    const last = conn.of('npc:state').at(-1)!.npcs;
    expect(last.map((n) => n.id).sort()).toEqual(['npc:theo', 'npc:zoe']);
    expect(last.find((n) => n.id === 'npc:theo')!.name).toBe('Théodore');
  });
});

describe('character files', () => {
  it('writes the defaults once, reads edits, ignores bad files, hides disabled ones', () => {
    const dir = join(mkdtempSync(join(tmpdir(), 'npcs-')), 'npcs');
    const warns: object[] = [];
    const log = { info: () => {}, warn: (o: object) => warns.push(o) };
    const files = new NpcPersonas(dir, log, { writeDefaults: true });
    expect(files.list(0).map((p) => p.id)).toEqual(['zoe', 'felix', 'theo']);
    const theo = JSON.parse(readFileSync(join(dir, 'theo.json'), 'utf8')) as NpcPersona;
    writeFileSync(join(dir, 'theo.json'), JSON.stringify({ ...theo, name: 'Théo B.' }));
    writeFileSync(
      join(dir, 'felix.json'),
      JSON.stringify({ ...theo, id: 'felix', enabled: false }),
    );
    writeFileSync(join(dir, 'bad.json'), '{ not json');
    writeFileSync(join(dir, 'zoe.json'), JSON.stringify({ ...theo, id: 'zoe', schedule: [] }));
    utimesSync(join(dir, 'theo.json'), new Date(), new Date(Date.now() + 1000));
    // not re-read before the check interval
    expect(files.list(1000).find((p) => p.id === 'theo')!.name).toBe('Théo');
    const now = files.list(10_000);
    expect(now.map((p) => p.id)).toEqual(['zoe', 'theo']);
    expect(now.find((p) => p.id === 'theo')!.name).toBe('Théo B.');
    // the broken zoe.json is ignored: the default Zoé stays
    expect(now.find((p) => p.id === 'zoe')!.name).toBe('Zoé');
    expect(warns.length).toBe(2);
  });

  it('every default character passes the schema and lives in a region of the map', () => {
    for (const p of DEFAULT_NPCS) {
      expect(NpcPersonaSchema.parse(p)).toEqual(p);
      expect(
        map.regions.some((r) => r.id === p.home),
        p.id,
      ).toBe(true);
    }
  });
});

// ───────────────────────────────────────────── P15.3: needs, decisions, approach
const flush = () => new Promise<void>((r) => setImmediate(r));
const cellXY = (cx: number, cy: number) => ({ x: cx * TILE + TILE / 2, y: cy * TILE + TILE - 6 });

/** Like run(), but lets Clef's (fake) answers arrive between seconds. */
async function live(
  room: SpaceRoom,
  clock: { minute: number },
  from: number,
  seconds: number,
  rate = 0,
  each: (now: number) => void = () => {},
) {
  let now = from;
  for (let s = 0; s < seconds; s++) {
    now = run(room, clock, now, 1, each, rate);
    await flush();
  }
  return now;
}

function brainWith(
  answer: Parameters<typeof fakeDecider>[0],
  opts: { log?: DecisionLog; backoffMs?: number; now?: () => number } = {},
) {
  const fake = fakeDecider(answer);
  const brain = new Brain(fake, 0.7, silent, { backoffMs: opts.backoffMs, now: opts.now });
  return { fake, link: { brain, log: opts.log, space: 'hq' } satisfies NpcBrainLink };
}

const nextCalls = (fake: { calls: DecideRequest[] }) =>
  fake.calls.filter((c) => 'next' in c.questions);
const approachCalls = (fake: { calls: DecideRequest[] }) =>
  fake.calls.filter((c) => 'approach' in c.questions);

/** An open-floor cell `tiles` away from a character, as close to that as the map allows. */
function besideNpc(n: { state: { x: number; y: number } }, tiles: number) {
  for (const [dx, dy] of [
    [1, 0],
    [-1, 0],
    [0, 1],
    [0, -1],
  ] as const) {
    const p = { x: n.state.x + dx * tiles * TILE, y: n.state.y + dy * tiles * TILE };
    if (npcAllowedAt(map, p.x, p.y)) return p;
  }
  throw new Error('no open floor next to the character');
}

describe('minds (P15.3): Clef picks among the best scores, the scoring decides without it', () => {
  it('Clef chooses among the 4 best candidates, and its pick is followed', async () => {
    // always the last of the candidates, sure of it
    const { fake, link } = brainWith((id, q) =>
      id === 'next' && q.type === 'choice'
        ? { top: Object.keys(q.criteria).at(-1)!, p: 0.95 }
        : undefined,
    );
    const { room, clock } = makeRoom({ at: '10:30', link, cast: [DEFAULT_NPCS[2]!] });
    await room.join(new FakeConn(), { uid: 'ua', name: 'A' });
    // let the first choice expire (15 s floor, 15+ game minutes at the desk)
    await live(room, clock, 1000, 40, 1);
    const calls = nextCalls(fake);
    expect(calls.length).toBeGreaterThan(0);
    const q = calls[0]!.questions.next!;
    expect(q.type).toBe('choice');
    if (q.type !== 'choice') return;
    const options = Object.keys(q.criteria);
    expect(options.length).toBeGreaterThanOrEqual(2);
    expect(options.length).toBeLessThanOrEqual(4);
    const v = npc(room, 'theo').view();
    expect(v.next?.via).toBe('clef');
    expect(v.next?.chosen).toBe(options.at(-1));
    expect(v.next?.top.map((t) => t.a)).toEqual(options);
  });

  it('Clef unsure (under NPC_DECIDE_MIN_P): the top score wins', async () => {
    const { fake, link } = brainWith((id, q) =>
      id === 'next' && q.type === 'choice'
        ? { top: Object.keys(q.criteria).at(-1)!, p: 0.5 }
        : undefined,
    );
    const { room, clock } = makeRoom({ at: '10:30', link, cast: [DEFAULT_NPCS[2]!] });
    await room.join(new FakeConn(), { uid: 'ua', name: 'A' });
    await live(room, clock, 1000, 40, 1);
    expect(nextCalls(fake).length).toBeGreaterThan(0);
    const v = npc(room, 'theo').view();
    expect(v.next?.via).toBe('score');
    expect(v.next?.chosen).toBe(v.next?.top[0]!.a);
  });

  it('Clef down: the scoring decides, and Clef is left alone during the back-off', async () => {
    let t = 0;
    const { fake, link } = brainWith(() => 'down', { backoffMs: 60_000, now: () => t });
    const { room, clock } = makeRoom({ at: '10:30', link });
    await room.join(new FakeConn(), { uid: 'ua', name: 'A' });
    let now = 1000;
    for (let i = 0; i < 40; i++) {
      t = now;
      now = await live(room, clock, now, 1, 1);
    }
    expect(fake.calls.length).toBe(1);
    expect(link.brain.status).toBe('down');
    const views = director(room).minds();
    expect(views.some((v) => v.next?.via === 'score')).toBe(true);
    // every character still lives its day
    for (const n of director(room).all) expect(n.present).toBe(true);
  });

  it('a choice holds for its commit time: no new decision before then', async () => {
    const { fake, link } = brainWith((id, q) =>
      q.type === 'choice' ? { top: Object.keys(q.criteria)[0]!, p: 0.9 } : undefined,
    );
    const { room, clock } = makeRoom({ at: '10:30', link, cast: [DEFAULT_NPCS[2]!] });
    await room.join(new FakeConn(), { uid: 'ua', name: 'A' });
    // clock stopped: game minutes do not pass, so the desk choice from waking up holds
    await live(room, clock, 1000, 30, 0);
    expect(nextCalls(fake)).toHaveLength(0);
    // time runs: about one decision per commit, not one every 5 s
    await live(room, clock, 40_000, 60, 1);
    expect(nextCalls(fake).length).toBeGreaterThan(0);
    expect(nextCalls(fake).length).toBeLessThanOrEqual(5);
  });

  it('a strong need makes a detour from the schedule (no Clef: scoring only)', async () => {
    const { room, clock } = makeRoom({ at: '10:30', cast: [DEFAULT_NPCS[1]!] });
    await room.join(new FakeConn(), { uid: 'ua', name: 'A' });
    room.tick(1000);
    const felix = npc(room, 'felix');
    expect(felix.state.act).toBe('desk');
    felix.needs = { ...felix.needs, caffeine: 2 };
    const acts = new Set<string>();
    await live(room, clock, 1000, 60, 1, () => acts.add(felix.state.act));
    expect([...acts].some((a) => a === 'coffee' || a === 'tea')).toBe(true);
  });
});

describe('approaching people (P15.3)', () => {
  const sure = (choice: string, busy: 'yes' | 'no') =>
    brainWith((id) =>
      id === 'approach'
        ? { top: choice, p: 0.95 }
        : id === 'busy'
          ? { top: busy, p: 0.95 }
          : undefined,
    );

  it('walks up to an available person and waves; only people within chat reach see it', async () => {
    const { fake, link } = sure('walk_up', 'no');
    const { room, clock } = makeRoom({ at: '10:30', link, cast: [DEFAULT_NPCS[0]!] });
    const near = new FakeConn();
    const far = new FakeConn();
    const pn = (await room.join(near, { uid: 'un', name: 'Vincent Sylvestre' }))!;
    const pf = (await room.join(far, { uid: 'uf', name: 'Far Away' }))!;
    room.tick(1000);
    const zoe = npc(room, 'zoe');
    place(room, pf, defaultSpawnFar(zoe));
    place(room, pn, besideNpc(zoe, 5));
    let closest = Infinity;
    await live(room, clock, 1000, 20, 0, () => {
      closest = Math.min(closest, Math.hypot(zoe.state.x - pn.x, zoe.state.y - pn.y) / TILE);
    });
    const asked = approachCalls(fake);
    expect(asked).toHaveLength(1);
    expect(JSON.stringify(asked[0]!.state)).toContain('Vincent');
    expect(JSON.stringify(asked[0]!.state)).not.toContain('Sylvestre');
    expect(near.of('npc:emote')).toEqual([{ t: 'npc:emote', id: 'npc:zoe', emote: 'wave' }]);
    expect(far.of('npc:emote')).toHaveLength(0);
    expect(closest).toBeLessThanOrEqual(3);
    expect(zoe.view().approach).toMatchObject({ via: 'clef', choice: 'walk_up', busy: false });
  });

  it('never approaches Busy or Do Not Disturb, whatever Clef would say (negative control: available)', async () => {
    for (const status of ['busy', 'dnd', 'away', 'available'] as const) {
      const { fake, link } = sure('walk_up', 'no');
      const { room, clock } = makeRoom({ at: '10:30', link, cast: [DEFAULT_NPCS[0]!] });
      const c = new FakeConn();
      const p = (await room.join(c, { uid: 'u1', name: 'Vincent' }))!;
      room.handle(p, { t: 'status', status, msg: '' });
      room.tick(1000);
      place(room, p, besideNpc(npc(room, 'zoe'), 4));
      await live(room, clock, 1000, 15, 0);
      if (status === 'available') {
        expect(approachCalls(fake), status).toHaveLength(1);
        expect(c.of('npc:emote'), status).toHaveLength(1);
      } else {
        expect(approachCalls(fake), status).toHaveLength(0);
        expect(c.of('npc:emote'), status).toHaveLength(0);
      }
    }
  });

  it('leaves someone alone when the busy decision says so, or when Clef is unsure', async () => {
    for (const [answer, p] of [
      ['yes', 0.95],
      ['no', 0.5],
    ] as const) {
      const { link } = brainWith((id) =>
        id === 'approach'
          ? { top: 'walk_up', p: 0.95 }
          : id === 'busy'
            ? { top: answer, p }
            : undefined,
      );
      const { room, clock } = makeRoom({ at: '10:30', link, cast: [DEFAULT_NPCS[0]!] });
      const c = new FakeConn();
      const pl = (await room.join(c, { uid: 'u1', name: 'Vincent' }))!;
      room.tick(1000);
      place(room, pl, besideNpc(npc(room, 'zoe'), 4));
      await live(room, clock, 1000, 15, 0);
      expect(c.of('npc:emote')).toHaveLength(0);
      expect(npc(room, 'zoe').view().approach?.choice).toBe('ignore');
    }
  });

  it('never walks up to the same person twice within 10 minutes', async () => {
    let t = 0;
    const { fake, link } = brainWith(
      (id) =>
        id === 'approach'
          ? { top: 'wave', p: 0.95 }
          : id === 'busy'
            ? { top: 'no', p: 0.95 }
            : undefined,
      { now: () => t, backoffMs: 1 },
    );
    const { room, clock } = makeRoom({ at: '10:00', link, cast: [DEFAULT_NPCS[0]!] });
    const c = new FakeConn();
    const p = (await room.join(c, { uid: 'u1', name: 'Vincent' }))!;
    room.tick(1000);
    const zoe = npc(room, 'zoe');
    const close = besideNpc(zoe, 4);
    const away = defaultSpawnFar(zoe);
    const visit = async (at: number) => {
      t = at;
      place(room, p, away);
      await live(room, clock, at, 2, 0);
      place(room, p, close);
      return live(room, clock, at + 2000, 3, 0);
    };
    await visit(10_000);
    expect(c.of('npc:emote')).toHaveLength(1);
    await visit(10_000 + 9 * 60_000);
    expect(c.of('npc:emote')).toHaveLength(1);
    expect(approachCalls(fake)).toHaveLength(1);
    await visit(10_000 + 11 * 60_000);
    expect(c.of('npc:emote')).toHaveLength(2);
    expect(approachCalls(fake)).toHaveLength(2);
  });

  it('does not see people in a private room or desk pod (negative control: the open floor)', async () => {
    const { room } = makeRoom({ at: '10:30' });
    const a = (await room.join(new FakeConn(), { uid: 'ua', name: 'Inside Room' }))!;
    const b = (await room.join(new FakeConn(), { uid: 'ub', name: 'Open Floor' }))!;
    place(room, a, cellXY(41, 16)); // hub meeting room salle-a (private)
    place(room, b, cellXY(38, 14)); // the lane outside its wall
    expect(a.zone?.kind).toBe('private');
    const people = (room as unknown as { npcPeople(): { name: string }[] }).npcPeople();
    expect(people.map((p) => p.name)).toEqual(['Open']);
  });

  it('a wave reaches exactly the people nearby chat would reach: never into a private room', async () => {
    const { room } = makeRoom({ at: '10:30' });
    const ca = new FakeConn();
    const cb = new FakeConn();
    const cc = new FakeConn();
    const a = (await room.join(ca, { uid: 'ua', name: 'A' }))!;
    const b = (await room.join(cb, { uid: 'ub', name: 'B' }))!;
    const c = (await room.join(cc, { uid: 'uc', name: 'C' }))!;
    place(room, a, cellXY(41, 16)); // inside salle-a, 4 tiles from the wave
    place(room, b, cellXY(38, 14)); // outside, next to it
    place(room, c, cellXY(70, 40)); // far away on the open floor
    const send = (room as unknown as { sendNpcEmote(e: object): void }).sendNpcEmote.bind(room);
    send({ npcId: 'npc:zoe', ...cellXY(37, 14), emote: 'wave' });
    expect(cb.of('npc:emote')).toHaveLength(1);
    expect(ca.of('npc:emote')).toHaveLength(0);
    expect(cc.of('npc:emote')).toHaveLength(0);
  });

  it('keeps its distance from someone in Do Not Disturb', async () => {
    const { room, clock } = makeRoom({ at: '10:30', cast: [DEFAULT_NPCS[1]!] });
    const c = new FakeConn();
    const p = (await room.join(c, { uid: 'u1', name: 'Vincent' }))!;
    room.handle(p, { t: 'status', status: 'dnd', msg: '' });
    room.tick(1000);
    const felix = npc(room, 'felix');
    // Félix stands in the Zen garden (no open-floor chair there); DND walks right up to him
    expect(felix.state.p).toBeUndefined();
    place(room, p, besideNpc(felix, 1));
    await live(room, clock, 1000, 40, 0);
    expect(Math.hypot(felix.state.x - p.x, felix.state.y - p.y) / TILE).toBeGreaterThanOrEqual(2);
    expect(c.of('npc:emote')).toHaveLength(0);
  });
});

describe('the decision log and the brain view (P15.3)', () => {
  it('logs decisions with scores and Clef probabilities, without people’s names', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'npc-log-'));
    const log = new DecisionLog(dir, 30, silent);
    const { link } = brainWith(
      (id, q) =>
        id === 'approach'
          ? { top: 'wave', p: 0.9 }
          : id === 'busy'
            ? { top: 'no', p: 0.9 }
            : q.type === 'choice'
              ? { top: Object.keys(q.criteria)[0]!, p: 0.9 }
              : undefined,
      { log },
    );
    const { room, clock } = makeRoom({ at: '10:30', link, cast: [DEFAULT_NPCS[0]!] });
    const p = (await room.join(new FakeConn(), { uid: 'u1', name: 'Vincent Sylvestre' }))!;
    room.tick(1000);
    place(room, p, besideNpc(npc(room, 'zoe'), 4));
    await live(room, clock, 1000, 40, 1);
    await log.flush();
    const files = readdirSync(dir);
    expect(files.length).toBe(1);
    const text = readFileSync(join(dir, files[0]!), 'utf8');
    expect(text).not.toContain('Vincent');
    expect(text).not.toContain('u1');
    const recs = text
      .trim()
      .split('\n')
      .map((l) => JSON.parse(l) as DecisionRecord);
    expect(recs.some((r) => r.kind === 'approach' && r.via === 'clef')).toBe(true);
    const next = recs.find((r) => r.kind === 'next')!;
    expect(next.options[0]!.parts).toBeDefined();
    expect(next.probs?.next).toBeDefined();
    expect(JSON.stringify(recs)).toContain('person 1');
  });

  it('purges day files older than the retention', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'npc-log-'));
    writeFileSync(join(dir, '2020-01-01.jsonl'), '{}\n');
    writeFileSync(join(dir, 'notes.txt'), 'kept');
    const log = new DecisionLog(dir, 30, silent);
    await log.purge(Date.parse('2026-10-07T12:00:00Z'));
    expect(readdirSync(dir).sort()).toEqual(['notes.txt']);
  });

  it('the brain view goes only to people allowed to see it, and carries no names', async () => {
    const { room, clock } = makeRoom({ at: '10:30' });
    const dev = new FakeConn();
    const other = new FakeConn();
    await room.join(dev, { uid: 'ua', name: 'Vincent', npcDebug: true });
    await room.join(other, { uid: 'ub', name: 'Marie' });
    await live(room, clock, 1000, 3, 1);
    const m = dev.of('npc:mind').at(-1)!;
    expect(m.brain).toBe('off');
    expect(m.minds.map((x) => x.id).sort()).toEqual(['npc:felix', 'npc:theo', 'npc:zoe']);
    expect(Object.keys(m.minds[0]!.needs).sort()).toEqual([
      'caffeine',
      'energy',
      'focus',
      'social',
    ]);
    expect(JSON.stringify(m)).not.toContain('Vincent');
    expect(other.of('npc:mind')).toHaveLength(0);
  });
});

/** A spot on the open floor far from a character (the Atrium entrance, or a wing away). */
function defaultSpawnFar(n: { state: { x: number; y: number } }) {
  const candidates = map.regions.map((r) => regionSpawnOf(r.id)).filter(Boolean) as {
    x: number;
    y: number;
  }[];
  const far = candidates.sort(
    (a, b) =>
      Math.hypot(b.x - n.state.x, b.y - n.state.y) - Math.hypot(a.x - n.state.x, a.y - n.state.y),
  )[0]!;
  return far;
}

const regionSpawnOf = (id: string) => regionSpawn(map, id);
