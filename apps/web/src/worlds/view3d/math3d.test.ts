import { describe, expect, it } from 'vitest';
import {
  chunkKey,
  chunksIn,
  cellOnRay,
  heightOf,
  LEVEL_TILES,
  southFace,
  windowOf,
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
