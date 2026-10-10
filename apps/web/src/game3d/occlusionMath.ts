/**
 * Occlusion fade (P16.9, ADR-052): walls, tall plants and trees that stand between the camera and
 * a subject (my avatar, or the person under the pointer) fade to ~30 %. Pure: no Three.js, so the
 * rule is unit-tested and the view only applies the numbers.
 *
 * The rule: an object hides a subject when its screen box overlaps the subject's and it stands
 * nearer the camera. Everything else stays solid (floors, desks, chairs, low furniture).
 */
import { project, type Cam } from './camera';
import type { Face3D } from './scene';

/** The share of an object's pixels still drawn while it hides a subject (a 4×4 dither). */
export const KEPT_WHEN_HIDDEN = 0.3;
/** Fade time from solid to hidden, or back, ms (the 2D view's fades are of the same order). */
export const FADE_MS = 160;
/**
 * A card at least this many tiles tall is an occluder: a tree, a tall plant or a cabinet. Lower
 * cards (chairs, low plants, ground-level props) stay solid.
 */
export const TALL_TOP = 0.9;

/** A screen rectangle, canvas CSS px, y down. */
export interface Box2 {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

/** A world box, tiles: x east, y up, z south (as scene.ts). */
export interface Box3 {
  x0: number;
  x1: number;
  y0: number;
  y1: number;
  z0: number;
  z1: number;
}

/** A thing on screen: its box and its camera depth (larger = farther). */
export interface Seen {
  box: Box2;
  depth: number;
}

/** An occluder: its object key, the faces it owns (indices into `Scene3D.faces`), its world box. */
export interface OccluderObject {
  key: string;
  faces: number[];
  box: Box3;
}

/** A subject the occluders are tested against. */
export type Subject = Seen;

/**
 * The screen box and depth of a world box, or null when any corner is behind the camera (then the
 * object is too close to test; it stays solid).
 */
export function screenBox(cam: Cam, b: Box3 | null | undefined): Seen | null {
  if (!b) return null;
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  for (const x of [b.x0, b.x1])
    for (const y of [b.y0, b.y1])
      for (const z of [b.z0, b.z1]) {
        const p = project(cam, [x, y, z]);
        if (!p) return null;
        x0 = Math.min(x0, p.x);
        x1 = Math.max(x1, p.x);
        y0 = Math.min(y0, p.y);
        y1 = Math.max(y1, p.y);
      }
  const c = project(cam, [(b.x0 + b.x1) / 2, (b.y0 + b.y1) / 2, (b.z0 + b.z1) / 2]);
  if (!c) return null;
  return { box: { x0, y0, x1, y1 }, depth: c.depth };
}

/** Two boxes overlap (touching edges do not count). */
export function overlaps(a: Box2, b: Box2): boolean {
  return a.x0 < b.x1 && b.x0 < a.x1 && a.y0 < b.y1 && b.y0 < a.y1;
}

/** Is the screen point inside the box (inclusive)? */
export function hits(b: Box2, x: number, y: number): boolean {
  return x >= b.x0 && x <= b.x1 && y >= b.y0 && y <= b.y1;
}

/**
 * The ids of the objects that hide at least one subject: the screen boxes overlap and the object
 * is nearer the camera than the subject.
 */
export function hiders(
  subjects: readonly Subject[],
  objects: ReadonlyMap<string, Seen>,
): Set<string> {
  const out = new Set<string>();
  for (const [id, o] of objects)
    for (const s of subjects)
      if (o.depth < s.depth && overlaps(o.box, s.box)) {
        out.add(id);
        break;
      }
  return out;
}

/**
 * One frame of a fade. `cur` and `target` are the kept shares (1 = solid, KEPT_WHEN_HIDDEN =
 * hidden). Moves at a constant rate over FADE_MS; reduced motion jumps to the target.
 */
export function fadeStep(cur: number, target: number, dtMs: number, instant: boolean): number {
  if (instant || cur === target) return target;
  const step = (Math.max(0, dtMs) / FADE_MS) * (1 - KEPT_WHEN_HIDDEN);
  const next = cur < target ? cur + step : cur - step;
  // snap the last sliver (float steps) so a finished fade is exactly the target
  return Math.abs(next - target) < 1e-9 || (next - target) * (cur - target) < 0 ? target : next;
}

/**
 * The occluder objects of a region: the faces of walls and decals (vines), and of cards at least
 * `TALL_TOP` tall, grouped by the map cell they belong to, so one wall cell or one tree cell fades
 * as a whole. Other faces (floors, boxed furniture, low cards) are not in any object.
 */
export function occluderObjects(faces: readonly Face3D[]): OccluderObject[] {
  const byKey = new Map<string, OccluderObject>();
  faces.forEach((f, i) => {
    const top = Math.max(f.p[0][1], f.p[1][1], f.p[2][1], f.p[3][1]);
    const tall = f.kind === 'wall' || f.kind === 'decal' || (f.kind === 'card' && top >= TALL_TOP);
    if (!tall) return;
    const key = `${f.cx},${f.cy}`;
    let o = byKey.get(key);
    if (!o) {
      o = {
        key,
        faces: [],
        box: {
          x0: Infinity,
          x1: -Infinity,
          y0: Infinity,
          y1: -Infinity,
          z0: Infinity,
          z1: -Infinity,
        },
      };
      byKey.set(key, o);
    }
    o.faces.push(i);
    for (const p of f.p) {
      o.box.x0 = Math.min(o.box.x0, p[0]);
      o.box.x1 = Math.max(o.box.x1, p[0]);
      o.box.y0 = Math.min(o.box.y0, p[1]);
      o.box.y1 = Math.max(o.box.y1, p[1]);
      o.box.z0 = Math.min(o.box.z0, p[2]);
      o.box.z1 = Math.max(o.box.z1, p[2]);
    }
  });
  return [...byKey.values()];
}
