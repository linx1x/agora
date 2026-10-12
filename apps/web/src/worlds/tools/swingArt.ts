/**
 * The pixels of a tool swing, shared by the world views (P17.21b, P17.21c, P17.21d): the tool card in
 * three frames per facing (the handle and head turned through the arc), the arc the head has swept
 * (the trail), and the tier mark (`overlay.ts`). The card has a paper edge, so it reads on the dirt
 * and on clothes. Code-drawn canvases, made once and cached. Timing, sizes and the frame keys are in
 * `swing.ts`; nothing here plays anything.
 */
import { OVERLAY_GRID, tierOverlay, type OverlayRect } from './overlay';
import { FACINGS, SWING_FRAMES, type Facing } from './swing';

/** Side of a card's canvas, in pixels: the card grid (the 2.5D card is drawn `CARD_TILES` tiles wide). */
export const FRAME_PX = OVERLAY_GRID;
const CENTRE = FRAME_PX / 2;
/** The swing turns this far (radians) from the first frame to the last. */
const SWING_ARC = 0.9;
/** The head's centre from the hand, in pixels (the flat view's head). */
const REACH_PX = 12;
/** The handle starts this far from the hand (the grip). */
const GRIP_PX = 3;
/** The head: a block across the handle, this many pixels out and along (the flat view's head). */
const HEAD_OUT = 3;
const HEAD_ALONG = 4;
/** The 2.5D card's head, in its own pixels: bigger, so the head reads at the default zoom. */
const CARD_REACH_PX = 11;
const CARD_HEAD_OUT = 4;
const CARD_HEAD_ALONG = 4;
/** The card's tier plate: a box in the top-left corner (the swing sweeps the lower part), one pip per tier. */
const PLATE = { x: 2, y: 2, w: 10, h: 6 };
const PIP = 2;
const PIP_GAP = 1;

const PAPER = '#ffffff';
const INK = '#1d2328';
const WOOD = '#e8c48a';
const WOOD_EDGE = '#8a5a2b';
/** The flat view's head (steel), as it was before the tier marks. */
const STEEL = '#cfd6dd';
const ANGLE: Readonly<Record<Facing, number>> = {
  right: 0,
  down: Math.PI / 2,
  left: Math.PI,
  up: -Math.PI / 2,
};

const frames = new Map<string, HTMLCanvasElement>();
const cards = new Map<string, HTMLCanvasElement>();
const marks = new Map<number, HTMLCanvasElement>();

function canvasOf(size: number): { canvas: HTMLCanvasElement; g: CanvasRenderingContext2D } {
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const g = canvas.getContext('2d');
  if (!g) throw new Error('a 2D canvas is needed for the tool swing');
  return { canvas, g };
}

/** The angle of frame n: the first frame is one side of the arc, the last the other. */
function frameAngle(facing: Facing, n: number): number {
  return ANGLE[facing] + (n - (SWING_FRAMES - 1) / 2) * (SWING_ARC / (SWING_FRAMES - 1));
}

/** A rectangle filled with a paper edge around it, so the shape reads on any ground. */
function paperRect(g: CanvasRenderingContext2D, r: OverlayRect, fill: string): void {
  g.fillStyle = PAPER;
  g.fillRect(r.x - 1, r.y - 1, r.w + 2, r.h + 2);
  g.fillStyle = fill;
  g.fillRect(r.x, r.y, r.w, r.h);
}

/** The tier mark: the plate and its pips in the tier's colour. */
function drawMark(g: CanvasRenderingContext2D, tier: number): void {
  const mark = tierOverlay(tier);
  paperRect(g, mark.plate, INK);
  for (const pip of mark.pips) {
    g.fillStyle = mark.color;
    g.fillRect(pip.x, pip.y, pip.w, pip.h);
  }
}

/** The 2.5D card's tier plate: a small box with one pip per tier, in the tier's colour. */
function drawCardMark(g: CanvasRenderingContext2D, tier: number): void {
  paperRect(g, PLATE, INK);
  const width = tier * PIP + (tier - 1) * PIP_GAP;
  const x0 = PLATE.x + (PLATE.w - width) / 2;
  g.fillStyle = tierOverlay(tier).color;
  for (let i = 0; i < tier; i++) g.fillRect(x0 + i * (PIP + PIP_GAP), PLATE.y + (PLATE.h - PIP) / 2, PIP, PIP);
}

/**
 * One frame of the swing: the handle and head turned for the facing and the frame's place in the
 * arc, the arc swept so far (the trail, from frame 1), and the tier mark. `headColour` null is the
 * flat view's steel head, with no trail and no mark.
 */
function drawCard(
  facing: Facing,
  n: number,
  opts: { tier: number | null; trail: boolean },
): HTMLCanvasElement {
  const { canvas, g } = canvasOf(FRAME_PX);
  const head = opts.tier === null ? STEEL : tierOverlay(opts.tier).color;
  g.lineCap = 'round';
  g.lineJoin = 'round';
  const a = frameAngle(facing, n);
  const card = opts.tier !== null;
  const reach = card ? CARD_REACH_PX : REACH_PX;
  const headOut = card ? CARD_HEAD_OUT : HEAD_OUT;
  const headAlong = card ? CARD_HEAD_ALONG : HEAD_ALONG;
  // the tier plate first: the arc and the head are drawn over it
  if (opts.tier !== null) drawCardMark(g, opts.tier);
  if (opts.trail && n > 0) {
    // the arc the head has swept: a paper edge, then the head's colour on top
    g.beginPath();
    g.arc(CENTRE, CENTRE, reach, frameAngle(facing, 0), a);
    g.strokeStyle = PAPER;
    g.lineWidth = card ? 5 : 4;
    g.globalAlpha = 0.85;
    g.stroke();
    g.strokeStyle = head;
    g.lineWidth = card ? 3 : 2;
    g.globalAlpha = 1;
    g.stroke();
  }
  const hx = CENTRE + Math.cos(a) * reach;
  const hy = CENTRE + Math.sin(a) * reach;
  // the handle: paper edge, a dark wood edge, the wood
  g.beginPath();
  g.moveTo(CENTRE + Math.cos(a) * GRIP_PX, CENTRE + Math.sin(a) * GRIP_PX);
  g.lineTo(hx, hy);
  g.strokeStyle = PAPER;
  g.lineWidth = 4;
  g.stroke();
  g.strokeStyle = WOOD_EDGE;
  g.lineWidth = 2.5;
  g.stroke();
  g.strokeStyle = WOOD;
  g.lineWidth = 1.5;
  g.stroke();
  // the head: a block across the handle, with a paper edge and an ink edge
  g.save();
  g.translate(hx, hy);
  g.rotate(a);
  g.fillStyle = PAPER;
  g.fillRect(-headOut - 1, -headAlong - 1, headOut * 2 + 2, headAlong * 2 + 2);
  g.fillStyle = head;
  g.fillRect(-headOut, -headAlong, headOut * 2, headAlong * 2);
  g.strokeStyle = INK;
  g.lineWidth = 1;
  g.strokeRect(-headOut, -headAlong, headOut * 2, headAlong * 2);
  g.restore();
  return canvas;
}

/** The frame `n` (0 to SWING_FRAMES - 1) of a facing's swing, in the flat view's steel: `FRAME_PX` square, cached. */
export function swingFrameCanvas(facing: Facing, n: number): HTMLCanvasElement {
  const key = `${facing}-${n}`;
  let c = frames.get(key);
  if (!c) {
    c = drawCard(facing, n, { tier: null, trail: false });
    frames.set(key, c);
  }
  return c;
}

/**
 * The 2.5D card of a tier: frame `n` of a facing, in the tier's colours, with its tier mark and, when
 * `trail` is set, the arc swept so far. Cached per (tier, facing, frame, trail).
 */
export function swingCardCanvas(tier: number, facing: Facing, n: number, trail: boolean): HTMLCanvasElement {
  const key = `${tier}-${facing}-${n}-${trail ? 1 : 0}`;
  let c = cards.get(key);
  if (!c) {
    c = drawCard(facing, n, { tier, trail });
    cards.set(key, c);
  }
  return c;
}

/** The tier mark (1 to 3) alone, on the card grid, cached. */
export function tierMarkCanvas(tier: number): HTMLCanvasElement {
  let c = marks.get(tier);
  if (!c) {
    const { canvas, g } = canvasOf(OVERLAY_GRID);
    drawMark(g, tier);
    c = canvas;
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
