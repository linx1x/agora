import { describe, expect, it } from 'vitest';
import { blipFrequency, BLIP_HZ } from './sound';
import { shakeIntensity, sparkCount, swingParams } from './swing';

describe('the hit juice of a tool (P17.21b)', () => {
  it('throws more sparks at a higher tier, from 4 to 8', () => {
    expect([1, 2, 3].map(sparkCount)).toEqual([4, 6, 8]);
    expect(() => sparkCount(4)).toThrow(RangeError);
  });

  it('shakes the view by about two pixels a tier each way, as a share of the width', () => {
    expect(shakeIntensity(2, 1000)).toBeCloseTo(0.004, 10);
    expect(shakeIntensity(0, 1000)).toBe(0);
    expect(shakeIntensity(3, 0)).toBe(0);
  });

  it('does not shake under reduced motion, through the swing parameters', () => {
    const tool = { tier: 3, speed: 1.5 };
    expect(swingParams(tool, 'up', true).shakePx).toBe(0);
    expect(swingParams(tool, 'up', false).shakePx).toBe(7);
    expect(shakeIntensity(swingParams(tool, 'up', true).shakePx, 1280)).toBe(0);
  });

  it('plays the blip at the tier pitch: the base tone at tier 1, higher per tier', () => {
    expect(blipFrequency(1)).toBe(BLIP_HZ);
    expect(blipFrequency(1.1)).toBeCloseTo(BLIP_HZ * 1.1, 10);
  });
});
