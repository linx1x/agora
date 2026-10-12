import { describe, expect, it } from 'vitest';
import { plantedSoilGeometry, plantingDepth, soilHeight } from './cropSoil';
import { groundedGeometry } from './grounding';

describe('planted crop soil', () => {
  it('keeps the whole plot continuous with adjacent floor tiles, through all ages', () => {
    for (let stage = 0; stage < 5; stage++) {
      const geometry = plantedSoilGeometry(stage, 103);
      const p = geometry.getAttribute('position');
      for (let i = 0; i < p.count; i++) {
        expect(p.getY(i)).toBeGreaterThanOrEqual(0);
        expect(p.getY(i)).toBeLessThan(0.06);
        if (Math.abs(p.getX(i)) === 0.5 || Math.abs(p.getZ(i)) === 0.5) expect(p.getY(i)).toBe(0);
      }
      geometry.dispose();
    }
    expect(soilHeight(0.5, 0.6, 4, 103)).toBeGreaterThan(soilHeight(0.5, 0.6, 0, 103));
  });

  it('buries the radish taproot beneath the earth but leaves the upper bulb shoulder exposed', () => {
    const depth = plantingDepth('dawn_radish', 4);
    const body = groundedGeometry(0.85, 0.85, { bottom: 95 / 96, footHeight: 0 });
    body.translate(0, -depth, 0);
    const earth = soilHeight(0.5, 0.6, 4, 102);
    expect(body.getAttribute('position').getY(144)).toBeLessThan(0);
    expect(0.06 - depth).toBeLessThan(earth);
    expect(0.15 - depth).toBeGreaterThan(earth);
    expect(plantingDepth('dawn_radish', 0)).toBeLessThan(0.015);
    body.dispose();
  });
});
