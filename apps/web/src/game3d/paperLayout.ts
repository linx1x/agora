/**
 * P16.7 (ADR-052): layout of the paper avatar sheet, kept free of the DOM so it is unit-tested.
 * Same grid as the 2D sheet (`game/avatars.ts`) so the 2.5D view picks frames the same way:
 * rows 0–3 walk (down, left, right, up) × 4 frames; row 4 crouch and row 5 seated, one column per
 * direction. The figure is 64×96 at 1×; each cell adds a margin for the white cut-out edge.
 */
export const PAPER_W = 64;
export const PAPER_H = 96;
/** margin around the figure (1× px) for the white cut-out edge and its faint shadow line */
export const PAPER_PAD = 3;
export const PAPER_FRAMES = 4;
export const PAPER_ROWS = 6;
export const PAPER_DIR_ROW = { down: 0, left: 1, right: 2, up: 3 } as const;
export type PaperDir = keyof typeof PAPER_DIR_ROW;
export type PaperPose = 'walk' | 'crouch' | 'sit';
/** texture scale: 1× or 2× only, never the spike's 4× (ADR-052 texture budget) */
export type PaperScale = 1 | 2;

/** 1× on standard screens, 2× on high-density ones (device pixel ratio ≥ 1.5). */
export function paperScale(dpr: number): PaperScale {
  return Number.isFinite(dpr) && dpr >= 1.5 ? 2 : 1;
}

/** Size of one cell in texture px. */
export function paperCellSize(scale: PaperScale): { cw: number; ch: number } {
  return { cw: (PAPER_W + PAPER_PAD * 2) * scale, ch: (PAPER_H + PAPER_PAD * 2) * scale };
}

/** Size of the whole sheet in texture px. */
export function paperSheetSize(scale: PaperScale): { width: number; height: number } {
  const { cw, ch } = paperCellSize(scale);
  return { width: cw * PAPER_FRAMES, height: ch * PAPER_ROWS };
}

/** Column and row of a frame. Crouch and sit ignore `frame`. */
export function paperCell(dir: PaperDir, pose: PaperPose, frame = 0): { col: number; row: number } {
  const d = PAPER_DIR_ROW[dir];
  if (pose === 'crouch') return { col: d, row: 4 };
  if (pose === 'sit') return { col: d, row: 5 };
  return { col: ((frame % PAPER_FRAMES) + PAPER_FRAMES) % PAPER_FRAMES, row: d };
}

/** GPU memory of one person's sheet (RGBA, no mipmaps). */
export function paperSheetBytes(scale: PaperScale): number {
  const { width, height } = paperSheetSize(scale);
  return width * height * 4;
}
