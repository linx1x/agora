import { describe, expect, it } from 'vitest';
import { chunkKey, chunkOfPoint, chunksInView } from './view';

describe('chunkOfPoint', () => {
  it('maps world pixels to chunks of 32 x 32 cells of 32 px, flooring toward minus infinity', () => {
    expect(chunkOfPoint(0, 0)).toEqual({ cx: 0, cy: 0 });
    expect(chunkOfPoint(1023.9, 0)).toEqual({ cx: 0, cy: 0 });
    expect(chunkOfPoint(1024, 0)).toEqual({ cx: 1, cy: 0 });
    expect(chunkOfPoint(-0.5, -1024)).toEqual({ cx: -1, cy: -1 });
  });
});

describe('chunksInView', () => {
  it('is the square of chunks around the centre, row by row from the top-left', () => {
    const view = chunksInView({ cx: 0, cy: 0 }, 2);
    expect(view).toHaveLength(25);
    expect(view[0]).toEqual({ cx: -2, cy: -2 });
    expect(view[24]).toEqual({ cx: 2, cy: 2 });
    expect(chunksInView({ cx: 3, cy: -1 }, 0)).toEqual([{ cx: 3, cy: -1 }]);
  });

  it('gives chunk keys that do not collide', () => {
    const keys = new Set(chunksInView({ cx: 0, cy: 0 }, 2).map((c) => chunkKey(c.cx, c.cy)));
    expect(keys.size).toBe(25);
    expect(chunkKey(1, -2)).toBe('1,-2');
  });
});
