import { describe, expect, it } from 'vitest';
import blocksJson from '../../data/worlds/blocks.json';
import biomesJson from '../../data/worlds/biomes.json';
import { biomeWeights, dominantBiome, pickBiome } from './biomes';
import { WORLD_BIOMES, parseWorldBiomeRegistry, parseBlockRegistry } from './registry';
import { hashUnit } from './noise';

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

/** The row at `index`; throws if the fixture is shorter than the test assumes. */
function row<T>(list: T[], index: number): T {
  const value = list[index];
  if (value === undefined) throw new Error(`fixture has no row ${index}`);
  return value;
}

function centreOf(id: string): { temperature: number; humidity: number } {
  const biome = WORLD_BIOMES.byId.get(id);
  if (!biome) throw new Error(`no biome ${id}`);
  return biome.centre;
}

function indexOf(id: string): number {
  const index = WORLD_BIOMES.list.findIndex((biome) => biome.id === id);
  if (index < 0) throw new Error(`no biome ${id}`);
  return index;
}

describe('shipped biome registry', () => {
  it('has the four biomes, each with a palette and a centre', () => {
    expect(WORLD_BIOMES.list.map((biome) => biome.id)).toEqual(['meadow', 'jungle', 'desert', 'taiga']);
    expect(WORLD_BIOMES.list.map((biome) => biome.palette)).toEqual(['zen', 'jungle', 'oasis', 'boreal']);
    expect(WORLD_BIOMES.blendRadius).toBeGreaterThan(0);
  });

  it('keeps decor densities at or below 1 per biome', () => {
    for (const biome of WORLD_BIOMES.list) {
      const total = biome.decor.reduce((sum, entry) => sum + entry.density, 0);
      expect(total).toBeLessThanOrEqual(1);
    }
  });
});

describe('parseWorldBiomeRegistry cross-references', () => {
  const blocks = parseBlockRegistry(blocksJson);

  it('rejects a surface that is a decor block', () => {
    const raw = clone(biomesJson);
    row(raw.biomes, 0).surface = 'oak_tree';
    expect(() => parseWorldBiomeRegistry(raw, blocks)).toThrow(
      /biomes\.json: biomes\.0\.surface: "oak_tree" is a decor block, expected ground/,
    );
  });

  it('rejects an unknown decor block with its path', () => {
    const raw = clone(biomesJson);
    row(row(raw.biomes, 1).decor, 0).block = 'moon_rock';
    expect(() => parseWorldBiomeRegistry(raw, blocks)).toThrow(
      /biomes\.json: biomes\.1\.decor\.0\.block: unknown block "moon_rock"/,
    );
  });

  it('rejects liquid as biome terrain', () => {
    const raw = clone(biomesJson);
    row(raw.biomes, 2).deep = 'water';
    expect(() => parseWorldBiomeRegistry(raw, blocks)).toThrow(/biomes\.2\.deep: "water" is liquid/);
  });

  it('rejects a block that names an unknown biome', () => {
    const raw = parseBlockRegistry(
      clone({ version: 1, blocks: [{ ...row(blocksJson.blocks, 0), biomes: ['moon'] }] }),
    );
    expect(() => parseWorldBiomeRegistry(biomesJson, raw)).toThrow(
      /blocks\.json: blocks\.0\.biomes\.0: unknown biome "moon"/,
    );
  });

  it('rejects decor densities above 1 and an unknown palette', () => {
    const dense = clone(biomesJson);
    row(dense.biomes, 0).decor = [
      { block: 'tall_grass', density: 0.7 },
      { block: 'flower', density: 0.6 },
    ];
    expect(() => parseWorldBiomeRegistry(dense, blocks)).toThrow(/decor densities add up to 1\.300/);

    const palette = clone(biomesJson);
    row(palette.biomes, 0).palette = 'neon';
    expect(() => parseWorldBiomeRegistry(palette, blocks)).toThrow(/biomes\.0\.palette/);
  });
});

describe('biomeWeights', () => {
  it('is exactly the biome itself at its own centre', () => {
    for (const biome of WORLD_BIOMES.list) {
      const weights = biomeWeights(biome.centre.temperature, biome.centre.humidity);
      expect(weights[indexOf(biome.id)]).toBe(1);
      expect(weights.reduce((sum, w) => sum + w, 0)).toBeCloseTo(1, 12);
    }
  });

  it('sums to 1 with no negative weights over a grid', () => {
    for (let t = 0; t <= 1; t += 0.05) {
      for (let h = 0; h <= 1; h += 0.05) {
        const weights = biomeWeights(t, h);
        expect(weights.every((w) => w >= 0)).toBe(true);
        expect(weights.reduce((sum, w) => sum + w, 0)).toBeCloseTo(1, 12);
      }
    }
  });

  it('falls back to the nearest centre far from every kernel', () => {
    expect(biomeWeights(0, 0)).toEqual([0, 0, 0, 1]);
  });

  it('mixes across a border over at least three cells', () => {
    // Walk one cell at a time (0.01 of temperature and humidity) from meadow to jungle.
    const from = centreOf('meadow');
    const to = centreOf('jungle');
    const steps = 35;
    let mixedCells = 0;
    for (let k = 0; k <= steps; k++) {
      const t = from.temperature + ((to.temperature - from.temperature) * k) / steps;
      const h = from.humidity + ((to.humidity - from.humidity) * k) / steps;
      const weights = biomeWeights(t, h);
      const contenders = weights.filter((w) => w > 0.05).length;
      if (contenders >= 2) mixedCells++;
    }
    expect(mixedCells).toBeGreaterThanOrEqual(3);
  });

  it('dithers a border: some mixed cells take the minority biome', () => {
    const from = centreOf('meadow');
    const to = centreOf('jungle');
    const meadow = indexOf('meadow');
    const jungle = indexOf('jungle');
    const steps = 35;
    const picks = new Set<number>();
    let minority = 0;
    for (let k = 0; k <= steps; k++) {
      const t = from.temperature + ((to.temperature - from.temperature) * k) / steps;
      const h = from.humidity + ((to.humidity - from.humidity) * k) / steps;
      const weights = biomeWeights(t, h);
      const pick = pickBiome(weights, hashUnit(7, k, 0));
      picks.add(pick);
      if (pick !== dominantBiome(weights) && (weights[pick] ?? 0) > 0.05) minority++;
    }
    expect(picks.has(meadow)).toBe(true);
    expect(picks.has(jungle)).toBe(true);
    expect(minority).toBeGreaterThanOrEqual(1);
  });
});

describe('pickBiome', () => {
  it('walks the cumulative weights', () => {
    expect(pickBiome([0.6, 0.4], 0)).toBe(0);
    expect(pickBiome([0.6, 0.4], 0.59)).toBe(0);
    expect(pickBiome([0.6, 0.4], 0.6)).toBe(1);
    expect(pickBiome([0, 1, 0], 0.99)).toBe(1);
  });

  it('never picks a zero-weight biome, even when rounding leaves a gap', () => {
    expect(pickBiome([0.3333333333, 0.3333333333, 0.3333333333, 0], 0.9999999999)).toBe(2);
  });

  it('dominantBiome returns the largest weight', () => {
    expect(dominantBiome([0.1, 0.7, 0.2])).toBe(1);
  });
});
