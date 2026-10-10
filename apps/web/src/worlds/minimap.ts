import type { WorldCell } from '@agora/shared';

/**
 * Colours for the tuning preview (P17.12): one colour per top block. The placeholder tiles of
 * P17.13 replace these in the game; this is only the debug view.
 */
const BLOCK_RGB: Readonly<Record<string, string>> = {
  water: '#2f6fb0',
  sand: '#e6d59a',
  stone: '#8a8d91',
  gravel: '#a7a29a',
  meadow_grass: '#7fb35a',
  meadow_dirt: '#9a7a4b',
  jungle_grass: '#3f9a52',
  jungle_mud: '#6b4c2e',
  desert_sand: '#e2c77a',
  desert_sandstone: '#c79a5c',
  taiga_moss: '#5f7f4a',
  taiga_podzol: '#7a5a3a',
  taiga_snow: '#eef3f7',
  tilled_soil: '#6d4b2c',
};

const UNKNOWN = '#999999';

/** The colour of a block id (unknown ids are grey). */
export function colourOfBlock(id: string): string {
  return BLOCK_RGB[id] ?? UNKNOWN;
}

/** The colour of one preview cell: water when it holds water, else its top block. */
export function cellColour(c: WorldCell): string {
  return c.liquid ? colourOfBlock('water') : colourOfBlock(c.block);
}

/** Paint a square preview, `size` cells across, `px` canvas pixels per cell (row-major cells). */
export function paintPreview(
  canvas: HTMLCanvasElement,
  cells: readonly WorldCell[],
  size: number,
  px: number,
): void {
  canvas.width = size * px;
  canvas.height = size * px;
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  cells.forEach((c, i) => {
    ctx.fillStyle = cellColour(c);
    ctx.fillRect((i % size) * px, Math.floor(i / size) * px, px, px);
  });
}
