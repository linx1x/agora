/**
 * The pixels of a tool swing, shared by the world views (P17.21b, P17.21c): the three frames of each
 * facing (the handle and head turned through the arc) and the tier mark (`overlay.ts`). Code-drawn
 * canvases, made once and cached, so the flat view's textures and the 2.5D view's sprites are the
 * same pixels. Timing, sizes and the frame keys are in `swing.ts`; nothing here plays anything.
 */
import { OVERLAY_GRID, tierOverlay } from './overlay';
import { FACINGS, HEAD_PX, SWING_FRAMES, type Facing } from './swing';

/** Side of a frame's canvas, in pixels. */
export const FRAME_PX = 16;
/** The swing turns this far (radians) from the first frame to the last. */
const SWING_ARC = 0.9;
const ANGLE: Readonly<Record<Facing, number>> = {
  right: 0,
  down: Math.PI / 2,
  left: Math.PI,
  up: -Math.PI / 2,
};

const frames = new Map<string, HTMLCanvasElement>();
const marks = new Map<number, HTMLCanvasElement>();

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
  // a light wood handle and a steel head with a dark edge: the arc reads on the dirt and on clothes
  g.strokeStyle = '#e8c48a';
  g.lineWidth = 2;
  g.beginPath();
  g.moveTo(mid + Math.cos(a) * 2, mid + Math.sin(a) * 2);
  g.lineTo(hx, hy);
  g.stroke();
  g.fillStyle = '#cfd6dd';
  g.strokeStyle = '#3a4650';
  g.lineWidth = 1;
  g.beginPath();
  g.arc(hx, hy, 3, 0, Math.PI * 2);
  g.fill();
  g.stroke();
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

/** The frame `n` (0 to SWING_FRAMES - 1) of a facing's swing: `FRAME_PX` square, cached. */
export function swingFrameCanvas(facing: Facing, n: number): HTMLCanvasElement {
  const key = `${facing}-${n}`;
  let c = frames.get(key);
  if (!c) {
    c = drawFrame(facing, n);
    frames.set(key, c);
  }
  return c;
}

/** The tier mark (1 to 3), `OVERLAY_GRID` square, cached. */
export function tierMarkCanvas(tier: number): HTMLCanvasElement {
  let c = marks.get(tier);
  if (!c) {
    c = drawMark(tier);
    marks.set(tier, c);
  }
  return c;
}

/** Every facing's frames, in play order, as (facing, n) pairs: the views add them to their atlas or textures. */
export function allSwingFrames(): { facing: Facing; n: number }[] {
  return FACINGS.flatMap((facing) =>
    Array.from({ length: SWING_FRAMES }, (_, n) => ({ facing, n })),
  );
}
