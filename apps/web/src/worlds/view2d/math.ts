/**
 * Pure geometry of the flat world view (P17.14, ADR-053): how a cell's level lifts it on screen, the
 * darker side strip a step leaves, the depth order of players, blocks and objects, which cells the
 * camera can see, and what the farm layer shows on a plot. No Phaser here, so it is unit-tested.
 */
import { LEVEL_MAX, WORLD_CELL_PX, type GridCell, type PlotState } from '@agora/shared';

export const CELL = WORLD_CELL_PX;
/** Pixels a level lifts a cell's top face (ADR-053: 12 px per level). */
export const LEVEL_PX = 12;
/** Feet of a walker standing in the middle of a cell, below the cell's centre row. */
export const FEET_DY = 26;

/** How far a raised cell's top can rise above its own cell (level 7 is 84 px). */
export const MAX_LIFT = LEVEL_PX * LEVEL_MAX;

/** Screen y of a cell's top face: the cell row, lifted by its level. */
export function topY(cy: number, level: number): number {
  return cy * CELL - LEVEL_PX * level;
}

/**
 * The darker side strip under a raised cell: from its bottom edge down to the top of the cell to
 * the south, when that one is lower. Null when the south cell is level or higher (nothing shows).
 * `shade` is `steep` for a drop of two or more levels, so cliffs read darker than steps.
 */
export function sideStrip(
  cy: number,
  level: number,
  southLevel: number,
): { y: number; h: number; shade: 'step' | 'steep' } | null {
  const drop = level - southLevel;
  if (drop <= 0) return null;
  return {
    y: topY(cy, level) + CELL,
    h: Math.min(LEVEL_PX * drop, MAX_LIFT),
    shade: drop >= 2 ? 'steep' : 'step',
  };
}

/** Depth ranks inside one base row (higher draws later). */
export const RANK = { strip: 0, top: 1, farm: 2, decor: 3, crop: 4, avatar: 5 } as const;
export type Rank = (typeof RANK)[keyof typeof RANK];

/**
 * Draw order: by base y (the cell's centre row, or a walker's feet), then by level, then by rank.
 * An object lower on screen draws over one higher up; a raised cell draws over the row behind it.
 * Base y is whole pixels, so the product stays exact.
 */
export function depthOf(baseY: number, level: number, rank: Rank): number {
  return Math.round(baseY) * 64 + level * 8 + rank;
}

/** The base y of a cell's objects: its centre row. */
export function cellBaseY(cy: number): number {
  return cy * CELL + CELL / 2;
}

/** Inclusive cell bounds the camera can see, with margins for raised tops and tall decor. */
export interface CellWindow {
  readonly x0: number;
  readonly y0: number;
  readonly x1: number;
  readonly y1: number;
}

/**
 * The cells to draw for a view in world pixels. Rows above the view get the most margin: a raised
 * top and a tree crown reach up into the row above their cell.
 */
export function cellWindow(
  view: { left: number; top: number; right: number; bottom: number },
  margin = { up: 4, side: 1, down: 1 },
): CellWindow {
  return {
    x0: Math.floor(view.left / CELL) - margin.side,
    y0: Math.floor(view.top / CELL) - margin.up,
    x1: Math.floor(view.right / CELL) + margin.side,
    y1: Math.floor(view.bottom / CELL) + margin.down,
  };
}

/** Whether a cell is inside a window. */
export function inWindow(w: CellWindow, cx: number, cy: number): boolean {
  return cx >= w.x0 && cx <= w.x1 && cy >= w.y0 && cy <= w.y1;
}

/** What a plot shows on the farm layer today (P17.22 sends the plots; the art is placeholder). */
export interface FarmVisual {
  /** tilled soil over the ground */
  readonly soil: boolean;
  /** watered today: the soil takes the watered tint */
  readonly watered: boolean;
  /** the crop art frame: 0-3 growth, 4 ripe; null when nothing is planted */
  readonly crop: number | null;
  readonly sprinkler: boolean;
}

export const CROP_FRAMES = 5;
export const RIPE_FRAME = 4;

/** The art frame of a crop: growth stages 0-3 (the last stages share the last sprout), then ripe. */
export function cropFrame(stage: number, ripe: boolean): number {
  if (ripe) return RIPE_FRAME;
  return Math.max(0, Math.min(RIPE_FRAME - 1, Math.floor(stage)));
}

/** The farm visual of a plot on a day (watered means watered today). */
export function farmVisual(plot: PlotState | undefined, day: number): FarmVisual | null {
  if (!plot) return null;
  const soil = plot.tilled;
  const crop = plot.crop ? cropFrame(plot.crop.stage, plot.crop.ripe) : null;
  const sprinkler = plot.sprinkler !== null;
  if (!soil && crop === null && !sprinkler) return null;
  return { soil, watered: soil && plot.wateredOn === day, crop, sprinkler };
}

/** Pick the cell a screen point is on: the front-most one whose lifted top covers the point. */
export function pickCell(
  wx: number,
  wy: number,
  levelAt: (cx: number, cy: number) => number,
): GridCell {
  const base = Math.floor(wy / CELL);
  const cx = Math.floor(wx / CELL);
  // a raised cell's top sits above its own row, so the point can belong to a row further south
  for (let cy = base + 3; cy >= base - 3; cy--) {
    const top = topY(cy, levelAt(cx, cy));
    if (wy >= top && wy < top + CELL) return { cx, cy };
  }
  return { cx, cy: base };
}

