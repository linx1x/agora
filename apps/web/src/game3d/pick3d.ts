/**
 * Picking in the 2.5D view (P16.13, P16.14, ADR-039 parity). A screen point picks what is drawn
 * under it, the way the flat view picks the cell under the pointer: the nearest face along the ray
 * whose texel is opaque (a plant's transparent corner lets the ray through), else the floor.
 * Props are the exception: their cards are hit anywhere in their box (the flat view's rule too).
 * Faces are axis-aligned quads (scene.ts, propFaces.ts), so each is one plane test and a
 * rectangle test. Pure: no Three.js, unit-tested.
 */
import type { Cell } from '@agora/shared';
import type { Face3D, V3 } from './scene';

/** What the view picked under a screen point (BuildMode3D reads it). */
export interface PickResult {
  /** the map cell of the thing hit (the floor's cell when nothing was hit) */
  cell: Cell;
  /** the point hit, tiles */
  p: V3;
  /** height (tiles) of a horizontal face hit, else 0: where the cell's outline is drawn */
  top: number;
  /** the prop whose card was hit, if any */
  prop: string | null;
}

export interface Ray {
  /** eye position, tiles */
  o: V3;
  /** direction (not normalised: hit distances are in its units) */
  d: V3;
}

/** Is the tileset texel (tile, u, v) drawn (alpha ≥ 128)? u, v in px of the 32 px cell. */
export type Opaque = (tile: number, u: number, v: number) => boolean;

/** A face with its plane and rectangle worked out once (faces change only on a rebuild). */
export interface Prepared<T extends Face3D = Face3D> {
  item: T;
  /** the axis the face is flat on (0 x, 1 y, 2 z) and its coordinate there */
  axis: number;
  c: number;
  /** the two other axes, and their bounds */
  a: number;
  b: number;
  lo: [number, number];
  hi: [number, number];
  /** corner 0 and the two edges from it (corner 1 and corner 3) */
  p0: V3;
  e1: V3;
  e3: V3;
}

const EPS = 1e-9;

/** The plane of a quad: the one axis all four corners share (null if none, or degenerate). */
function planeOf(p: Face3D['p']): number | null {
  for (const axis of [1, 2, 0])
    if (p.every((q) => Math.abs(q[axis]! - p[0][axis]!) < EPS)) return axis;
  return null;
}

export function prepare<T extends Face3D>(items: readonly T[]): Prepared<T>[] {
  const out: Prepared<T>[] = [];
  for (const item of items) {
    const axis = planeOf(item.p);
    if (axis === null) continue;
    const a = (axis + 1) % 3;
    const b = (axis + 2) % 3;
    const e1: V3 = [0, 0, 0];
    const e3: V3 = [0, 0, 0];
    for (let k = 0; k < 3; k++) {
      e1[k] = item.p[1][k]! - item.p[0][k]!;
      e3[k] = item.p[3][k]! - item.p[0][k]!;
    }
    const ext = (k: number) => item.p.map((q) => q[k]!);
    const ea = ext(a);
    const eb = ext(b);
    const len = (v: V3) => v[0] * v[0] + v[1] * v[1] + v[2] * v[2];
    if (len(e1) < EPS || len(e3) < EPS) continue;
    out.push({
      item,
      axis,
      c: item.p[0][axis]!,
      a,
      b,
      lo: [Math.min(...ea), Math.min(...eb)],
      hi: [Math.max(...ea), Math.max(...eb)],
      p0: [item.p[0][0]!, item.p[0][1]!, item.p[0][2]!],
      e1,
      e3,
    });
  }
  return out;
}

export interface Hit<T> {
  item: T;
  /** distance along the ray (in the ray's units) */
  t: number;
  /** the point hit, tiles */
  p: V3;
}

/**
 * The nearest opaque hit of the ray among the prepared faces (`keep` filters them). Null when the
 * ray meets nothing in front of the eye.
 */
export function pickNearest<T extends Face3D>(
  prep: readonly Prepared<T>[],
  ray: Ray,
  opaque: Opaque,
  keep?: (item: T) => boolean,
): Hit<T> | null {
  let best: Hit<T> | null = null;
  for (const q of prep) {
    if (keep && !keep(q.item)) continue;
    const dn = ray.d[q.axis]!;
    if (Math.abs(dn) < EPS) continue;
    const t = (q.c - ray.o[q.axis]!) / dn;
    if (t <= EPS || (best && t >= best.t)) continue;
    const p: V3 = [ray.o[0] + ray.d[0] * t, ray.o[1] + ray.d[1] * t, ray.o[2] + ray.d[2] * t];
    const pa = p[q.a]!;
    const pb = p[q.b]!;
    if (pa < q.lo[0] - 1e-6 || pa > q.hi[0] + 1e-6) continue;
    if (pb < q.lo[1] - 1e-6 || pb > q.hi[1] + 1e-6) continue;
    // affine position on the quad: fractions along its two edges from corner 0
    const r: V3 = [p[0] - q.p0[0], p[1] - q.p0[1], p[2] - q.p0[2]];
    const dot = (x: V3, y: V3) => x[0] * y[0] + x[1] * y[1] + x[2] * y[2];
    const fu = dot(r, q.e1) / dot(q.e1, q.e1);
    const fv = dot(r, q.e3) / dot(q.e3, q.e3);
    const f = q.item;
    const u = f.u0 + Math.min(1, Math.max(0, fu)) * (f.u1 - f.u0);
    const v = f.v0 + Math.min(1, Math.max(0, fv)) * (f.v1 - f.v0);
    const tu = Math.min(31, Math.max(0, Math.floor(u)));
    const tv = Math.min(31, Math.max(0, Math.floor(v)));
    if (!opaque(f.tile, tu, tv)) continue;
    best = { item: f, t, p };
  }
  return best;
}

/** Where the ray meets the floor (y = 0), or null when it points at the sky. */
export function floorPoint(ray: Ray): { x: number; z: number; t: number } | null {
  if (ray.d[1] >= -1e-9) return null;
  const t = -ray.o[1] / ray.d[1];
  return { x: ray.o[0] + ray.d[0] * t, z: ray.o[2] + ray.d[2] * t, t };
}
