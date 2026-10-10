/**
 * Pets (ADR-040): shared types and the pure parts of a cat's movement. The server owns every
 * cat (apps/server/src/world/pets.ts); browsers only draw what `pet:state` says. Pathfinding is
 * `findPath` from ./pathfind, so a cat is held to the same walls and pods as an avatar.
 */
import { FEET_W, SPEED_PX, type Dir } from './constants';
import { cellOf, cellPos, collides, isSolidCell, regionAt, type Cell, type WorldMap } from './map';
import { tileDef } from './tileset';
import { POND, SOFA, WINDOW_WALL } from './spot-tiles';
import { findPath } from './pathfind';

export const PET_KINDS = ['office', 'personal'] as const;
export type PetKind = (typeof PET_KINDS)[number];
export const PET_COATS = ['ginger', 'grey', 'black', 'tabby', 'tuxedo', 'calico'] as const;
export type PetCoat = (typeof PET_COATS)[number];
/**
 * What the cat is doing; the art has a sprite per animation (`cat.<coat>.<anim>`). `walk` also
 * covers up and down; `sit` is the front view; `stretch` plays once and the server then sits.
 */
export const PET_ANIMS = ['walk', 'sit', 'loaf', 'sleep', 'drink', 'stretch'] as const;
export type PetAnim = (typeof PET_ANIMS)[number];

/** One cat as every browser draws it. Never carries anything about people. */
export interface PetState {
  id: string;
  kind: PetKind;
  x: number;
  y: number;
  d: Dir;
  a: PetAnim;
  coat: PetCoat;
  /** personal cats only */
  name?: string;
}

/** About 60% of an avatar's speed. */
export const PET_SPEED_PX = SPEED_PX * 0.6;
/** A wandering cat looks at most this many tiles away for its next spot. */
export const PET_WANDER_TILES = 10;
/** How long a cat sits between walks (ms). */
export const PET_REST_MIN_MS = 2000;
export const PET_REST_MAX_MS = 7000;
/** Pathfinding budget for one wander (cells expanded); a cat never searches the whole map. */
export const PET_PATH_NODES = 1500;

/** Facing from a movement vector: the longer axis wins. */
export function dirOfVector(dx: number, dy: number, fallback: Dir = 'down'): Dir {
  if (!dx && !dy) return fallback;
  if (Math.abs(dx) >= Math.abs(dy)) return dx > 0 ? 'right' : 'left';
  return dy > 0 ? 'down' : 'up';
}

/**
 * A random walk target: a free cell within `PET_WANDER_TILES` of `from`, in the same region,
 * with a path to it. `blocked` is the caller's extra rule (pods the cat may not enter).
 * With `prefer`, the reachable candidate with the lowest value wins (a cat exploring picks
 * places it has not been to lately). Returns the path (start exclusive) or null when nothing
 * was reachable in a few tries.
 */
export function planWander(
  map: WorldMap,
  from: Cell,
  rng: () => number,
  blocked?: (x: number, y: number) => boolean,
  tries = 6,
  prefer?: (c: Cell) => number,
): Cell[] | null {
  const region = regionAt(map, ...xy(cellPos(map, from)));
  let best: Cell[] | null = null;
  let bestScore = Infinity;
  for (let i = 0; i < tries; i++) {
    const r = 2 + rng() * (PET_WANDER_TILES - 2);
    const a = rng() * Math.PI * 2;
    const goal = {
      cx: Math.round(from.cx + Math.cos(a) * r),
      cy: Math.round(from.cy + Math.sin(a) * r),
    };
    if (goal.cx < 0 || goal.cy < 0 || goal.cx >= map.width || goal.cy >= map.height) continue;
    const g = cellPos(map, goal);
    if (collides(map, g.x, g.y) || blocked?.(g.x, g.y)) continue;
    if (region && regionAt(map, g.x, g.y)?.id !== region.id) continue;
    const path = findPath(map, from, goal, blocked, PET_PATH_NODES);
    if (!path || !path.length) continue;
    if (!prefer) return path;
    const score = prefer(goal);
    if (score < bestScore) {
      best = path;
      bestScore = score;
    }
  }
  return best;
}

const xy = (p: { x: number; y: number }): [number, number] => [p.x, p.y];

/**
 * Advance `pos` toward the first cell of `path` by `dt` seconds at `speed`. Reached cells are
 * dropped from `path`; the cell to step into must pass `walkable` (walls, pods) or the walk
 * stops and `stopped` is true so the caller can pick something else.
 */
export function stepAlong(
  map: WorldMap,
  pos: { x: number; y: number },
  path: Cell[],
  dt: number,
  walkable: (x: number, y: number) => boolean,
  speed = PET_SPEED_PX,
): { x: number; y: number; d?: Dir; stopped: boolean } {
  let { x, y } = pos;
  let d: Dir | undefined;
  let left = speed * dt;
  while (left > 0 && path.length) {
    const t = cellPos(map, path[0]!);
    if (!walkable(t.x, t.y)) return { x, y, d, stopped: true };
    const dx = t.x - x;
    const dy = t.y - y;
    const dist = Math.hypot(dx, dy);
    d = dirOfVector(dx, dy, d);
    if (dist <= left) {
      x = t.x;
      y = t.y;
      left -= dist;
      path.shift();
    } else {
      x += (dx / dist) * left;
      y += (dy / dist) * left;
      left = 0;
    }
  }
  return { x, y, d, stopped: false };
}

/** The cell a cat stands in (feet position). */
export const petCell = (map: WorldMap, p: { x: number; y: number }): Cell => cellOf(map, p.x, p.y);

// ───────────────────────────────────────────── needs (P14.4)
/** 0 = content, 1 = desperate. */
export const PET_NEEDS = ['thirst', 'energy', 'curiosity', 'affection'] as const;
export type PetNeed = (typeof PET_NEEDS)[number];
export type PetNeeds = Record<PetNeed, number>;
/** Per-cat personality: how much each need counts (1 = average). */
export type PetWeights = Record<PetNeed, number>;

export const freshNeeds = (): PetNeeds => ({
  thirst: 0.2,
  energy: 0.1,
  curiosity: 0.3,
  affection: 0.2,
});

/** Same cat, same character: weights from a seed (0.7 to 1.3 per need). */
export function weightsFor(seed: number): PetWeights {
  let s = seed >>> 0 || 1;
  const next = () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 2 ** 32;
  };
  return {
    thirst: 0.7 + next() * 0.6,
    energy: 0.7 + next() * 0.6,
    curiosity: 0.7 + next() * 0.6,
    affection: 0.7 + next() * 0.6,
  };
}

export type PetMode = 'walk' | 'rest';
/** Urgency gained per second: thirst always, energy while walking, curiosity sitting still, affection always. */
export const NEED_GROWTH: Record<PetMode, PetNeeds> = {
  walk: { thirst: 1 / 540, energy: 1 / 120, curiosity: 0, affection: 1 / 300 },
  rest: { thirst: 1 / 540, energy: 1 / 1200, curiosity: 1 / 150, affection: 1 / 300 },
};

/** Advance every need by `dt` seconds spent in `mode`, minus what an activity gives back per second. */
export function tickNeeds(
  needs: PetNeeds,
  dt: number,
  mode: PetMode,
  relief: Partial<PetNeeds> = {},
): PetNeeds {
  const g = NEED_GROWTH[mode];
  const out = { ...needs };
  for (const n of PET_NEEDS)
    out[n] = Math.min(1, Math.max(0, needs[n] + (g[n] - (relief[n] ?? 0)) * dt));
  return out;
}

// ───────────────────────────────────────────── spots (P14.4)
/** What a place is good for. */
export const PET_SPOT_KINDS = ['drink', 'sleep', 'loaf', 'perch'] as const;
export type PetSpotKind = (typeof PET_SPOT_KINDS)[number];

/** A place a cat can use: where to stand to get there, and where it ends up. */
export interface PetSpot {
  /** stable id, kind + cell + approach (same place gives the same key across rebuilds) */
  key: string;
  kind: PetSpotKind;
  /** the walkable cell the cat walks to first */
  from: Cell;
  /** feet position while using the spot (equal to `from`'s centre for floor spots) */
  x: number;
  y: number;
  /** which way it faces (side views only) */
  face: 'left' | 'right';
  /** the cell the spot belongs to (the bowl, the sofa, the desk); a cat on it is "perched" */
  cell: Cell;
  /** true when the cat ends up on top of something solid (sofa, desk) */
  perch: boolean;
}

/** The need each kind of spot answers, how urgent it must be before the cat cares, and how much it is worth. */
export const SPOT_RULES: Record<PetSpotKind, { need: PetNeed; min: number; weight: number }> = {
  drink: { need: 'thirst', min: 0.35, weight: 1.4 },
  sleep: { need: 'energy', min: 0.55, weight: 1.2 },
  loaf: { need: 'energy', min: 0.3, weight: 0.8 },
  perch: { need: 'curiosity', min: 0.3, weight: 1.0 },
};

/** What a cat does at a spot: animation, how long (s), and what it gives back per second. */
export const ACTIVITY: Record<
  PetSpotKind,
  { anim: PetAnim; seconds: [number, number]; relief: Partial<PetNeeds> }
> = {
  drink: { anim: 'drink', seconds: [5, 8], relief: { thirst: 0.2 } },
  sleep: { anim: 'sleep', seconds: [25, 50], relief: { energy: 0.04 } },
  loaf: { anim: 'loaf', seconds: [12, 25], relief: { energy: 0.02 } },
  perch: { anim: 'sit', seconds: [8, 16], relief: { curiosity: 0.08 } },
};

/** A choice the cat weighs: a spot, wandering anywhere, or exploring somewhere new. */
export type PetOption =
  { kind: PetSpotKind; spot: PetSpot; dist: number } | { kind: 'wander' | 'explore'; dist: number };

/** Distance (tiles) at which a spot's score halves. */
export const SCORE_TILES = 6;
/** What wandering is worth when nothing is needed. */
export const WANDER_BASE = 0.14;
/** Exploring beats wandering as curiosity grows. */
export const EXPLORE_WEIGHT = 0.9;

/** score = need × weight / (1 + distance) + jitter; not worth considering (-Infinity) below the spot's minimum need. */
export function scoreOption(
  needs: PetNeeds,
  weights: PetWeights,
  opt: PetOption,
  jitter: number,
): number {
  if (opt.kind === 'wander') return WANDER_BASE + jitter;
  if (opt.kind === 'explore')
    return (
      (needs.curiosity * weights.curiosity * EXPLORE_WEIGHT) / (1 + opt.dist / SCORE_TILES) + jitter
    );
  const r = SPOT_RULES[opt.kind];
  if (needs[r.need] < r.min) return -Infinity;
  return (needs[r.need] * weights[r.need] * r.weight) / (1 + opt.dist / SCORE_TILES) + jitter;
}

/** The best option; `rng` supplies the jitter that keeps a cat from looking like a machine. */
export function chooseOption(
  needs: PetNeeds,
  weights: PetWeights,
  options: PetOption[],
  rng: () => number,
): PetOption | null {
  let best: PetOption | null = null;
  let bestScore = -Infinity;
  for (const o of options) {
    const sc = scoreOption(needs, weights, o, (rng() - 0.5) * 0.12);
    if (sc > bestScore) {
      best = o;
      bestScore = sc;
    }
  }
  return best;
}

// ───────────────────────────────────────────── finding spots (P14.4)
/** Bases a cat may sit on top of (desk and table tops); monitors and counters are left alone. */
const PERCH_SKIP = new Set(['deskMonitor', 'deskMonitorBack', 'counter']);
/** Seat height of a sofa, px from the cell top. */
const SOFA_SEAT = 22;

/**
 * Every place the cat can use on this map, found from tile names alone (so a map the players
 * built works as well as the generated one): bowls and pond edges to drink, sofas, the hearth and
 * zabuton to sleep, the floor under a window to loaf, desk and table tops to perch on.
 * Pure and shared; the server caches the result per map revision.
 */
export function petSpots(map: WorldMap): PetSpot[] {
  const out: PetSpot[] = [];
  const T = map.tile;
  const nameAt = (layer: string, cx: number, cy: number): string | undefined => {
    if (cx < 0 || cy < 0 || cx >= map.width || cy >= map.height) return undefined;
    const g = map.layers[layer]?.[cy * map.width + cx];
    return g ? tileDef(g)?.base : undefined;
  };
  const free = (cx: number, cy: number) => !isSolidCell(map, cx, cy);
  const propIn = new Set(map.props.map((p) => `${Math.floor(p.x / T)},${Math.floor(p.y / T)}`));
  const add = (
    kind: PetSpotKind,
    cell: Cell,
    from: Cell,
    face: 'left' | 'right',
    pos: { x: number; y: number },
    perch: boolean,
  ) =>
    out.push({
      key: `${kind}:${cell.cx},${cell.cy}:${from.cx},${from.cy}`,
      kind,
      from,
      x: pos.x,
      y: pos.y,
      face,
      cell,
      perch,
    });
  const centre = (c: Cell) => cellPos(map, c);
  /** how far toward the water a drinking cat leans, so that its head hangs over it */
  const LEAN = T / 2 - FEET_W / 2;

  for (let cy = 0; cy < map.height; cy++) {
    for (let cx = 0; cx < map.width; cx++) {
      const cell = { cx, cy };
      const f = nameAt('furniture', cx, cy);
      const w = nameAt('walls', cx, cy);
      if (f === 'waterBowl' && free(cx, cy)) {
        const c = centre(cell);
        add('drink', cell, cell, 'right', { x: c.x - LEAN, y: c.y }, false);
      }
      if (f && POND.test(f)) {
        // side view only: a cat drinks from the east or west bank
        for (const [dx, face] of [
          [-1, 'right'],
          [1, 'left'],
        ] as const) {
          const from = { cx: cx + dx, cy };
          if (!free(from.cx, from.cy) || nameAt('furniture', from.cx, from.cy)?.match(POND))
            continue;
          const c = centre(from);
          add('drink', cell, from, face, { x: c.x - dx * LEAN, y: c.y }, false);
        }
      }
      if (f && SOFA.test(f)) {
        const below = { cx, cy: cy + 1 };
        if (free(below.cx, below.cy))
          add(
            'sleep',
            cell,
            below,
            cx % 2 ? 'left' : 'right',
            { x: cx * T + T / 2, y: cy * T + SOFA_SEAT },
            true,
          );
      }
      if (f === 'fireplace' && free(cx, cy + 1))
        add(
          'sleep',
          cell,
          { cx, cy: cy + 1 },
          cx % 2 ? 'left' : 'right',
          centre({ cx, cy: cy + 1 }),
          false,
        );
      if (f === 'zabuton' && free(cx, cy)) add('sleep', cell, cell, 'right', centre(cell), false);
      if (w && WINDOW_WALL.test(w) && free(cx, cy + 1))
        add(
          'loaf',
          cell,
          { cx, cy: cy + 1 },
          cx % 2 ? 'left' : 'right',
          centre({ cx, cy: cy + 1 }),
          false,
        );
      if (f && !PERCH_SKIP.has(f) && !propIn.has(`${cx},${cy}`)) {
        const def = map.layers.furniture?.[cy * map.width + cx];
        const surface = def ? tileDef(def)?.surface : undefined;
        if (surface !== undefined) {
          for (const [dx, dy] of [
            [0, 1],
            [-1, 0],
            [1, 0],
            [0, -1],
          ] as const) {
            const from = { cx: cx + dx, cy: cy + dy };
            if (!free(from.cx, from.cy)) continue;
            add(
              'perch',
              cell,
              from,
              dx > 0 ? 'left' : 'right',
              { x: cx * T + T / 2, y: cy * T + surface },
              true,
            );
            break;
          }
        }
      }
    }
  }
  return out;
}
