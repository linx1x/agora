import { describe, expect, it } from 'vitest';
import { WORLDGEN } from './gen';
import { BLOCKS } from './registry';
import { worldSeedFor } from './noise';
import { NO_RIVER, riverAt } from './rivers';
import { baseCellAt, chunkDigest, generateChunk } from './terrain';
import { WorldTerrain, describeCell, type CellOverlay } from './cells';

const P = WORLDGEN.params;
const SEED = worldSeedFor('golden-1');

describe('WorldTerrain.cellAt', () => {
  it('equals the base terrain when there are no patches', () => {
    const world = new WorldTerrain(SEED, P);
    for (const [x, y] of [
      [0, 0],
      [5, -7],
      [40, 33],
      [-70, 12],
    ] as const) {
      const cell = world.cellAt(x, y);
      const base = baseCellAt(SEED, x, y, P);
      expect([cell.level, cell.block, cell.decor]).toEqual([base.level, base.block, base.decor]);
    }
  });

  it('marks ocean as liquid and not walkable, and solid trees as walls', () => {
    const world = new WorldTerrain(SEED, P);
    let ocean: [number, number] | undefined;
    let tree: [number, number] | undefined;
    for (let y = -40; y < 40 && !(ocean && tree); y++) {
      for (let x = -40; x < 40 && !(ocean && tree); x++) {
        const cell = world.cellAt(x, y);
        if (!ocean && cell.block === 'water' && riverAt(SEED, x, y, P) === NO_RIVER) ocean = [x, y];
        if (!tree && cell.decor === 'oak_tree') tree = [x, y];
      }
    }
    expect(ocean, 'an ocean cell in the sample').toBeDefined();
    expect(tree, 'a tree in the sample').toBeDefined();
    const water = world.cellAt(ocean?.[0] ?? 0, ocean?.[1] ?? 0);
    expect(water.liquid).toBe(true);
    expect(water.walkable).toBe(false);
    const oak = world.cellAt(tree?.[0] ?? 0, tree?.[1] ?? 0);
    expect(oak.solid).toBe(true);
    expect(oak.walkable).toBe(false);
  });

  it('applies patches on top without changing the cached chunk', () => {
    const overlay: CellOverlay = (x, y) => (x === 1 && y === 1 ? { block: 'meadow_grass', decor: 'oak_tree' } : undefined);
    const patched = new WorldTerrain(SEED, P, { overlay });
    const plain = new WorldTerrain(SEED, P);
    expect(patched.cellAt(1, 1).solid).toBe(true);
    expect(plain.cellAt(1, 1).solid).toBe(false);
    expect(chunkDigest(patched.chunkAt(0, 0))).toBe(chunkDigest(plain.chunkAt(0, 0)));
  });

  it('keeps a small LRU of chunks and regenerates evicted ones identically', () => {
    const world = new WorldTerrain(SEED, P, { chunkCapacity: 2 });
    const first = world.chunkAt(0, 0);
    expect(world.chunkAt(0, 0)).toBe(first);
    world.chunkAt(1, 0);
    world.chunkAt(2, 0);
    const again = world.chunkAt(0, 0);
    expect(again).not.toBe(first);
    expect(chunkDigest(again)).toBe(chunkDigest(generateChunk(SEED, 0, 0, P)));
  });
});

describe('describeCell', () => {
  it('fails closed on unknown block ids', () => {
    expect(describeCell(3, 'no_such_block', '', BLOCKS).walkable).toBe(false);
    expect(describeCell(3, 'meadow_grass', 'no_such_decor', BLOCKS).walkable).toBe(false);
  });

  it('reads ramp, solid and liquid from the block rows', () => {
    expect(describeCell(3, 'meadow_grass', 'stone_stairs', BLOCKS).ramp).toBe(true);
    expect(describeCell(3, 'meadow_grass', 'boulder', BLOCKS).solid).toBe(true);
    expect(describeCell(0, 'water', '', BLOCKS).liquid).toBe(true);
    expect(describeCell(3, 'meadow_grass', 'flower', BLOCKS).walkable).toBe(true);
  });
});
