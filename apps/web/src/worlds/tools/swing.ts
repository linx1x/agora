/**
 * Swing timing and tier "juice" for a held tool (ADR-053, P17.21, P17.21d). Pure numbers and frame
 * keys: the world views play them, so both views swing the same way at the same speed. The tier
 * changes only the tool card's sprite (`swingArt.ts`) and these parameters, never the animation. A
 * higher tier swings faster, throws bigger and brighter sparks, shakes the screen harder and rings
 * higher with a sharper click. Reduced motion turns the shake and the arc trail off; the swing
 * itself stays, it is the player's own action.
 */
import { loadGameData, type Tool } from '@agora/shared';

export type Facing = 'up' | 'down' | 'left' | 'right';
export const FACINGS: readonly Facing[] = ['up', 'down', 'left', 'right'];

/** The step a facing points at, in cells (x east, y south): the direction a tool head reaches. */
export const FACING_UNIT: Readonly<Record<Facing, readonly [number, number]>> = {
  up: [0, -1],
  down: [0, 1],
  left: [-1, 0],
  right: [1, 0],
};

/** The hand is this far above the feet, in world pixels: the swing is drawn around it. */
export const HAND_PX = 10;
/** Reach of the tool head from the hand, in world pixels (the flat view's head). */
export const HEAD_PX = 12;
/** The 2.5D tool card's width, in tiles: big enough that the head, the handle and the tier plate read at a glance at the default zoom. */
export const CARD_TILES = 1.5;
/** Where the impact is, as a share of the swing's duration (the head meets the cell). */
export const IMPACT_AT = 0.66;
/** The tools that swing (a rod casts, a seed and food are used by hand). */
const SWINGING = new Set(['hoe', 'can', 'axe', 'pick']);

/** Frames per facing; the swing plays them in order and holds the last one. */
export const SWING_FRAMES = 3;

/** The swing of a tier-1 tool at speed 1, in milliseconds. */
export const BASE_SWING_MS = 480;

/** Each tier swings this fraction faster than the tier below (10 % faster per tier). */
export const TIER_SWING_FACTOR = 0.9;

/** The card stays in view this long after the swing ends, then fades (ms; reduced motion cuts it). */
export const AFTER_MS = 60;
export const FADE_MS = 120;
/** The sparks fly for this long; under reduced motion they flash in place for `SPARK_STILL_MS`. */
export const SPARK_MS = 260;
export const SPARK_STILL_MS = 160;
/** A camera shake lasts this long. */
export const SHAKE_MS = 180;
/**
 * After my swing ends, its target cell's decor stays out of the occlusion fade this long (ms), so the
 * tree or rock I chop is still drawn when the card has gone.
 */
export const TARGET_HOLD_MS = 300;

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
  /** The tone of the hit: its rate, how long it rings and its click (see `HitSound`). */
  readonly hit: HitSound;
  /** The tier's look and spread for the sparks (see `TierFeel`). */
  readonly feel: TierFeel;
}

/** The sound of a hit: a tone at `pitch` ringing `decayMs`, with a click (0 to 1) on top. */
export interface HitSound {
  readonly pitch: number;
  readonly decayMs: number;
  readonly click: number;
}

/** What a tier looks and sounds like on a hit. */
export interface TierFeel {
  /** side of a spark square, in screen pixels at the default zoom */
  readonly sparkPx: number;
  /** sparks one hit throws */
  readonly sparkCount: number;
  /** how far the sparks fly from the cell's top, in screen pixels */
  readonly sparkReachPx: number;
  /** the camera shake for my own hit, pixels at the start (one way) */
  readonly shakePx: number;
  /** playback rate of the hit's tone (1 is the base pitch) */
  readonly pitch: number;
  /** how long the tone rings, ms */
  readonly decayMs: number;
  /** the click on top of the tone (0 none, 1 full) */
  readonly click: number;
  /** spark colours, cycled through the sparks */
  readonly sparks: readonly string[];
  /** brighter sparks blend additively, so they glow on the dirt */
  readonly bright: boolean;
}

const TIERS = [1, 2, 3] as const;
export type Tier = (typeof TIERS)[number];

/** The feel of each tier: wood (small, low), iron (medium), diamond (large, bright, high and sharp). */
const FEEL: Readonly<Record<Tier, TierFeel>> = {
  1: {
    sparkPx: 5,
    sparkCount: 4,
    sparkReachPx: 8,
    shakePx: 2,
    pitch: 1,
    decayMs: 90,
    click: 0,
    sparks: ['#ffd27a', '#fff1c9'],
    bright: false,
  },
  2: {
    sparkPx: 8,
    sparkCount: 6,
    sparkReachPx: 12,
    shakePx: 4,
    pitch: 2 ** (2 / 12),
    decayMs: 70,
    click: 0.35,
    sparks: ['#e6ecf2', '#9aa7b4', '#ffffff'],
    bright: false,
  },
  3: {
    sparkPx: 12,
    sparkCount: 8,
    sparkReachPx: 16,
    shakePx: 7,
    pitch: 2 ** (4 / 12),
    decayMs: 55,
    click: 0.7,
    sparks: ['#c8fbff', '#6fe3f2', '#ffffff'],
    bright: true,
  },
};

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

/** The look and sound of a tier's hit (throws for a tier outside 1 to 3). */
export function tierFeel(tier: number): TierFeel {
  assertTier(tier);
  return FEEL[tier];
}

/** Side of the spark square at a tier, in pixels: 5 at wood, 8 at iron, 12 at diamond. */
export function sparkPx(tier: number): number {
  return tierFeel(tier).sparkPx;
}

/** Screen shake in pixels: per tier, none under reduced motion. */
export function shakePx(tier: number, reducedMotion: boolean): number {
  const px = tierFeel(tier).shakePx;
  return reducedMotion ? 0 : px;
}

/** Playback rate of the hit's tone: about 12 % higher per tier (a major third at diamond). */
export function soundPitch(tier: number): number {
  return tierFeel(tier).pitch;
}

/** The sound of a hit at a tier. */
export function hitSound(tier: number): HitSound {
  const f = tierFeel(tier);
  return { pitch: f.pitch, decayMs: f.decayMs, click: f.click };
}

/** Everything a view needs to play one swing of this tool. */
export function swingParams(tool: Pick<Tool, 'tier' | 'speed'>, facing: Facing, reducedMotion: boolean): SwingParams {
  const feel = tierFeel(tool.tier);
  return {
    durationMs: swingDurationMs(tool),
    frames: swingFrames(facing),
    sparkPx: feel.sparkPx,
    shakePx: shakePx(tool.tier, reducedMotion),
    pitch: feel.pitch,
    hit: hitSound(tool.tier),
    feel,
  };
}

/** Sparks one hit throws: 4 at wood, 6 at iron, 8 at diamond. */
export function sparkCount(tier: number): number {
  return tierFeel(tier).sparkCount;
}

/**
 * The `intensity` argument of a camera shake (Phaser takes a fraction of the view width): about
 * `shakePx` times 2 pixels each way at 1x zoom. 0 when there is no shake or no width.
 */
export function shakeIntensity(shakePx: number, viewWidth: number): number {
  return shakePx > 0 && viewWidth > 0 ? (2 * shakePx) / viewWidth : 0;
}

/**
 * The playback speed of a swing at a tier, when the server only said the tier (another person's
 * swing): the speed of a swinging tool of that tier in tools.json (1 when there is none).
 */
export function speedOfTier(tier: number): number {
  const tool = loadGameData().tools.find((t) => t.tier === tier && SWINGING.has(t.tool));
  return tool?.speed ?? 1;
}
