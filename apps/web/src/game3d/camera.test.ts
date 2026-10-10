import { describe, expect, it } from 'vitest';
import {
  DOCK_PX,
  TILT,
  camPos,
  clampTarget,
  distForZoom,
  dockPx,
  fitZoom,
  followStep,
  project,
  unprojectFloor,
  type Cam,
} from './camera';

const base = (w: number, h: number, zoom: number): Cam => {
  const fov = 30;
  return { tx: 19.5, tz: 9.2, tilt: TILT, dist: distForZoom(zoom, h, fov), fov, w, h };
};

const VIEWPORTS: [number, number][] = [
  [1280, 800],
  [390, 680],
  [1920, 1080],
  [600, 900],
];

describe('2.5D camera maths (ADR-052)', () => {
  it('puts the target in the middle of the viewport', () => {
    for (const [w, h] of VIEWPORTS)
      for (const zoom of [1, 2, 3, 4]) {
        const c = base(w, h, zoom);
        const p = project(c, [c.tx, 0, c.tz])!;
        expect(p.x).toBeCloseTo(w / 2, 6);
        expect(p.y).toBeCloseTo(h / 2, 6);
      }
  });

  it('round-trips floor points through unprojectFloor across the screen at zoom 1–4', () => {
    for (const [w, h] of VIEWPORTS)
      for (const zoom of [1, 2, 3, 4]) {
        const c = base(w, h, zoom);
        // a grid of screen points on the floor, away from the screen edge
        for (let fx = 0.1; fx <= 0.91; fx += 0.2)
          for (let fy = 0.1; fy <= 0.91; fy += 0.2) {
            const sx = w * fx;
            const sy = h * fy;
            const floor = unprojectFloor(c, sx, sy);
            if (!floor) continue;
            const back = project(c, [floor.x, 0, floor.z])!;
            expect(back.x).toBeCloseTo(sx, 6);
            expect(back.y).toBeCloseTo(sy, 6);
          }
        // and floor points project and invert back to themselves
        for (const [x, z] of [
          [c.tx - 3, c.tz - 2],
          [c.tx + 2, c.tz + 1],
          [c.tx, c.tz],
        ] as const) {
          const s = project(c, [x, 0, z])!;
          const f = unprojectFloor(c, s.x, s.y)!;
          expect(f.x).toBeCloseTo(x, 6);
          expect(f.z).toBeCloseTo(z, 6);
        }
      }
  });

  it('returns null for a screen point whose ray misses the floor (above the horizon)', () => {
    const c = base(1280, 800, 2);
    expect(unprojectFloor(c, 640, -2000)).toBeNull();
  });

  it('returns null for a floor point behind the camera', () => {
    const c = base(1280, 800, 2);
    expect(project(c, [c.tx, 0, c.tz + 200])).toBeNull();
  });

  it('draws a tile at the target 32 * zoom px across', () => {
    for (const [w, h] of VIEWPORTS)
      for (const zoom of [1, 2, 3, 4]) {
        const c = base(w, h, zoom);
        expect(project(c, [c.tx, 0, c.tz])!.s).toBeCloseTo(32 * zoom, 6);
      }
  });

  it('keeps the view direction at every zoom and tilts it 35 degrees from the floor', () => {
    const dirOf = (c: Cam) => {
      const [x, y, z] = camPos(c);
      const v = [c.tx - x, 0 - y, c.tz - z];
      const n = Math.hypot(v[0]!, v[1]!, v[2]!);
      return v.map((q) => q / n);
    };
    const ref = dirOf(base(1280, 800, 1));
    for (const zoom of [1, 2, 3, 4]) {
      const d = dirOf(base(1280, 800, zoom));
      expect(d[0]).toBeCloseTo(ref[0]!, 9);
      expect(d[1]).toBeCloseTo(ref[1]!, 9);
      expect(d[2]).toBeCloseTo(ref[2]!, 9);
      // the angle between the view and the floor (its horizontal part is the same at every zoom)
      expect((Math.asin(-d[1]!) * 180) / Math.PI).toBeCloseTo(TILT, 6);
    }
  });

  it('makes nearer things bigger', () => {
    const c = base(1280, 800, 2);
    expect(project(c, [c.tx, 0, c.tz + 4])!.s).toBeGreaterThan(project(c, [c.tx, 0, c.tz - 4])!.s);
  });

  describe('clampTarget', () => {
    // the footprint at zoom 1 is about 51 tiles tall, so the large region must be taller than that
    const big = { x: 0, z: 0, w: 80, h: 80 };
    it('keeps the four footprint points inside a large region', () => {
      for (const zoom of [1, 2, 4]) {
        const c = base(1280, 800, zoom);
        for (const t of [
          { x: -50, z: -50 },
          { x: 300, z: 300 },
          { x: 0.2, z: 0.1 },
          { x: 79, z: 79 },
        ]) {
          const r = clampTarget(t, big, c);
          const pts = [
            unprojectFloor({ ...c, tx: r.x, tz: r.z }, 0, c.h)!,
            unprojectFloor({ ...c, tx: r.x, tz: r.z }, c.w, c.h)!,
            unprojectFloor({ ...c, tx: r.x, tz: r.z }, c.w / 2, 0)!,
          ];
          for (const p of pts) {
            expect(p.x).toBeGreaterThanOrEqual(big.x - 1e-6);
            expect(p.x).toBeLessThanOrEqual(big.x + big.w + 1e-6);
            expect(p.z).toBeGreaterThanOrEqual(big.z - 1e-6);
            expect(p.z).toBeLessThanOrEqual(big.z + big.h + 1e-6);
          }
        }
      }
    });

    it('leaves a target that is already inside alone', () => {
      const c = base(1280, 800, 2);
      const t = { x: 30, z: 20 };
      expect(clampTarget(t, big, c)).toEqual(t);
    });

    it('pulls a target far outside back into the region', () => {
      const c = base(1280, 800, 2);
      const r = clampTarget({ x: 900, z: -900 }, big, c);
      expect(r.x).toBeLessThan(big.w);
      expect(r.z).toBeGreaterThan(big.z);
    });

    it('centres on a region smaller than the view, on that axis', () => {
      const c = base(1280, 800, 4);
      const small = { x: 10, z: 5, w: 6, h: 60 };
      const r = clampTarget({ x: 100, z: 0 }, small, c);
      expect(r.x).toBeCloseTo(small.x + small.w / 2, 6);
      // the tall axis still clamps as usual
      expect(r.z).toBeGreaterThanOrEqual(small.z);
    });
  });

  describe('followStep', () => {
    it('two 8.33 ms steps move about as far as one 16.67 ms step', () => {
      const cur = { x: 0, z: 0 };
      const target = { x: 10, z: -4 };
      const one = followStep(cur, target, 1000 / 30);
      const two = followStep(followStep(cur, target, 1000 / 60), target, 1000 / 60);
      expect(two.x).toBeCloseTo(one.x, 9);
      expect(two.z).toBeCloseTo(one.z, 9);
    });

    it('does not move when dtMs is 0', () => {
      const cur = { x: 3, z: 7 };
      expect(followStep(cur, { x: 50, z: -20 }, 0)).toEqual(cur);
    });

    it('converges for a long frame', () => {
      const r = followStep({ x: 0, z: 0 }, { x: 10, z: 10 }, 1000);
      expect(r.x).toBeCloseTo(10, 3);
      expect(r.z).toBeCloseTo(10, 3);
    });

    it('closes 18% of the gap per 60 fps frame', () => {
      const r = followStep({ x: 0, z: 0 }, { x: 10, z: 0 }, 1000 / 60);
      expect(r.x).toBeCloseTo(1.8, 9);
    });
  });

  describe('dockPx (ADR-035)', () => {
    it('reserves the dock only for the compact layout in portrait with touch controls on', () => {
      expect(dockPx(true, true, true)).toBe(DOCK_PX);
      expect(dockPx(true, false, true)).toBe(0);
      expect(dockPx(false, true, true)).toBe(0);
      expect(dockPx(true, true, false)).toBe(0);
    });
  });

  describe('fitZoom', () => {
    it('follows the 2D rule and stays between 1 and 3', () => {
      expect(fitZoom(100, 100)).toBe(1);
      expect(fitZoom(22 * 32, 14 * 32)).toBe(1);
      expect(fitZoom(44 * 32, 28 * 32)).toBe(2);
      expect(fitZoom(9999, 9999)).toBe(3);
    });
  });
});
