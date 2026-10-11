/**
 * Pixel art of the flat world view (P17.14), drawn in code until real art exists (ADR-053: a
 * missing sprite falls back to the placeholder). Pure RGBA functions, so they are unit-tested; the
 * canvas atlas that holds them is in atlas.ts.
 *
 * A block's top face is the first 24 rows of its placeholder tile, and its side band (rows 24-31)
 * repeats down a cliff strip. Decor is the whole placeholder tile. Crops and the sprinkler are
 * drawn here, one frame per growth stage.
 */
import { LEVEL_MAX, hash32 } from '@agora/shared';
import { placeholderTiles, TILE_PX, type Tile } from '../placeholders';
import { CROP_FRAMES, LEVEL_PX, RIPE_FRAME } from './math';

export type Rgba = Uint8ClampedArray<ArrayBuffer>;
type Rgb = readonly [number, number, number];

/** Height of a full cliff strip: seven levels of 12 px. */
export const SIDE_PX = LEVEL_PX * LEVEL_MAX;
const TOP_ROWS = 24;
const SIDE_ROWS = TILE_PX - TOP_ROWS;

/** A small RGBA canvas that the draw helpers write into. */
class Canvas {
  readonly data: Rgba;
  constructor(
    readonly w: number,
    readonly h: number,
  ) {
    this.data = new Uint8ClampedArray(new ArrayBuffer(w * h * 4));
  }
  put(x: number, y: number, c: Rgb, a = 255): void {
    if (x < 0 || y < 0 || x >= this.w || y >= this.h) return;
    const i = (y * this.w + x) * 4;
    this.data[i] = c[0];
    this.data[i + 1] = c[1];
    this.data[i + 2] = c[2];
    this.data[i + 3] = a;
  }
  copyFrom(src: Rgba, sw: number, sx: number, sy: number, dx: number, dy: number, w: number, h: number): void {
    for (let y = 0; y < h; y++)
      for (let x = 0; x < w; x++) {
        const si = ((sy + y) * sw + (sx + x)) * 4;
        const di = ((dy + y) * this.w + (dx + x)) * 4;
        for (let k = 0; k < 4; k++) this.data[di + k] = src[si + k]!;
      }
  }
}

/** The top face of a block: rows 0-23 as drawn, rows 24-31 repeat the speckled rows above them. */
export function topPixels(tile: Tile): Rgba {
  const c = new Canvas(TILE_PX, TILE_PX);
  c.copyFrom(tile.pixels, TILE_PX, 0, 0, 0, 0, TILE_PX, TOP_ROWS);
  // the bottom 8 rows of the top would be the side band; repeat the rows just above them instead
  for (let y = TOP_ROWS; y < TILE_PX; y++) c.copyFrom(tile.pixels, TILE_PX, 0, y - 8, 0, y, TILE_PX, 1);
  return c.data;
}

/**
 * The side of a block as a cliff strip: the side band of the tile repeated down SIDE_PX rows, so
 * a drop of any height is cut from the same face (the strip is cropped to its height).
 */
export function sidePixels(tile: Tile): Rgba {
  const c = new Canvas(TILE_PX, SIDE_PX);
  for (let y = 0; y < SIDE_PX; y++) {
    const row = TOP_ROWS + (y % SIDE_ROWS);
    c.copyFrom(tile.pixels, TILE_PX, 0, row, 0, y, TILE_PX, 1);
  }
  return c.data;
}

/** A crop at one art frame: a sprout (0-3) that grows taller, or the ripe plant with its fruit. */
export function cropPixels(frame: number, fruit: Rgb): Rgba {
  const c = new Canvas(TILE_PX, TILE_PX);
  const stem: Rgb = [84, 142, 62];
  const leaf: Rgb = [128, 190, 98];
  const ripe = frame === RIPE_FRAME;
  const height = ripe ? 16 : 4 + frame * 4;
  const base = 30;
  const top = base - height;
  for (let y = top; y <= base; y++) c.put(16, y, stem);
  const leaves = ripe ? 3 : frame;
  for (let k = 0; k < leaves; k++) {
    const y = base - 3 - k * 4;
    for (const dx of [-1, -2, -3]) c.put(16 + dx, y - (dx === -3 ? 1 : 0), leaf);
    for (const dx of [1, 2, 3]) c.put(16 + dx, y - (dx === 3 ? 1 : 0), leaf);
  }
  if (ripe) {
    for (let y = -3; y <= 3; y++)
      for (let x = -3; x <= 3; x++)
        if (x * x + y * y <= 9) c.put(16 + x, top + y - 1, fruit);
    c.put(15, top - 3, [255, 255, 255], 160);
  }
  return c.data;
}

/** The sprinkler: a grey pipe on the soil with a blue head. */
export function sprinklerPixels(): Rgba {
  const c = new Canvas(TILE_PX, TILE_PX);
  for (let y = 22; y <= 28; y++) for (let x = 15; x <= 17; x++) c.put(x, y, [120, 130, 140]);
  for (let y = 14; y <= 18; y++) for (let x = 13; x <= 19; x++) if ((x - 16) ** 2 + (y - 16) ** 2 <= 9) c.put(x, y, [92, 160, 214]);
  return c.data;
}

/** The frames a block draws, from its placeholder tile. */
export interface BlockFrames {
  readonly top: Rgba;
  readonly side: Rgba;
  readonly decor: Rgba;
}

export function blockFrames(tile: Tile): BlockFrames {
  return { top: topPixels(tile), side: sidePixels(tile), decor: tile.pixels };
}

/** Fruit colours of the ripe crops: a crop takes one of these from its id (a small fixed set). */
export const CROP_HUES: readonly Rgb[] = [
  [222, 70, 70],
  [236, 176, 58],
  [150, 96, 190],
  [240, 118, 170],
  [236, 226, 92],
];

/** Which fruit colour a crop has: the same crop id always gives the same one. */
export function cropVariant(cropId: string): number {
  return hash32(cropId) % CROP_HUES.length;
}

/** The frame name of a crop at an art frame, as the atlas names it. */
export function cropFrameName(cropId: string, frame: number): string {
  return `crop:${cropVariant(cropId)}:${frame}`;
}

/** Every crop frame: each fruit colour at each art frame, by frame name. */
export function cropFrameSet(): Map<string, Rgba> {
  const out = new Map<string, Rgba>();
  CROP_HUES.forEach((hue, v) => {
    for (let f = 0; f < CROP_FRAMES; f++) out.set(`crop:${v}:${f}`, cropPixels(f, hue));
  });
  return out;
}

/** The top, side and decor frames of every block of `blocks.json`, by block id. */
export function allBlockFrames(): Map<string, BlockFrames> {
  const out = new Map<string, BlockFrames>();
  for (const [id, tile] of placeholderTiles()) out.set(id, blockFrames(tile));
  return out;
}
