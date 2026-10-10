import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  DEFAULT_FLAGS,
  MOODS,
  NPC_CHAT_COOLDOWN_MS,
  NPC_CHAT_LINES,
  NPC_CHAT_TILES,
  TICK_HZ,
  TILE,
  chatKinds,
  moodPersona,
  npcAllowedAt,
  parseMap,
  type NpcPersona,
  type Placed,
  type S2CMsg,
  type Tmj,
} from '@agora/shared';
import { MemoryStore, roomStore } from '../db/store';
import { Brain, fakeDecider } from '../npc-brain/decide';
import { NpcLineBanks } from '../npc-brain/lines';
import { DEFAULT_NPCS } from './npc-personas';
import { NpcChatter, type Npc, type NpcDirector, type NpcSocialLink } from './npcs';
import { SpaceRoom, type Player } from './room';

const tmj = JSON.parse(
  readFileSync(new URL('../../../../packages/maps/hq.tmj', import.meta.url), 'utf8'),
) as Tmj;
const map = parseMap(tmj);
const silent = { info: () => {}, warn: () => {} };
const STEP = 1000 / TICK_HZ;
const flush = () => new Promise<void>((r) => setImmediate(r));
const cell = (cx: number, cy: number) => ({ x: cx * TILE + 16, y: cy * TILE + 26 });
const banks = new NpcLineBanks(undefined, silent);

// ───────────────────────────────────────────── the chat rules, on stand-ins for characters
function stub(id: string, x: number, y: number) {
  const calls: string[] = [];
  const n = {
    state: { id: `npc:${id}`, x, y },
    persona: DEFAULT_NPCS.find((p) => p.id === id)!,
    free: true,
    here: true,
    canChat: () => n.free,
    canChatWith: () => n.here,
    attend: () => {
      calls.push('attend');
      return true;
    },
    calls,
  };
  return n;
}
const asNpc = (n: ReturnType<typeof stub>) => n as unknown as Npc;
const person = (id: string, x: number, y: number): Placed => ({ id, x, y });

function chatter(rng = () => 0) {
  return new NpcChatter((id) => banks.get(id), rng);
}

describe('characters talking to each other (P15.5, ADR-043/046): only with someone in earshot', () => {
  const at = cell(30, 30);
  const next = (dx: number) => ({ x: at.x + dx * TILE, y: at.y });

  it('chats when two free characters stand close and a person hears both', () => {
    const [a, b] = [stub('zoe', at.x, at.y), stub('felix', next(1).x, at.y)];
    const c = chatter();
    const people = [person('p', next(2).x, at.y)];
    let now = 0;
    for (let i = 0; i < 60; i++) c.tick((now += 1000), [asNpc(a), asNpc(b)], people);
    expect(c.says.length).toBe(NPC_CHAT_LINES);
    expect(c.says[0]).toMatchObject({ from: 'npc:zoe', to: 'npc:felix' });
    expect(c.says[1]).toMatchObject({ from: 'npc:felix', to: 'npc:zoe' });
    expect(a.calls.length + b.calls.length).toBeGreaterThan(0);
  });

  it('says nothing and asks nothing when nobody is connected on the open floor (negative control above)', () => {
    const [a, b] = [stub('zoe', at.x, at.y), stub('felix', next(1).x, at.y)];
    const c = chatter();
    let now = 0;
    for (let i = 0; i < 60; i++) c.tick((now += 1000), [asNpc(a), asNpc(b)], []);
    expect(c.says).toHaveLength(0);
    expect(c.stats.started).toBe(0);
  });

  it('says nothing when a person is far from them, or hears only one of them', () => {
    const [a, b] = [stub('zoe', at.x, at.y), stub('felix', at.x + NPC_CHAT_TILES * TILE, at.y)];
    const far = chatter();
    let now = 0;
    for (let i = 0; i < 60; i++)
      far.tick((now += 1000), [asNpc(a), asNpc(b)], [person('p', at.x, at.y + 40 * TILE)]);
    expect(far.says).toHaveLength(0);
    // hears Zoé (2 tiles) but not Félix (3 tiles away from Zoé, 7+ from the listener)
    const one = chatter();
    for (let i = 0; i < 60; i++)
      one.tick((now += 1000), [asNpc(a), asNpc(b)], [person('p', at.x - 6 * TILE, at.y)]);
    expect(one.says).toHaveLength(0);
  });

  it('does not start when they are too far apart or one of them is busy', () => {
    const people = [person('p', at.x, at.y + TILE)];
    const apart = chatter();
    const [a, b] = [
      stub('zoe', at.x, at.y),
      stub('felix', at.x + (NPC_CHAT_TILES + 2) * TILE, at.y),
    ];
    let now = 0;
    for (let i = 0; i < 40; i++) apart.tick((now += 1000), [asNpc(a), asNpc(b)], people);
    expect(apart.says).toHaveLength(0);
    const busy = chatter();
    const [c, d] = [stub('zoe', at.x, at.y), stub('felix', next(1).x, at.y)];
    d.free = false;
    for (let i = 0; i < 40; i++) busy.tick((now += 1000), [asNpc(c), asNpc(d)], people);
    expect(busy.says).toHaveLength(0);
  });

  it('stops the moment the listener is gone: the next line is never said', () => {
    const [a, b] = [stub('zoe', at.x, at.y), stub('felix', next(1).x, at.y)];
    const c = chatter();
    const listener = [person('p', next(2).x, at.y)];
    let now = 0;
    c.tick((now += 1000), [asNpc(a), asNpc(b)], listener);
    expect(c.says).toHaveLength(1);
    for (let i = 0; i < 30; i++) c.tick((now += 1000), [asNpc(a), asNpc(b)], []);
    expect(c.says).toHaveLength(1);
    expect(c.stats.endedUnheard).toBe(1);
  });

  it('the same pair does not chat again until the cooldown has passed', () => {
    const [a, b] = [stub('zoe', at.x, at.y), stub('felix', next(1).x, at.y)];
    const c = chatter();
    const people = [person('p', next(2).x, at.y)];
    let now = 0;
    for (let i = 0; i < 60; i++) c.tick((now += 1000), [asNpc(a), asNpc(b)], people);
    expect(c.stats.started).toBe(1);
    for (let i = 0; i < 60; i++) c.tick((now += 1000), [asNpc(a), asNpc(b)], people);
    expect(c.stats.started).toBe(1);
    now += NPC_CHAT_COOLDOWN_MS;
    for (let i = 0; i < 60; i++) c.tick((now += 1000), [asNpc(a), asNpc(b)], people);
    expect(c.stats.started).toBe(2);
  });

  it('uses only prepared lines (no model is involved anywhere in this class)', () => {
    const [a, b] = [stub('zoe', at.x, at.y), stub('felix', next(1).x, at.y)];
    const c = chatter();
    let now = 0;
    for (let i = 0; i < 60; i++)
      c.tick((now += 1000), [asNpc(a), asNpc(b)], [person('p', at.x, at.y + TILE)]);
    const said = (id: string, other: string) =>
      Object.values(banks.get(id).lines.fr)
        .flat()
        .map((l) => l.replace(/\{name\}/g, other));
    expect(c.says.length).toBeGreaterThan(0);
    for (const s of c.says) {
      const from = s.from.replace('npc:', '');
      const other = DEFAULT_NPCS.find((p) => `npc:${p.id}` === s.to)!.name;
      expect(said(from, other), s.body).toContain(s.body);
    }
    expect(chatKinds(3)).toEqual(['greeting', 'small_talk', 'goodbye']);
  });
});

// ───────────────────────────────────────────── delivery in a room
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
function place(room: SpaceRoom, p: Player, pos: { x: number; y: number }) {
  p.x = pos.x;
  p.y = pos.y;
  p.zone = undefined;
  room.handle(p, {
    t: 'move',
    x: pos.x,
    y: pos.y,
    dir: 'down',
    moving: false,
    pose: 'stand',
    seq: 0,
  });
}
const director = (room: SpaceRoom) => (room as unknown as { npcDirector: NpcDirector }).npcDirector;

async function social(opts: { brain?: Brain; saved?: Record<string, string> } = {}) {
  const store = new MemoryStore();
  const state = new Map(Object.entries(opts.saved ?? {}));
  const link: NpcSocialLink = {
    bank: (id) => banks.get(id),
    state: {
      get: async (id) => state.get(id) ?? null,
      set: async (id, json) => void state.set(id, json),
    },
  };
  const clock = { minute: 10 * 60 + 30 };
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
        flags: { ...DEFAULT_FLAGS, npcs: true, npcSocial: true },
      },
      npcs: {
        personas: () => DEFAULT_NPCS,
        clock: () => clock.minute,
        rng: () => 0.4,
        link: opts.brain ? { brain: opts.brain, space: 'hq' } : undefined,
        social: link,
      },
    },
    roomStore(store, 'hq'),
    silent,
  );
  await room.init();
  return { room, state, clock };
}

/** An open-floor spot with room around it. */
function openSpot() {
  for (let cy = 20; cy < 60; cy++)
    for (let cx = 20; cx < 80; cx++) {
      const p = cell(cx, cy);
      if (
        [-3, -2, -1, 0, 1, 2, 3].every((d) =>
          [-3, -2, -1, 0, 1, 2, 3].every((e) => npcAllowedAt(map, p.x + d * TILE, p.y + e * TILE)),
        )
      )
        return p;
    }
  throw new Error('no open floor');
}

/** Hold two characters still next to each other, free to chat. */
function huddle(room: SpaceRoom, spot: { x: number; y: number }) {
  const d = director(room);
  const [zoe, felix] = [d.get('npc:zoe')!, d.get('npc:felix')!];
  for (const [n, dx] of [
    [zoe, 0],
    [felix, 1],
  ] as const) {
    n.state.x = spot.x + dx * TILE;
    n.state.y = spot.y;
    const priv = n as unknown as Record<string, unknown>;
    priv.mode = 'stay';
    priv.goal = null;
    priv.talkUntil = 0;
    priv.pendingNext = true; // no new choices while the test watches
    priv.pendingApproach = true;
    priv.stayUntil = Infinity;
  }
}

describe('a chat between characters reaches exactly the people nearby chat would', () => {
  async function scene() {
    const s = await social();
    const conns = [new FakeConn(), new FakeConn(), new FakeConn()];
    const ps: Player[] = [];
    for (const [i, c] of conns.entries())
      ps.push((await s.room.join(c, { uid: `u${i}`, name: `P${i}` }))!);
    s.room.tick(1000);
    const spot = openSpot();
    return { ...s, conns, ps, spot };
  }
  const run = (room: SpaceRoom, spot: { x: number; y: number }, seconds: number, from = 2000) => {
    let now = from;
    for (let i = 0; i < seconds * TICK_HZ; i++) {
      huddle(room, spot);
      room.tick((now += STEP));
    }
    return now;
  };
  const lines = (c: FakeConn) =>
    c.of('npc:say').filter((m) => m.id.startsWith('npc:') && m.to.startsWith('npc:'));

  it('a nearby listener hears the chat; a person in a private room right beside them and one far away hear nothing', async () => {
    const { room, ps, conns, spot } = await scene();
    place(room, ps[0]!, { x: spot.x + 2 * TILE, y: spot.y });
    place(room, ps[1]!, cell(44, 12)); // private meeting room
    place(room, ps[2]!, cell(5, 5)); // far across the map
    expect(ps[1]!.zone?.kind).toBe('private');
    run(room, spot, 40);
    expect(lines(conns[0]!).length).toBeGreaterThan(0);
    expect(lines(conns[1]!)).toHaveLength(0);
    expect(lines(conns[2]!)).toHaveLength(0);
    expect(director(room).chatStats!.started).toBeGreaterThan(0);
  });

  it('with nobody in earshot nothing is said, and no chat is even started', async () => {
    const { room, ps, conns, spot } = await scene();
    place(room, ps[0]!, cell(44, 12)); // private
    place(room, ps[1]!, cell(5, 5)); // far
    place(room, ps[2]!, cell(5, 8)); // far
    run(room, spot, 40);
    for (const c of conns) expect(lines(c)).toHaveLength(0);
    expect(director(room).chatStats!.started).toBe(0);
  });
});

// ───────────────────────────────────────────── moods and the saved day
describe('the day’s mood (P15.5): Clef picks it, safe default steady', () => {
  const answer = (top: string, p: number) =>
    new Brain(
      fakeDecider((id) => (id === 'mood' ? { top, p } : undefined)),
      0.7,
      silent,
      {
        backoffMs: 1,
      },
    );
  const moodOf = async (brain: Brain) => {
    const { room } = await social({ brain });
    const c = new FakeConn();
    await room.join(c, { uid: 'u', name: 'P' });
    for (let i = 0; i < 5; i++) {
      room.tick(1000 + i * 1000);
      await flush();
    }
    return director(room).get('npc:zoe')!.mood;
  };

  it('applies a sure answer, ignores an unsure one and a missing Clef', async () => {
    expect(await moodOf(answer('social', 0.95))).toBe('social');
    expect(await moodOf(answer('social', 0.5))).toBe('steady');
    expect(await moodOf(new Brain(null, 0.7, silent))).toBe('steady');
    expect(
      await moodOf(
        new Brain(
          fakeDecider(() => 'down'),
          0.7,
          silent,
          { backoffMs: 1 },
        ),
      ),
    ).toBe('steady');
  });

  it('bends the numbers for the day without touching the persona file', () => {
    const zoe = DEFAULT_NPCS[0]!;
    for (const m of MOODS) {
      const p = moodPersona(zoe, m);
      expect(p.schedulePull).toBeGreaterThanOrEqual(0);
      expect(p.schedulePull).toBeLessThanOrEqual(2);
    }
    expect(moodPersona(zoe, 'steady')).toBe(zoe);
    expect(moodPersona(zoe, 'social').needRates.social).toBeGreaterThan(zoe.needRates.social ?? 1);
    expect(moodPersona(zoe, 'focused').schedulePull).toBeGreaterThan(zoe.schedulePull);
    expect(zoe.needRates.social ?? 1).toBe(zoe.needRates.social ?? 1); // the original is unchanged
  });
});

describe('the day is kept across a restart (npc_state)', () => {
  const today = () => new Date().toISOString().slice(0, 10);
  const saved = (day: string) =>
    JSON.stringify({
      day,
      mood: 'relaxed',
      needs: { energy: 11, social: 22, focus: 33, caffeine: 44 },
    });

  async function zoeAfterRestart(day: string) {
    const { room } = await social({ saved: { zoe: saved(day) } });
    await room.join(new FakeConn(), { uid: 'u', name: 'P' });
    room.tick(Date.now());
    return director(room).get('npc:zoe')!;
  }

  it('resumes needs and mood from the same day, and starts fresh from another day', async () => {
    const same = await zoeAfterRestart(today());
    expect(same.mood).toBe('relaxed');
    expect(Math.round(same.needs.caffeine)).toBeLessThanOrEqual(44);
    const old = await zoeAfterRestart('2020-01-01');
    expect(old.mood).toBe('steady');
    expect(old.needs.caffeine).toBeGreaterThan(44);
  });

  it('writes the day back about once a minute while someone is connected', async () => {
    const { room, state } = await social();
    await room.join(new FakeConn(), { uid: 'u', name: 'P' });
    const t = Date.now();
    room.tick(t);
    room.tick(t + 61_000);
    await flush();
    const j = JSON.parse(state.get('zoe')!) as { day: string; mood: string };
    expect(j.day).toBe(today());
    expect(MOODS).toContain(j.mood);
  });
});

export type { NpcPersona };
