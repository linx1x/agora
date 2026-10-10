import { describe, expect, it } from 'vitest';
import { flipScale, project, unprojectFloor, type Cam } from './camera';

const cam: Cam = { tx: 19.5, tz: 9.2, tilt: 35, dist: 14, fov: 30, w: 1280, h: 800 };

describe('fixed-tilt camera (ADR-052)', () => {
  it('puts the target in the middle of the screen', () => {
    const p = project(cam, [cam.tx, 0, cam.tz])!;
    expect(p.x).toBeCloseTo(640, 6);
    expect(p.y).toBeCloseTo(400, 6);
  });
  it('click-to-floor inverts the projection at every tilt', () => {
    for (const tilt of [30, 35, 45, 55])
      for (const [x, z] of [[12, 4], [19.5, 9.2], [25, 15], [17.25, 12.75]] as const) {
        const c = { ...cam, tilt };
        const s = project(c, [x, 0, z]);
        if (!s) continue;
        const f = unprojectFloor(c, s.x, s.y)!;
        expect(f.x).toBeCloseTo(x, 6);
        expect(f.z).toBeCloseTo(z, 6);
      }
  });
  it('makes nearer things bigger', () => {
    expect(project(cam, [19.5, 0, 14])!.s).toBeGreaterThan(project(cam, [19.5, 0, 4])!.s);
  });
  it('flips a card from mirrored to normal through zero width', () => {
    expect(flipScale(0)).toBe(-1);
    expect(Math.abs(flipScale(0.5))).toBeLessThanOrEqual(0.04);
    expect(flipScale(1)).toBe(1);
  });
});
