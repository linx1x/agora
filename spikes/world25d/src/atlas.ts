/**
 * Texture atlas for the 2.5D faces: the app's tileset three times, top to bottom: lit, front
 * (×0.82) and side (×0.64). Baking the shade keeps both engines identical without lights.
 */
import { TILESET_COLUMNS, TILE_DEFS } from '@agora/shared';
import type { Face } from './scene';

export const SHADES = [1, 0.82, 0.64] as const;

export interface Atlas {
  canvas: HTMLCanvasElement;
  rows: number;
  /** normalised uv rect of a face (u0, v0 top-left, u1, v1 bottom-right), v top-down */
  uv(f: Face): [number, number, number, number];
}

/** `cell` = tile size in `tileset` px (32 for the app's art, 128 for a 4× redraw). */
export function makeAtlas(tileset: HTMLCanvasElement, cell = 32): Atlas {
  const ks = cell / 32;
  const rows = Math.ceil(TILE_DEFS.length / TILESET_COLUMNS);
  const cv = document.createElement('canvas');
  cv.width = tileset.width;
  cv.height = tileset.height * 3;
  const c = cv.getContext('2d')!;
  c.imageSmoothingEnabled = false;
  SHADES.forEach((k, i) => {
    c.drawImage(tileset, 0, i * tileset.height);
    if (k < 1) {
      c.globalCompositeOperation = 'source-atop';
      c.fillStyle = `rgba(0,0,0,${1 - k})`;
      c.fillRect(0, i * tileset.height, tileset.width, tileset.height);
      c.globalCompositeOperation = 'source-over';
    }
  });
  const W = cv.width;
  const H = cv.height;
  // a hair inside the texel edges so nearest sampling never picks the neighbouring tile
  // (a 4× redraw is sampled linearly, so keep a full texel and a half away from the edge)
  const e = cell > 32 ? 1.5 : 0.02;
  return {
    canvas: cv,
    rows,
    uv(f) {
      const ox = (f.tile % TILESET_COLUMNS) * cell;
      const oy = Math.floor(f.tile / TILESET_COLUMNS) * cell + f.shade * rows * cell;
      return [(ox + f.u0 * ks + e) / W, (oy + f.v0 * ks + e) / H, (ox + f.u1 * ks - e) / W, (oy + f.v1 * ks - e) / H];
    },
  };
}
