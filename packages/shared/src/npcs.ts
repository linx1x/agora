/**
 * NPCs (Phase 15, ADR-042): shared types and the pure parts of a character's body. The server
 * owns every character (apps/server/src/world/npcs.ts); browsers only draw what `npc:state` says.
 * An NPC is never a Player: it walks with the same `findPath` and walls as an avatar, but it may
 * never stand in a private room, a desk pod or the quiet zone (`npcAllowedAt`).
 */
import { z } from 'zod';
import { AvatarSchema, type Avatar } from './avatar';
import { SPEED_PX, TILE, type Dir } from './constants';
import {
  SIT_DIRS,
  cellOf,
  cellPos,
  collides,
  isSolidCell,
  regionAt,
  zoneContains,
  type Cell,
  type WorldMap,
  type ZoneKind,
} from './map';
import { chatReaches, type Placed } from './proximity';
import { COFFEE, PLANT, WATER_EDGE, WINDOW_WALL } from './spot-tiles';
import { tileDef } from './tileset';

// ───────────────────────────────────────────── personas
/** What a schedule block can ask a character to do. */
export const SCHEDULE_ACTIVITIES = [
  'desk',
  'coffee',
  'lounge',
  'tea',
  'water',
  'tour',
  'wander',
  'break',
] as const;
export type ScheduleActivity = (typeof SCHEDULE_ACTIVITIES)[number];
/**
 * Everything a character can be doing (P15.3): the schedule's activities, plus going to greet a
 * person (`greet`) and joining a friend (`friend`), which only the scoring and Clef choose.
 */
export const NPC_ACTIVITIES = [...SCHEDULE_ACTIVITIES, 'greet', 'friend'] as const;
export type NpcActivity = (typeof NPC_ACTIVITIES)[number];

/** The four needs (P15.3): 0 = urgent, 100 = satisfied. */
export const NPC_NEEDS = ['energy', 'social', 'focus', 'caffeine'] as const;
export type NpcNeed = (typeof NPC_NEEDS)[number];
export type NpcNeeds = Record<NpcNeed, number>;

const HHMM = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'HH:MM');
/**
 * One schedule line: a moment (`{at: "09:40", do: "arrive"}`, lasting until the next line) or a
 * span (`{from: "10:00", to: "12:00", do: "desk"}`, free time after `to`).
 */
export const NpcBlockSchema = z.union([
  z.object({
    at: HHMM,
    do: z.union([z.literal('arrive'), z.literal('leave'), z.enum(SCHEDULE_ACTIVITIES)]),
  }),
  z.object({ from: HHMM, to: HHMM, do: z.enum(SCHEDULE_ACTIVITIES) }),
]);
export type NpcBlock = z.infer<typeof NpcBlockSchema>;

/**
 * A goal (P15.3). A plain sentence is for the brain only; with `pushes` it also raises the score
 * of the activities that move it forward (less so each time one is done that day).
 */
export const NpcGoalSchema = z.union([
  z.string().max(200),
  z.object({
    text: z.string().max(200),
    pushes: z.array(z.enum(NPC_ACTIVITIES)).max(6).default([]),
    /** how much the goal adds to a pushed activity's score (0.25 by default) */
    weight: z.number().min(0).max(1).default(0.25),
  }),
]);
export type NpcGoal = z.infer<typeof NpcGoalSchema>;

/**
 * A character file (`data/npcs/<id>.json`). The body uses id, name, avatar, home and schedule;
 * the rest is for the brain (P15.4) and is only checked for size here.
 */
export const NpcPersonaSchema = z.object({
  id: z.string().regex(/^[a-z0-9-]{1,32}$/),
  name: z.string().trim().min(1).max(40),
  avatar: AvatarSchema,
  /** region the character works in (a map region id: hub, jungle, oasis, boreal, zen) */
  home: z.string().min(1).max(40),
  enabled: z.boolean().default(true),
  locale: z.enum(['fr-CA', 'en']).default('fr-CA'),
  role: z.string().max(200).default(''),
  personality: z.string().max(600).default(''),
  traits: z.record(z.string(), z.number().min(0).max(1)).default({}),
  schedule: z.array(NpcBlockSchema).min(1).max(40),
  goals: z.array(NpcGoalSchema).max(10).default([]),
  /**
   * How strongly the schedule pulls (P15.3): 1 = mostly on schedule, a strong need still makes a
   * short detour; 0 = needs only; 2 = almost strict.
   */
  schedulePull: z.number().min(0).max(2).default(1),
  /** How fast each need runs down, as a multiplier of the defaults (1 = normal). */
  needRates: z.partialRecord(z.enum(NPC_NEEDS), z.number().min(0).max(3)).default({}),
  knows: z.string().max(2000).default(''),
  friends: z.record(z.string(), z.number().min(0).max(1)).default({}),
  fallbackLines: z.array(z.string().max(200)).max(20).default([]),
});
export type NpcPersona = z.infer<typeof NpcPersonaSchema>;

// ───────────────────────────────────────────── what browsers see
/** One character as every browser draws it. Never carries anything about people. */
export interface NpcState {
  id: string;
  name: string;
  avatar: Avatar;
  x: number;
  y: number;
  d: Dir;
  /** walking */
  m: boolean;
  p?: 'sit';
  /** what it is doing, for the "Characters" list */
  act: NpcActivity;
}

/** A little slower than a person walking. */
export const NPC_SPEED_PX = SPEED_PX * 0.75;
/** Pathfinding budget for one leg (cells expanded). */
export const NPC_PATH_NODES = 8000;

// ───────────────────────────────────────────── where an NPC may stand
/** Zone kinds an NPC never enters: private rooms, desk pods, the quiet zone (ADR-042). */
export const NPC_FORBIDDEN: readonly ZoneKind[] = ['private', 'desk', 'quiet'];

/**
 * May a character stand at (x, y)? Avatar walls, and never inside a private room, a desk pod or
 * the quiet zone, whatever the pod's access. The server enforces it every tick.
 */
export function npcAllowedAt(map: WorldMap, x: number, y: number): boolean {
  if (collides(map, x, y)) return false;
  for (const z of map.zones)
    if (NPC_FORBIDDEN.includes(z.kind) && zoneContains(z, x, y)) return false;
  return true;
}

/** Nearest place a character may stand, searched outward from (x, y). */
export function npcNearestAllowed(map: WorldMap, x: number, y: number): { x: number; y: number } {
  const T = map.tile;
  const c = cellOf(map, x, y);
  for (let r = 0; r < Math.max(map.width, map.height); r++)
    for (let dy = -r; dy <= r; dy++)
      for (let dx = -r; dx <= r; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
        const cx = c.cx + dx;
        const cy = c.cy + dy;
        if (cx < 0 || cy < 0 || cx >= map.width || cy >= map.height) continue;
        const p = { x: cx * T + T / 2, y: cy * T + T - 6 };
        if (npcAllowedAt(map, p.x, p.y)) return p;
      }
  return { x, y };
}

// ───────────────────────────────────────────── time
/** Minutes since midnight in a time zone (the space's: America/Toronto). */
export function minuteOfDay(now: number, timeZone = 'America/Toronto'): number {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(new Date(now));
  const n = (t: string) => Number(parts.find((p) => p.type === t)?.value ?? 0);
  return n('hour') * 60 + n('minute') + n('second') / 60;
}

export const parseHHMM = (s: string) => Number(s.slice(0, 2)) * 60 + Number(s.slice(3, 5));

/**
 * The character's clock. Real time in the space's zone by default; for development a start time
 * and a speed (`NPC_CLOCK=10:00`, `NPC_TIME_SCALE=60` = one game hour per real minute).
 */
export function npcClock(opts: { timeZone?: string; start?: string; scale?: number; t0?: number }) {
  const scale = opts.scale && opts.scale > 0 ? opts.scale : 1;
  if (!opts.start && scale === 1) return (now: number) => minuteOfDay(now, opts.timeZone);
  let t0 = opts.t0;
  return (now: number) => {
    t0 ??= now;
    const base = opts.start ? parseHHMM(opts.start) : minuteOfDay(t0, opts.timeZone);
    return (((base + ((now - t0) / 60_000) * scale) % 1440) + 1440) % 1440;
  };
}

export interface NpcMoment {
  /** what to do now, or away (not in the office) */
  activity: ScheduleActivity | 'away';
  /** minute the current line started, to notice a change */
  since: number;
}

/**
 * Where the schedule puts a character at `minute`: before `arrive` and after `leave` it is
 * away; a moment line lasts until the next line; after a span's `to` it wanders. Pure.
 */
export function scheduleAt(schedule: NpcBlock[], minute: number): NpcMoment {
  type Line = { start: number; end?: number; do: NpcBlock['do'] };
  const lines: Line[] = schedule
    .map((b) =>
      'at' in b
        ? { start: parseHHMM(b.at), do: b.do }
        : { start: parseHHMM(b.from), end: parseHHMM(b.to), do: b.do },
    )
    .sort((a, b) => a.start - b.start);
  const arrive = lines.find((l) => l.do === 'arrive')?.start ?? lines[0]?.start ?? 0;
  const leave = lines.find((l) => l.do === 'leave')?.start ?? 24 * 60;
  if (minute < arrive || minute >= leave)
    return { activity: 'away', since: minute < arrive ? 0 : leave };
  let cur: Line | undefined;
  for (const l of lines) if (l.start <= minute) cur = l;
  if (!cur || cur.do === 'arrive' || cur.do === 'leave')
    return { activity: 'wander', since: cur?.start ?? arrive };
  if (cur.end !== undefined && minute >= cur.end) return { activity: 'wander', since: cur.end };
  return { activity: cur.do, since: cur.start };
}

// ───────────────────────────────────────────── interest spots
export const NPC_SPOT_KINDS = ['seat', 'coffee', 'water', 'window', 'plant'] as const;
export type NpcSpotKind = (typeof NPC_SPOT_KINDS)[number];

export interface NpcSpot {
  key: string;
  kind: NpcSpotKind;
  /** the cell the character stands (or sits) in */
  cell: Cell;
  face: Dir;
  sit: boolean;
  region?: string;
  /** id of the `area` zone around it (salon, accueil, jungle-aire…) */
  area?: string;
}

const NEIGHBOURS: [number, number, Dir][] = [
  [0, 1, 'up'],
  [0, -1, 'down'],
  [-1, 0, 'right'],
  [1, 0, 'left'],
];

/**
 * Every place a character can use on this map, found from tiles alone (a built map works as well
 * as the generated one): open-floor chairs to sit (desk, lounge, tea), the kitchen counter, fridge
 * and water cooler for coffee, the edge of ponds and fountains for a walk by the water. Spots in
 * private rooms, desk pods and the quiet zone are left out. Pure; the server caches it per map
 * revision. Cat spots live in `petSpots` (P14.4); the two share the tile-name approach.
 */
export function npcSpots(map: WorldMap): NpcSpot[] {
  const out: NpcSpot[] = [];
  const seen = new Set<string>();
  const nameAt = (cx: number, cy: number, layer = 'furniture'): string | undefined => {
    if (cx < 0 || cy < 0 || cx >= map.width || cy >= map.height) return undefined;
    const g = map.layers[layer]?.[cy * map.width + cx];
    return g ? tileDef(g)?.base : undefined;
  };
  const feet = (c: Cell) => cellPos(map, c);
  const add = (kind: NpcSpotKind, cell: Cell, face: Dir, sit: boolean) => {
    const key = `${kind}:${cell.cx},${cell.cy}`;
    if (seen.has(key)) return;
    const p = feet(cell);
    if (!sit && !npcAllowedAt(map, p.x, p.y)) return;
    if (sit && map.zones.some((z) => NPC_FORBIDDEN.includes(z.kind) && zoneContains(z, p.x, p.y)))
      return;
    seen.add(key);
    const area = map.zones.find((z) => z.kind === 'area' && zoneContains(z, p.x, p.y));
    out.push({ key, kind, cell, face, sit, region: regionAt(map, p.x, p.y)?.id, area: area?.id });
  };
  for (let cy = 0; cy < map.height; cy++)
    for (let cx = 0; cx < map.width; cx++) {
      const s = map.sit[cy * map.width + cx] ?? 0;
      if (s) add('seat', { cx, cy }, SIT_DIRS[s - 1] ?? 'down', true);
      // a window in the wall: stand just below it, looking out
      const w = nameAt(cx, cy, 'walls');
      if (w && WINDOW_WALL.test(w) && cy + 1 < map.height && !isSolidCell(map, cx, cy + 1))
        add('window', { cx, cy: cy + 1 }, 'up', false);
      const f = nameAt(cx, cy);
      if (!f) continue;
      const kind: NpcSpotKind | null = COFFEE.test(f)
        ? 'coffee'
        : WATER_EDGE.test(f)
          ? 'water'
          : PLANT.test(f)
            ? 'plant'
            : null;
      if (!kind) continue;
      for (const [dx, dy, face] of NEIGHBOURS) {
        const n = { cx: cx + dx, cy: cy + dy };
        if (n.cx < 0 || n.cy < 0 || n.cx >= map.width || n.cy >= map.height) continue;
        if (isSolidCell(map, n.cx, n.cy) || WATER_EDGE.test(nameAt(n.cx, n.cy) ?? '')) continue;
        add(kind, n, face, false);
        // one place is enough for a plant
        if (kind === 'plant') break;
      }
    }
  return out;
}

/** Stable small hash, so a character keeps "its" desk from day to day. */
export function hashString(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
}

/** A character keeps this far (tiles) from anyone in Busy or Do Not Disturb (P15.3). */
export const NPC_AVOID_TILES = 3;

/** Is a spot within `NPC_AVOID_TILES` of one of these points (people to leave alone)? */
export function spotNear(s: NpcSpot, points: { x: number; y: number }[], tiles = NPC_AVOID_TILES) {
  const x = s.cell.cx * TILE + TILE / 2;
  const y = s.cell.cy * TILE + TILE / 2;
  return points.some((p) => Math.hypot(p.x - x, p.y - y) < tiles * TILE);
}

/**
 * Where an activity takes a character. `taken` holds spot keys used by someone else (people
 * sitting, other characters); `avoid` the positions of people in Busy or Do Not Disturb, whose
 * surroundings it leaves alone (P15.3). Returns null when nothing fits (the caller wanders).
 *  - desk: an open-floor seat in its home region, the same one each day when free; a wing
 *    without open-floor chairs (Zen) means standing somewhere in it
 *  - coffee: the kitchen (counter, fridge, water cooler)
 *  - lounge: a seat in the lounge (`salon`), else any seat in the Atrium
 *  - tea: a seat in the Zen garden, else by its water, else the lounge
 *  - water: the edge of water in its home region, else anywhere
 *  - break: a window or a plant in the wing it is in, else at home, else anywhere
 * `tour`, `wander`, `greet` and `friend` have no spot: the server picks a cell.
 */
export function pickSpot(
  spots: NpcSpot[],
  activity: NpcActivity,
  who: { id: string; home: string; region?: string },
  taken: Set<string>,
  rng: () => number,
  avoid: { x: number; y: number }[] = [],
): NpcSpot | null {
  const ok = (s: NpcSpot) => !taken.has(s.key) && !(avoid.length && spotNear(s, avoid));
  const free = spots.filter(ok);
  const any = (list: NpcSpot[]) => (list.length ? list[Math.floor(rng() * list.length)]! : null);
  const seats = free.filter((s) => s.kind === 'seat');
  switch (activity) {
    case 'desk': {
      const usual = spots.filter(
        (s) => s.kind === 'seat' && s.region === who.home && s.area !== 'salon',
      );
      const first = usual[hashString(who.id) % Math.max(1, usual.length)];
      if (first && ok(first)) return first;
      const mine = seats.filter((s) => s.region === who.home && s.area !== 'salon');
      // a wing without open-floor chairs (the Zen garden's are all in pods): stand somewhere at home
      return (
        any(mine) ??
        any(free.filter((s) => s.region === who.home)) ??
        any(seats.filter((s) => s.region === 'hub' && s.area !== 'salon')) ??
        any(seats)
      );
    }
    case 'coffee':
      return any(free.filter((s) => s.kind === 'coffee'));
    case 'lounge':
      return (
        any(seats.filter((s) => s.area === 'salon')) ?? any(seats.filter((s) => s.region === 'hub'))
      );
    case 'tea':
      // tea in the Zen garden: a seat if there is one, else by the water basin
      return (
        any(seats.filter((s) => s.region === 'zen')) ??
        any(free.filter((s) => s.region === 'zen')) ??
        pickSpot(spots, 'lounge', who, taken, rng, avoid)
      );
    case 'water': {
      const water = free.filter((s) => s.kind === 'water');
      return any(water.filter((s) => s.region === who.home)) ?? any(water);
    }
    case 'break': {
      const views = free.filter((s) => s.kind === 'window' || s.kind === 'plant');
      return (
        any(views.filter((s) => who.region && s.region === who.region)) ??
        any(views.filter((s) => s.region === who.home)) ??
        any(views)
      );
    }
    default:
      return null;
  }
}

/** The cell to walk to in order to leave `from` for `to`: a teleporter pad of this region. */
export function portalFor(map: WorldMap, from: string | undefined, to: string): Cell | null {
  const pads = map.zones.filter((z) => z.kind === 'portal' && z.region === from);
  const pad = pads.find((z) => z.props.to === to) ?? pads[0];
  return pad ? cellOf(map, pad.x + 16, pad.y + 26) : null;
}

// ───────────────────────────────────────────── audience (P15.5, Vincent 2026-10-07)
/**
 * The people who would read a line said by `speaker`: exactly those `chatReaches` allows, like
 * nearby chat. Characters only talk to each other when someone hears them: a line is said only
 * if this is not empty for the speaker, and a chat starts only if someone hears both (see
 * `npcChatHasAudience`). Characters never chat with nobody around, so no decision is spent and
 * nothing is sent.
 */
export function npcAudience(speaker: Placed, people: Placed[]): string[] {
  return people.filter((p) => chatReaches(speaker, p)).map((p) => p.id);
}

/** May two characters start (or keep up) a chat? Only while some person hears both of them. */
export function npcChatHasAudience(a: Placed, b: Placed, people: Placed[]): boolean {
  return people.some((p) => chatReaches(a, p) && chatReaches(b, p));
}
