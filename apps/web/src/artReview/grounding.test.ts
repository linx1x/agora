import { describe, expect, it } from 'vitest';
import { TILT } from '../game3d/camera';
import {
  FLOOR_CLEARANCE,
  SUN_SHADOW,
  groundedGeometry,
  groundedPoint,
  shadowGeometry,
} from './grounding';

describe('art review floor contact', () => {
  it('puts raised painted rear feet on the floor without flattening their screen appearance', () => {
    const tilt = (TILT * Math.PI) / 180;
    for (const height of [0, 0.04, 0.12, 0.25, 0.8, 2.8]) {
      const [x, y, z] = groundedPoint(0.3, height, 0.25);
      expect(x).toBe(0.3);
      expect(y * Math.cos(tilt) - z * Math.sin(tilt)).toBeCloseTo(height * Math.cos(tilt), 8);
      if (height <= 0.25) expect(y).toBe(0);
      else expect(y).toBeGreaterThan(0);
    }
  });

  it('anchors the opaque foot instead of the transparent bottom of the image', () => {
    const g = groundedGeometry(1, 2, { bottom: 0.75, footHeight: 0.12 }, 4);
    const p = g.getAttribute('position');
    // The visible foot is at 75% down a padded sheet (row 3), not the canvas's bottom row.
    expect(p.getY(6)).toBeCloseTo(FLOOR_CLEARANCE);
    expect(p.getZ(6)).toBeCloseTo(0);
    for (let i = 0; i < p.count; i++)
      expect(p.getY(i)).toBeGreaterThanOrEqual(FLOOR_CLEARANCE - 1e-6);
    g.dispose();
  });

  it('keeps cast shadows connected at ground level and projects height away from the same sun', () => {
    const body = groundedGeometry(1, 2, { bottom: 1, footHeight: 0.1 }, 20);
    const cast = shadowGeometry(body, false);
    const contact = shadowGeometry(body, true);
    const b = body.getAttribute('position'),
      s = cast.getAttribute('position');
    const a = contact.getAttribute('color');
    for (let i = 0; i < b.count; i++) {
      const h = Math.max(0, b.getY(i) - FLOOR_CLEARANCE);
      expect(s.getX(i)).toBeCloseTo(b.getX(i) + h * SUN_SHADOW.x, 5);
      expect(s.getZ(i)).toBeCloseTo(b.getZ(i) + h * SUN_SHADOW.z, 5);
      expect(s.getY(i)).toBeCloseTo(0.001);
    }
    // Contact darkening is confined to supports; it cannot duplicate a dark canopy on the floor.
    expect(a.getW(0)).toBeLessThan(0.001);
    expect(a.getW(a.count - 1)).toBeCloseTo(1);
    body.dispose();
    cast.dispose();
    contact.dispose();
  });
});
