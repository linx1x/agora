import { describe, expect, it } from 'vitest';
import { focal } from '../../game3d/camera';
import {
  chunkKey,
  chunksIn,
  cellOnRay,
  heightOf,
  LEVEL_TILES,
  screenShift,
  southFace,
  windowOf,
  worldOfDrawn,
} from './math3d';

const flat = () => 0;

describe('heights and cliffs', () => {
  it('a level is 12 px of the flat view over 32 px a tile', () => {
    expect(LEVEL_TILES).toBe(0.375);
    expect(heightOf(0)).toBe(0);
    expect(heightOf(4)).toBe(1.5);
  });

  it('a cell level with or below its southern neighbour has no south face', () => {
    expect(southFace(2, 2)).toBeNull();
    expect(southFace(1, 3)).toBeNull();
  });

  it('a step of one level is a plain face, two or more levels is a steep cliff', () => {
    expect(southFace(3, 2)).toEqual({ low: heightOf(2), high: heightOf(3), steep: false });
    expect(southFace(4, 1)).toEqual({ low: heightOf(1), high: heightOf(4), steep: true });
  });
});

describe('cellOnRay', () => {
  it('a ray straight down meets the cell under it', () => {
    expect(cellOnRay([5.5, 10, 5.5], [0, -1, 0], flat)).toEqual({ cx: 5, cy: 5 });
  });

  it('a ray going down the view meets a raised plateau before the floor behind it', () => {
    // the plateau (3,3) stands 4 levels (1.5 tiles) up; the ray passes over (3,2) at floor level
    const levelAt = (cx: number, cy: number) => (cx === 3 && cy === 3 ? 4 : 0);
    expect(cellOnRay([3.5, 4, 0], [0, -1, 1], levelAt)).toEqual({ cx: 3, cy: 3 });
  });

  it('a ray pointing up meets nothing', () => {
    expect(cellOnRay([0, 1, 0], [0, 1, 1], flat)).toBeNull();
  });
});

describe('chunks and windows', () => {
  it('a window covers the floor points with margins, north the most', () => {
    const w = windowOf([
      { x: 10.2, z: 20.7 },
      { x: 12.9, z: 25.1 },
    ]);
    expect(w).toEqual({ x0: 8, y0: 14, x1: 14, y1: 27 });
  });

  it('negative cells are in chunk -1 and cells 0..31 in chunk 0', () => {
    const keys = chunksIn({ x0: -1, y0: -1, x1: 0, y1: 0 }).map(chunkKey);
    expect(keys).toEqual(['-1,-1', '0,-1', '-1,0', '0,0']);
    expect(chunksIn({ x0: 0, y0: 0, x1: 31, y1: 31 })).toEqual([{ ix: 0, iy: 0 }]);
  });
});

describe('worldOfDrawn: the flat view\'s pixels, as the 2.5D view has them (P17.21c)', () => {
  it('flat ground is the same point at height 0', () => {
    expect(worldOfDrawn(100, 100, () => 0)).toEqual({ x: 100, y: 100, height: 0 });
  });

  it('the top face centre of a raised cell maps to that cell, at its top height', () => {
    // cell (3, 4) at level 2: its top is drawn 24 px higher than the floor (12 px a level)
    const levels = (cx: number, cy: number) => (cx === 3 && cy === 4 ? 2 : 0);
    const drawn = { x: 3 * 32 + 16, y: 4 * 32 + 16 - 24 };
    const w = worldOfDrawn(drawn.x, drawn.y, levels);
    expect(w.x).toBe(3 * 32 + 16);
    expect(w.y).toBe(4 * 32 + 16);
    expect(w.height).toBeCloseTo(0.75, 6);
  });
});

describe('screenShift: a slide of the view in screen pixels (P17.21c)', () => {
  const cam = { tx: 5, tz: 5, tilt: 35, dist: 10, fov: 30, w: 800, h: 600 };
  it('no shift is no move', () => {
    for (const v of screenShift(cam, 0, 0)) expect(v).toBeCloseTo(0, 12);
  });
  it('right moves along the world x axis, by the px-to-tile scale at the target', () => {
    const k = cam.dist / focal(cam.h, cam.fov);
    const [x, y, z] = screenShift(cam, 4, 0);
    expect(x).toBeCloseTo(4 * k, 9);
    expect(y).toBeCloseTo(0, 12);
    expect(z).toBeCloseTo(0, 12);
  });
  it('up follows the camera up axis, (0, cos tilt, -sin tilt): it has height and goes north', () => {
    const k = cam.dist / focal(cam.h, cam.fov);
    const t = (35 * Math.PI) / 180;
    const [x, y, z] = screenShift(cam, 0, 4);
    expect(x).toBeCloseTo(0, 12);
    expect(y).toBeCloseTo(4 * k * Math.cos(t), 9);
    expect(z).toBeCloseTo(-4 * k * Math.sin(t), 9);
  });
});
