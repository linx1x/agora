/**
 * P16.8 (ADR-052): the maths of the paper figures in the 2.5D view, kept free of three.js and the
 * DOM so it is unit-tested (`figureMath.test.ts`). `paperFigures.ts` turns these numbers into
 * meshes and textures.
 *
 * Units: tiles (1 = 32 px), as `camera.ts`. A figure is a vertical card standing on its floor
 * point; the camera tilts `TILT` degrees down, so a vertical length looks `cos(TILT)` as long.
 * `upright` undoes that for heights, so the art keeps its proportions on screen.
 */
import type { Dir } from '@agora/shared';
import { TILT } from './camera';
import {
  PAPER_H,
  PAPER_PAD,
  PAPER_W,
  paperCell,
  paperCellSize,
  paperSheetSize,
  type PaperScale,
} from './paperLayout';

/** the 2D walk cycle: frame index per 130 ms step (stand, left step, stand, right step) */
export const WALK_SEQ = [1, 0, 3, 2] as const;
/** ms per walk step, as the 2D view and World3DView */
export const WALK_MS = 130;
/** a left↔right turn plays a card flip this long (ADR-052) */
export const FLIP_MS = 120;
/** the seat top above the floor, tiles: a sitter's feet rest on the chair's seat */
export const SEAT_H = 0.28;
/** z offset of a seated figure (tiles) for down, left and right: in front of the chair card */
export const SEAT_DZ = 0.42;
/** z offset of a seated figure facing up: the chair's back stays in front of it */
export const SEAT_DZ_UP = -0.05;
/** the flip never reaches a zero-width card: a degenerate matrix is avoided */
const MIN_SCALE = 0.001;

/** Figure height in tiles, as seen on screen (feet to top of head), without the cut-out margin. */
export const FIG_H = 1.4;
/** Figure width in tiles, at the art's 64:96 ratio. */
export const FIG_W = (FIG_H * PAPER_W) / PAPER_H;
/** Tiles per art px. One scale on both axes, so the art is never stretched. */
const TILES_PER_PX = FIG_H / PAPER_H;
/** The quad maps the whole cell (cut-out margin included): its width, tiles. */
export const QUAD_W = (PAPER_W + 2 * PAPER_PAD) * TILES_PER_PX;
/** The quad's height in world units (tiles), upright so it keeps the art's proportions. */
export const QUAD_H = upright((PAPER_H + 2 * PAPER_PAD) * TILES_PER_PX);
/** The cut-out margin below the feet, world units: the card's feet sit on the floor point. */
export const PAD_BOTTOM = upright(PAPER_PAD * TILES_PER_PX);
/** Feet to the top of the head, world units. The top margin is not part of it. */
export const FIG_TOP = upright(FIG_H);

/**
 * A height on the floor's scale, as a vertical card's world height. The camera looks down at
 * `TILT` degrees, so an upright length appears `cos(TILT)` as long; this divides that back out.
 */
export function upright(h: number): number {
  return h / Math.cos((TILT * Math.PI) / 180);
}

/** Pose as the view knows it. */
export type FramePose = 'stand' | 'sit';

/** Two frames from the two sides of a left↔right turn. */
export function isFlip(from: Dir, to: Dir): boolean {
  return (from === 'left' && to === 'right') || (from === 'right' && to === 'left');
}

/** A flip in progress: from `from` to `to`, started at `t0` (performance.now ms). */
export interface FlipStart {
  from: Dir;
  to: Dir;
  t0: number;
}

/** The card's state during a flip. */
export interface FlipState {
  /** horizontal scale of the card: 1 normally, near 0 at the midpoint */
  scaleX: number;
  /** the direction whose art is shown */
  dir: Dir;
  /** true once the flip is over (or there was none) */
  done: boolean;
}

/** Ease in and out (sine): 0 at 0, 1 at 1, slow at both ends. */
function easeInOut(p: number): number {
  return 0.5 - 0.5 * Math.cos(Math.PI * p);
}

/**
 * The card flip of a left↔right turn. The first half narrows the card from 1 to 0 showing `from`,
 * the second half widens it from 0 to 1 showing `to`. With `reduced` motion, or no flip, the card
 * is shown at full width facing `start.to`, or `current` when there is no flip.
 */
export function flipAt(
  start: FlipStart | null,
  now: number,
  reduced: boolean,
  current: Dir = 'down',
): FlipState {
  if (!start) return { scaleX: 1, dir: current, done: true };
  if (reduced) return { scaleX: 1, dir: start.to, done: true };
  const t = Math.min(1, Math.max(0, (now - start.t0) / FLIP_MS));
  if (t >= 1) return { scaleX: 1, dir: start.to, done: true };
  if (t < 0.5) {
    const s = 1 - easeInOut(t * 2);
    return { scaleX: Math.max(MIN_SCALE, s), dir: start.from, done: false };
  }
  const s = easeInOut((t - 0.5) * 2);
  return { scaleX: Math.max(MIN_SCALE, s), dir: start.to, done: false };
}

/**
 * Where a figure sits on its floor point. Standing and crouching stay on the floor. A seated
 * figure is lifted onto the seat and moved so it stands in front of the chair card, except facing
 * up, where the chair's back must stay in front of it.
 */
export function seatPlacement(
  pose: FramePose,
  dir: Dir,
  transitioning: boolean,
): { lift: number; dz: number } {
  if (pose !== 'sit' || transitioning) return { lift: 0, dz: 0 };
  return { lift: SEAT_H, dz: dir === 'up' ? SEAT_DZ_UP : SEAT_DZ };
}

/** Walk frame (0–3) for a figure at `now`: the 2D cycle while moving, stand (0) otherwise. */
export function walkFrame(moving: boolean, now: number): number {
  if (!moving) return 0;
  const step = Math.floor(now / WALK_MS);
  const i = ((step % WALK_SEQ.length) + WALK_SEQ.length) % WALK_SEQ.length;
  return WALK_SEQ[i] ?? 0;
}

/**
 * The frame name the 2D view would use: `crouch-<dir>` for POSE_MS after a pose change, else
 * `sit-<dir>` when seated, else `<dir>-<walk>`. The crouch check comes first, as World3DView.
 */
export function frameName(
  dir: Dir,
  pose: FramePose,
  moving: boolean,
  now: number,
  poseAt: number,
  poseMs: number,
): string {
  if (now - poseAt < poseMs) return `crouch-${dir}`;
  if (pose === 'sit') return `sit-${dir}`;
  return `${dir}-${walkFrame(moving, now)}`;
}

/** The sheet cell of the same frame as `frameName`. */
export function frameCell(
  dir: Dir,
  pose: FramePose,
  moving: boolean,
  now: number,
  poseAt: number,
  poseMs: number,
): { col: number; row: number } {
  if (now - poseAt < poseMs) return paperCell(dir, 'crouch');
  if (pose === 'sit') return paperCell(dir, 'sit');
  return paperCell(dir, 'walk', walkFrame(moving, now));
}

/** A texture window onto one cell of the sheet, for three.js (v runs bottom-up). */
export interface CellUv {
  offsetX: number;
  offsetY: number;
  repeatX: number;
  repeatY: number;
}

/** The part of a `scale` sheet that holds the cell at (col, row), margin included. */
export function cellUv(col: number, row: number, scale: PaperScale): CellUv {
  const { cw, ch } = paperCellSize(scale);
  const { width, height } = paperSheetSize(scale);
  return {
    offsetX: (col * cw) / width,
    offsetY: 1 - ((row + 1) * ch) / height,
    repeatX: cw / width,
    repeatY: ch / height,
  };
}
