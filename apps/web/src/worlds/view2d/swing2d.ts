/**
 * The 2D body of a tool swing (P17.21b, ADR-053): the tool's arc in three frames per facing, the
 * tier mark (`tools/overlay.ts`) beside it, sparks where the head lands, a short screen shake for my
 * own hit (none under reduced motion) and the tier's sound. The frames, the marks and the timing are
 * shared with the 2.5D view (`tools/swingArt.ts`, `tools/swing.ts`); this file only puts them on the
 * Phaser scene.
 */
import type Phaser from 'phaser';
import type { Dir } from '@agora/shared';
import { playSwingSound } from '../tools/sound';
import { allSwingFrames, swingFrameCanvas, tierMarkCanvas } from '../tools/swingArt';
import {
  FACING_UNIT,
  HAND_PX,
  HEAD_PX,
  IMPACT_AT,
  SWING_FRAMES,
  shakeIntensity,
  sparkCount,
  sparkPx,
  swingFrames,
  swingParams,
} from '../tools/swing';

const SPARK_COLORS = [0xffe08a, 0xfff4c2] as const;

/** The frame key of a tier's mark. */
export const tierMarkKey = (tier: number) => `swing-tier-${tier}`;

/** Adds the swing frames (every facing) and the three tier marks to the texture manager, once. */
export function ensureSwingTextures(textures: Phaser.Textures.TextureManager): void {
  for (const { facing, n } of allSwingFrames()) {
    const key = swingFrames(facing)[n]!;
    if (!textures.exists(key)) textures.addCanvas(key, swingFrameCanvas(facing, n));
  }
  for (const tier of [1, 2, 3]) {
    const key = tierMarkKey(tier);
    if (!textures.exists(key)) textures.addCanvas(key, tierMarkCanvas(tier));
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

/** Plays one swing: the arc, the tier mark, the sound, and at the impact the sparks and the shake. */
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
  playSwingSound(p.pitch, opts.sounds);
}

/** Sparks where the head lands: a ring that fades out, or a still flash under reduced motion. */
function spark(scene: Phaser.Scene, at: SwingSpot, dir: Dir, tier: number, reduced: boolean): void {
  const [ux, uy] = FACING_UNIT[dir];
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
