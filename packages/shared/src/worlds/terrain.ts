/**
 * Base terrain of a personal world (ADR-053): a pure function of (seed, cell coordinates,
 * params, biome registry). Chunks are 32 x 32 cells generated from it, so any two clients or
 * the server produce the same cells. Stored deltas are applied on top later (P17.7).
 *
 * Rules, in order: elevation below `seaElevation` is water; a river cell (rivers.ts) is water;
 * land within `beachWidth` above the sea is sand; otherwise the biome whose blend weight wins
 * the dither takes the surface (its alpine block above `alpineElevation`); decor is one hashed
 * draw per cell against the biome's densities.
 */
import { biomeWeights, pickBiome } from './biomes';
import { CHUNK_SIZE } from './constants';
import { elevationAt, layer01, levelOf, seedsOf, type TerrainSeeds } from './fields';
import type { WorldGenParams } from './gen';
import { hash32, hashUnit } from './noise';
import { NO_RIVER, RIVER_REGION_CELLS, RIVER_REGION_CHUNKS, riverAt, riverRegion } from './rivers';
import { WORLD_BIOMES, type WorldBiome, type WorldBiomeRegistry } from './registry';

export { levelOf } from './fields';

export const WATER_BLOCK = 'water';
export const BEACH_BLOCK = 'sand';
/** The decor of a cave mouth: a walkable doorway onto a cave (caves.ts, P17.32). */
export const CAVE_MOUTH_BLOCK = 'cave_mouth';

/** Decor for a biome from one unit draw: the densities are cumulative thresholds. '' for none. */
export function pickDecor(biome: WorldBiome, u: number): string {
  let acc = 0;
  for (const entry of biome.decor) {
    acc += entry.density;
    if (u < acc) return entry.block;
  }
  return '';
}

export interface BaseCell {
  /** Terrain level 0..LEVEL_MAX. Water cells sit on the seabed level. */
  readonly level: number;
  /** Top block id. */
  readonly block: string;
  /** Decor block id, or '' for none. */
  readonly decor: string;
}

function cellWith(
  seeds: TerrainSeeds,
  x: number,
  y: number,
  params: WorldGenParams,
  biomes: WorldBiomeRegistry,
  river: number,
): BaseCell {
  const elevation = elevationAt(seeds, x, y, params);
  const level = levelOf(elevation);
  if (elevation < params.seaElevation || river !== NO_RIVER) {
    return { level, block: WATER_BLOCK, decor: '' };
  }
  if (elevation < params.seaElevation + params.beachWidth) {
    return { level, block: BEACH_BLOCK, decor: '' };
  }
  const temperature = layer01(seeds.temperature, x, y, params.temperature);
  const humidity = layer01(seeds.humidity, x, y, params.humidity);
  const weights = biomeWeights(temperature, humidity, biomes);
  const biome = biomes.list[pickBiome(weights, hashUnit(seeds.biome, x, y))];
  if (!biome) throw new Error('biome registry is empty');
  if (elevation >= params.alpineElevation && biome.alpine) {
    return { level, block: biome.alpine, decor: '' };
  }
  if (isCaveMouth(seeds, x, y, params)) return { level, block: biome.surface, decor: CAVE_MOUTH_BLOCK };
  const decor = pickDecor(biome, hashUnit(seeds.decor, x, y));
  return { level, block: biome.surface, decor };
}

/**
 * A cave mouth: one hashed draw per land cell outside the starter clearing, against the chance in
 * `params.caves`. Worlds with no `caves` params (genVersion 1) have none, so their terrain is the same.
 */
function isCaveMouth(seeds: TerrainSeeds, x: number, y: number, params: WorldGenParams): boolean {
  const caves = params.caves;
  if (!caves || caves.mouthChance <= 0) return false;
  if (Math.max(Math.abs(x), Math.abs(y)) <= caves.clearRadius) return false;
  return hashUnit(seeds.cave, x, y) < caves.mouthChance;
}

/** Base terrain of one world cell. For single queries; chunks use the same rule in bulk. */
export function baseCellAt(
  seed: number,
  x: number,
  y: number,
  params: WorldGenParams,
  biomes: WorldBiomeRegistry = WORLD_BIOMES,
): BaseCell {
  return cellWith(seedsOf(seed), x, y, params, biomes, riverAt(seed, x, y, params));
}

/** A 32 x 32 chunk. Arrays are indexed `j * CHUNK_SIZE + i` for local cell (i, j). */
export interface Chunk {
  readonly cx: number;
  readonly cy: number;
  readonly level: Uint8Array;
  readonly block: string[];
  readonly decor: string[];
}

/** Index of local cell (i, j) in a chunk's arrays. */
export function chunkIndex(i: number, j: number): number {
  return j * CHUNK_SIZE + i;
}

/** Generate the base terrain of chunk (cx, cy). Same inputs, same arrays, on every platform. */
export function generateChunk(
  seed: number,
  cx: number,
  cy: number,
  params: WorldGenParams,
  biomes: WorldBiomeRegistry = WORLD_BIOMES,
): Chunk {
  const seeds = seedsOf(seed);
  const rx = Math.floor(cx / RIVER_REGION_CHUNKS);
  const ry = Math.floor(cy / RIVER_REGION_CHUNKS);
  const rivers = riverRegion(seed, rx, ry, params).cells;
  const localX0 = (cx - rx * RIVER_REGION_CHUNKS) * CHUNK_SIZE;
  const localY0 = (cy - ry * RIVER_REGION_CHUNKS) * CHUNK_SIZE;
  const count = CHUNK_SIZE * CHUNK_SIZE;
  const level = new Uint8Array(count);
  const block: string[] = new Array<string>(count).fill('');
  const decor: string[] = new Array<string>(count).fill('');
  const x0 = cx * CHUNK_SIZE;
  const y0 = cy * CHUNK_SIZE;
  for (let j = 0; j < CHUNK_SIZE; j++) {
    for (let i = 0; i < CHUNK_SIZE; i++) {
      const river = rivers[(localY0 + j) * RIVER_REGION_CELLS + (localX0 + i)] ?? NO_RIVER;
      const cell = cellWith(seeds, x0 + i, y0 + j, params, biomes, river);
      const k = chunkIndex(i, j);
      level[k] = cell.level;
      block[k] = cell.block;
      decor[k] = cell.decor;
    }
  }
  return { cx, cy, level, block, decor };
}

/** A digest of a chunk's cells: equal chunks give equal digests (used by golden tests and checks). */
export function chunkDigest(chunk: Chunk): number {
  const text = `${chunk.cx},${chunk.cy}|${chunk.level.join(',')}|${chunk.block.join(',')}|${chunk.decor.join(',')}`;
  return hash32(text);
}

