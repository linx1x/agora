import { describe, expect, it } from 'vitest';
import {
  BASE_SWING_MS,
  FACINGS,
  SWING_FRAMES,
  frameIndexAt,
  hitSound,
  shakePx,
  soundPitch,
  sparkPx,
  swingDurationMs,
  swingFrames,
  swingParams,
  tierFeel,
} from './swing';

const tool = (tier: number, speed = 1) => ({ tier, speed });

describe('swing: timing and juice per tool tier (P17.21)', () => {
  it('every facing has its own three frames, in order', () => {
    const all = FACINGS.flatMap((f) => swingFrames(f));
    expect(new Set(all).size).toBe(FACINGS.length * SWING_FRAMES);
    expect(swingFrames('left')).toEqual(['swing-left-0', 'swing-left-1', 'swing-left-2']);
  });

  it('a tier swings 10 % faster than the one below, and speed shortens the swing further', () => {
    expect(swingDurationMs(tool(1))).toBe(BASE_SWING_MS);
    expect(swingDurationMs(tool(2))).toBeCloseTo(BASE_SWING_MS * 0.9, 6);
    expect(swingDurationMs(tool(3))).toBeCloseTo(BASE_SWING_MS * 0.81, 6);
    expect(swingDurationMs(tool(3, 1.5))).toBeCloseTo((BASE_SWING_MS * 0.81) / 1.5, 6);
    expect(swingDurationMs(tool(2))).toBeLessThan(swingDurationMs(tool(1)));
    expect(swingDurationMs(tool(3))).toBeLessThan(swingDurationMs(tool(2)));
  });

  it('the frame follows the swing and holds the last one after it ends', () => {
    const d = 300;
    expect(frameIndexAt(-5, d)).toBe(0);
    expect(frameIndexAt(0, d)).toBe(0);
    expect(frameIndexAt(d / 3, d)).toBe(1);
    expect(frameIndexAt((2 * d) / 3, d)).toBe(2);
    expect(frameIndexAt(d - 1, d)).toBe(2);
    expect(frameIndexAt(d * 4, d)).toBe(SWING_FRAMES - 1);
    expect(frameIndexAt(10, 0)).toBe(0);
  });

  it('sparks grow with the tier (wood small, iron medium, diamond large), the shake grows with it and is off under reduced motion', () => {
    expect([1, 2, 3].map(sparkPx)).toEqual([5, 8, 12]);
    expect([1, 2, 3].map((t) => shakePx(t, false))).toEqual([2, 4, 7]);
    expect([1, 2, 3].map((t) => shakePx(t, true))).toEqual([0, 0, 0]);
  });

  it('the sound rises about 12 % per tier from the base pitch, and the click sharpens it', () => {
    expect(soundPitch(1)).toBe(1);
    expect(soundPitch(2)).toBeCloseTo(2 ** (2 / 12), 6);
    expect(soundPitch(3)).toBeCloseTo(2 ** (4 / 12), 6);
    expect([1, 2, 3].map((t) => hitSound(t).click)).toEqual([0, 0.35, 0.7]);
    expect(hitSound(3).decayMs).toBeLessThan(hitSound(1).decayMs);
  });

  it('a diamond hit is the largest and the only glowing one, and throws the most sparks', () => {
    const [wood, iron, diamond] = [1, 2, 3].map(tierFeel);
    expect(wood!.sparkPx).toBeLessThan(iron!.sparkPx);
    expect(iron!.sparkPx).toBeLessThan(diamond!.sparkPx);
    expect(wood!.sparkReachPx).toBeLessThan(diamond!.sparkReachPx);
    expect([wood!.bright, iron!.bright, diamond!.bright]).toEqual([false, false, true]);
    expect(diamond!.sparkCount).toBeGreaterThan(wood!.sparkCount);
    for (const f of [wood!, iron!, diamond!]) expect(f.sparks.length).toBeGreaterThan(0);
  });

  it('swingParams gathers the parts a view needs for one facing', () => {
    const p = swingParams(tool(2, 1), 'up', true);
    expect(p).toEqual({
      durationMs: swingDurationMs(tool(2)),
      frames: ['swing-up-0', 'swing-up-1', 'swing-up-2'],
      sparkPx: 8,
      shakePx: 0,
      pitch: soundPitch(2),
      hit: hitSound(2),
      feel: tierFeel(2),
    });
  });

  it('refuses a tier outside 1 to 3', () => {
    expect(() => sparkPx(0)).toThrow(RangeError);
    expect(() => swingDurationMs(tool(4))).toThrow(RangeError);
    expect(() => shakePx(1.5, false)).toThrow(RangeError);
  });
});
