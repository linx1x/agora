/**
 * The tile pixels and the cell composer of the blended tiles (ADR-037), with no Phaser: the 2D
 * view (`BlendLayers.ts`) and the 2.5D view (P16.12, `game3d/`) both compose from here.
 */
import { T, composeFurniture, composeGround, type TileSource } from './compose';
import { TILE_DEFS, TILESET_COLUMNS, markAnimated, type TileReader } from '@agora/shared';
import { animatedTiles, tilesetCanvas } from '../tiles';

export type Kind = 'g' | 'f';

let sourceCache: TileSource | null = null;
/** Tile pixels read once from the game's tileset canvas (art, Kenney or procedural). */
export function tileSource(): TileSource {
  if (sourceCache) return sourceCache;
  const cv = tilesetCanvas();
  const all = cv
    .getContext('2d', { willReadFrequently: true })!
    .getImageData(0, 0, cv.width, cv.height);
  const index = new Map(TILE_DEFS.map((d, i) => [d.name, i]));
  const tiles = new Map<string, Uint8ClampedArray>();
  sourceCache = {
    tile(name) {
      const hit = tiles.get(name);
      if (hit) return hit;
      const i = index.get(name);
      if (i === undefined) return null;
      const px = new Uint8ClampedArray(T * T * 4);
      const sx = (i % TILESET_COLUMNS) * T;
      const sy = Math.floor(i / TILESET_COLUMNS) * T;
      for (let y = 0; y < T; y++)
        px.set(
          all.data.subarray(((sy + y) * all.width + sx) * 4, ((sy + y) * all.width + sx + T) * 4),
          y * T * 4,
        );
      tiles.set(name, px);
      return px;
    },
  };
  markAnimated(animatedTiles().map((a) => a.name));
  return sourceCache;
}

/** Compose one cell's variant pixels for a reader (live map or a build preview). */
export function composeCell(r: TileReader, kind: Kind, x: number, y: number): Uint8ClampedArray {
  return kind === 'g'
    ? composeGround(r, tileSource(), x, y)
    : composeFurniture(r, tileSource(), x, y);
}
