/**
 * Blob shadows under the trees and plants of a region (P16.10, ADR-052): a soft dark disc on the
 * floor at each card's foot, as the paper figures have under them. Pure: the geometry is built
 * here and tested; `lightRig.ts` turns it into one mesh, so the whole region is one draw call.
 *
 * A disc is a fan: its centre is opaque and its rim is clear, so the falloff is in the vertex
 * alpha (the vertex colour's alpha channel), not in a texture.
 */
import type { OccluderObject } from './occlusionMath';

/** Radius of a blob, tiles (about the width of a trunk and its root). */
export const BLOB_RADIUS = 0.42;
/** Lift above the floor, tiles: enough to avoid z-fighting with the floor. */
export const BLOB_Y = 0.012;
const SEGMENTS = 10;

export interface Blobs {
  /** x, y, z per vertex (tiles) */
  pos: number[];
  /** r, g, b, a per vertex (black, with the falloff as alpha) */
  color: number[];
  /** three indices */
  index: number[];
}

/** One blob fan per card occluder (trees, plants, tall cards); walls and vines cast none. */
export function blobShadows(objects: readonly OccluderObject[], radius = BLOB_RADIUS): Blobs {
  const pos: number[] = [];
  const color: number[] = [];
  const index: number[] = [];
  for (const o of objects) {
    if (!o.card) continue;
    const cx = (o.box.x0 + o.box.x1) / 2;
    const cz = o.box.z0;
    const base = pos.length / 3;
    pos.push(cx, BLOB_Y, cz);
    color.push(0, 0, 0, 1);
    for (let k = 0; k < SEGMENTS; k++) {
      const a = (k / SEGMENTS) * Math.PI * 2;
      pos.push(cx + Math.cos(a) * radius, BLOB_Y, cz + Math.sin(a) * radius);
      color.push(0, 0, 0, 0);
    }
    for (let k = 0; k < SEGMENTS; k++)
      index.push(base, base + 1 + k, base + 1 + ((k + 1) % SEGMENTS));
  }
  return { pos, color, index };
}
