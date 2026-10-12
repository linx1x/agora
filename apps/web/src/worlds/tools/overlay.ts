/**
 * The tier mark of a held tool (ADR-053, P17.21, P17.21d): a small dark plate in the bottom corner
 * of the tool card, with one, two or three pips in the tier's colour (wood, iron, diamond). Pure
 * geometry on the card's grid, so the tier reads at a glance at the default zoom. Code-drawn: the
 * views fill these rectangles with `fillRect` (`swingArt.ts`), so there is no art to register.
 */

/** The card's grid, in pixels: the tool card is this square, and so is the tier mark's canvas. */
export const OVERLAY_GRID = 32;

export type OverlayTier = 1 | 2 | 3;

/** A rectangle on the grid: top-left corner and size, in pixels. */
export interface OverlayRect {
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
}

export interface TierOverlay {
  readonly tier: OverlayTier;
  /** wood, iron, diamond: the head of the card and the pips */
  readonly color: string;
  /** the dark plate behind the pips */
  readonly plate: OverlayRect;
  /** one square pip per tier, left to right, centred on the plate */
  readonly pips: readonly OverlayRect[];
}

/** Light enough to read on the dirt and on the dark plate: tan wood, silver iron, cyan diamond. */
const COLORS: Readonly<Record<OverlayTier, string>> = {
  1: '#d9a46a',
  2: '#e6ecf2',
  3: '#6fe3f2',
};

/** The plate: 17 by 7 px, two px in from the corner. */
const PLATE_W = 17;
const PLATE_H = 7;
/** A pip is 3 by 3 px, with 2 px between pips. */
const PIP = 3;
const GAP = 2;
const INSET = 2;

/** The overlay of a tool tier. Throws for any other tier. */
export function tierOverlay(tier: number): TierOverlay {
  if (tier !== 1 && tier !== 2 && tier !== 3) throw new RangeError(`tool tier must be 1, 2 or 3, got ${tier}`);
  const plate: OverlayRect = {
    x: OVERLAY_GRID - INSET - PLATE_W,
    y: OVERLAY_GRID - INSET - PLATE_H,
    w: PLATE_W,
    h: PLATE_H,
  };
  const row = tier * PIP + (tier - 1) * GAP;
  const left = plate.x + Math.round((PLATE_W - row) / 2);
  const pips: OverlayRect[] = [];
  for (let i = 0; i < tier; i++) {
    pips.push({ x: left + i * (PIP + GAP), y: plate.y + Math.round((PLATE_H - PIP) / 2), w: PIP, h: PIP });
  }
  return { tier, color: COLORS[tier], plate, pips };
}
