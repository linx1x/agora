import { describe, expect, it } from 'vitest';
import { OVERLAY_GRID, tierOverlay } from './overlay';

describe('overlay: the code-drawn tier mark (P17.21)', () => {
  it('a tier draws as many pixels as its number, in its colour', () => {
    expect([1, 2, 3].map((t) => tierOverlay(t).pixels.length)).toEqual([1, 2, 3]);
    expect(new Set([1, 2, 3].map((t) => tierOverlay(t).color)).size).toBe(3);
  });

  it('every pixel lies on the grid, in the bottom-right corner, without repeats', () => {
    for (const t of [1, 2, 3]) {
      const pixels = tierOverlay(t).pixels;
      for (const [x, y] of pixels) {
        expect(x).toBeGreaterThanOrEqual(0);
        expect(x).toBeLessThan(OVERLAY_GRID);
        expect(y).toBe(OVERLAY_GRID - 2);
      }
      expect(new Set(pixels.map(([x, y]) => `${x},${y}`)).size).toBe(pixels.length);
    }
  });

  it('a higher tier keeps the lower tier pixels and adds one to the left', () => {
    const one = tierOverlay(1).pixels;
    const three = tierOverlay(3).pixels;
    expect(three.slice(-1)).toEqual(one);
    expect(three).toEqual([
      [4, 6],
      [5, 6],
      [6, 6],
    ]);
  });

  it('refuses a tier outside 1 to 3', () => {
    expect(() => tierOverlay(0)).toThrow(RangeError);
    expect(() => tierOverlay(4)).toThrow(RangeError);
  });
});
