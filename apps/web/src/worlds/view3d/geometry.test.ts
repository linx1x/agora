import { describe, expect, it } from 'vitest';
import { buildChunk, type CellIn, type UvRect } from './geometry';

const BASE: CellIn = {
  level: 0,
  block: 'meadow_grass',
  decor: '',
  solid: false,
  soil: false,
  watered: false,
  crop: null,
  sprinkler: false,
};

/** Every sprite the tests use has a place in a made-up atlas; a name not listed is missing. */
const SPRITES = new Set([
  'top:meadow_grass',
  'top:stone',
  'top:tilled_soil',
  'side:meadow_grass',
  'side:stone',
  'decor:oak_tree',
  'decor:wood_wall',
  'crop:wheat',
  'sprinkler',
]);
const uv = (name: string): UvRect | undefined =>
  SPRITES.has(name) ? { u0: 0.1, u1: 0.2, vt: 0.9, vb: 0.8 } : undefined;

/** A reader over a grid of cells: `cells[y][x]`, and the flat grass outside it. */
function reader(cells: Record<string, Partial<CellIn>>) {
  return (cx: number, cy: number): CellIn => ({ ...BASE, ...cells[`${cx},${cy}`] });
}

describe('buildChunk', () => {
  it('a flat region is one top quad per cell, four vertices and six indices each', () => {
    const g = buildChunk({ x0: 0, y0: 0, size: 2 }, reader({}), uv);
    expect(g.quads).toBe(4);
    expect(g.position.length).toBe(4 * 4 * 3);
    expect(g.index.length).toBe(4 * 6);
    expect(g.occluders).toEqual([]);
    expect(Math.max(...g.index)).toBeLessThan(4 * g.quads);
  });

  it('a cell raised two levels leaves one steep cliff quad on its south edge', () => {
    const g = buildChunk({ x0: 0, y0: 0, size: 2 }, reader({ '0,0': { level: 2 } }), uv);
    // four tops, and the cliff of (0,0) over the level-0 cell (0,1)
    expect(g.quads).toBe(5);
    // the cell's top is quad 0 and its cliff comes right after it: quad 1, on the south edge z = 1,
    // between the neighbour's height (0) and its own (2 levels = 0.75 tiles)
    const v = (q: number, i: number) => q * 4 + i;
    const cliff = 1;
    const z = g.position[v(cliff, 0) * 3 + 2];
    expect(z).toBe(1);
    expect(g.position[v(cliff, 0) * 3 + 1]).toBeCloseTo(0.75);
    expect(g.position[v(cliff, 3) * 3 + 1]).toBe(0);
    // steep: the darker cliff shade (0x55 / 255)
    expect(g.color[v(cliff, 0) * 3]).toBeCloseTo(0x55 / 255);
  });

  it('a one-level step is shaded as a step, not a cliff', () => {
    const g = buildChunk({ x0: 0, y0: 0, size: 2 }, reader({ '0,0': { level: 1 } }), uv);
    // quad 1 is the cliff (the top of (0,0) is quad 0)
    expect(g.color[1 * 4 * 3]).toBeCloseTo(0x8f / 255);
  });

  it('a solid decor cell is an occluder over its quad; a wall is not a card', () => {
    const tree = buildChunk(
      { x0: 0, y0: 0, size: 1 },
      reader({ '0,0': { decor: 'oak_tree', solid: true } }),
      uv,
    );
    expect(tree.occluders).toHaveLength(1);
    expect(tree.occluders[0]).toMatchObject({ key: '0,0', faces: [1], card: true });
    const wall = buildChunk(
      { x0: 0, y0: 0, size: 1 },
      reader({ '0,0': { decor: 'wood_wall', solid: true } }),
      uv,
    );
    expect(wall.occluders[0]).toMatchObject({ card: false });
  });

  it('soil, a crop and the sprinkler add quads, and only solid decor is an occluder', () => {
    const g = buildChunk(
      { x0: 0, y0: 0, size: 1 },
      reader({ '0,0': { soil: true, watered: true, crop: 'crop:wheat', sprinkler: true } }),
      uv,
    );
    expect(g.quads).toBe(4);
    expect(g.occluders).toEqual([]);
    expect(g.color.slice(4 * 3, 4 * 3 + 3)).not.toEqual(new Float32Array([1, 1, 1]));
  });

  it('a sprite name that is not in the atlas is skipped, not drawn as a wrong one', () => {
    const g = buildChunk(
      { x0: 0, y0: 0, size: 1 },
      reader({ '0,0': { block: 'nope', decor: 'nope', crop: 'missing' } }),
      uv,
    );
    expect(g.quads).toBe(0);
  });

  it('every vertex starts solid for the occlusion fade', () => {
    const g = buildChunk({ x0: 0, y0: 0, size: 2 }, reader({ '1,1': { level: 3 } }), uv);
    expect(g.fade.length).toBe(g.quads * 4);
    expect(g.fade.every((f) => f === 1)).toBe(true);
  });
});
