/**
 * Swing timing and tier "juice" for a held tool (ADR-053, P17.21). Pure numbers and frame keys: the
 * world views (P17.21b) play them, so both views swing the same way at the same speed. A higher
 * tier swings faster, throws bigger sparks, shakes the screen harder and rings a little higher.
 * Reduced motion turns the shake off; the swing itself stays, it is the player's own action.
 */
import type { Tool } from '@agora/shared';

export type Facing = 'up' | 'down' | 'left' | 'right';
export const FACINGS: readonly Facing[] = ['up', 'down', 'left', 'right'];

/** Frames per facing; the swing plays them in order and holds the last one. */
export const SWING_FRAMES = 3;

/** The swing of a tier-1 tool at speed 1, in milliseconds. */
export const BASE_SWING_MS = 480;

/** Each tier swings this fraction faster than the tier below (10 % faster per tier). */
export const TIER_SWING_FACTOR = 0.9;

export interface SwingParams {
  readonly durationMs: number;
  /** Frame keys in play order: `swing-<facing>-<n>`, n from 0 to SWING_FRAMES - 1. */
  readonly frames: readonly string[];
  /** Side of the spark square, in pixels. */
  readonly sparkPx: number;
  /** Screen shake amplitude, in pixels; 0 under reduced motion. */
  readonly shakePx: number;
  /** Playback rate of the swing sound (1 is the base pitch). */
  readonly pitch: number;
}

const TIERS = [1, 2, 3] as const;
export type Tier = (typeof TIERS)[number];

function assertTier(tier: number): asserts tier is Tier {
  if (!(TIERS as readonly number[]).includes(tier)) throw new RangeError(`tool tier must be 1, 2 or 3, got ${tier}`);
}

/** The frame keys of one facing, in play order. */
export function swingFrames(facing: Facing): readonly string[] {
  return Array.from({ length: SWING_FRAMES }, (_, n) => `swing-${facing}-${n}`);
}

/** How long one swing lasts: the tier's factor and the tool's speed-up (1 is base speed; 1.5 is 50 % faster). */
export function swingDurationMs(tool: Pick<Tool, 'tier' | 'speed'>): number {
  assertTier(tool.tier);
  return (BASE_SWING_MS * TIER_SWING_FACTOR ** (tool.tier - 1)) / tool.speed;
}

/** The frame (0 to SWING_FRAMES - 1) shown `elapsedMs` into a swing; the last frame holds after the swing. */
export function frameIndexAt(elapsedMs: number, durationMs: number): number {
  if (elapsedMs <= 0 || durationMs <= 0) return 0;
  return Math.min(SWING_FRAMES - 1, Math.floor((elapsedMs / durationMs) * SWING_FRAMES));
}

/** Side of the spark square at a tier: 3 px at tier 1, 5 px at tier 3. */
export function sparkPx(tier: number): number {
  assertTier(tier);
  return 2 + tier;
}

/** Screen shake in pixels: one per tier, none under reduced motion. */
export function shakePx(tier: number, reducedMotion: boolean): number {
  assertTier(tier);
  return reducedMotion ? 0 : tier;
}

/** Playback rate of the swing sound: 5 % higher per tier. */
export function soundPitch(tier: number): number {
  assertTier(tier);
  return 1 + 0.05 * (tier - 1);
}

/** Everything a view needs to play one swing of this tool. */
export function swingParams(tool: Pick<Tool, 'tier' | 'speed'>, facing: Facing, reducedMotion: boolean): SwingParams {
  return {
    durationMs: swingDurationMs(tool),
    frames: swingFrames(facing),
    sparkPx: sparkPx(tool.tier),
    shakePx: shakePx(tool.tier, reducedMotion),
    pitch: soundPitch(tool.tier),
  };
}

/** Sparks one hit throws: 4 at tier 1, 6 at tier 2, 8 at tier 3. */
export function sparkCount(tier: number): number {
  assertTier(tier);
  return 2 + 2 * tier;
}

/**
 * The `intensity` argument of a camera shake (Phaser takes a fraction of the view width): about
 * `shakePx` times 2 pixels each way at 1x zoom. 0 when there is no shake or no width.
 */
export function shakeIntensity(shakePx: number, viewWidth: number): number {
  return shakePx > 0 && viewWidth > 0 ? (2 * shakePx) / viewWidth : 0;
}
