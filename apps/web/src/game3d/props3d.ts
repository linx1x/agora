/**
 * P16.5 (ADR-052, ADR-039): props between the 2D map and the 2.5D world.
 *
 * A prop's base point (x, y) is stored in map px on the 3/4 drawing of the surface it rests on:
 * a top-face row of a desk that stands `hpx` px tall. In 3D that row is `hpx` px further south
 * (the 3/4 art draws a raised top face higher than its floor footprint), at height `hpx`, raised
 * again by the stack it rests on (`resolveProps` lift) and its manual raise `z`. The server keeps
 * validating the 2D point (`surfaceTop`); these two functions only move between the views.
 */
import {
  BLEND_GEOM,
  TILE_DEFS,
  joinMask,
  shape3d,
  type PlacedProp,
  type PropRest,
  type TileReader,
} from '@agora/shared';
import type { Extents, V3 } from './scene';

/**
 * Height in px of the top face at a cell (the front of its box): joined furniture uses
 * ADR-037's fixed front, a lone tile its own art. 0 where nothing stands (a prop on nothing).
 */
export function surfaceHeightPx(
  r: TileReader,
  cx: number,
  cy: number,
  ext: readonly Extents[],
): number {
  const d = r.def('furniture', cx, cy);
  if (!d) return 0;
  const s = shape3d(d);
  if (s.kind !== 'box') return 0;
  if (joinMask(r, cx, cy)) return BLEND_GEOM.front;
  const e = ext[TILE_DEFS.indexOf(d)];
  return e ? e.r1 + 1 - (s.split ?? 21) : 32 - (s.split ?? 21);
}

/** 3D position (tiles) of a prop's base point. */
export function propTo3D(
  p: Pick<PlacedProp, 'x' | 'y' | 'z'>,
  rest: Pick<PropRest, 'lift'>,
  hpx: number,
): V3 {
  return [p.x / 32, (hpx + rest.lift + p.z) / 32, (p.y + hpx) / 32];
}

/** The 2D base point (map px) of a point picked on a top face `hpx` px tall. */
export function surfaceTo2D(x: number, z: number, hpx: number): { x: number; y: number } {
  return { x: Math.round(x * 32), y: Math.round(z * 32 - hpx) };
}
