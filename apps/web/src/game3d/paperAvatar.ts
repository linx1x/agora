/**
 * P16.7 (ADR-052): the smooth 64×96 paper cut-out avatar, drawn in code from the same catalog
 * choices as the 2D avatar (skin, hair style and colour, top, bottom, accessory), so saved avatars
 * keep working. Proportions lean Paper Mario: a big head, a short body.
 *
 * Ported from the spike's `smooth` look (`spikes/world25d/src/paper-avatar.ts`; the `pixel` look
 * is dropped), with three additions: a four-frame walk cycle (stand, left step, stand, right step,
 * as `game/avatars.ts`), a `crouch` pose and a `sit` pose (on a chair the world draws), and a
 * texture scale of 1× or 2×. Each figure is drawn in a 100 × 150 unit box and mapped onto the
 * 64 × 96 figure at `scale`; the box is shrunk slightly so the beanie pom and the bun stay inside it.
 * The white cut-out edge (2 px × scale, with a faint grey hairline one px below it) sits in the
 * `PAPER_PAD` margin of each cell, so it is never clipped. Sheet layout: `paperLayout.ts`.
 */
import {
  ACCESSORIES,
  BOTTOM_COLORS,
  HAIR_COLORS,
  HAIR_STYLES,
  SKIN_TONES,
  TOP_COLORS,
  type Avatar,
} from '@agora/shared';
import {
  PAPER_FRAMES,
  PAPER_H,
  PAPER_PAD,
  PAPER_W,
  paperCell,
  paperCellSize,
  paperSheetSize,
  type PaperDir,
  type PaperPose,
  type PaperScale,
} from './paperLayout';

type Ctx = CanvasRenderingContext2D;
type Pt = [number, number];
type HairStyle = (typeof HAIR_STYLES)[number];

const DIRS: readonly PaperDir[] = ['down', 'left', 'right', 'up'];
const EDGE_WHITE = '#fbfaf6';
const EDGE_GREY = '#5b6168';
const SHOE = '#2b2f36';
const INK = '#22262c';

/**
 * Body state of one frame. `drop` lowers the upper body (units; negative bobs it up on a step);
 * `lift` raises a foot per leg (left, right); `reach` moves a stepping foot forward in side view;
 * `swing` is the arm phase (-1 back, 0 level, 1 forward), opposite the leg that steps forward.
 */
interface Posture {
  drop: number;
  lift: readonly [number, number];
  reach: readonly [number, number];
  swing: -1 | 0 | 1;
}

function posture(pose: PaperPose, frame: number): Posture {
  if (pose === 'crouch') return { drop: 9, lift: [0, 0], reach: [0, 0], swing: 0 };
  if (pose === 'sit') return { drop: 14, lift: [0, 0], reach: [0, 0], swing: 0 };
  // walk: 0 stand, 1 left step, 2 stand, 3 right step (frame is already 0–3)
  if (frame === 1) return { drop: -2, lift: [3, 0], reach: [8, 0], swing: -1 };
  if (frame === 3) return { drop: -2, lift: [0, 3], reach: [0, 6], swing: 1 };
  return { drop: 0, lift: [0, 0], reach: [0, 0], swing: 0 };
}

/** Darken (k < 1) or lighten (k > 1) a `#rrggbb` colour. */
function shade(hex: string, k: number): string {
  const n = parseInt(hex.slice(1), 16);
  const f = (v: number) =>
    Math.max(0, Math.min(255, Math.round(k < 1 ? v * k : v + (255 - v) * (k - 1))));
  return `rgb(${f(n >> 16)},${f((n >> 8) & 255)},${f(n & 255)})`;
}

function ell(c: Ctx, x: number, y: number, rx: number, ry: number, col: string): void {
  c.fillStyle = col;
  c.beginPath();
  c.ellipse(x, y, rx, ry, 0, 0, Math.PI * 2);
  c.fill();
}

function rr(c: Ctx, x: number, y: number, w: number, h: number, r: number, col: string): void {
  c.fillStyle = col;
  c.beginPath();
  c.roundRect(x, y, w, h, r);
  c.fill();
}

/**
 * Knee of a two-bone leg from hip `h` to ankle `f` (segments `l1`, `l2`): of the two solutions,
 * the one further along `bias`. Side view bends knees forward, front view outward.
 */
function knee(h: Pt, f: Pt, l1: number, l2: number, bias: Pt): Pt {
  const dx = f[0] - h[0];
  const dy = f[1] - h[1];
  const d = Math.max(1e-3, Math.min(Math.hypot(dx, dy), l1 + l2));
  const ux = dx / d;
  const uy = dy / d;
  const along = (l1 * l1 - l2 * l2 + d * d) / (2 * d);
  const perp = Math.sqrt(Math.max(0, l1 * l1 - along * along));
  const bx = h[0] + ux * along;
  const by = h[1] + uy * along;
  const a: Pt = [bx - uy * perp, by + ux * perp];
  const b: Pt = [bx + uy * perp, by - ux * perp];
  return a[0] * bias[0] + a[1] * bias[1] >= b[0] * bias[0] + b[1] * bias[1] ? a : b;
}

/** One arm: a rounded sleeve hung from the shoulder `(px, py)`, rotated by `theta`, with a hand. */
function arm(
  c: Ctx,
  px: number,
  py: number,
  theta: number,
  len: number,
  half: number,
  sleeve: string,
  skin: string,
): void {
  c.save();
  c.translate(px, py);
  c.rotate(theta);
  c.fillStyle = sleeve;
  c.beginPath();
  c.roundRect(-half, -6, half * 2, len, 6);
  c.fill();
  ell(c, 0, len - 5, half, 6, skin);
  c.restore();
}

/** Hair behind and on top of the head. Front and side get a crown, up gets the back of the head. */
function hair(c: Ctx, dir: PaperDir, style: HairStyle, hx: number, col: string): void {
  const dark = shade(col, 0.8);
  const side = dir === 'left' || dir === 'right';
  const curls = (y0: number) => {
    for (let i = 0; i < 7; i++)
      ell(c, hx - 30 + i * 10, y0 + (i % 2) * 4, 9, 9, i % 2 ? col : dark);
  };
  if (dir === 'up') {
    // back of the head: the dome stops above the nape so the head keeps its outline
    if (style === 'buzz') ell(c, hx, 36, 33, 26, col);
    else ell(c, hx, 38, 34, 28, col);
    if (style === 'long') rr(c, hx - 32, 40, 64, 40, 14, col);
    if (style === 'curly') curls(20);
    if (style === 'bun') ell(c, hx, 12, 13, 11, dark);
    return;
  }
  c.fillStyle = col;
  c.beginPath();
  if (style === 'buzz') c.ellipse(hx, 30, 31, 18, 0, Math.PI, 0);
  else c.ellipse(hx, 32, 35, 24, 0, Math.PI, 0);
  c.fill();
  if (style === 'long') {
    if (side) rr(c, hx - 34, 30, 26, 50, 8, col);
    else {
      rr(c, hx - 36, 30, 14, 50, 8, col);
      rr(c, hx + 22, 30, 14, 50, 8, col);
    }
  }
  if (style === 'curly') curls(22);
  if (style === 'bun') ell(c, side ? hx - 22 : hx, 8, 13, 11, dark);
  if (style === 'short' || style === 'bun') {
    // fringe: the lower half of a flat ellipse over the forehead
    c.fillStyle = col;
    c.beginPath();
    c.ellipse(side ? hx + 8 : hx - 8, 30, 24, 10, -0.15, 0, Math.PI);
    c.fill();
  }
  if (side) rr(c, hx - 34, 26, 18, 26, 8, col); // back of the head
}

/** Face features: none from behind, eyes and smile from the front, eye, nose and ear in profile. */
function face(c: Ctx, dir: PaperDir, hx: number, skin: string): void {
  if (dir === 'down') {
    ell(c, hx - 12, 48, 4.2, 6, INK);
    ell(c, hx + 12, 48, 4.2, 6, INK);
    ell(c, hx - 11, 46, 1.5, 2, '#ffffff');
    ell(c, hx + 13, 46, 1.5, 2, '#ffffff');
    ell(c, hx - 22, 58, 6, 3.5, 'rgba(232,120,110,.35)');
    ell(c, hx + 22, 58, 6, 3.5, 'rgba(232,120,110,.35)');
    c.strokeStyle = shade(skin, 0.55);
    c.lineWidth = 2.5;
    c.lineCap = 'round';
    c.beginPath();
    c.arc(hx, 56, 5, 0.2 * Math.PI, 0.8 * Math.PI);
    c.stroke();
  } else if (dir === 'left' || dir === 'right') {
    ell(c, hx + 18, 47, 4, 6, INK);
    ell(c, hx + 19, 45, 1.4, 2, '#ffffff');
    ell(c, hx + 31, 52, 4, 4, shade(skin, 0.9)); // nose
    ell(c, hx + 14, 58, 5, 3, 'rgba(232,120,110,.35)');
    ell(c, hx - 6, 48, 6, 7, shade(skin, 0.9)); // ear
  }
}

/** Accessories over the head: glasses (not from behind), a beanie, headphones. */
function accessory(c: Ctx, dir: PaperDir, acc: (typeof ACCESSORIES)[number], hx: number): void {
  const side = dir === 'left' || dir === 'right';
  if (acc === 'glasses' && dir !== 'up') {
    c.strokeStyle = '#1f2328';
    c.lineWidth = 3;
    c.beginPath();
    if (side) {
      c.roundRect(hx + 10, 40, 16, 13, 4);
      c.moveTo(hx + 10, 45);
      c.lineTo(hx - 6, 44);
    } else {
      c.roundRect(hx - 21, 40, 17, 14, 4);
      c.roundRect(hx + 4, 40, 17, 14, 4);
      c.moveTo(hx - 4, 46);
      c.lineTo(hx + 4, 46);
    }
    c.stroke();
  }
  if (acc === 'beanie') {
    c.fillStyle = '#b8443a';
    c.beginPath();
    c.ellipse(hx, 26, 36, 24, 0, Math.PI, 0);
    c.fill();
    rr(c, hx - 36, 22, 72, 10, 5, '#93352d');
    ell(c, hx, 2, 7, 7, '#e9e2d6');
  }
  if (acc === 'headphones') {
    c.strokeStyle = SHOE;
    c.lineWidth = 6;
    c.beginPath();
    c.arc(hx, 40, 36, Math.PI * 1.05, Math.PI * 1.95);
    c.stroke();
    if (side) rr(c, hx - 12, 36, 14, 22, 6, '#3a7bd5');
    else {
      rr(c, hx - 42, 36, 12, 22, 6, '#3a7bd5');
      rr(c, hx + 30, 36, 12, 22, 6, '#3a7bd5');
    }
  }
}

/**
 * Draw the figure (no edge) into a `W × H` canvas. Left is the mirror of right; every other
 * direction uses the same geometry in its own view.
 */
function figure(
  c: Ctx,
  a: Avatar,
  dir: PaperDir,
  pose: PaperPose,
  frame: number,
  W: number,
  H: number,
): void {
  const p = posture(pose, frame);
  const side = dir === 'left' || dir === 'right';
  const sit = pose === 'sit';
  const crouch = pose === 'crouch';
  const skin = SKIN_TONES[a.skin]!;
  const hairCol = HAIR_COLORS[a.hairColor]!;
  const top = TOP_COLORS[a.top]!;
  const bottom = BOTTOM_COLORS[a.bottom]!;
  const style = HAIR_STYLES[a.hair]!;
  const acc = ACCESSORIES[a.accessory]!;

  c.save();
  c.scale(W / 100, H / 150);
  if (dir === 'left') {
    c.translate(100, 0);
    c.scale(-1, 1);
  }
  // the figure runs from y -5 (beanie pom) to 145 (soles); shrink about y 70 to sit inside the box
  c.translate(50, 75);
  c.scale(0.92, 0.92);
  c.translate(-50, -70);

  // legs and shoes: drawn first so the hip hides under the torso
  const hipY = 112 + p.drop;
  type Leg = { hip: Pt; ankle: Pt; bias: Pt; col: string };
  let legs: Leg[];
  if (side) {
    legs = [
      {
        hip: [48, hipY],
        ankle: [45 + p.reach[0], 137 - p.lift[0]],
        bias: [1, 0],
        col: shade(bottom, 0.8),
      },
      { hip: [56, hipY], ankle: [61 + p.reach[1], 137 - p.lift[1]], bias: [1, 0], col: bottom },
    ];
    if (sit) {
      legs[0]!.ankle = [50, 137];
      legs[1]!.ankle = [64, 137];
    }
  } else {
    legs = [
      { hip: [41, hipY], ankle: [40, 137 - p.lift[0]], bias: [-1, 0], col: bottom },
      { hip: [59, hipY], ankle: [60, 137 - p.lift[1]], bias: [1, 0], col: shade(bottom, 0.85) },
    ];
  }
  for (const l of legs) {
    // seated from the front, the thigh is foreshortened: the knee sits just below the hip
    const k: Pt =
      sit && !side ? [(l.hip[0] + l.ankle[0]) / 2, 131] : knee(l.hip, l.ankle, 13.5, 13.5, l.bias);
    c.strokeStyle = l.col;
    c.lineWidth = 14;
    c.lineCap = 'round';
    c.lineJoin = 'round';
    c.beginPath();
    c.moveTo(l.hip[0], l.hip[1]);
    c.lineTo(k[0], k[1]);
    c.lineTo(l.ankle[0], l.ankle[1]);
    c.stroke();
    const [ax, ay] = l.ankle;
    rr(c, side ? ax - 5 : ax - 10, ay - 4, side ? 22 : 20, 12, 5, SHOE);
  }

  // upper body: torso, arms, head, hair, face, accessory; all lowered by `drop`
  c.save();
  c.translate(0, p.drop);
  c.fillStyle = top;
  c.beginPath();
  if (side) c.roundRect(34, 76, 36, 42, 12);
  else c.roundRect(26, 76, 48, 42, 14);
  c.fill();
  rr(c, side ? 34 : 26, 104, side ? 36 : 48, 14, 6, shade(top, 0.82));
  if (side) {
    // the near arm: forward or back with the walk, forward to the lap when seated
    const theta = sit ? -0.35 : crouch ? -0.15 : -p.swing * 0.4;
    arm(c, 55, 86, theta, 30, 7, shade(top, 0.86), skin);
  } else {
    // front and back: the swinging arm reads as longer, the trailing one shorter
    arm(c, 22.5, 86, 0, 30 + 2.5 * p.swing, 6.5, shade(top, 0.9), skin);
    arm(c, 77.5, 86, 0, 30 - 2.5 * p.swing, 6.5, shade(top, 0.9), skin);
  }

  const hx = side ? 52 : 50;
  ell(c, hx, 44, 33, 31, skin);
  if (style !== 'none') hair(c, dir, style, hx, hairCol);
  face(c, dir, hx, skin);
  accessory(c, dir, acc, hx);
  c.restore();
  c.restore();
}

/** Scratch canvas for the cut-out edge, resized (not reallocated) to the cell size. */
let edgeScratch: HTMLCanvasElement | undefined;

function scratchCtx(w: number, h: number): Ctx {
  if (!edgeScratch) edgeScratch = document.createElement('canvas');
  if (edgeScratch.width !== w) edgeScratch.width = w;
  if (edgeScratch.height !== h) edgeScratch.height = h;
  return edgeScratch.getContext('2d')!;
}

/** Stamp `src` at every whole-pixel offset within `r` of the origin (a disc-shaped dilation). */
function stampDisc(c: Ctx, src: HTMLCanvasElement, r: number): void {
  for (let dy = -r; dy <= r; dy++)
    for (let dx = -r; dx <= r; dx++) if (dx * dx + dy * dy <= r * r) c.drawImage(src, dx, dy);
}

/**
 * Wrap the figure in its cut-out: a white edge `2 px × scale` wide around the alpha shape, and a
 * faint grey hairline one px below that. Returns a canvas of exactly `paperCellSize(scale)`.
 */
function cutout(fig: HTMLCanvasElement, scale: PaperScale): HTMLCanvasElement {
  const { cw, ch } = paperCellSize(scale);
  const pad = PAPER_PAD * scale;
  const edge = 2 * scale;
  const out = document.createElement('canvas');
  out.width = cw;
  out.height = ch;
  const oc = out.getContext('2d')!;
  const sc = scratchCtx(cw, ch);
  // 1. the white silhouette, dilated into the margin
  sc.globalCompositeOperation = 'source-over';
  sc.clearRect(0, 0, cw, ch);
  sc.drawImage(fig, pad, pad);
  sc.globalCompositeOperation = 'source-in';
  sc.fillStyle = EDGE_WHITE;
  sc.fillRect(0, 0, cw, ch);
  sc.globalCompositeOperation = 'source-over';
  stampDisc(oc, sc.canvas, edge);
  // 2. the grey hairline: the same ring tinted grey, one px lower, under the white at low alpha
  sc.globalCompositeOperation = 'copy';
  sc.drawImage(out, 0, 0);
  sc.globalCompositeOperation = 'source-in';
  sc.fillStyle = EDGE_GREY;
  sc.fillRect(0, 0, cw, ch);
  sc.globalCompositeOperation = 'source-over';
  oc.globalCompositeOperation = 'destination-over';
  oc.globalAlpha = 0.35;
  oc.drawImage(sc.canvas, 0, scale);
  oc.globalAlpha = 1;
  oc.globalCompositeOperation = 'source-over';
  // 3. the figure on top
  oc.drawImage(fig, pad, pad);
  return out;
}

/** One frame (figure + white cut-out edge), sized `paperCellSize(scale)`. */
export function paperFrame(
  a: Avatar,
  dir: PaperDir,
  pose: PaperPose,
  frame: number,
  scale: PaperScale,
): HTMLCanvasElement {
  const walkFrame = ((frame % PAPER_FRAMES) + PAPER_FRAMES) % PAPER_FRAMES;
  const fig = document.createElement('canvas');
  fig.width = PAPER_W * scale;
  fig.height = PAPER_H * scale;
  figure(fig.getContext('2d')!, a, dir, pose, walkFrame, fig.width, fig.height);
  return cutout(fig, scale);
}

/** Whole sheet, sized `paperSheetSize(scale)`: walk rows, then crouch and sit, one column per direction. */
export function makePaperSheet(a: Avatar, scale: PaperScale): HTMLCanvasElement {
  const { width, height } = paperSheetSize(scale);
  const { cw, ch } = paperCellSize(scale);
  const cv = document.createElement('canvas');
  cv.width = width;
  cv.height = height;
  const c = cv.getContext('2d')!;
  const cells: Array<[PaperDir, PaperPose, number]> = [
    ...DIRS.flatMap((dir) =>
      [0, 1, 2, 3].map((f): [PaperDir, PaperPose, number] => [dir, 'walk', f]),
    ),
    ...DIRS.map((dir): [PaperDir, PaperPose, number] => [dir, 'crouch', 0]),
    ...DIRS.map((dir): [PaperDir, PaperPose, number] => [dir, 'sit', 0]),
  ];
  for (const [dir, pose, frame] of cells) {
    const { col, row } = paperCell(dir, pose, frame);
    c.drawImage(paperFrame(a, dir, pose, frame, scale), col * cw, row * ch);
  }
  return cv;
}

/** Data URL of one standing frame for the avatar editor (drawn at 2×). */
export function paperPreviewDataUrl(a: Avatar, dir: PaperDir = 'down'): string {
  return paperFrame(a, dir, 'walk', 0, 2).toDataURL();
}
