/**
 * The 2D body of a tool swing (P17.21b, ADR-053): the tool's arc in three code-drawn frames per
 * facing (no art to register), the tier mark (`tools/overlay.ts`) beside it, sparks where the head
 * lands, a short screen shake for my own hit (none under reduced motion) and a blip whose pitch is
 * the tier. Frame keys, timing and sizes come from `tools/swing.ts`; this file only draws them. The
 * 2.5D view plays the same parameters (P17.15).
 */
import type Phaser from 'phaser';
import { loadGameData, type Dir } from '@agora/shared';
import { OVERLAY_GRID, tierOverlay } from '../tools/overlay';
import { swingBlip } from '../tools/blip';
import {
  FACINGS,
  SWING_FRAMES,
  shakeIntensity,
  sparkCount,
  sparkPx,
  swingFrames,
  swingParams,
  type Facing,
} from '../tools/swing';

/** Side of a frame's canvas, in pixels. */
const FRAME_PX = 16;
/** The swing turns this far (radians) from the first frame to the last. */
const SWING_ARC = 0.9;
/** The hand is this far above the feet: the swing is drawn around it. */
const HAND_PX = 10;
/** Reach of the tool head from the hand, in pixels. */
const HEAD_PX = 12;
/** Where the impact is, as a share of the swing's duration (the head meets the cell). */
const IMPACT_AT = 0.66;
const SPARK_COLORS = [0xffe08a, 0xfff4c2] as const;
/** The tools that swing (the rod casts, the seed and food are used by hand). */
const SWINGING = new Set(['hoe', 'can', 'axe', 'pick']);

const UNIT: Readonly<Record<Dir, readonly [number, number]>> = {
  up: [0, -1],
  down: [0, 1],
  left: [-1, 0],
  right: [1, 0],
};
const ANGLE: Readonly<Record<Facing, number>> = {
  right: 0,
  down: Math.PI / 2,
  left: Math.PI,
  up: -Math.PI / 2,
};

/** The frame key of a tier's mark. */
export const tierMarkKey = (tier: number) => `swing-tier-${tier}`;

/**
 * The playback speed of a swing at a tier, when the server only said the tier (another person's
 * swing): the speed of a swinging tool of that tier in tools.json (1 when there is none).
 */
export function speedOfTier(tier: number): number {
  const tool = loadGameData().tools.find((t) => t.tier === tier && SWINGING.has(t.tool));
  return tool?.speed ?? 1;
}

function canvasOf(size: number): { canvas: HTMLCanvasElement; g: CanvasRenderingContext2D } {
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const g = canvas.getContext('2d');
  if (!g) throw new Error('a 2D canvas is needed for the tool swing');
  return { canvas, g };
}

/** One frame of the swing: the handle and head, turned for the facing and the frame's place in the arc. */
function drawFrame(facing: Facing, n: number): HTMLCanvasElement {
  const { canvas, g } = canvasOf(FRAME_PX);
  const mid = FRAME_PX / 2;
  const a = ANGLE[facing] + (n - (SWING_FRAMES - 1) / 2) * (SWING_ARC / (SWING_FRAMES - 1));
  const hx = mid + Math.cos(a) * HEAD_PX * 0.6;
  const hy = mid + Math.sin(a) * HEAD_PX * 0.6;
  g.lineCap = 'round';
  g.strokeStyle = '#6b4a2b';
  g.lineWidth = 2;
  g.beginPath();
  g.moveTo(mid + Math.cos(a) * 2, mid + Math.sin(a) * 2);
  g.lineTo(hx, hy);
  g.stroke();
  g.fillStyle = '#cfd6dd';
  g.beginPath();
  g.arc(hx, hy, 2.5, 0, Math.PI * 2);
  g.fill();
  return canvas;
}

/** The tier mark: the overlay's pixels on an 8 x 8 grid. */
function drawMark(tier: number): HTMLCanvasElement {
  const { canvas, g } = canvasOf(OVERLAY_GRID);
  const mark = tierOverlay(tier);
  g.fillStyle = mark.color;
  for (const [x, y] of mark.pixels) g.fillRect(x, y, 1, 1);
  return canvas;
}

/** Adds the swing frames (every facing) and the three tier marks to the texture manager, once. */
export function ensureSwingTextures(textures: Phaser.Textures.TextureManager): void {
  for (const facing of FACINGS)
    swingFrames(facing).forEach((key, n) => {
      if (!textures.exists(key)) textures.addCanvas(key, drawFrame(facing, n));
    });
  for (const tier of [1, 2, 3]) {
    const key = tierMarkKey(tier);
    if (!textures.exists(key)) textures.addCanvas(key, drawMark(tier));
  }
}

export interface SwingSpot {
  /** the feet, in world pixels */
  readonly x: number;
  readonly y: number;
  /** the depth the swing is drawn at (above the person it belongs to) */
  readonly depth: number;
}

export interface SwingOptions {
  /** the tool's playback speed (1 is base speed) */
  readonly speed: number;
  /** shake the screen at the impact (my own swing only) */
  readonly shake: boolean;
  readonly reduced: boolean;
  /** the player's sounds setting: off means silent */
  readonly sounds: boolean;
}

/** Plays one swing: the arc, the tier mark, the blip, and at the impact the sparks and the shake. */
export function playSwing2d(scene: Phaser.Scene, at: SwingSpot, dir: Dir, tier: number, opts: SwingOptions): void {
  ensureSwingTextures(scene.textures);
  const p = swingParams({ tier, speed: opts.speed }, dir, opts.reduced);
  const hx = at.x;
  const hy = at.y - HAND_PX;
  const arc = scene.add.image(hx, hy, p.frames[0]!).setDepth(at.depth);
  const mark = scene.add.image(hx + 6, hy - 6, tierMarkKey(tier)).setDepth(at.depth + 0.1);
  const step = p.durationMs / SWING_FRAMES;
  p.frames.slice(1).forEach((key, i) => scene.time.delayedCall(step * (i + 1), () => arc.setTexture(key)));
  scene.time.delayedCall(p.durationMs * IMPACT_AT, () => {
    spark(scene, at, dir, tier, opts.reduced);
    if (opts.shake && !opts.reduced)
      scene.cameras.main.shake(180, shakeIntensity(p.shakePx, scene.cameras.main.width));
  });
  scene.time.delayedCall(p.durationMs + 60, () => {
    arc.destroy();
    mark.destroy();
  });
  swingBlip(p.pitch, opts.sounds);
}

/** Sparks where the head lands: a ring that fades out, or a still flash under reduced motion. */
function spark(scene: Phaser.Scene, at: SwingSpot, dir: Dir, tier: number, reduced: boolean): void {
  const [ux, uy] = UNIT[dir];
  const x = at.x + ux * HEAD_PX;
  const y = at.y - HAND_PX + uy * HEAD_PX;
  const size = sparkPx(tier);
  const n = sparkCount(tier);
  for (let i = 0; i < n; i++) {
    const color = SPARK_COLORS[i % SPARK_COLORS.length]!;
    const s = scene.add.rectangle(x, y, size, size, color).setDepth(at.depth + 2);
    if (reduced) {
      scene.time.delayedCall(160, () => s.destroy());
      continue;
    }
    const a = (i / n) * Math.PI * 2 + tier * 0.3;
    const r = 6 + tier * 2;
    scene.tweens.add({
      targets: s,
      x: x + Math.cos(a) * r,
      y: y + Math.sin(a) * r,
      alpha: 0,
      duration: 260,
      onComplete: () => s.destroy(),
    });
  }
}
