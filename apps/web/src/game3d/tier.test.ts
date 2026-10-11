import { describe, expect, it } from 'vitest';
import {
  ALL_FEATURES,
  FrameRate,
  LOW_POINT_LIGHTS,
  LOWEST_PROBE_FPS,
  PHONE_PROBE_FPS,
  POINT_LIGHTS,
  PROBE_MS,
  PROBE_WARMUP_MS,
  QualityGovernor,
  RUNGS,
  SCALE_ONLY,
  SLOW_FPS,
  SLOW_HOLD_MS,
  SlowWatch,
  bottomRung,
  nextRung,
  postFx,
  probeVerdict,
  qualityOf,
  startTier,
  sunShadows,
  type GovernorStart,
  type QualityChange,
  type Tier,
} from './tier';

const GPU = 'ANGLE (NVIDIA, NVIDIA GeForce RTX 3080 Direct3D11)';
/** frames 16 ms apart (60 fps) and 200 ms apart (5 fps) */
const FAST = 16;
const SLOW = 200;
/** the time the probe takes to close, with the warm-up: after this the device is classed */
const PROBED = PROBE_WARMUP_MS + PROBE_MS + 200;

describe('probeVerdict (P16.11, ADR-054)', () => {
  it('a desktop-class graphics card that probes fast is the desktop tier', () => {
    expect(probeVerdict({ coarse: false, gpu: GPU, probeFps: 60 })).toBe('desktop');
    expect(probeVerdict({ coarse: false, gpu: GPU, probeFps: PHONE_PROBE_FPS })).toBe('desktop');
  });

  it('a touch screen is a phone whatever it probes', () => {
    expect(probeVerdict({ coarse: true, gpu: 'Adreno (TM) 750', probeFps: 120 })).toBe('phone');
  });

  it('a slow probe on a desktop gets the phone tier, down to the lowest floor', () => {
    expect(probeVerdict({ coarse: false, gpu: GPU, probeFps: PHONE_PROBE_FPS - 1 })).toBe('phone');
    expect(probeVerdict({ coarse: false, gpu: GPU, probeFps: LOWEST_PROBE_FPS })).toBe('phone');
  });

  it('a software renderer, or a probe under the lowest floor, starts at the bottom of the ladder', () => {
    expect(probeVerdict({ coarse: false, gpu: 'Google SwiftShader', probeFps: 60 })).toBe('bottom');
    expect(probeVerdict({ coarse: false, gpu: 'llvmpipe (LLVM 15)', probeFps: 90 })).toBe('bottom');
    expect(probeVerdict({ coarse: true, gpu: GPU, probeFps: 1 })).toBe('bottom');
    expect(probeVerdict({ coarse: false, gpu: GPU, probeFps: LOWEST_PROBE_FPS - 1 })).toBe(
      'bottom',
    );
  });

  it('the features follow the tier: shadows and post-processing are desktop only', () => {
    expect(sunShadows('desktop')).toBe(true);
    expect(sunShadows('phone')).toBe(false);
    expect(postFx('desktop')).toBe(true);
    expect(postFx('phone')).toBe(false);
  });

  it('a device starts on the phone tier when its pointer is coarse, else on desktop', () => {
    expect(startTier(true)).toBe('phone');
    expect(startTier(false)).toBe('desktop');
  });
});

describe('qualityOf: the rungs of the ladder (ADR-054)', () => {
  it('rung 0 is the full look of the tier', () => {
    expect(qualityOf('desktop', 0)).toEqual({
      scale: 1,
      post: true,
      shadows: true,
      pointLights: POINT_LIGHTS.desktop,
      lights: true,
    });
    expect(qualityOf('phone', 0)).toEqual({
      scale: 1,
      post: false,
      shadows: false,
      pointLights: POINT_LIGHTS.phone,
      lights: true,
    });
  });

  it('rungs 1 and 2 step the render scale 1 → 0.75 → 0.5 and change nothing else', () => {
    expect(qualityOf('desktop', 1)).toEqual({ ...qualityOf('desktop', 0), scale: 0.75 });
    expect(qualityOf('desktop', 2)).toEqual({ ...qualityOf('desktop', 0), scale: 0.5 });
  });

  it('rung 3 turns the post-processing off, and keeps the shadows and the lamps', () => {
    expect(qualityOf('desktop', 3)).toEqual({ ...qualityOf('desktop', 2), post: false });
  });

  it('rung 4 leaves two point lights in the pool', () => {
    expect(qualityOf('desktop', 4)).toEqual({
      ...qualityOf('desktop', 3),
      pointLights: LOW_POINT_LIGHTS,
    });
    expect(qualityOf('phone', 4).pointLights).toBe(LOW_POINT_LIGHTS);
  });

  it('rung 5 turns the lights off: no lamps, no shadows, the plain midday look', () => {
    expect(qualityOf('desktop', 5)).toEqual({
      scale: 0.5,
      post: false,
      shadows: false,
      pointLights: 0,
      lights: false,
    });
    expect(qualityOf('phone', 5)).toEqual(qualityOf('desktop', 5));
  });

  it('never draws more than the rung above it, and clamps out-of-range rungs', () => {
    for (const tier of ['desktop', 'phone'] as Tier[]) {
      for (let r = 1; r < RUNGS; r++) {
        const a = qualityOf(tier, r - 1);
        const b = qualityOf(tier, r);
        expect(b.scale).toBeLessThanOrEqual(a.scale);
        expect(b.pointLights).toBeLessThanOrEqual(a.pointLights);
        expect(!b.post || a.post).toBe(true);
        expect(!b.shadows || a.shadows).toBe(true);
        expect(!b.lights || a.lights).toBe(true);
      }
    }
    expect(qualityOf('desktop', -3)).toEqual(qualityOf('desktop', 0));
    expect(qualityOf('desktop', 99)).toEqual(qualityOf('desktop', RUNGS - 1));
  });
});

describe('the ladder walk: nextRung and bottomRung', () => {
  it('a desktop walks every rung, one visible step each', () => {
    const walk: number[] = [];
    for (let r: number | null = 0; r !== null; r = nextRung('desktop', r)) walk.push(r);
    expect(walk).toEqual([0, 1, 2, 3, 4, 5]);
    expect(bottomRung('desktop')).toBe(5);
  });

  it('a phone skips rung 3, which has no post-processing to lose', () => {
    expect(nextRung('phone', 2)).toBe(4);
    expect(bottomRung('phone')).toBe(5);
  });

  it('the bottom has no next rung', () => {
    expect(nextRung('desktop', 5)).toBeNull();
    expect(nextRung('phone', 5)).toBeNull();
  });

  it('a personal world (scale only) stops at rung 2: its other rungs draw nothing', () => {
    expect(nextRung('desktop', 0, SCALE_ONLY)).toBe(1);
    expect(nextRung('desktop', 1, SCALE_ONLY)).toBe(2);
    expect(nextRung('desktop', 2, SCALE_ONLY)).toBeNull();
    expect(bottomRung('desktop', SCALE_ONLY)).toBe(2);
    expect(bottomRung('phone', SCALE_ONLY)).toBe(2);
  });

  it('the office has every feature', () => {
    expect(ALL_FEATURES).toEqual({ post: true, lights: true });
  });
});

describe('FrameRate (the probe and the 1 s readings)', () => {
  /** Frames every `ms` from `from` to `to` (inclusive); returns the readings that closed windows. */
  function run(r: FrameRate, from: number, to: number, ms: number): number[] {
    const out: number[] = [];
    for (let t = from; t <= to + 1e-9; t += ms) {
      const v = r.frame(t);
      if (v !== null) out.push(v);
    }
    return out;
  }

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

describe('SlowWatch (the hold under the floor)', () => {
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

  it('reset starts the hold again, so the next trip needs its own hold', () => {
    const w = new SlowWatch();
    expect(w.sample(0, 5)).toBe(false);
    expect(w.sample(SLOW_HOLD_MS, 5)).toBe(true);
    w.reset();
    expect(w.sample(SLOW_HOLD_MS + 1000, 5)).toBe(false);
    expect(w.sample(SLOW_HOLD_MS * 2 + 1000, 5)).toBe(true);
  });

  it('a smooth view never trips it', () => {
    const w = new SlowWatch();
    expect(at(w, 0, 120_000, 30)).toBe(0);
  });
});

describe('QualityGovernor (the probe and the ladder of one view)', () => {
  /** Frames `stepMs` apart from `from` to `until`; the changes with the time they happened. */
  function drive(
    g: QualityGovernor,
    from: number,
    until: number,
    stepMs: number,
  ): { t: number; change: QualityChange }[] {
    const out: { t: number; change: QualityChange }[] = [];
    for (let t = from; t <= until; t += stepMs) {
      const change = g.frame(t);
      if (change) out.push({ t, change });
    }
    return out;
  }

  const governor = (over: Partial<GovernorStart> = {}) =>
    new QualityGovernor({
      coarse: false,
      gpu: GPU,
      pinned: false,
      rung: 0,
      features: ALL_FEATURES,
      ...over,
    });

  it('a fast desktop keeps the full look and reports no change', () => {
    const g = governor();
    expect(drive(g, 0, 20_000, FAST)).toEqual([]);
    expect(g.tier).toBe('desktop');
    expect(g.rung).toBe(0);
  });

  it('a probe that finds a slow desktop moves it to the phone tier, with no step down', () => {
    const g = governor();
    // frames 33 ms apart: about 30 fps, under the phone floor and over the lowest one
    const changes = drive(g, 0, PROBED, 33).map((c) => c.change);
    expect(changes).toEqual([{ tier: 'phone', rung: 0, dropped: false }]);
  });

  it('a software renderer starts at the bottom rung, and that is the one notice', () => {
    const g = governor({ gpu: 'Google SwiftShader' });
    const changes = drive(g, 0, PROBED, FAST).map((c) => c.change);
    expect(changes).toEqual([{ tier: 'phone', rung: 5, dropped: true }]);
    expect(g.quality.lights).toBe(false);
  });

  it('a slow view steps down one rung per hold, and says so only at the first step', () => {
    const g = governor();
    drive(g, 0, PROBED, FAST);
    // 5 fps for 19 s: the first hold completes about 15 s in, the second needs another 15 s
    const first = drive(g, 4000, 4000 + SLOW_HOLD_MS + 4000, SLOW);
    expect(first.map((c) => c.change)).toEqual([{ tier: 'desktop', rung: 1, dropped: true }]);
    const second = drive(g, 4000 + SLOW_HOLD_MS + 4000, 4000 + 2 * SLOW_HOLD_MS + 8000, SLOW);
    expect(second.map((c) => c.change)).toEqual([{ tier: 'desktop', rung: 2, dropped: false }]);
    expect(second[0]!.t - first[0]!.t).toBeGreaterThanOrEqual(SLOW_HOLD_MS);
  });

  it('a reading at the floor clears the count, so two slow spells alone do not step', () => {
    const g = governor();
    drive(g, 0, PROBED, FAST);
    expect(drive(g, 4000, 14_000, SLOW)).toEqual([]);
    expect(drive(g, 14_000, 24_000, FAST)).toEqual([]);
    expect(drive(g, 24_000, 34_000, SLOW)).toEqual([]);
    expect(g.rung).toBe(0);
  });

  it('the ladder runs to the bottom, then stops, and never climbs back in the visit', () => {
    const g = governor();
    drive(g, 0, PROBED, FAST);
    const steps = drive(g, 4000, 4000 + 8 * SLOW_HOLD_MS, SLOW).map((c) => c.change.rung);
    expect(steps).toEqual([1, 2, 3, 4, 5]);
    expect(g.rung).toBe(5);
    expect(drive(g, 200_000, 260_000, FAST)).toEqual([]);
    expect(g.rung).toBe(5);
  });

  it('a remounted view keeps the rung the session reached, and a fast probe does not raise it', () => {
    const g = governor({ rung: 2 });
    expect(drive(g, 0, PROBED, FAST)).toEqual([]);
    expect(g.rung).toBe(2);
    expect(g.quality.scale).toBe(0.5);
  });

  it('a pinned hour (?hour=) decides nothing from the device speed', () => {
    const g = governor({ pinned: true });
    expect(drive(g, 0, 60_000, SLOW)).toEqual([]);
    expect(g.rung).toBe(0);
    expect(g.tier).toBe('desktop');
  });

  it('a personal world (scale only) steps its render scale and stops at rung 2', () => {
    const g = governor({ features: SCALE_ONLY });
    drive(g, 0, PROBED, FAST);
    const steps = drive(g, 4000, 4000 + 6 * SLOW_HOLD_MS, SLOW);
    expect(steps.map((c) => c.change.rung)).toEqual([1, 2]);
    expect(g.rung).toBe(2);
    expect(g.quality.scale).toBe(0.5);
  });

  it('a slow device on the software renderer never climbs out of the bottom rung', () => {
    const g = governor({ rung: 4, gpu: 'Google SwiftShader' });
    const changes = drive(g, 0, PROBED, FAST).map((c) => c.change);
    expect(changes).toEqual([{ tier: 'phone', rung: 5, dropped: false }]);
    expect(g.rung).toBe(5);
  });
});
