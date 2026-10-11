/**
 * Caves behind cave mouths (ADR-053, P17.32). A mouth is a decor cell of a personal world's terrain
 * (`cave_mouth`, terrain.ts). Stepping on it opens the cave under it: a room of its own, with its
 * own SFU room and its own nearby chat, so nobody outside the cave hears or sees anyone inside.
 *
 * A cave is a pure function of (world seed, cave id): a 64 x 64 cellular-automata map closed by
 * rock, one connected region reached from the exit, with ores by depth. The server and the browser
 * run this same code, so they agree on every cell without sending it.
 */
import { WORLD_SPAWN, type PortalRect } from '../portals';
import { CHUNK_SIZE, WORLD_CELL_PX } from './constants';
import { WorldTerrain, type WorldTerrainOptions } from './cells';
import type { WorldGenParams } from './gen';
import { hash32, hashCell, hashUnit } from './noise';
import { CAVE_MOUTH_BLOCK, chunkIndex, type Chunk } from './terrain';

/** Cells per side of a cave: two chunks, so a cave is a 2 x 2 block of chunks. */
export const CAVE_SIZE = 64;
export const CAVE_PREFIX = 'cave:';
export const CAVE_FLOOR_BLOCK = 'cave_floor';
export const CAVE_ROCK_BLOCK = 'cave_rock';
/** Floor cells stand at level 1 and rock at level 4: the rock is a wall the walker cannot climb. */
const FLOOR_LEVEL = 1;
const ROCK_LEVEL = 4;

/** What a cave cell is. Ores are floor cells with an ore decor on top. */
export const CAVE_KIND = { rock: 0, floor: 1, copper: 2, iron: 3, gold: 4 } as const;
export type CaveKind = (typeof CAVE_KIND)[keyof typeof CAVE_KIND];

/** Where the way out is, in cave cells: the mouth pad, and the cell a visitor arrives on. */
export const CAVE_EXIT = { x: CAVE_SIZE / 2, y: CAVE_SIZE - 4 } as const;
export const CAVE_ARRIVAL = { x: CAVE_EXIT.x, y: CAVE_EXIT.y - 2 } as const;
/** The corridor carved north from the exit, so the map always opens onto the mouth. */
const CORRIDOR = 6;
/** Initial rock share and smoothing steps of the cellular automaton. */
const ROCK_SHARE = 0.46;
const SMOOTH_STEPS = 4;
/** Ores need this much depth from the exit, so the way in stays clear. */
const ORE_MIN_DEPTH = 4;
/** Ore by depth band (depth / deepest): the share of eligible cells that get the ore. */
const ORE_BANDS: readonly { below: number; kind: CaveKind; block: string; density: number }[] = [
  { below: 0.34, kind: CAVE_KIND.copper, block: 'ore_copper', density: 0.05 },
  { below: 0.67, kind: CAVE_KIND.iron, block: 'ore_iron', density: 0.04 },
  { below: Infinity, kind: CAVE_KIND.gold, block: 'ore_gold', density: 0.03 },
];

/**
 * A cave id names the world it opens from and the mouth cell it is behind: `cave:<worldId>:<x>_<y>`.
 * The world id is a UUID (or a test id); the cell is in the world's cells, so it may be negative.
 */
const CAVE_ID = /^cave:([a-z0-9-]{1,40}):(-?\d{1,7})_(-?\d{1,7})$/;

export interface CaveRef {
  readonly worldId: string;
  /** the mouth cell in the world's cells */
  readonly mouthX: number;
  readonly mouthY: number;
}

/** The cave id behind the mouth at cell (x, y) of a world. */
export function caveIdOf(worldId: string, x: number, y: number): string {
  return `${CAVE_PREFIX}${worldId}:${x}_${y}`;
}

/** The world and the mouth a cave id names, or null for any other id. */
export function parseCaveId(id: string): CaveRef | null {
  const m = CAVE_ID.exec(id);
  if (!m) return null;
  return { worldId: m[1]!, mouthX: Number(m[2]), mouthY: Number(m[3]) };
}

export function isCaveId(id: string): boolean {
  return CAVE_ID.test(id);
}

/** The pad a visitor steps on to come back out, as a rectangle in the cave's pixels. */
export function caveExitRect(): PortalRect {
  return {
    x: CAVE_EXIT.x * WORLD_CELL_PX,
    y: CAVE_EXIT.y * WORLD_CELL_PX,
    w: WORLD_CELL_PX,
    h: WORLD_CELL_PX,
  };
}

/** The feet point of a cell, as a world's spawn is placed in it (the same offset as `WORLD_SPAWN`). */
export function cellFeet(cx: number, cy: number): { x: number; y: number } {
  return { x: cx * WORLD_CELL_PX + WORLD_SPAWN.x, y: cy * WORLD_CELL_PX + WORLD_SPAWN.y };
}

/** A generated cave: the kind of every cell, and the depth of each floor cell from the exit. */
export interface CaveMap {
  readonly kind: Uint8Array;
  readonly depth: Int16Array;
  readonly maxDepth: number;
}

/** The seed of one cave: the world's seed and the cave's id, so every cave differs. */
function caveSeedOf(seed: number, caveId: string): number {
  return hashCell(seed, hash32(caveId), 0x5e11);
}

const rockOutside = (x: number, y: number) => x < 0 || y < 0 || x >= CAVE_SIZE || y >= CAVE_SIZE;

/** Rock cells among the eight around (x, y); outside the map counts as rock. */
function rocksAround(rock: Uint8Array, x: number, y: number): number {
  let n = 0;
  for (let dy = -1; dy <= 1; dy++)
    for (let dx = -1; dx <= 1; dx++) {
      if (dx === 0 && dy === 0) continue;
      const nx = x + dx;
      const ny = y + dy;
      n += rockOutside(nx, ny) ? 1 : rock[ny * CAVE_SIZE + nx]!;
    }
  return n;
}

/** Floor cells reached from `start` over four-way steps (true where reached). */
function reachFrom(open: Uint8Array, sx: number, sy: number): Uint8Array {
  const seen = new Uint8Array(CAVE_SIZE * CAVE_SIZE);
  const queue = new Int32Array(CAVE_SIZE * CAVE_SIZE);
  let head = 0;
  let tail = 0;
  const start = sy * CAVE_SIZE + sx;
  seen[start] = 1;
  queue[tail++] = start;
  while (head < tail) {
    const i = queue[head++]!;
    const x = i % CAVE_SIZE;
    const y = (i - x) / CAVE_SIZE;
    for (const [nx, ny] of [
      [x + 1, y],
      [x - 1, y],
      [x, y + 1],
      [x, y - 1],
    ] as const) {
      if (rockOutside(nx, ny)) continue;
      const j = ny * CAVE_SIZE + nx;
      if (open[j] && !seen[j]) {
        seen[j] = 1;
        queue[tail++] = j;
      }
    }
  }
  return seen;
}

/** Build the cave of one seed: smooth rock, carve the corridor, keep what the exit reaches, add ores. */
function buildCave(caveSeed: number): CaveMap {
  const N = CAVE_SIZE;
  let rock = new Uint8Array(N * N);
  for (let y = 0; y < N; y++)
    for (let x = 0; x < N; x++) {
      const border = x === 0 || y === 0 || x === N - 1 || y === N - 1;
      rock[y * N + x] = border || hashUnit(caveSeed, x, y) < ROCK_SHARE ? 1 : 0;
    }
  for (let step = 0; step < SMOOTH_STEPS; step++) {
    const next = new Uint8Array(N * N);
    for (let y = 0; y < N; y++)
      for (let x = 0; x < N; x++) {
        const n = rocksAround(rock, x, y);
        const i = y * N + x;
        next[i] = n >= 5 ? 1 : n <= 3 ? 0 : rock[i]!;
      }
    rock = next;
  }
  for (let y = CAVE_EXIT.y - CORRIDOR; y <= CAVE_EXIT.y; y++)
    for (let x = CAVE_EXIT.x - 1; x <= CAVE_EXIT.x + 1; x++) rock[y * N + x] = 0;

  // one region: what the arrival cell reaches; the rest is closed off as rock
  const open = new Uint8Array(N * N);
  for (let i = 0; i < N * N; i++) open[i] = rock[i] ? 0 : 1;
  const reach = reachFrom(open, CAVE_ARRIVAL.x, CAVE_ARRIVAL.y);
  const kind = new Uint8Array(N * N);
  for (let i = 0; i < N * N; i++) kind[i] = reach[i] ? CAVE_KIND.floor : CAVE_KIND.rock;

  // depth from the exit over floor cells (breadth first, four-way)
  const depth = new Int16Array(N * N).fill(-1);
  const queue = new Int32Array(N * N);
  let head = 0;
  let tail = 0;
  const exit = CAVE_EXIT.y * N + CAVE_EXIT.x;
  depth[exit] = 0;
  queue[tail++] = exit;
  let maxDepth = 0;
  while (head < tail) {
    const i = queue[head++]!;
    const x = i % N;
    const y = (i - x) / N;
    maxDepth = Math.max(maxDepth, depth[i]!);
    for (const [nx, ny] of [
      [x + 1, y],
      [x - 1, y],
      [x, y + 1],
      [x, y - 1],
    ] as const) {
      if (rockOutside(nx, ny)) continue;
      const j = ny * N + nx;
      if (kind[j] === CAVE_KIND.floor && depth[j] === -1) {
        depth[j] = depth[i]! + 1;
        queue[tail++] = j;
      }
    }
  }

  // ores: only where all eight neighbours are floor and no ore is among them, so no two ores touch
  // and walking around any ore keeps the cave connected (checked in caves.test.ts)
  const oreSeed = hashCell(caveSeed, 0x0be, 0x21);
  for (let y = 1; y < N - 1; y++)
    for (let x = 1; x < N - 1; x++) {
      const i = y * N + x;
      const d = depth[i]!;
      if (kind[i] !== CAVE_KIND.floor || d < ORE_MIN_DEPTH) continue;
      let clear = true;
      for (let dy = -1; dy <= 1 && clear; dy++)
        for (let dx = -1; dx <= 1 && clear; dx++)
          if (kind[(y + dy) * N + x + dx] !== CAVE_KIND.floor) clear = false;
      if (!clear) continue;
      const band = ORE_BANDS.find((b) => d / maxDepth < b.below)!;
      if (hashUnit(oreSeed, x, y) < band.density) kind[i] = band.kind;
    }
  return { kind, depth, maxDepth };
}

const MAPS = new Map<string, CaveMap>();
const MAP_CAPACITY = 16;

/** The map of a cave, built once per (seed, cave id) and kept while recently used. */
export function caveMapFor(seed: number, caveId: string): CaveMap {
  const key = `${seed}|${caveId}`;
  const hit = MAPS.get(key);
  if (hit) {
    MAPS.delete(key);
    MAPS.set(key, hit);
    return hit;
  }
  const map = buildCave(caveSeedOf(seed, caveId));
  MAPS.set(key, map);
  if (MAPS.size > MAP_CAPACITY) {
    const oldest = MAPS.keys().next().value;
    if (oldest !== undefined) MAPS.delete(oldest);
  }
  return map;
}

/** The ore block of a cave kind, or '' for rock and plain floor. */
function oreOf(kind: number): string {
  return ORE_BANDS.find((b) => b.kind === kind)?.block ?? '';
}

/**
 * A 32 x 32 chunk of a cave, in the cave's own cells (the chunk at (0, 0) starts at cell 0, 0).
 * Cells outside the map are rock, so the cave is closed on every side.
 */
export function caveChunk(seed: number, caveId: string, cx: number, cy: number): Chunk {
  const map = caveMapFor(seed, caveId);
  const count = CHUNK_SIZE * CHUNK_SIZE;
  const level = new Uint8Array(count);
  const block: string[] = new Array<string>(count).fill(CAVE_ROCK_BLOCK);
  const decor: string[] = new Array<string>(count).fill('');
  for (let j = 0; j < CHUNK_SIZE; j++)
    for (let i = 0; i < CHUNK_SIZE; i++) {
      const x = cx * CHUNK_SIZE + i;
      const y = cy * CHUNK_SIZE + j;
      const k = chunkIndex(i, j);
      const kind = rockOutside(x, y) ? CAVE_KIND.rock : map.kind[y * CAVE_SIZE + x]!;
      if (kind === CAVE_KIND.rock) {
        level[k] = ROCK_LEVEL;
        continue;
      }
      level[k] = FLOOR_LEVEL;
      block[k] = CAVE_FLOOR_BLOCK;
      decor[k] = x === CAVE_EXIT.x && y === CAVE_EXIT.y ? CAVE_MOUTH_BLOCK : oreOf(kind);
    }
  return { cx, cy, level, block, decor };
}

/**
 * Terrain of a world room: the generated terrain of a world, or the cave's map when the id is a
 * cave id. The seed is the world's seed in both cases, so a cave belongs to its world.
 */
export function worldTerrainFor(
  worldId: string,
  seed: number,
  params: WorldGenParams,
  options: WorldTerrainOptions = {},
): WorldTerrain {
  if (!isCaveId(worldId)) return new WorldTerrain(seed, params, options);
  return new WorldTerrain(seed, params, {
    ...options,
    source: (cx, cy) => caveChunk(seed, worldId, cx, cy),
  });
}
