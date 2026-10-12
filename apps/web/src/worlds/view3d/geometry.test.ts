import { describe, expect, it } from 'vitest';
import { animalSlot, farmAnimalSlot, buildChunk, type CellIn, type UvRect } from './geometry';

const BASE: CellIn = {
  level: 0,
  block: 'meadow_grass',
  decor: '',
  solid: false,
  soil: false,
  watered: false,
  crop: null,
  sprinkler: false,
  animals: [],
  mark: null,
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
  'animal:plume_hen',
  'mark:busy',
]);
const uv = (name: string): UvRect | undefined =>
  SPRITES.has(name) ? { u0: 0.1, u1: 0.2, vt: 0.9, vb: 0.8 } : undefined;

/** A reader over a grid of cells: `cells[y][x]`, and the flat grass outside it. */
function reader(cells: Record<string, Partial<CellIn>>) {
  return (cx: number, cy: number): CellIn => ({ ...BASE, ...cells[`${cx},${cy}`] });
}

describe('buildChunk', () => {
  it('separates a recessed water surface and submerged basin without changing cell levels', () => {
    const cell = Object.freeze({ ...BASE, level: 2, block: 'water' });
    const atlas = () => ({ u0: 0.1, u1: 0.2, vt: 0.9, vb: 0.8 });
    const g = buildChunk({ x0: 0, y0: 0, size: 1 }, () => cell, atlas);
    expect(cell.level).toBe(2);
    expect(g.water.position.length).toBe(12);
    expect(g.water.index.length).toBe(6);
    for (let i = 1; i < 12; i += 3) {
      expect(g.position[i]).toBeCloseTo(0.25); // deep basin: .75 - .5
      expect(g.water.position[i]).toBeCloseTo(0.71); // surface: .75 - .04
    }
    expect(g.water.uv).toEqual(g.uv);
    expect(g.occluders).toEqual([]);
  });

  it('gives shores shallower basins and joins water corners across independent chunks', () => {
    const atlas = () => ({ u0: 0, u1: 1, vt: 1, vb: 0 });
    const read = reader({ '0,0': { block: 'water' }, '1,0': { block: 'water' } });
    const left = buildChunk({ x0: 0, y0: 0, size: 1 }, read, atlas);
    const right = buildChunk({ x0: 1, y0: 0, size: 1 }, read, atlas);
    expect(left.position[4]).toBeCloseTo(right.position[1]!); // shared north corner
    expect(left.position[7]).toBeCloseTo(right.position[10]!); // shared south corner
    expect(left.position[1]).toBeGreaterThan(-0.2);
    expect(left.position[4]).toBeGreaterThan(-0.5);
    expect(left.quads).toBe(4); // basin and three exposed shore walls
    expect(left.water.index.length).toBe(6);
  });

  it('varies natural ground gently while leaving placed stone floors unmodified', () => {
    const grass = buildChunk({ x0: 0, y0: 0, size: 2 }, reader({}), uv);
    expect(grass.color[0]).not.toBe(grass.color[12]);
    expect(Math.min(...grass.color)).toBeGreaterThan(0.89);
    const stone = buildChunk({ x0: 0, y0: 0, size: 1 }, reader({ '0,0': { block: 'stone' } }), uv);
    expect([...stone.color].every((value) => value === 1)).toBe(true);
  });

  it('uses approved proportions, folded feet and every face in the occlusion bounds', () => {
    const g = buildChunk(
      { x0: 0, y0: 0, size: 1 },
      reader({ '0,0': { decor: 'oak_tree', solid: true } }),
      (name) => {
        const rect = uv(name);
        return rect && name === 'decor:oak_tree'
          ? { ...rect, width: 3.4, height: 3.7, footDepth: 0.07, bottom: 0.96 }
          : rect;
      },
    );
    expect(g.quads).toBe(3); // ground, folded roots, crown
    expect(g.occluders[0]!.faces).toEqual([1, 2]);
    expect(g.occluders[0]!.box.x0).toBeCloseTo(-1.2);
    expect(g.occluders[0]!.box.y1).toBeCloseTo(3.7 * 0.96);
    expect(g.position[4 * 3 + 1]).toBeCloseTo(0.004);
    expect(g.position[4 * 3 + 2]).toBeLessThan(0.5);
    expect([...g.wind.slice(4, 8)]).toEqual([0, 0, 0, 0]);
    expect([...g.wind.slice(8)]).toEqual([1, 1, 0, 0]);
    expect(g.index.length).toBe(g.quads * 6);
  });

  it('casts sprite-shaped shadows onto the actual raised floor without affecting body face indices', () => {
    const g = buildChunk(
      { x0: 0, y0: 0, size: 1 },
      reader({ '0,0': { level: 2, decor: 'oak_tree' } }),
      (name) => {
        const rect = uv(name);
        return rect && name === 'decor:oak_tree' ? { ...rect, width: 3, height: 4 } : rect;
      },
    );
    expect(g.shadow.index).toHaveLength(12); // silhouette and short contact projection
    expect(g.shadow.uv.slice(0, 8)).toEqual(
      new Float32Array([0.1, 0.9, 0.2, 0.9, 0.2, 0.8, 0.1, 0.8]),
    );
    for (let i = 1; i < g.shadow.position.length; i += 3) {
      expect(g.shadow.position[i]).toBeGreaterThan(0.75);
      expect(g.shadow.position[i]).toBeLessThan(0.754);
    }
    expect(g.shadow.color.length).toBe((g.shadow.position.length / 3) * 4);
    expect(Math.max(...g.shadow.index)).toBeLessThan(g.shadow.position.length / 3);
    expect(g.fade.length).toBe(g.quads * 4);
  });

  it('selects growth-dependent soil, raises a root mound and buries the crop base', () => {
    const names: string[] = [];
    const g = buildChunk(
      { x0: 0, y0: 0, size: 1 },
      reader({ '0,0': { soil: true, crop: 'crop:rust_yam:4' } }),
      (name) => {
        names.push(name);
        const rect = { u0: 0, u1: 1, vt: 1, vb: 0 };
        return name.startsWith('crop:')
          ? { ...rect, width: 0.92, height: 0.9, burial: 0.14 }
          : rect;
      },
    );
    expect(names).toContain('top:tilled_soil:4');
    const soilY = Array.from({ length: 16 * 4 }, (_, i) => g.position[(i + 4) * 3 + 1]!);
    expect(Math.max(...soilY)).toBeGreaterThan(0.02);
    expect(Math.min(...soilY)).toBeCloseTo(0.003);
    expect(g.position.at(-2)).toBeLessThan(0);
    expect(g.wind.at(-1)).toBe(0);
    expect(g.quads).toBe(18);
  });

  it('bends only vegetation tips and keeps structures and roots fixed', () => {
    const tree = buildChunk(
      { x0: 0, y0: 0, size: 1 },
      reader({ '0,0': { decor: 'oak_tree' } }),
      uv,
    );
    expect([...tree.wind]).toEqual([0, 0, 0, 0, 1, 1, 0, 0]);
    const wall = buildChunk(
      { x0: 0, y0: 0, size: 1 },
      reader({ '0,0': { decor: 'wood_wall' } }),
      uv,
    );
    expect([...wall.wind].every((n) => n === 0)).toBe(true);
  });
  it('chooses distinct bed views without changing the cell footprint', () => {
    const shapes = [];
    for (const bedAxis of ['vertical', 'horizontal'] as const) {
      const names: string[] = [];
      shapes.push(
        buildChunk(
          { x0: 0, y0: 0, size: 1 },
          reader({ '0,0': { decor: 'bed', bedAxis } }),
          (name) => {
            names.push(name);
            return { u0: 0, u1: 1, vt: 1, vb: 0 };
          },
        ),
      );
      expect(names).toContain(bedAxis === 'horizontal' ? 'decor:bed:horizontal' : 'decor:bed');
    }
    expect(shapes[0]!.position).toEqual(shapes[1]!.position);
  });
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

describe('animals and marks of the farm (P17.21c)', () => {
  it('keeps approved animals at their species size in a staggered, grounded pen', () => {
    const animals = Array.from({ length: 4 }, () => 'animal:plume_hen');
    const g = buildChunk({ x0: 0, y0: 0, size: 1 }, reader({ '0,0': { animals } }), (name) => {
      const rect = uv(name);
      return rect && name.startsWith('animal:')
        ? { ...rect, width: 0.65, height: 0.65, footDepth: 0.04 }
        : rect;
    });
    expect(g.quads).toBe(9); // floor + folded feet/body for each animal
    for (let q = 2; q < 9; q += 2)
      expect(g.position[q * 12 + 3]! - g.position[q * 12]!).toBeCloseTo(0.65);
    expect(g.shadow.index.length).toBe(4 * 18);
    expect([...g.livestock.keys()]).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
    expect([...g.livestock.values()].every((cell) => cell.x === 0 && cell.y === 0)).toBe(true);
    expect(g.livestock.has(0)).toBe(false); // the visible floor must remain a walking target
    const pen = [0, 1, 2, 3].map((i) => farmAnimalSlot(i, 4));
    expect(pen[1]!.x - pen[0]!.x).toBeGreaterThan(1);
    expect(pen[2]!.z - pen[0]!.z).toBeCloseTo(0.8);
    expect(pen[2]!.x).not.toBe(pen[0]!.x);
  });

  it('each animal of a housing cell is one card, and a mark is one more card on the corner', () => {
    const g = buildChunk(
      { x0: 0, y0: 0, size: 1 },
      reader({ '0,0': { animals: ['animal:plume_hen', 'animal:plume_hen'], mark: 'mark:busy' } }),
      uv,
    );
    // the top, and two animals and the mark
    expect(g.quads).toBe(4);
    expect([...g.livestock.keys()]).toEqual([1, 2]); // the state mark is not an animal
  });

  it('two animals stand in two columns, the second row nearer the viewer', () => {
    const one = animalSlot(0, 1);
    expect(one.x0).toBeCloseTo(0.1);
    expect(one.x1 - one.x0).toBeCloseTo(0.72, 6);
    const four = [0, 1, 2, 3].map((i) => animalSlot(i, 4));
    expect(four[0]!.x0).toBeLessThan(four[1]!.x0);
    expect(four[2]!.z).toBeGreaterThan(four[0]!.z);
    const six = [0, 1, 2, 3, 4, 5].map((i) => animalSlot(i, 6));
    expect(new Set(six.map((a) => a.x0)).size).toBe(3);
  });

  it('every animal stands in front of the housing card (the animal row is south of the cell centre)', () => {
    for (let i = 0; i < 6; i++) expect(animalSlot(i, 6).z).toBeGreaterThan(0.5);
  });
});
