import { describe, expect, it } from 'vitest';
import { birdPose, type Place } from './life';
const perches: Place[] = [
  [1, 2, 1],
  [7, 2, 1],
  [11, 2.5, 1],
];
describe('bird behaviour', () => {
  it('visits another tree, lands to peck, hops and returns to its first perch', () => {
    expect(birdPose(0, 0, perches)).toMatchObject({ state: 'perch', at: perches[0] });
    expect(birdPose(6, 0, perches).state).toBe('fly');
    expect(birdPose(8, 0, perches)).toMatchObject({ state: 'perch', at: perches[1] });
    expect(birdPose(18, 0, perches).state).toBe('peck');
    expect(birdPose(18, 0, perches).at[1]).toBe(0.02);
    expect(birdPose(24, 0, perches).state).toBe('hop');
    expect(birdPose(27, 0, perches).state).toBe('fly');
    expect(birdPose(30, 0, perches).at).toEqual(perches[0]);
  });
  it('has continuous positions at every transition, independent of frame rate', () => {
    for (const t of [5, 8, 12, 15, 23, 26, 30]) {
      const before = birdPose(t - 1e-6, 0, perches).at,
        after = birdPose(t, 0, perches).at;
      expect(Math.hypot(...before.map((v, i) => v - after[i]!))).toBeLessThan(0.001);
    }
    expect(new Set([0, 1, 2].map((i) => birdPose(0, i, perches).state)).size).toBeGreaterThan(1);
  });
});
