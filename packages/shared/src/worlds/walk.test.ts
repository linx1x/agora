import { describe, expect, it } from 'vitest';
import { TILE } from '../constants';
import { WORLDGEN } from './gen';
import { BLOCKS } from './registry';
import { worldSeedFor } from './noise';
import { WorldTerrain, describeCell, type CellOverlay, type CellPatch } from './cells';
import {
  canStep,
  feetCell,
  findWorldPath,
  outOfWorld,
  segmentWalkable,
  validateWorldMove,
  worldCollides,
  type GridCell,
} from './walk';

const P = WORLDGEN.params;
const SEED = worldSeedFor('golden-1');

/** A flat, walkable strip along row 10 from column -10 to 60 (level 4), so routes are fixed. */
function corridor(extra: Record<string, CellPatch> = {}): CellOverlay {
  return (x, y) => {
    const key = `${x},${y}`;
    const base: CellPatch | undefined =
      y === 10 && x >= -10 && x <= 60 ? { block: 'meadow_grass', decor: '', level: 4 } : undefined;
    const over = extra[key];
    if (!over) return base;
    return { ...base, ...over };
  };
}

function cell(level: number, block = 'meadow_grass', decor = '') {
  return describeCell(level, block, decor, BLOCKS);
}

describe('canStep', () => {
  it('allows flat ground and a rise or drop of one level', () => {
    expect(canStep(cell(3), cell(3))).toBe(true);
    expect(canStep(cell(3), cell(4))).toBe(true);
    expect(canStep(cell(4), cell(3))).toBe(true);
  });

  it('refuses a cliff of two levels unless a ramp is involved', () => {
    expect(canStep(cell(3), cell(5))).toBe(false);
    expect(canStep(cell(5), cell(3))).toBe(false);
    expect(canStep(cell(3), cell(5, 'meadow_grass', 'stone_stairs'))).toBe(true);
    expect(canStep(cell(3, 'meadow_grass', 'stone_stairs'), cell(5))).toBe(true);
  });

  it('never steps onto water or solid decor, and refuses a three-level climb even on stairs', () => {
    expect(canStep(cell(3), cell(3, 'water'))).toBe(false);
    expect(canStep(cell(3), cell(3, 'meadow_grass', 'oak_tree'))).toBe(false);
    expect(canStep(cell(3), cell(6, 'meadow_grass', 'stone_stairs'))).toBe(false);
  });
});

describe('collision and bounds', () => {
  it('a feet box inside walkable ground does not collide; one reaching water does', () => {
    const world = new WorldTerrain(SEED, P, { overlay: corridor() });
    // Feet at the bottom of row 10: the box stays inside that row and column 20.
    expect(worldCollides(world, 20 * TILE + 16, 10 * TILE + 28)).toBe(false);
    // Feet just above the corridor in row 9 reach a box that overlaps the row-9 base cells.
    const water = new WorldTerrain(SEED, P, {
      overlay: (x, y) => (y === 10 && x === 21 ? { block: 'water', decor: '' } : undefined),
    });
    expect(worldCollides(water, 21 * TILE + 30, 10 * TILE + 28)).toBe(true);
  });

  it('a tree blocks, and points outside the world or not finite always collide', () => {
    const world = new WorldTerrain(SEED, P, {
      overlay: (x, y) => (x === 22 && y === 10 ? { block: 'meadow_grass', decor: 'oak_tree' } : undefined),
    });
    expect(worldCollides(world, 22 * TILE + 16, 10 * TILE + 28)).toBe(true);
    expect(worldCollides(world, 1e9, 0)).toBe(true);
    expect(worldCollides(world, Number.NaN, 0)).toBe(true);
    expect(outOfWorld(0, 0)).toBe(false);
  });

  it('feetCell maps a point to its tile', () => {
    expect(feetCell(33, 64)).toEqual({ cx: 1, cy: 2 });
    expect(feetCell(-1, -1)).toEqual({ cx: -1, cy: -1 });
  });
});

describe('segmentWalkable and validateWorldMove', () => {
  const y = 10 * TILE + 28;
  const at = (col: number) => ({ x: col * TILE + 16, y });

  it('walks along a corridor across a chunk border (column 31 to 32)', () => {
    const world = new WorldTerrain(SEED, P, { overlay: corridor() });
    expect(segmentWalkable(world, at(30), at(34))).toBe('ok');
    expect(validateWorldMove(world, at(30), { x: at(30).x + 60, y }, 1000)).toEqual({ ok: true });
  });

  it('refuses a move that is too fast for the elapsed time', () => {
    const world = new WorldTerrain(SEED, P, { overlay: corridor() });
    expect(validateWorldMove(world, at(20), at(30), 1000)).toEqual({ ok: false, reason: 'speed' });
  });

  it('refuses a move into a tree, and a move up a cliff', () => {
    // at(25) is the centre of column 25: the feet box then overlaps that tile.
    const tree = new WorldTerrain(SEED, P, { overlay: corridor({ '25,10': { decor: 'oak_tree' } }) });
    expect(validateWorldMove(tree, at(20), at(25), 1000)).toEqual({ ok: false, reason: 'collision' });
    const cliff = new WorldTerrain(SEED, P, { overlay: corridor({ '25,10': { level: 6 } }) });
    expect(validateWorldMove(cliff, at(20), at(25), 1000)).toEqual({ ok: false, reason: 'step' });
  });

  it('climbs a two-level rise on stairs', () => {
    const stairs = new WorldTerrain(SEED, P, {
      overlay: corridor({ '25,10': { level: 6, decor: 'stone_stairs' } }),
    });
    expect(validateWorldMove(stairs, at(20), at(25), 1000)).toEqual({ ok: true });
  });

  it('refuses points outside the world', () => {
    const world = new WorldTerrain(SEED, P);
    expect(validateWorldMove(world, at(0), { x: 1e12, y: 0 }, 1000)).toEqual({ ok: false, reason: 'bounds' });
  });
});

describe('findWorldPath', () => {
  it('finds the corridor route, valid step by step, across a chunk border', () => {
    const world = new WorldTerrain(SEED, P, { overlay: corridor() });
    const start: GridCell = { cx: 20, cy: 10 };
    const goal: GridCell = { cx: 40, cy: 10 };
    const path = findWorldPath(world, start, goal);
    expect(path).not.toBeNull();
    const steps = path ?? [];
    expect(steps.at(-1)).toEqual(goal);
    let at = start;
    let crossed = false;
    for (const next of steps) {
      expect(Math.abs(next.cx - at.cx)).toBeLessThanOrEqual(1);
      expect(Math.abs(next.cy - at.cy)).toBeLessThanOrEqual(1);
      expect(canStep(world.cellAt(at.cx, at.cy), world.cellAt(next.cx, next.cy))).toBe(true);
      if (at.cx === 31 && next.cx === 32) crossed = true;
      at = next;
    }
    expect(crossed).toBe(true);
    expect(findWorldPath(world, start, goal)).toEqual(path);
  });

  it('returns null when the goal is walled in, and [] when already there', () => {
    const walls: Record<string, CellPatch> = {};
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        if (dx || dy) walls[`${30 + dx},${10 + dy}`] = { decor: 'oak_tree' };
      }
    }
    const world = new WorldTerrain(SEED, P, { overlay: corridor(walls) });
    expect(findWorldPath(world, { cx: 20, cy: 10 }, { cx: 30, cy: 10 })).toBeNull();
    expect(findWorldPath(world, { cx: 20, cy: 10 }, { cx: 20, cy: 10 })).toEqual([]);
  });

  it('gives up after maxNodes expansions', () => {
    const world = new WorldTerrain(SEED, P, { overlay: corridor() });
    expect(findWorldPath(world, { cx: 20, cy: 10 }, { cx: 40, cy: 10 }, 3)).toBeNull();
  });

  it('never cuts a corner past a solid cell', () => {
    const flat: Record<string, CellPatch> = {};
    for (let dy = -1; dy <= 2; dy++) {
      for (let dx = -1; dx <= 2; dx++) flat[`${5 + dx},${5 + dy}`] = { block: 'meadow_grass', decor: '', level: 4 };
    }
    flat['6,5'] = { block: 'meadow_grass', decor: 'oak_tree' };
    const world = new WorldTerrain(SEED, P, {
      overlay: (x, y) => flat[`${x},${y}`],
    });
    const path = findWorldPath(world, { cx: 5, cy: 5 }, { cx: 6, cy: 6 });
    expect(path).not.toBeNull();
    expect(path?.[0]).toEqual({ cx: 5, cy: 6 });
  });
});
