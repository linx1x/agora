/**
 * Placeholder art for personal-world blocks (ADR-053, P17.13, FIX-1). Every block in `blocks.json`
 * gets a 32 px tile drawn from its biome's palette in `art-src/palettes.json`: a top face (rows
 * 0-23) and a side face (rows 24-31) for the 2.5D view, or a shape for decor. Starter objects have
 * their own shapes (a roofed wall, a door, a bed, a crate, a sign, a glowing pad, a tilled plot with
 * furrows and an edge, planked floor), so the starter reads as a house and a farm. When the asset
 * registry has a file for a block's sprite, `resolveTile` prefers that file.
 */
import palettesJson from '../../../../art-src/palettes.json';
import { BLOCKS, WORLD_BIOMES, hash32, hashCell, type Block } from '@agora/shared';

export const TILE_PX = 32;
/** rows of the top face; the side face is the rows below */
const TOP_ROWS = 24;
/** rows of a wall's roof band (shingles) before its planks */
const ROOF_ROWS = 10;

/**
 * How a block is drawn: the colour names (from the block's palette) of its top and side, and its
 * shape. Ground shapes fill the tile: `ground` a flat tile, `planks` boarded floor, `tilled` a plot
 * with furrows and an edge, `pad` a glowing ring, `box` a solid tile with a border. Decor is solid
 * (`wall`, `door`) or drawn on transparent ground: `blob` a bush or flower, `tree` a crown on a
 * trunk, `post` a thin post with a flame, `bed`, `crate` (a bin) and `sign` (a board on posts).
 * `accent` and `glow` are optional extra names for the shapes that need a third colour.
 */
export interface Look {
  readonly top: string;
  readonly side: string;
  readonly shape: Shape;
  readonly accent?: string;
  readonly glow?: string;
}

export type Shape =
  | 'ground'
  | 'planks'
  | 'tilled'
  | 'pad'
  | 'box'
  | 'wall'
  | 'door'
  | 'blob'
  | 'tree'
  | 'post'
  | 'bed'
  | 'crate'
  | 'sign';

/** Shapes that fill their whole tile: the corner is opaque, so a block of these is solid ground or a wall. */
export const OPAQUE_SHAPES: ReadonlySet<Shape> = new Set<Shape>([
  'ground',
  'planks',
  'tilled',
  'pad',
  'box',
  'wall',
  'door',
]);

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
  tilled_soil: { top: 'wood1', side: 'wood0', shape: 'tilled' },
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
  wood_wall: { top: 'terra', side: 'wood2', shape: 'wall', accent: 'wood0' },
  torch: { top: 'terra', side: 'wood1', shape: 'post' },
  stone_stairs: { top: 'stone2', side: 'stone1', shape: 'box' },
  wood_floor: { top: 'wood2', side: 'wood1', shape: 'planks' },
  return_pad: { top: 'stone2', side: 'stone0', shape: 'pad', glow: 'turq2' },
  door: { top: 'terra', side: 'wood2', shape: 'door', accent: 'wood0' },
  bed: { top: 'indigo2', side: 'wood1', shape: 'bed', accent: 'plaster2' },
  shipping_bin: { top: 'wood3', side: 'wood1', shape: 'crate', accent: 'wood0' },
  shop_board: { top: 'plaster2', side: 'wood0', shape: 'sign', accent: 'terra' },
  cave_floor: { top: 'stone0', side: 'stone0', shape: 'ground' },
  cave_rock: { top: 'stone1', side: 'stone2', shape: 'ground' },
  cave_mouth: { top: 'stone1', side: 'stone0', shape: 'pad', accent: 'wood0' },
  ore_copper: { top: 'stone2', side: 'stone1', shape: 'box', accent: 'terra' },
  ore_iron: { top: 'stone2', side: 'stone1', shape: 'box', accent: 'stone3' },
  ore_gold: { top: 'stone2', side: 'stone1', shape: 'box', accent: 'sand2' },
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

/** `c` moved toward the colour `to` by `t` (0..1). */
function blend(c: Rgb, to: Rgb, t: number): Rgb {
  return [c[0] + (to[0] - c[0]) * t, c[1] + (to[1] - c[1]) * t, c[2] + (to[2] - c[2]) * t];
}

/** Draw one block. Same block, same pixels, every time: the speckle comes from the block id. */
export function renderTile(block: Block): Tile {
  const look = LOOKS[block.id];
  if (!look) throw new Error(`no placeholder look for block ${block.id}`);
  const palette = paletteOf(block);
  const named = (name: string, what: string): Rgb => {
    const hex = paletteColour(palette, name);
    if (!hex) throw new Error(`palette ${palette} lacks ${name} (${what}) for ${block.id}`);
    return rgbOf(hex);
  };
  const top = named(look.top, 'top');
  const side = named(look.side, 'side');
  const accent = look.accent ? named(look.accent, 'accent') : side;
  const glow = look.glow ? named(look.glow, 'glow') : top;
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
  /** the side band of a ground block: streaks down the columns, darker toward the bottom */
  const sideFace = (x: number, y: number) => {
    const streak = hashCell(seed, x, 1000) % 5 === 0 ? 0.12 : 0;
    return mix(side, 0, streak + (y - TOP_ROWS) * 0.02);
  };

  // ground and solid ground: the top face is a pattern, the side a cliff band
  if (
    look.shape === 'ground' ||
    look.shape === 'box' ||
    look.shape === 'planks' ||
    look.shape === 'tilled' ||
    look.shape === 'pad'
  ) {
    for (let y = 0; y < TILE_PX; y++)
      for (let x = 0; x < TILE_PX; x++) {
        if (y >= TOP_ROWS) {
          put(x, y, sideFace(x, y));
          continue;
        }
        let c = speckled(x, y, top);
        if (look.shape === 'box') {
          // a box has a lit top edge and a shaded border, so it reads as solid
          if (y < 2 || x < 2 || x >= TILE_PX - 2) c = mix(c, 0, 0.3);
          if (y === 2) c = mix(c, 255, 0.25);
        } else if (look.shape === 'planks') {
          // vertical boards 8 px wide with a seam between them; each board's end joint is staggered
          const seam = x % 8 === 0;
          const end = (y + Math.floor(x / 8) * 13) % 24 === 0;
          if (seam) c = mix(c, 0, 0.3);
          else if (end) c = mix(c, 0, 0.18);
          else if (x % 8 === 1) c = mix(c, 255, 0.08);
        } else if (look.shape === 'tilled') {
          // furrows (two dark rows in every six) and a dark plot edge on every side
          if (y % 6 === 2 || y % 6 === 3) c = mix(c, 0, 0.32);
          else if (y % 6 === 5) c = mix(c, 255, 0.12);
          if (x === 0 || y === 0 || x === TILE_PX - 1 || y === TOP_ROWS - 1) c = mix(c, 0, 0.5);
        } else if (look.shape === 'pad') {
          // a teleport plate: a glowing ring and a brighter centre on the stone
          const d = ((x + 0.5 - 16) / 12) ** 2 + ((y + 0.5 - 11.5) / 8.5) ** 2;
          if (d <= 0.2) c = mix(glow, 255, 0.35);
          else if (d <= 0.55) c = mix(glow, 255, 0.05);
          else if (d <= 0.8) c = blend(c, glow, 0.25);
          if (d > 0.8 && d <= 0.9) c = mix(c, 0, 0.25);
        }
        put(x, y, c);
      }
    return { size: TILE_PX, pixels };
  }

  // a wall and a door: a roof band of shingles over vertical planks
  if (look.shape === 'wall' || look.shape === 'door') {
    for (let y = 0; y < TILE_PX; y++)
      for (let x = 0; x < TILE_PX; x++) {
        if (y < ROOF_ROWS) {
          const course = (y >> 2) % 2 === 1 ? 4 : 0;
          let c = speckled(x, y, top);
          if ((x + course) % 8 === 0) c = mix(c, 0, 0.35);
          if (y === 0) c = mix(c, 255, 0.3);
          if (y === ROOF_ROWS - 1) c = mix(c, 0, 0.4);
          put(x, y, c);
          continue;
        }
        let c = mix(side, 0, hashCell(seed, x, 1000) % 5 === 0 ? 0.1 : 0);
        if (x % 8 === 0) c = mix(c, 0, 0.3);
        if (y >= 29) c = mix(c, 0, 0.35);
        if (look.shape === 'door') {
          // the door panel in the wall: a frame, boards, and a handle
          const inDoor = x >= 9 && x <= 22 && y >= 13;
          const frame = (x === 8 || x === 23 || y === 12) && x >= 8 && x <= 23 && y >= 12;
          if (frame) c = mix(accent, 0, 0.45);
          else if (inDoor) {
            c = mix(accent, 0, (x - 9) % 4 === 0 ? 0.25 : 0);
            if (x >= 19 && x <= 20 && y >= 21 && y <= 23) c = mix(accent, 255, 0.6);
          }
        }
        put(x, y, c);
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
  } else if (look.shape === 'bed') {
    for (let y = 0; y < TILE_PX; y++)
      for (let x = 0; x < TILE_PX; x++) {
        if (inEllipse(x, y, 16, 30, 14, 2)) put(x, y, [0, 0, 0], 70);
        // the wooden frame, then the blanket with a fold, and the pillow at the head
        const frame = (y >= 5 && y <= 6 && x >= 2 && x <= 29) || ((x <= 3 || x >= 28) && y >= 5 && y <= 29) || (y >= 28 && y <= 29 && x >= 2 && x <= 29);
        if (frame) put(x, y, mix(side, 0, (y - 5) * 0.03));
        else if (x >= 4 && x <= 27 && y >= 7 && y <= 27) {
          const pillow = y >= 7 && y <= 11 && x >= 6 && x <= 25 && !((x === 6 || x === 25) && (y === 7 || y === 11));
          if (pillow) put(x, y, speckled(x, y, accent));
          else put(x, y, y === 13 ? mix(top, 255, 0.2) : speckled(x, y, top));
        }
      }
  } else if (look.shape === 'crate') {
    for (let y = 0; y < TILE_PX; y++)
      for (let x = 0; x < TILE_PX; x++) {
        if (inEllipse(x, y, 16, 29, 13, 2.2)) put(x, y, [0, 0, 0], 70);
        // the lid (a lighter top face with a seam), then the body with slats
        if (x >= 4 && x <= 27 && y >= 8 && y <= 12) {
          let c = speckled(x, y, top);
          if (y === 8) c = mix(c, 255, 0.25);
          if (x === 16) c = mix(c, 0, 0.3);
          put(x, y, c);
        } else if (x >= 5 && x <= 26 && y >= 13 && y <= 27) {
          let c = speckled(x, y, side);
          if ((x - 5) % 5 === 0) c = mix(c, 0, 0.35);
          if (y === 19 || y === 20) c = blend(c, accent, 0.4);
          if (x === 5 || x === 26 || y === 27) c = mix(c, 0, 0.3);
          put(x, y, c);
        }
      }
  } else if (look.shape === 'sign') {
    for (let y = 0; y < TILE_PX; y++)
      for (let x = 0; x < TILE_PX; x++) {
        if (inEllipse(x, y, 16, 30, 12, 2)) put(x, y, [0, 0, 0], 70);
        // two posts, and a board with a border and three lines of text
        if ((x === 7 || x === 8 || x === 23 || x === 24) && y >= 14 && y <= 30) put(x, y, side);
        const board = x >= 3 && x <= 28 && y >= 4 && y <= 17;
        if (board) {
          const edge = x === 3 || x === 28 || y === 4 || y === 17;
          const line = (y === 8 || y === 11 || y === 14) && x >= 7 && x <= (y === 11 ? 20 : 24);
          if (edge) put(x, y, side);
          else if (line) put(x, y, accent);
          else put(x, y, speckled(x, y, top));
        }
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
