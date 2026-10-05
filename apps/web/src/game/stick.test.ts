import { describe, expect, it } from 'vitest';
import { snapDir, stickVector } from './stick';

describe('stickVector (P8.2)', () => {
  it('is still inside the dead zone', () => {
    expect(stickVector(5, 5, 46).dir).toEqual([0, 0]);
    expect(stickVector(0, 0, 46)).toEqual({ dir: [0, 0], knob: [0, 0] });
  });
  it('gives a unit direction outside the dead zone', () => {
    const { dir } = stickVector(30, 0, 46);
    expect(dir).toEqual([1, 0]);
    const d = stickVector(20, -20, 46).dir;
    expect(Math.hypot(d[0], d[1])).toBeCloseTo(1);
  });
  it('clamps the knob to the base radius', () => {
    const { knob } = stickVector(0, 200, 46);
    expect(knob).toEqual([0, 46]);
  });
  it('survives bad input', () => {
    expect(stickVector(NaN, 3, 46).dir).toEqual([0, 0]);
    expect(stickVector(3, 3, 0).dir).toEqual([0, 0]);
  });
});

describe('snapDir', () => {
  it('snaps to the nearest of 8 directions', () => {
    expect(snapDir([0.98, 0.2])).toEqual([1, 0]);
    expect(snapDir([0, -1])).toEqual([0, -1]);
    const [x, y] = snapDir([0.7, 0.75]);
    expect(x).toBeCloseTo(Math.SQRT1_2);
    expect(y).toBeCloseTo(Math.SQRT1_2);
    expect(snapDir([0, 0])).toEqual([0, 0]);
  });
});
