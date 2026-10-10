/**
 * Frame-rate measurement for the 2.5D view's fallback (P16.11, ADR-052). Pure: the view feeds in
 * frame times and reads back frames per second, so the rules are unit-tested.
 *
 * - `FrameRate`: frames per second over fixed windows (the 3 s device probe, then 1 s readings),
 *   after a warm-up so the first shader compiles do not count.
 * - `SlowWatch`: the fallback timer. Under `SLOW_FPS` for `SLOW_HOLD_MS` in a row trips it once
 *   (then the view switches to 2D); one reading at or above the floor starts the count again.
 */

/** The fallback's floor: under this for the hold, the view switches to 2D (ADR-052). */
export const SLOW_FPS = 20;
/** How long under the floor before the switch, ms. */
export const SLOW_HOLD_MS = 15_000;

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
}
