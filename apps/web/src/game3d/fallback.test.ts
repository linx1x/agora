import { describe, expect, it } from 'vitest';
import { FrameRate, SLOW_FPS, SLOW_HOLD_MS, SlowWatch } from './fallback';

/** Frames every `ms` from `from` to `to` (inclusive); returns the readings that closed windows. */
function run(r: FrameRate, from: number, to: number, ms: number): number[] {
  const out: number[] = [];
  for (let t = from; t <= to + 1e-9; t += ms) {
    const v = r.frame(t);
    if (v !== null) out.push(v);
  }
  return out;
}

describe('FrameRate', () => {
  it('reads frames per second over each window, after the warm-up', () => {
    const r = new FrameRate(1000, 600);
    // 60 fps (16.67 ms frames) for 4 s: warm-up first, then one reading per second
    const readings = run(r, 0, 4000, 1000 / 60);
    expect(readings.length).toBeGreaterThanOrEqual(3);
    for (const fps of readings) expect(fps).toBeGreaterThan(55);
    for (const fps of readings) expect(fps).toBeLessThan(65);
  });

  it('does not count the warm-up frames', () => {
    const r = new FrameRate(1000, 600);
    // 5 fps during the warm-up, 30 fps after: the first reading is 30, not a mean of both
    const slow = run(r, 0, 500, 200);
    expect(slow).toEqual([]);
    const fast = run(r, 600, 1700, 1000 / 30);
    expect(fast.length).toBeGreaterThanOrEqual(1);
    expect(fast[0]!).toBeGreaterThan(28);
    expect(fast[0]!).toBeLessThan(32);
  });

  it('gives no reading before the first window has closed', () => {
    const r = new FrameRate(3000);
    expect(run(r, 0, 2500, 100)).toEqual([]);
  });
});

describe('SlowWatch (the fallback timer)', () => {
  const at = (w: SlowWatch, from: number, to: number, fps: number) => {
    let trips = 0;
    for (let t = from; t <= to; t += 1000) if (w.sample(t, fps)) trips += 1;
    return trips;
  };

  it('trips once after the hold under the floor, not before', () => {
    const w = new SlowWatch();
    expect(SLOW_FPS).toBe(20);
    expect(SLOW_HOLD_MS).toBe(15_000);
    // readings each second from 0 to 14 s: still short of the hold
    expect(at(w, 0, 14_000, 10)).toBe(0);
    // the reading at 15 s completes the hold, and it trips once only
    expect(w.sample(15_000, 10)).toBe(true);
    expect(w.sample(16_000, 10)).toBe(false);
    expect(w.sample(60_000, 5)).toBe(false);
  });

  it('a reading at the floor or above starts the count again', () => {
    const w = new SlowWatch();
    expect(at(w, 0, 10_000, 10)).toBe(0);
    expect(w.sample(11_000, 20)).toBe(false); // exactly the floor is fine
    expect(at(w, 12_000, 22_000, 10)).toBe(0); // 11 s slow again: not enough
    expect(w.sample(27_000, 10)).toBe(true);
  });

  it('a smooth view never trips it', () => {
    const w = new SlowWatch();
    expect(at(w, 0, 120_000, 30)).toBe(0);
  });
});
