/**
 * The art of the farm in the 2.5D view (P17.21c): the four animals as small sprites on their housing
 * cell, and the marks that show a machine working or a finished batch, or a housing with products to
 * collect. Code-drawn 32 px frames (as the crops and the swing), so there is no art file and no
 * registry row. Pure RGBA functions, so they are unit-tested; the atlas that holds them is atlas3d.ts.
 */
import type { AnimalState, MachineState } from '@agora/shared';
import { TILE_PX } from './placeholders';

type Rgb = readonly [number, number, number];
type Rgba = Uint8ClampedArray<ArrayBuffer>;

/** The animals of animals.json, in the order the atlas draws them. */
export const ANIMAL_KINDS = ['plume_hen', 'cloud_sheep', 'milk_cow', 'rune_goat'] as const;
/** The marks: a machine still working, or done (a batch to collect, a housing with products). */
export const MARK_KINDS = ['busy', 'ready'] as const;

/** The sprite name of an animal or a mark in the atlas. */
export const animalSprite = (kind: string) => `animal:${kind}`;
export const markSprite = (mark: string) => `mark:${mark}`;

function rgb(hex: string): Rgb {
  return [parseInt(hex.slice(1, 3), 16), parseInt(hex.slice(3, 5), 16), parseInt(hex.slice(5, 7), 16)];
}

/** A TILE_PX square of pixels, painted with filled ellipses and rectangles. */
class Painter {
  readonly data: Rgba = new Uint8ClampedArray(new ArrayBuffer(TILE_PX * TILE_PX * 4));

  dot(x: number, y: number, c: Rgb): void {
    if (x < 0 || y < 0 || x >= TILE_PX || y >= TILE_PX) return;
    const i = (y * TILE_PX + x) * 4;
    this.data[i] = c[0];
    this.data[i + 1] = c[1];
    this.data[i + 2] = c[2];
    this.data[i + 3] = 255;
  }

  rect(x: number, y: number, w: number, h: number, hexColour: string): void {
    const c = rgb(hexColour);
    for (let yy = y; yy < y + h; yy++) for (let xx = x; xx < x + w; xx++) this.dot(xx, yy, c);
  }

  /** A filled ellipse centred on (cx, cy), in pixels (a pixel is in when its centre is). */
  ellipse(cx: number, cy: number, rx: number, ry: number, hexColour: string): void {
    const c = rgb(hexColour);
    for (let y = Math.floor(cy - ry); y <= Math.ceil(cy + ry); y++)
      for (let x = Math.floor(cx - rx); x <= Math.ceil(cx + rx); x++) {
        const dx = (x + 0.5 - cx) / rx;
        const dy = (y + 0.5 - cy) / ry;
        if (dx * dx + dy * dy <= 1) this.dot(x, y, c);
      }
  }

  /** An ellipse with a one-pixel outline in another colour. */
  body(cx: number, cy: number, rx: number, ry: number, fill: string, outline: string): void {
    this.ellipse(cx, cy, rx + 1, ry + 1, outline);
    this.ellipse(cx, cy, rx, ry, fill);
  }
}

/** Draws the animal of a kind (animals.json). An unknown kind draws a plain round body. */
export function animalPixels(kind: string): Rgba {
  const p = new Painter();
  switch (kind) {
    case 'plume_hen':
      p.ellipse(9, 15, 2, 2, '#e8e2d0');
      p.body(15, 19, 7, 5, '#f5f2e8', '#6b5a4a');
      p.body(21, 13, 3.5, 3.5, '#f5f2e8', '#6b5a4a');
      p.rect(20, 8, 2, 2, '#d63b2f');
      p.rect(24, 13, 2, 1, '#f2b33d');
      p.dot(22, 12, [34, 34, 34]);
      p.rect(13, 24, 1, 4, '#c98a2b');
      p.rect(17, 24, 1, 4, '#c98a2b');
      break;
    case 'cloud_sheep':
      p.body(11, 17, 4, 4, '#f7f7f2', '#b9b4a8');
      p.body(16, 16, 5, 5, '#f7f7f2', '#b9b4a8');
      p.body(21, 17, 4, 4, '#f7f7f2', '#b9b4a8');
      p.body(15, 20, 6, 3.5, '#f7f7f2', '#b9b4a8');
      p.ellipse(25, 15, 3, 3, '#3d3d3d');
      p.rect(12, 23, 1, 4, '#3d3d3d');
      p.rect(19, 23, 1, 4, '#3d3d3d');
      break;
    case 'milk_cow':
      p.body(15, 18, 9, 6, '#f4f4f4', '#4a4a4a');
      p.ellipse(11, 16, 2, 2, '#2b2b2b');
      p.ellipse(18, 20, 2, 2, '#2b2b2b');
      p.body(24, 13, 4, 4, '#f4f4f4', '#4a4a4a');
      p.rect(26, 15, 2, 2, '#f1b6b0');
      p.rect(22, 10, 1, 2, '#2b2b2b');
      p.rect(10, 24, 2, 4, '#2b2b2b');
      p.rect(18, 24, 2, 4, '#2b2b2b');
      break;
    case 'rune_goat':
      p.body(15, 19, 7, 5, '#c9a46a', '#5e4524');
      p.body(22, 13, 3, 3.5, '#c9a46a', '#5e4524');
      p.rect(22, 8, 1, 3, '#8a8a8a');
      p.rect(24, 8, 1, 3, '#8a8a8a');
      p.rect(23, 16, 1, 2, '#6b4f2a');
      p.dot(23, 12, [34, 34, 34]);
      p.rect(12, 23, 1, 4, '#5e4524');
      p.rect(18, 23, 1, 4, '#5e4524');
      break;
    default:
      p.body(16, 18, 8, 6, '#dddddd', '#555555');
  }
  return p.data;
}

/** The mark of a machine or housing: a flame while a batch works, a gold coin once it is ready. */
export function markPixels(mark: string): Rgba {
  const p = new Painter();
  if (mark === 'busy') {
    p.ellipse(16, 18, 6, 9, '#ff7a1a');
    p.ellipse(16, 20, 3.5, 5, '#ffd166');
  } else {
    p.body(16, 16, 9, 9, '#f2c14e', '#8a5a00');
    p.ellipse(16, 16, 4, 4, '#fff1b8');
  }
  return p.data;
}

/** The farm's sprites by cell key ("x,y"): the animals housed on a cell, and the mark of a cell. */
export interface FarmSprites {
  readonly animals: ReadonlyMap<string, readonly string[]>;
  readonly marks: ReadonlyMap<string, string>;
}

/**
 * The farm of the world by cell, from the animals and machines the server last sent. A housing
 * with products to collect, or a machine whose batch is done, shows the ready mark; a machine still
 * working shows the busy mark.
 */
export function farmSprites(animals: readonly AnimalState[], machines: readonly MachineState[]): FarmSprites {
  const herd = new Map<string, string[]>();
  const marks = new Map<string, string>();
  for (const a of animals) {
    const list = herd.get(a.cell) ?? [];
    list.push(animalSprite(a.animal));
    herd.set(a.cell, list);
    if (a.pending > 0) marks.set(a.cell, markSprite('ready'));
  }
  for (const m of machines) marks.set(m.cell, markSprite(m.daysLeft > 0 ? 'busy' : 'ready'));
  return { animals: herd, marks };
}
