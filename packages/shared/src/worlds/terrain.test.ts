import { describe, expect, it } from 'vitest';
import { BLOCKS, WORLD_BIOMES, getBlock } from './registry';
import { CHUNK_SIZE, LEVEL_MAX } from './constants';
import { WORLDGEN } from './gen';
import { worldSeedFor } from './noise';
import { NO_RIVER, riverAt } from './rivers';
import {
  BEACH_BLOCK,
  WATER_BLOCK,
  baseCellAt,
  chunkDigest,
  chunkIndex,
  generateChunk,
  levelOf,
  pickDecor,
} from './terrain';

const P = WORLDGEN.params;
const SEED = worldSeedFor('golden-1');

// Golden values: computed by this module and reproduced exactly by an independent Python port
// (same JSON data, 32-bit integer masks, IEEE doubles). A change means the terrain changed:
// bump genVersion and keep the old params (ADR-053).
describe('golden terrain', () => {
  it('chunk digests match the reference values', () => {
    expect(chunkDigest(generateChunk(SEED, 0, 0, P))).toBe(503316246);
    expect(chunkDigest(generateChunk(SEED, -3, 7, P))).toBe(3756192143);
    expect(chunkDigest(generateChunk(SEED, 12, -9, P))).toBe(1932215716);
  });

  it('sample cells match the reference values', () => {
    const chunk = generateChunk(SEED, 0, 0, P);
    const cell = (k: number) => [chunk.level[k], chunk.block[k], chunk.decor[k]];
    expect(cell(0)).toEqual([4, 'meadow_grass', 'flower']);
    expect(cell(1)).toEqual([4, 'meadow_grass', '']);
    expect(cell(31)).toEqual([4, 'desert_sand', '']);
    expect(cell(32)).toEqual([3, 'meadow_grass', '']);
    expect(cell(33)).toEqual([3, 'meadow_grass', 'tall_grass']);
    expect(cell(500)).toEqual([3, 'sand', '']);
    expect(cell(1023)).toEqual([5, 'jungle_grass', 'jungle_tree']);
  });

  it('a single-cell query equals the chunk cell', () => {
    expect(baseCellAt(SEED, 0, 0, P)).toEqual({ level: 4, block: 'meadow_grass', decor: 'flower' });
    expect(baseCellAt(SEED, -5, 40, P)).toEqual({ level: 3, block: 'sand', decor: '' });
  });
});

describe('generateChunk', () => {
  it('is repeatable and seed-sensitive', () => {
    expect(chunkDigest(generateChunk(SEED, 2, 2, P))).toBe(chunkDigest(generateChunk(SEED, 2, 2, P)));
    expect(chunkDigest(generateChunk(SEED + 1, 2, 2, P))).not.toBe(chunkDigest(generateChunk(SEED, 2, 2, P)));
  });

  it('has 32 x 32 cells with valid levels and registered blocks', () => {
    const chunk = generateChunk(SEED, 1, -1, P);
    const count = CHUNK_SIZE * CHUNK_SIZE;
    expect(chunk.level.length).toBe(count);
    expect(chunk.block.length).toBe(count);
    expect(chunk.decor.length).toBe(count);
    for (let k = 0; k < count; k++) {
      expect(chunk.level[k]).toBeLessThanOrEqual(LEVEL_MAX);
      expect(getBlock(BLOCKS, chunk.block[k] ?? '')).toBeDefined();
      if (chunk.decor[k]) expect(getBlock(BLOCKS, chunk.decor[k] ?? '')?.layer).toBe('decor');
    }
  });

  it('is seamless across chunk borders: a cell is the same from either side', () => {
    const left = generateChunk(SEED, 0, 0, P);
    const right = generateChunk(SEED, 1, 0, P);
    for (let j = 0; j < CHUNK_SIZE; j++) {
      const a = left.block[chunkIndex(CHUNK_SIZE - 1, j)];
      expect(a).toBe(baseCellAt(SEED, CHUNK_SIZE - 1, j, P).block);
      expect(right.block[chunkIndex(0, j)]).toBe(baseCellAt(SEED, CHUNK_SIZE, j, P).block);
    }
  });

  it('gives a land-and-sea world: water 20-45 %, beaches, several biomes', () => {
    const counts = new Map<string, number>();
    let water = 0;
    let sand = 0;
    let cells = 0;
    let waterNextToSand = false;
    for (let cx = -3; cx < 3; cx++) {
      for (let cy = -3; cy < 3; cy++) {
        const chunk = generateChunk(SEED, cx, cy, P);
        for (let k = 0; k < chunk.block.length; k++) {
          const block = chunk.block[k] ?? '';
          cells++;
          counts.set(block, (counts.get(block) ?? 0) + 1);
          if (block === WATER_BLOCK) water++;
          if (block === BEACH_BLOCK) sand++;
        }
        for (let k = 1; k < chunk.block.length; k++) {
          if (chunk.block[k - 1] === WATER_BLOCK && chunk.block[k] === BEACH_BLOCK) waterNextToSand = true;
        }
      }
    }
    expect(water / cells).toBeGreaterThan(0.2);
    expect(water / cells).toBeLessThan(0.45);
    expect(sand).toBeGreaterThan(0);
    expect(waterNextToSand).toBe(true);
    const surfaces = WORLD_BIOMES.list.filter((biome) => counts.has(biome.surface));
    expect(surfaces.length).toBe(WORLD_BIOMES.list.length);
  });

  it('keeps ocean at or below sea level, rivers and land at or above it, and no decor on water or beach', () => {
    const seaLevel = levelOf(P.seaElevation);
    for (let cx = 0; cx < 3; cx++) {
      const chunk = generateChunk(SEED, cx, 4, P);
      for (let k = 0; k < chunk.block.length; k++) {
        const level = chunk.level[k] ?? 0;
        const x = cx * CHUNK_SIZE + (k % CHUNK_SIZE);
        const y = 4 * CHUNK_SIZE + Math.floor(k / CHUNK_SIZE);
        if (chunk.block[k] === WATER_BLOCK) {
          // Ocean sits at or below the sea level; a river is land, carved at its own level.
          if (riverAt(SEED, x, y, P) === NO_RIVER) expect(level).toBeLessThanOrEqual(seaLevel);
          else expect(level).toBeGreaterThanOrEqual(seaLevel);
          expect(chunk.decor[k]).toBe('');
        } else {
          expect(level).toBeGreaterThanOrEqual(seaLevel);
        }
        if (chunk.block[k] === BEACH_BLOCK) expect(chunk.decor[k]).toBe('');
      }
    }
  });

  it('places decor only on its own biome surface, from that biome list', () => {
    const chunk = generateChunk(SEED, -2, 5, P);
    for (let k = 0; k < chunk.block.length; k++) {
      const decor = chunk.decor[k] ?? '';
      if (!decor) continue;
      const biome = WORLD_BIOMES.list.find((b) => b.surface === chunk.block[k]);
      expect(biome, `decor ${decor} needs a biome surface`).toBeDefined();
      expect(biome?.decor.map((entry) => entry.block)).toContain(decor);
    }
  });

  it('runs in under 15 ms on average (50 chunks)', () => {
    const started = performance.now();
    for (let n = 0; n < 50; n++) generateChunk(SEED, n % 10, Math.floor(n / 10), P);
    const average = (performance.now() - started) / 50;
    console.info(`generateChunk average over 50 chunks: ${average.toFixed(2)} ms`);
    expect(average).toBeLessThan(15);
  });
});

describe('levelOf and pickDecor', () => {
  it('maps elevation to integer levels monotonically over 0..LEVEL_MAX', () => {
    expect(levelOf(0)).toBe(0);
    expect(levelOf(0.124)).toBe(0);
    expect(levelOf(0.125)).toBe(1);
    expect(levelOf(0.999)).toBe(LEVEL_MAX);
    expect(levelOf(1)).toBe(LEVEL_MAX);
    let last = 0;
    for (let e = 0; e <= 1; e += 0.001) {
      const level = levelOf(e);
      expect(level).toBeGreaterThanOrEqual(last);
      last = level;
    }
  });

  it('draws decor by cumulative density, with a single decor per cell', () => {
    const meadow = WORLD_BIOMES.byId.get('meadow');
    if (!meadow) throw new Error('no meadow');
    const [tall, flower] = meadow.decor;
    expect(pickDecor(meadow, 0)).toBe(tall?.block);
    expect(pickDecor(meadow, (tall?.density ?? 0) - 1e-9)).toBe(tall?.block);
    expect(pickDecor(meadow, (tall?.density ?? 0) + 1e-9)).toBe(flower?.block);
    expect(pickDecor(meadow, 0.999999)).toBe('');
  });
});
