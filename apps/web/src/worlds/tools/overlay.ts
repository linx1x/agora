/**
 * The tier mark drawn on a tool's icon (ADR-053, P17.21): a row of one, two or three pixels in the
 * bottom-right corner of an 8 x 8 grid, in the tier's colour. Code-drawn, so there is no art to
 * register: P17.21b fills these pixels with `fillRect` in both world views. Pure data.
 */

export const OVERLAY_GRID = 8;

export type OverlayTier = 1 | 2 | 3;

/** One pixel on the overlay grid: [column, row], both from 0 to OVERLAY_GRID - 1. */
export type OverlayPixel = readonly [number, number];

export interface TierOverlay {
  readonly tier: OverlayTier;
  /** wood, iron, diamond */
  readonly color: string;
  readonly pixels: readonly OverlayPixel[];
}

const COLORS: Readonly<Record<OverlayTier, string>> = {
  1: '#9c6b3c',
  2: '#aeb8c4',
  3: '#6fe3f2',
};

/** The overlay of a tool tier. Throws for any other tier. */
export function tierOverlay(tier: number): TierOverlay {
  if (tier !== 1 && tier !== 2 && tier !== 3) throw new RangeError(`tool tier must be 1, 2 or 3, got ${tier}`);
  const row = OVERLAY_GRID - 2;
  const first = OVERLAY_GRID - 1 - tier;
  const pixels: OverlayPixel[] = [];
  for (let i = 0; i < tier; i++) pixels.push([first + i, row]);
  return { tier, color: COLORS[tier], pixels };
}
