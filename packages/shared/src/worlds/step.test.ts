import { describe, expect, it } from 'vitest';
import { FEET_W, SPEED_PX, TILE } from '../constants';
import { WorldTerrain, type CellOverlay, type CellPatch } from './cells';
import { WORLDGEN } from './gen';
import { worldSeedFor } from './noise';
import { canStep, findWorldPath, stepWorld, worldCollides } from './walk';

const SEED = worldSeedFor('step-test');
const P = WORLDGEN.params;

/**
 * A flat plain of meadow grass at level 2 over cells x 0..19, y 0..9, with the given patches on
 * top. Everything outside it is the generated terrain, which the walks below never reach.
 */
function plain(patches: Record<string, CellPatch> = {}): WorldTerrain {
  const overlay: CellOverlay = (x, y) => {
    const key = `${x},${y}`;
    const base: CellPatch | undefined =
      x >= 0 && x < 20 && y >= 0 && y < 10 ? { block: 'meadow_grass', decor: '', level: 2 } : undefined;
    const over = patches[key];
    if (!over) return base;
    return { ...base, ...over };
  };
  return new WorldTerrain(SEED, P, { overlay });
}

/** Feet point in the middle of cell (cx, cy). */
const at = (cx: number, cy: number) => ({ x: cx * TILE + TILE / 2, y: cy * TILE + 26 });

/** Run `frames` steps of 50 ms with a fixed input and return every position visited. */
function run(world: WorldTerrain, start: { x: number; y: number }, ix: number, iy: number, frames: number) {
  const out = [start];
  let p = start;
  for (let i = 0; i < frames; i++) {
    p = stepWorld(world, p.x, p.y, ix, iy, 0.05);
    out.push(p);
  }
  return out;
}

describe('stepWorld (P17.14): client prediction with the shared rules', () => {
  it('walks at the office speed in the input direction on open ground', () => {
    const world = plain();
    const start = at(4, 4);
    const end = stepWorld(world, start.x, start.y, 1, 0, 0.05);
    expect(end.y).toBe(start.y);
    expect(end.x - start.x).toBeCloseTo(SPEED_PX * 0.05, 6);
  });

  it('does nothing without input, and never moves on a zero step', () => {
    const world = plain();
    const start = at(4, 4);
    expect(stepWorld(world, start.x, start.y, 0, 0, 0.05)).toEqual(start);
    expect(stepWorld(world, start.x, start.y, 1, 0, 0)).toEqual(start);
  });

  it('stops at a solid cell, with the feet box still clear of it', () => {
    const world = plain({ '6,4': { decor: 'wood_wall' } });
    const frames = run(world, at(2, 4), 1, 0, 200);
    const last = frames[frames.length - 1]!;
    expect(worldCollides(world, last.x, last.y)).toBe(false);
    // the box's right edge never reaches the wall's left edge (cell 6 starts at 192 px)
    expect(last.x + FEET_W / 2).toBeLessThanOrEqual(6 * TILE);
    expect(last.x).toBeGreaterThan(at(2, 4).x);
  });

  it('slides along a wall: a diagonal into a wall moves only along it', () => {
    // a wall column at cell x 6 for rows 0..9
    const patches: Record<string, CellPatch> = {};
    for (let y = 0; y < 10; y++) patches[`6,${y}`] = { decor: 'wood_wall' };
    const world = plain(patches);
    const start = at(4, 4);
    const frames = run(world, start, 1, 1, 10);
    const last = frames[frames.length - 1]!;
    expect(last.y).toBeGreaterThan(start.y + 10);
    expect(last.x + FEET_W / 2).toBeLessThanOrEqual(6 * TILE);
    for (const p of frames) expect(worldCollides(world, p.x, p.y)).toBe(false);
  });

  it('refuses a cliff of two levels, and climbs one level', () => {
    // the feet decide the cell (the server checks the same), so the feet stay in cell 5 and the
    // body may overlap the cliff's edge by its half width
    const cliff = plain({ '6,4': { level: 4 } });
    const cliffFrames = run(cliff, at(2, 4), 1, 0, 200);
    expect(Math.floor(cliffFrames[cliffFrames.length - 1]!.x / TILE)).toBe(5);

    const step = plain({ '6,4': { level: 3 } });
    const stepFrames = run(step, at(2, 4), 1, 0, 200);
    // a single level is a step: the walker gets past the cell line
    expect(stepFrames[stepFrames.length - 1]!.x).toBeGreaterThan(7 * TILE);
  });

  it('climbs a two-level rise over stairs (a ramp)', () => {
    const stairs = plain({ '6,4': { level: 4, decor: 'stone_stairs' } });
    const frames = run(stairs, at(2, 4), 1, 0, 200);
    expect(frames[frames.length - 1]!.x).toBeGreaterThan(7 * TILE);
  });

  it('never leaves a walkable position, whatever the input sequence', () => {
    const patches: Record<string, CellPatch> = { '5,3': { decor: 'boulder' }, '9,6': { decor: 'oak_tree' }, '12,4': { level: 5 } };
    const world = plain(patches);
    let p = at(3, 3);
    const inputs: [number, number][] = [
      [1, 0],
      [1, 1],
      [0, 1],
      [-1, 1],
      [-1, 0],
      [-1, -1],
      [0, -1],
      [1, -1],
    ];
    for (let i = 0; i < 400; i++) {
      const [ix, iy] = inputs[(i * 7) % inputs.length]!;
      p = stepWorld(world, p.x, p.y, ix, iy, 0.05);
      expect(worldCollides(world, p.x, p.y)).toBe(false);
    }
  });
});

describe('findWorldPath corners (P17.14): a diagonal must be a walk the feet can take', () => {
  it('finds no route across a checkerboard of cliffs: every way past is a diagonal past a corner', () => {
    const patches: Record<string, CellPatch> = {};
    for (let x = 4; x <= 12; x++)
      for (let y = 0; y <= 9; y++) patches[`${x},${y}`] = { level: (x + y) % 2 === 0 ? 4 : 2 };
    const world = plain(patches);
    expect(findWorldPath(world, { cx: 2, cy: 5 }, { cx: 14, cy: 5 })).toBeNull();
  });

  it('plans a route round a wall of cliffs, and every diagonal in it has both cells beside it legal', () => {
    const patches: Record<string, CellPatch> = {};
    for (let x = 4; x <= 12; x++) for (let y = 1; y <= 9; y++) patches[`${x},${y}`] = { level: 4 };
    const world = plain(patches);
    const path = findWorldPath(world, { cx: 2, cy: 5 }, { cx: 14, cy: 5 });
    expect(path).not.toBeNull();
    let here = { cx: 2, cy: 5 };
    for (const next of path!) {
      const diagonal = next.cx !== here.cx && next.cy !== here.cy;
      if (diagonal) {
        expect(canStep(world.cellAt(here.cx, here.cy), world.cellAt(next.cx, here.cy))).toBe(true);
        expect(canStep(world.cellAt(here.cx, here.cy), world.cellAt(here.cx, next.cy))).toBe(true);
      }
      here = next;
    }
    expect(here).toEqual({ cx: 14, cy: 5 });
  });
});
