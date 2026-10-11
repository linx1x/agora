/**
 * Placeholder art for personal-world blocks (ADR-053, P17.13). Every block in `blocks.json` gets a
 * 32 px tile drawn from its biome's palette in `art-src/palettes.json`: a top face (rows 0-23) and a
 * side face (rows 24-31) for the 2.5D view, or a shape for decor (a tree, a bush, a post, a box).
 * When the asset registry has a file for a block's sprite, `resolveTile` prefers that file.
 */
import palettesJson from '../../../../art-src/palettes.json';
import { BLOCKS, WORLD_BIOMES, hash32, hashCell, type Block } from '@agora/shared';

export const TILE_PX = 32;
/** rows of the top face; the side face is the rows below */
const TOP_ROWS = 24;

/**
 * How a block is drawn: the colour names (from the block's palette) of its top and side, and its
 * shape. `ground` is a flat tile, `box` a solid one with a border, `blob` a bush or flower on
 * transparent ground, `tree` a crown on a trunk, `post` a thin post with a flame on top.
 */
export interface Look {
  readonly top: string;
  readonly side: string;
  readonly shape: 'ground' | 'box' | 'blob' | 'tree' | 'post';
}

/** Looks by block id. A block missing here fails the placeholder test. */
export const LOOKS: Readonly<Record<string, Look>> = {
  stone: { top: 'stone2', side: 'stone1', shape: 'ground' },
  gravel: { top: 'stone3', side: 'stone2', shape: 'ground' },
  sand: { top: 'sand2', side: 'sand1', shape: 'ground' },
  water: { top: 'tile1', side: 'tile0', shape: 'ground' },
  meadow_grass: { top: 'bons2', side: 'pot', shape: 'ground' },
  meadow_dirt: { top: 'pot', side: 'wood0', shape: 'ground' },
  jungle_grass: { top: 'leaf3', side: 'dirt0', shape: 'ground' },
  jungle_mud: { top: 'dirt1', side: 'dirt0', shape: 'ground' },
  desert_sand: { top: 'sand2', side: 'sand0', shape: 'ground' },
  desert_sandstone: { top: 'stone1', side: 'stone0', shape: 'ground' },
  taiga_moss: { top: 'pine2', side: 'wood0', shape: 'ground' },
  taiga_podzol: { top: 'wood1', side: 'wood0', shape: 'ground' },
  taiga_snow: { top: 'snow1', side: 'snow0', shape: 'ground' },
  tilled_soil: { top: 'wood1', side: 'wood0', shape: 'ground' },
  tall_grass: { top: 'bons3', side: 'bons1', shape: 'blob' },
  flower: { top: 'lotus', side: 'bons1', shape: 'blob' },
  fern: { top: 'moss2', side: 'moss1', shape: 'blob' },
  dead_bush: { top: 'wood0', side: 'wood1', shape: 'blob' },
  oak_tree: { top: 'bons1', side: 'wood0', shape: 'tree' },
  jungle_tree: { top: 'leaf2', side: 'wood0', shape: 'tree' },
  palm: { top: 'palm2', side: 'wood1', shape: 'tree' },
  spruce: { top: 'pine2', side: 'wood0', shape: 'tree' },
  cactus: { top: 'palm1', side: 'palm0', shape: 'blob' },
  boulder: { top: 'stone2', side: 'stone1', shape: 'box' },
  wood_wall: { top: 'wood2', side: 'wood1', shape: 'box' },
  torch: { top: 'terra', side: 'wood1', shape: 'post' },
  stone_stairs: { top: 'stone2', side: 'stone1', shape: 'box' },
  wood_floor: { top: 'wood2', side: 'wood1', shape: 'ground' },
  return_pad: { top: 'terra', side: 'terraD', shape: 'ground' },
  bed: { top: 'plaster2', side: 'wood1', shape: 'box' },
  shipping_bin: { top: 'wood2', side: 'wood0', shape: 'box' },
  shop_board: { top: 'plaster2', side: 'wood0', shape: 'box' },
  chest: { top: 'wood1', side: 'wood0', shape: 'box' },
  fence: { top: 'wood2', side: 'wood0', shape: 'post' },
  coop: { top: 'wood2', side: 'wood1', shape: 'box' },
  barn: { top: 'terra', side: 'wood0', shape: 'box' },
  workbench: { top: 'wood2', side: 'wood0', shape: 'box' },
  stove: { top: 'stone2', side: 'stone0', shape: 'box' },
  furnace: { top: 'stone1', side: 'terra', shape: 'box' },
};

export interface Tile {
  readonly size: number;
  /** RGBA, row-major, `size * size * 4` bytes */
  readonly pixels: Uint8ClampedArray<ArrayBuffer>;
}

type Rgb = readonly [number, number, number];

/** The colour a palette names, or undefined when the palette has no such name. */
export function paletteColour(palette: string, name: string): string | undefined {
  const table = (palettesJson as Record<string, unknown>)[palette];
  if (!table || typeof table !== 'object') return undefined;
  const hex = (table as Record<string, unknown>)[name];
  return typeof hex === 'string' && /^#[0-9a-f]{6}$/i.test(hex) ? hex : undefined;
}

/** The palette of a block: its first biome's palette (biomes.json), or Zen for shared blocks. */
export function paletteOf(block: Block): string {
  const biome = block.biomes[0] ? WORLD_BIOMES.byId.get(block.biomes[0]) : undefined;
  return biome?.palette ?? 'zen';
}

function rgbOf(hex: string): Rgb {
  return [parseInt(hex.slice(1, 3), 16), parseInt(hex.slice(3, 5), 16), parseInt(hex.slice(5, 7), 16)];
}

/** `c` moved toward `to` by `t` (0..1). */
function mix(c: Rgb, to: number, t: number): Rgb {
  return [c[0] + (to - c[0]) * t, c[1] + (to - c[1]) * t, c[2] + (to - c[2]) * t];
}

/** Draw one block. Same block, same pixels, every time: the speckle comes from the block id. */
export function renderTile(block: Block): Tile {
  const look = LOOKS[block.id];
  if (!look) throw new Error(`no placeholder look for block ${block.id}`);
  const palette = paletteOf(block);
  const topHex = paletteColour(palette, look.top);
  const sideHex = paletteColour(palette, look.side);
  if (!topHex || !sideHex) throw new Error(`palette ${palette} lacks ${look.top}/${look.side} for ${block.id}`);
  const top = rgbOf(topHex);
  const side = rgbOf(sideHex);
  const seed = hash32(block.id);
  const pixels = new Uint8ClampedArray(new ArrayBuffer(TILE_PX * TILE_PX * 4));
  const put = (x: number, y: number, c: Rgb, a = 255) => {
    const i = (y * TILE_PX + x) * 4;
    pixels[i] = Math.round(c[0]);
    pixels[i + 1] = Math.round(c[1]);
    pixels[i + 2] = Math.round(c[2]);
    pixels[i + 3] = a;
  };
  const inEllipse = (x: number, y: number, cx: number, cy: number, rx: number, ry: number) =>
    ((x + 0.5 - cx) / rx) ** 2 + ((y + 0.5 - cy) / ry) ** 2 <= 1;
  const speckled = (x: number, y: number, c: Rgb): Rgb => {
    const h = hashCell(seed, x, y);
    if (h % 9 === 0) return mix(c, 255, 0.16);
    if (h % 13 === 0) return mix(c, 0, 0.18);
    return c;
  };

  if (look.shape === 'ground' || look.shape === 'box') {
    for (let y = 0; y < TILE_PX; y++)
      for (let x = 0; x < TILE_PX; x++) {
        if (y < TOP_ROWS) {
          let c = speckled(x, y, top);
          // a box has a lit top edge and a shaded border, so it reads as solid
          if (look.shape === 'box' && (y < 2 || x < 2 || x >= TILE_PX - 2)) c = mix(c, 0, 0.3);
          if (look.shape === 'box' && y === 2) c = mix(c, 255, 0.25);
          put(x, y, c);
        } else {
          // the side face: streaks down the columns, darker toward the bottom
          const streak = hashCell(seed, x, 1000) % 5 === 0 ? 0.12 : 0;
          put(x, y, mix(side, 0, streak + (y - TOP_ROWS) * 0.02));
        }
      }
    return { size: TILE_PX, pixels };
  }

  // the decor shapes: transparent around the object, with a soft shadow on the ground
  if (look.shape === 'blob') {
    for (let y = 0; y < TILE_PX; y++)
      for (let x = 0; x < TILE_PX; x++) {
        if (inEllipse(x, y, 16, 26, 8, 2.5)) put(x, y, [0, 0, 0], 70);
        if (inEllipse(x, y, 16, 14, 10, 8)) put(x, y, speckled(x, y, top));
      }
  } else if (look.shape === 'tree') {
    for (let y = 0; y < TILE_PX; y++)
      for (let x = 0; x < TILE_PX; x++) {
        if (inEllipse(x, y, 16, 30, 9, 2)) put(x, y, [0, 0, 0], 70);
        if (x >= 14 && x <= 17 && y >= 16) put(x, y, side);
        if (inEllipse(x, y, 16, 11, 12, 10)) put(x, y, speckled(x, y, top));
      }
  } else {
    // post: a thin wooden post with a flame (the top colour) on it
    for (let y = 0; y < TILE_PX; y++)
      for (let x = 0; x < TILE_PX; x++) {
        if (x >= 15 && x <= 16 && y >= 12) put(x, y, side);
        if (inEllipse(x, y, 16, 9, 4, 5)) put(x, y, top);
      }
  }
  return { size: TILE_PX, pixels };
}

/** Every block of `blocks.json`, drawn. */
export function placeholderTiles(): Map<string, Tile> {
  return new Map(BLOCKS.list.map((b) => [b.id, renderTile(b)]));
}

/** The tile of a block's sprite: a registry file when one exists for its key, else the placeholder. */
export type TileSource = { readonly kind: 'file'; readonly url: string } | { readonly kind: 'placeholder' };

export function resolveTile(sprite: string, files: ReadonlyMap<string, string>): TileSource {
  const url = files.get(sprite);
  return url ? { kind: 'file', url } : { kind: 'placeholder' };
}

/** A tile as a canvas, for the game (the browser only). */
export function tileCanvas(tile: Tile): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = tile.size;
  canvas.height = tile.size;
  canvas.getContext('2d')?.putImageData(new ImageData(tile.pixels, tile.size, tile.size), 0, 0);
  return canvas;
}
