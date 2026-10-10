/**
 * Base terrain of a personal world (ADR-053): a pure function of (seed, cell coordinates,
 * params, biome registry). Chunks are 32 x 32 cells generated from it, so any two clients or
 * the server produce the same cells. Stored deltas are applied on top later (P17.7).
 *
 * Layers: elevation, temperature and humidity are fBm noise in [0, 1]. Elevation below
 * `seaElevation` is water; land within `beachWidth` above it is sand; otherwise the biome whose
 * blend weight wins the dither takes the surface, alpine above `alpineElevation`; decor is one
 * hashed draw per cell against the biome's densities.
 */
import { biomeWeights, pickBiome } from './biomes';
import { CHUNK_SIZE, LEVEL_MAX } from './constants';
import type { NoiseLayer, WorldGenParams } from './gen';
import { fbm2, hash32, hashCell, hashUnit } from './noise';
import { WORLD_BIOMES, type WorldBiome, type WorldBiomeRegistry } from './registry';

/** Salts that keep each layer's noise independent of the others. */
const SALT = { elevation: 0x0e1e, temperature: 0x07e3, humidity: 0x04a1, biome: 0x0b10, decor: 0x0dec } as const;

export const WATER_BLOCK = 'water';
export const BEACH_BLOCK = 'sand';

interface TerrainSeeds {
  readonly elevation: number;
  readonly temperature: number;
  readonly humidity: number;
  readonly biome: number;
  readonly decor: number;
}

function seedsOf(seed: number): TerrainSeeds {
  return {
    elevation: hashCell(seed, SALT.elevation, 0x51),
    temperature: hashCell(seed, SALT.temperature, 0x51),
    humidity: hashCell(seed, SALT.humidity, 0x51),
    biome: hashCell(seed, SALT.biome, 0x51),
    decor: hashCell(seed, SALT.decor, 0x51),
  };
}

/** One layer in [0, 1]: fBm in [-1, 1], centred on 0.5 and stretched by `contrast`, then clamped. */
function layer01(layerSeed: number, x: number, y: number, layer: NoiseLayer): number {
  const v = fbm2(layerSeed, x / layer.scale, y / layer.scale, { octaves: layer.octaves });
  const u = 0.5 + 0.5 * v * layer.contrast;
  return u < 0 ? 0 : u > 1 ? 1 : u;
}

/** Integer level 0..LEVEL_MAX from an elevation in [0, 1]. Monotonic, exact (multiplies by 8). */
export function levelOf(elevation01: number): number {
  const level = Math.floor(elevation01 * (LEVEL_MAX + 1));
  return level > LEVEL_MAX ? LEVEL_MAX : level < 0 ? 0 : level;
}

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
): BaseCell {
  const elevation = layer01(seeds.elevation, x, y, params.elevation);
  const level = levelOf(elevation);
  if (elevation < params.seaElevation) return { level, block: WATER_BLOCK, decor: '' };
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
  const decor = pickDecor(biome, hashUnit(seeds.decor, x, y));
  return { level, block: biome.surface, decor };
}

/** Base terrain of one world cell. For single queries; chunks use the same rule in bulk. */
export function baseCellAt(
  seed: number,
  x: number,
  y: number,
  params: WorldGenParams,
  biomes: WorldBiomeRegistry = WORLD_BIOMES,
): BaseCell {
  return cellWith(seedsOf(seed), x, y, params, biomes);
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
  const count = CHUNK_SIZE * CHUNK_SIZE;
  const level = new Uint8Array(count);
  const block: string[] = new Array<string>(count).fill('');
  const decor: string[] = new Array<string>(count).fill('');
  const x0 = cx * CHUNK_SIZE;
  const y0 = cy * CHUNK_SIZE;
  for (let j = 0; j < CHUNK_SIZE; j++) {
    for (let i = 0; i < CHUNK_SIZE; i++) {
      const cell = cellWith(seeds, x0 + i, y0 + j, params, biomes);
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
