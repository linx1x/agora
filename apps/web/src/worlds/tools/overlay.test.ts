import { describe, expect, it } from 'vitest';
import { OVERLAY_GRID, tierOverlay, type OverlayRect } from './overlay';

const inside = (r: OverlayRect, outer: OverlayRect) =>
  r.x >= outer.x && r.y >= outer.y && r.x + r.w <= outer.x + outer.w && r.y + r.h <= outer.y + outer.h;

describe('overlay: the code-drawn tier mark (P17.21, P17.21d)', () => {
  it('a tier draws as many pips as its number, in its colour', () => {
    expect([1, 2, 3].map((t) => tierOverlay(t).pips.length)).toEqual([1, 2, 3]);
    expect(new Set([1, 2, 3].map((t) => tierOverlay(t).color)).size).toBe(3);
  });

  it('the plate sits in the bottom-right corner of the card grid, and every pip is on the plate', () => {
    for (const t of [1, 2, 3]) {
      const o = tierOverlay(t);
      expect(o.plate.x + o.plate.w).toBeLessThanOrEqual(OVERLAY_GRID);
      expect(o.plate.y + o.plate.h).toBeLessThanOrEqual(OVERLAY_GRID);
      expect(o.plate.x + o.plate.w).toBeGreaterThan(OVERLAY_GRID / 2);
      expect(o.plate.y + o.plate.h).toBeGreaterThan(OVERLAY_GRID / 2);
      for (const pip of o.pips) expect(inside(pip, o.plate)).toBe(true);
    }
  });

  it('pips never overlap, and a pip is at least 3 px square so it reads at 1x', () => {
    for (const t of [1, 2, 3]) {
      const pips = tierOverlay(t).pips;
      for (const [i, a] of pips.entries())
        for (const b of pips.slice(i + 1))
          expect(a.x + a.w <= b.x || b.x + b.w <= a.x).toBe(true);
      for (const pip of pips) expect(Math.min(pip.w, pip.h)).toBeGreaterThanOrEqual(3);
    }
  });

  it('the pips of a tier are centred on the plate', () => {
    for (const t of [1, 2, 3]) {
      const o = tierOverlay(t);
      const left = Math.min(...o.pips.map((p) => p.x)) - o.plate.x;
      const right = o.plate.x + o.plate.w - Math.max(...o.pips.map((p) => p.x + p.w));
      expect(Math.abs(left - right)).toBeLessThanOrEqual(1);
    }
  });

  it('refuses a tier outside 1 to 3', () => {
    expect(() => tierOverlay(0)).toThrow(RangeError);
    expect(() => tierOverlay(4)).toThrow(RangeError);
  });
});
