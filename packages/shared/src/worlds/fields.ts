/**
 * Scalar fields of the base terrain (ADR-053): one fBm layer each for elevation, temperature
 * and humidity, plus the integer level. Terrain (terrain.ts) and rivers (rivers.ts) both read
 * elevation through these functions, so a river always descends the same surface the terrain
 * is drawn from.
 */
import { LEVEL_MAX } from './constants';
import type { NoiseLayer, WorldGenParams } from './gen';
import { fbm2, hashCell } from './noise';

/** Salts that keep each layer's noise independent of the others. */
export const SALT = {
  elevation: 0x0e1e,
  temperature: 0x07e3,
  humidity: 0x04a1,
  biome: 0x0b10,
  decor: 0x0dec,
  river: 0x21e7,
  cave: 0x0c4e,
} as const;

export interface TerrainSeeds {
  readonly elevation: number;
  readonly temperature: number;
  readonly humidity: number;
  readonly biome: number;
  readonly decor: number;
  readonly river: number;
  readonly cave: number;
}

/** Per-layer seeds derived from the world seed. Computed once per chunk, not per cell. */
export function seedsOf(seed: number): TerrainSeeds {
  return {
    elevation: hashCell(seed, SALT.elevation, 0x51),
    temperature: hashCell(seed, SALT.temperature, 0x51),
    humidity: hashCell(seed, SALT.humidity, 0x51),
    biome: hashCell(seed, SALT.biome, 0x51),
    decor: hashCell(seed, SALT.decor, 0x51),
    river: hashCell(seed, SALT.river, 0x51),
    cave: hashCell(seed, SALT.cave, 0x51),
  };
}

/** One layer in [0, 1]: fBm in [-1, 1], centred on 0.5, stretched by `contrast`, clamped. */
export function layer01(layerSeed: number, x: number, y: number, layer: NoiseLayer): number {
  const v = fbm2(layerSeed, x / layer.scale, y / layer.scale, { octaves: layer.octaves });
  const u = 0.5 + 0.5 * v * layer.contrast;
  return u < 0 ? 0 : u > 1 ? 1 : u;
}

/** Elevation in [0, 1] of one cell. */
export function elevationAt(seeds: TerrainSeeds, x: number, y: number, params: WorldGenParams): number {
  return layer01(seeds.elevation, x, y, params.elevation);
}

/** Integer level 0..LEVEL_MAX from an elevation in [0, 1]. Monotonic, exact (multiplies by 8). */
export function levelOf(elevation01: number): number {
  const level = Math.floor(elevation01 * (LEVEL_MAX + 1));
  return level > LEVEL_MAX ? LEVEL_MAX : level < 0 ? 0 : level;
}
