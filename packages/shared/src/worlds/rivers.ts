/**
 * Rivers (ADR-053). Water runs downhill from hashed sources until it reaches the sea or a lake.
 *
 * A trace starts at a source cell and steps to the lowest of its 8 neighbours while that
 * neighbour is lower than the current cell (steepest descent, strictly decreasing, so no loops).
 * It ends in the sea (elevation below the sea level) or at a local minimum, which becomes a
 * lake: the land cells around the minimum (within lakeRadius) that stay below the minimum plus
 * lakeRise. A trace that does not finish within maxSteps is dropped everywhere, so only complete
 * traces are ever carved.
 *
 * Traces depend only on world coordinates, never on the region asking, so a region computes its
 * river cells from every source within `riverMargin` of it and two neighbouring regions agree on
 * every shared cell. Regions are RIVER_REGION_CHUNKS x RIVER_REGION_CHUNKS chunks, cached. The
 * tuning is in worldgen.json (`params.rivers`).
 */
import { CHUNK_SIZE } from './constants';
import { elevationAt, seedsOf, type TerrainSeeds } from './fields';
import type { RiverParams, WorldGenParams } from './gen';
import { hashUnit } from './noise';

export const RIVER_REGION_CHUNKS = 8;
export const RIVER_REGION_CELLS = RIVER_REGION_CHUNKS * CHUNK_SIZE;

export const NO_RIVER = 0;
export const RIVER_FLOW = 1;
export const RIVER_LAKE = 2;

/** Cells of one river region, row-major: index `j * RIVER_REGION_CELLS + i` for local (i, j). */
export interface RiverRegion {
  readonly rx: number;
  readonly ry: number;
  readonly cells: Uint8Array;
}

const NEIGHBOURS: readonly (readonly [number, number])[] = [
  [1, 0],
  [1, 1],
  [0, 1],
  [-1, 1],
  [-1, 0],
  [-1, -1],
  [0, -1],
  [1, -1],
];

/** How far (cells) a source can be from a region and still reach it: a trace plus its lake. */
export function riverMargin(rivers: RiverParams): number {
  return rivers.maxSteps + rivers.lakeRadius;
}

/** Memo keys pack (x, y) into one exact integer: both coordinates stay within +-2^21. */
const KEY_OFFSET = 1 << 21;
const KEY_STRIDE = 1 << 22;

function keyOf(x: number, y: number): number {
  return (x + KEY_OFFSET) * KEY_STRIDE + (y + KEY_OFFSET);
}

/** Elevation of world cells, memoised for one region build (traces overlap heavily). */
class ElevationField {
  private readonly memo = new Map<number, number>();
  private readonly seeds: TerrainSeeds;
  private readonly params: WorldGenParams;

  constructor(seed: number, params: WorldGenParams) {
    this.seeds = seedsOf(seed);
    this.params = params;
  }

  at(x: number, y: number): number {
    const key = keyOf(x, y);
    const known = this.memo.get(key);
    if (known !== undefined) return known;
    const e = elevationAt(this.seeds, x, y, this.params);
    this.memo.set(key, e);
    return e;
  }
}

interface Trace {
  /** Flattened (x, y) pairs of the land cells the river runs over, source first. */
  readonly path: number[];
  /** Where the trace ends: the sea, or a lake around the local minimum (lowX, lowY). */
  readonly end: 'sea' | 'lake';
  readonly lowX: number;
  readonly lowY: number;
}

function traceFrom(field: ElevationField, sea: number, maxSteps: number, sx: number, sy: number): Trace | null {
  const path: number[] = [];
  let x = sx;
  let y = sy;
  let e = field.at(x, y);
  for (let step = 0; step <= maxSteps; step++) {
    if (e < sea) return { path, end: 'sea', lowX: x, lowY: y };
    let bx = 0;
    let by = 0;
    let best = e;
    for (const [dx, dy] of NEIGHBOURS) {
      const ne = field.at(x + dx, y + dy);
      if (ne < best) {
        best = ne;
        bx = dx;
        by = dy;
      }
    }
    path.push(x, y);
    if (bx === 0 && by === 0) return { path, end: 'lake', lowX: x, lowY: y };
    x += bx;
    y += by;
    e = best;
  }
  return null;
}

/** Land cells of the lake around (lowX, lowY): connected, within lakeRadius, below the rim. */
function lakeCells(field: ElevationField, sea: number, rivers: RiverParams, lowX: number, lowY: number): number[] {
  const rim = field.at(lowX, lowY) + rivers.lakeRise;
  const radius = rivers.lakeRadius;
  const seen = new Set<number>([keyOf(lowX, lowY)]);
  const queue: [number, number][] = [[lowX, lowY]];
  const out: number[] = [];
  for (let head = 0; head < queue.length; head++) {
    const [x, y] = queue[head] ?? [lowX, lowY];
    out.push(x, y);
    for (const [dx, dy] of NEIGHBOURS) {
      const nx = x + dx;
      const ny = y + dy;
      if (Math.abs(nx - lowX) > radius || Math.abs(ny - lowY) > radius) continue;
      const k = keyOf(nx, ny);
      if (seen.has(k)) continue;
      const e = field.at(nx, ny);
      if (e >= sea && e < rim) {
        seen.add(k);
        queue.push([nx, ny]);
      }
    }
  }
  return out;
}

/** Build the river cells of one region from every source that can reach it. Pure and repeatable. */
export function buildRiverRegion(seed: number, rx: number, ry: number, params: WorldGenParams): RiverRegion {
  const rivers = params.rivers;
  const seeds = seedsOf(seed);
  const field = new ElevationField(seed, params);
  const sea = params.seaElevation;
  const size = RIVER_REGION_CELLS;
  const cells = new Uint8Array(size * size);
  const x0 = rx * size;
  const y0 = ry * size;
  const margin = riverMargin(rivers);
  const xlo = x0 - margin;
  const xhi = x0 + size - 1 + margin;
  const ylo = y0 - margin;
  const yhi = y0 + size - 1 + margin;
  const grid = rivers.sourceGrid;

  const mark = (x: number, y: number, value: number) => {
    const i = x - x0;
    const j = y - y0;
    if (i < 0 || j < 0 || i >= size || j >= size) return;
    const k = j * size + i;
    if ((cells[k] ?? 0) < value) cells[k] = value;
  };

  for (let bi = Math.floor(xlo / grid) - 1; bi <= Math.floor(xhi / grid) + 1; bi++) {
    for (let bj = Math.floor(ylo / grid) - 1; bj <= Math.floor(yhi / grid) + 1; bj++) {
      const sx = bi * grid + Math.floor(hashUnit(seeds.river, bi * 4, bj) * grid);
      const sy = bj * grid + Math.floor(hashUnit(seeds.river, bi * 4 + 1, bj) * grid);
      if (sx < xlo || sx > xhi || sy < ylo || sy > yhi) continue;
      if (hashUnit(seeds.river, bi * 4 + 2, bj) >= rivers.sourceChance) continue;
      if (field.at(sx, sy) < sea + rivers.sourceHeight) continue;
      const trace = traceFrom(field, sea, rivers.maxSteps, sx, sy);
      if (!trace) continue;
      for (let p = 0; p < trace.path.length; p += 2) {
        mark(trace.path[p] ?? 0, trace.path[p + 1] ?? 0, RIVER_FLOW);
      }
      if (trace.end === 'lake') {
        const lake = lakeCells(field, sea, rivers, trace.lowX, trace.lowY);
        for (let p = 0; p < lake.length; p += 2) mark(lake[p] ?? 0, lake[p + 1] ?? 0, RIVER_LAKE);
      }
    }
  }
  return { rx, ry, cells };
}

const CACHE_LIMIT = 64;
const cache = new Map<string, RiverRegion>();

/** The river region (rx, ry) for a world, cached. Keyed by everything elevation and rivers depend on. */
export function riverRegion(seed: number, rx: number, ry: number, params: WorldGenParams): RiverRegion {
  const key = `${seed}|${rx}|${ry}|${JSON.stringify([params.elevation, params.seaElevation, params.rivers])}`;
  const hit = cache.get(key);
  if (hit) {
    cache.delete(key);
    cache.set(key, hit);
    return hit;
  }
  const region = buildRiverRegion(seed, rx, ry, params);
  cache.set(key, region);
  if (cache.size > CACHE_LIMIT) {
    const oldest = cache.keys().next().value;
    if (oldest !== undefined) cache.delete(oldest);
  }
  return region;
}

/** River state of one world cell: NO_RIVER, RIVER_FLOW or RIVER_LAKE. */
export function riverAt(seed: number, x: number, y: number, params: WorldGenParams): number {
  const rx = Math.floor(x / RIVER_REGION_CELLS);
  const ry = Math.floor(y / RIVER_REGION_CELLS);
  const region = riverRegion(seed, rx, ry, params);
  const i = x - rx * RIVER_REGION_CELLS;
  const j = y - ry * RIVER_REGION_CELLS;
  return region.cells[j * RIVER_REGION_CELLS + i] ?? NO_RIVER;
}
