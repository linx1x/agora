/**
 * Device tiers and the quality ladder of the 2.5D view (ADR-052 P16.11, ADR-054 P16.19). This is
 * the only world view, so there is no flat view to fall back to: a device that is too slow steps
 * down a ladder of cheaper looks instead.
 *
 * A desktop runs the full look: sun shadows, the most point lights, the pixel-diorama
 * post-processing. A phone runs the cheap look: no shadows, a few lights, no post-processing. A
 * touch screen starts on phone; a 3 s probe of the frame rate (after shader warm-up) then sets the
 * tier, and a software renderer or a very slow probe starts at the bottom rung.
 *
 * The ladder (one rung per `SLOW_HOLD_MS` under `SLOW_FPS`, for this visit only):
 *   0 full · 1 render scale 0.75 · 2 render scale 0.5 · 3 post-processing off ·
 *   4 two point lights · 5 lights off (plain midday light, no shadows, no blobs at night).
 * Rung 4 comes before lights off: once the lights are off no point light is drawn, so "fewer point
 * lights" only saves anything before that. A rung that draws nothing new for a tier (the phone has
 * no post-processing to lose) is skipped, so every step is visible.
 *
 * Pure: the views feed in frame times and apply what comes back, so the rules are unit-tested.
 * The thresholds are constants on purpose. The phone and bottom numbers are first guesses until
 * Vincent's mid-range phone run ("Agora 2.5D Benchmark", P16.11).
 */

export type Tier = 'desktop' | 'phone';

/** Point lights in the scene at once (a fixed pool per tier, so shaders do not recompile). */
export const POINT_LIGHTS: Record<Tier, number> = { desktop: 8, phone: 3 };

/** The probe: the first `PROBE_MS` of frames after `PROBE_WARMUP_MS` (shader compiles skipped). */
export const PROBE_MS = 3000;
export const PROBE_WARMUP_MS = 600;
/** A desktop-class device probing under this many fps gets the phone tier. */
export const PHONE_PROBE_FPS = 40;
/** A device probing under this many fps starts at the bottom rung of the ladder. */
export const LOWEST_PROBE_FPS = 8;
/** Renderers that are software, not a graphics card: they start at the bottom rung. */
export const SOFTWARE_GPU = /swiftshader|llvmpipe|softpipe|software|basic render/i;

/** The ladder's floor: under this for `SLOW_HOLD_MS` in a row, one rung down. */
export const SLOW_FPS = 20;
export const SLOW_HOLD_MS = 15_000;

/** The render scale of rungs 0, 1 and 2 (times the device pixel ratio). */
export const RENDER_SCALE = [1, 0.75, 0.5] as const;
/** Point lights from rung 4 on. */
export const LOW_POINT_LIGHTS = 2;
/** The number of rungs: 0 (full) to 5 (lights off). */
export const RUNGS = 6;
const LAST_RUNG = RUNGS - 1;

/** Is this renderer a software one (no graphics card)? */
export function isSoftwareGpu(gpu: string): boolean {
  return SOFTWARE_GPU.test(gpu);
}

/** Sun shadow map: on the desktop tier only. */
export function sunShadows(tier: Tier): boolean {
  return tier === 'desktop';
}

/** Tilt-shift and bloom: on the desktop tier only. */
export function postFx(tier: Tier): boolean {
  return tier === 'desktop';
}

/** The tier a device starts on before its probe: a coarse pointer (touch) is a phone. */
export function startTier(coarsePointer: boolean): Tier {
  return coarsePointer ? 'phone' : 'desktop';
}

/** What one rung draws. */
export interface Quality {
  /** the render scale, times the device pixel ratio */
  readonly scale: number;
  /** tilt-shift and bloom */
  readonly post: boolean;
  /** the sun's shadow map */
  readonly shadows: boolean;
  /** the point-light pool (the nearest lamps take it) */
  readonly pointLights: number;
  /** Lighting: the lamps, the night look and the shadows (off: plain midday light, no night blobs) */
  readonly lights: boolean;
}

/** The look of a rung for a tier. */
export function qualityOf(tier: Tier, rung: number): Quality {
  const r = Math.max(0, Math.min(LAST_RUNG, Math.floor(rung)));
  const q = {
    scale: RENDER_SCALE[Math.min(r, RENDER_SCALE.length - 1)]!,
    post: postFx(tier),
    shadows: sunShadows(tier),
    pointLights: POINT_LIGHTS[tier],
    lights: true,
  };
  if (r >= 3) q.post = false;
  if (r >= 4) q.pointLights = Math.min(q.pointLights, LOW_POINT_LIGHTS);
  if (r >= 5) Object.assign(q, { lights: false, shadows: false, pointLights: 0 });
  return q;
}

/**
 * Which parts of the ladder a view has. The 2.5D office has all of them; a personal world has no
 * lights and no post-processing, so only its render scale steps down.
 */
export interface Features {
  readonly post: boolean;
  readonly lights: boolean;
}
export const ALL_FEATURES: Features = { post: true, lights: true };
export const SCALE_ONLY: Features = { post: false, lights: false };

/** The quality as a view with these features draws it: a part it does not have is off. */
function drawn(q: Quality, f: Features): Quality {
  return {
    scale: q.scale,
    post: q.post && f.post,
    shadows: q.shadows && f.lights,
    pointLights: f.lights ? q.pointLights : 0,
    lights: q.lights && f.lights,
  };
}

function sameQuality(a: Quality, b: Quality): boolean {
  return (
    a.scale === b.scale &&
    a.post === b.post &&
    a.shadows === b.shadows &&
    a.pointLights === b.pointLights &&
    a.lights === b.lights
  );
}

/** The next rung that draws something different, or null at the bottom of the ladder. */
export function nextRung(tier: Tier, rung: number, f: Features = ALL_FEATURES): number | null {
  const here = drawn(qualityOf(tier, rung), f);
  for (let r = rung + 1; r <= LAST_RUNG; r++) {
    if (!sameQuality(drawn(qualityOf(tier, r), f), here)) return r;
  }
  return null;
}

/** The lowest rung that draws the bottom look: the first rung of that look. */
export function bottomRung(tier: Tier, f: Features = ALL_FEATURES): number {
  const last = drawn(qualityOf(tier, LAST_RUNG), f);
  let r = LAST_RUNG;
  while (r > 0 && sameQuality(drawn(qualityOf(tier, r - 1), f), last)) r -= 1;
  return r;
}

/** What the probe decides: the bottom of the ladder, the phone tier, or the desktop tier. */
export type ProbeVerdict = 'bottom' | 'phone' | 'desktop';

/**
 * The probe's verdict: a software renderer, or a probe under `LOWEST_PROBE_FPS`, is 'bottom'; a
 * touch screen or a probe under `PHONE_PROBE_FPS` is 'phone'; else 'desktop'.
 */
export function probeVerdict(input: {
  coarse: boolean;
  gpu: string;
  probeFps: number;
}): ProbeVerdict {
  if (isSoftwareGpu(input.gpu) || input.probeFps < LOWEST_PROBE_FPS) return 'bottom';
  if (input.coarse || input.probeFps < PHONE_PROBE_FPS) return 'phone';
  return 'desktop';
}

/** Frames per second over fixed windows (the probe, then 1 s readings), after a warm-up. */
export class FrameRate {
  private start = Number.NaN;
  private t0 = Number.NaN;
  private frames = 0;

  constructor(
    private readonly windowMs: number,
    private readonly warmupMs = 0,
  ) {}

  /**
   * Count a frame at `now` (ms). Returns the frames per second of the window when it closes,
   * else null. The warm-up frames are not counted.
   */
  frame(now: number): number | null {
    if (Number.isNaN(this.start)) this.start = now;
    if (Number.isNaN(this.t0)) {
      if (now - this.start < this.warmupMs) return null;
      this.t0 = now;
      this.frames = 0;
      return null;
    }
    this.frames += 1;
    const dt = now - this.t0;
    if (dt < this.windowMs) return null;
    const fps = (this.frames * 1000) / dt;
    this.t0 = now;
    this.frames = 0;
    return fps;
  }
}

/** The hold under the floor: `sample` is true once, when the readings have been under it for the hold. */
export class SlowWatch {
  private since = Number.NaN;
  private tripped = false;

  constructor(
    private readonly floor = SLOW_FPS,
    private readonly holdMs = SLOW_HOLD_MS,
  ) {}

  /** A reading (fps) at `now`. True once, when the readings have been under the floor for the hold. */
  sample(now: number, fps: number): boolean {
    if (fps >= this.floor) {
      this.since = Number.NaN;
      return false;
    }
    if (Number.isNaN(this.since)) this.since = now;
    if (this.tripped || now - this.since < this.holdMs) return false;
    this.tripped = true;
    return true;
  }

  /** Start the count again: after a step down, the next one needs its own hold. */
  reset(): void {
    this.since = Number.NaN;
    this.tripped = false;
  }
}

export interface GovernorStart {
  coarse: boolean;
  gpu: string;
  /** `?hour=` pins the look (the tests): nothing is decided from this device's speed */
  pinned: boolean;
  /** the rung this session has reached already (kept when the view is remounted) */
  rung: number;
  features: Features;
}

/** A change of tier or rung. `dropped` is the session's first step down: the one notice. */
export interface QualityChange {
  readonly tier: Tier;
  readonly rung: number;
  readonly dropped: boolean;
}

/**
 * The quality of one view. The probe (3 s after the warm-up) sets the tier; readings under
 * `SLOW_FPS` for `SLOW_HOLD_MS` in a row step the ladder down one rung, and the count starts again.
 * The ladder never climbs back within a visit. `frame` returns the change to apply, or null.
 */
export class QualityGovernor {
  private tierNow: Tier;
  private rungNow: number;
  private probe: FrameRate | null;
  private readonly rate = new FrameRate(1000);
  private readonly slow = new SlowWatch();

  constructor(private readonly start: GovernorStart) {
    this.tierNow = startTier(start.coarse);
    this.rungNow = start.rung;
    this.probe = start.pinned ? null : new FrameRate(PROBE_MS, PROBE_WARMUP_MS);
  }

  get tier(): Tier {
    return this.tierNow;
  }

  get rung(): number {
    return this.rungNow;
  }

  get quality(): Quality {
    return qualityOf(this.tierNow, this.rungNow);
  }

  /**
   * One frame at `now` (ms). `fpsOverride` replaces the measured readings (a test forces a slow
   * view); it does not reach the probe.
   */
  frame(now: number, fpsOverride: number | null = null): QualityChange | null {
    const before = { tier: this.tierNow, rung: this.rungNow };
    if (this.probe) {
      const fps = this.probe.frame(now);
      if (fps !== null) {
        this.probe = null;
        const v = probeVerdict({ coarse: this.start.coarse, gpu: this.start.gpu, probeFps: fps });
        if (v === 'bottom') {
          this.tierNow = 'phone';
          this.rungNow = Math.max(this.rungNow, bottomRung('phone', this.start.features));
        } else {
          this.tierNow = v;
        }
      }
    }
    if (!this.start.pinned || fpsOverride !== null) {
      const reading = this.rate.frame(now);
      if (reading !== null && this.slow.sample(now, fpsOverride ?? reading)) {
        const next = nextRung(this.tierNow, this.rungNow, this.start.features);
        if (next !== null) {
          this.rungNow = next;
          this.slow.reset();
        }
      }
    }
    if (before.tier === this.tierNow && before.rung === this.rungNow) return null;
    return {
      tier: this.tierNow,
      rung: this.rungNow,
      dropped: before.rung === 0 && this.rungNow > 0,
    };
  }
}
