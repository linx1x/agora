/**
 * The 2.5D camera (P16.6, ADR-052): a fixed-tilt perspective camera. It looks north, tilted
 * `tilt` degrees down from the horizon, at `dist` tiles from its target on the floor. It never
 * rotates, so the maths is small and pure (no Three.js import): the Three camera is placed with
 * the same numbers (`position = camPos(c)`, `lookAt(tx, 0, tz)`), and click-to-move inverts the
 * projection with `unprojectFloor`.
 *
 * Units: tiles (1 = 32 px), x east, y up, z south, as scene.ts. Zoom keeps today's meaning: a
 * floor tile at the target is drawn `32 * zoom` CSS px wide, whatever the tilt.
 */
import { TILE } from '@agora/shared';
import type { V3 } from './scene';

/** Camera tilt below the horizon, degrees (ADR-052). */
export const TILT = 35;
/** Vertical field of view, degrees (the spike's default). */
export const FOV = 30;
/** Height the phone dock covers at the bottom of the screen (styles.css `--dock-space`), px. */
export const DOCK_PX = 72;

export interface Cam {
  /** target on the floor, tiles */
  tx: number;
  tz: number;
  /** degrees */
  tilt: number;
  /** distance from the target, tiles */
  dist: number;
  /** vertical field of view, degrees */
  fov: number;
  /** viewport size, CSS px */
  w: number;
  h: number;
}

export interface Pt {
  x: number;
  z: number;
}

export interface Rect {
  x: number;
  z: number;
  w: number;
  h: number;
}

/** Focal length in px for a viewport `h` px tall. */
export function focal(h: number, fov: number): number {
  return h / 2 / Math.tan(((fov / 2) * Math.PI) / 180);
}

export function camPos(c: Cam): V3 {
  const t = (c.tilt * Math.PI) / 180;
  return [c.tx, c.dist * Math.sin(t), c.tz + c.dist * Math.cos(t)];
}

/** World point → screen px, plus the scale of one tile at that depth (px). null behind camera. */
export function project(c: Cam, p: V3): { x: number; y: number; s: number; depth: number } | null {
  const t = (c.tilt * Math.PI) / 180;
  const st = Math.sin(t);
  const ct = Math.cos(t);
  const [cx, cy, cz] = camPos(c);
  const vx = p[0] - cx;
  const vy = p[1] - cy;
  const vz = p[2] - cz;
  // camera basis: right (1,0,0), up (0, cos t, -sin t), forward (0, -sin t, -cos t)
  const yc = vy * ct - vz * st;
  const zc = -vy * st - vz * ct;
  if (zc <= 0.05) return null;
  const f = focal(c.h, c.fov);
  return { x: c.w / 2 + (vx * f) / zc, y: c.h / 2 - (yc * f) / zc, s: f / zc, depth: zc };
}

/** Screen px → point on the floor (y = 0), for click-to-move. null when the ray misses the floor. */
export function unprojectFloor(c: Cam, sx: number, sy: number): Pt | null {
  const t = (c.tilt * Math.PI) / 180;
  const st = Math.sin(t);
  const ct = Math.cos(t);
  const f = focal(c.h, c.fov);
  const rx = (sx - c.w / 2) / f;
  const ry = -(sy - c.h / 2) / f;
  // ray direction in world: right*rx + up*ry + forward
  const dx = rx;
  const dy = ry * ct - st;
  const dz = -ry * st - ct;
  const [cx, cy, cz] = camPos(c);
  if (dy >= -1e-6) return null;
  const k = -cy / dy;
  return { x: cx + dx * k, z: cz + dz * k };
}

/**
 * Distance (tiles) at which a floor tile at the target is `32 * zoom` px across, for a viewport
 * `viewH` px tall: `focal / dist = 32 * zoom`.
 */
export function distForZoom(zoom: number, viewH: number, fov: number = FOV): number {
  return focal(viewH, fov) / (TILE * zoom);
}

/**
 * The zoom that fits a 22 × 14 tile area, clamped to 1–3 (the same rule as WorldScene.fitZoom).
 * `h` is the height of the world viewport (above the dock).
 */
export function fitZoom(w: number, h: number): number {
  return Math.max(1, Math.min(3, Math.round(Math.min(w / (22 * TILE), h / (14 * TILE)))));
}

/** The dock rule of ADR-035 (WorldScene.fitZoom): the world stops above the dock on phones in portrait. */
export function dockPx(compact: boolean, portrait: boolean, touchControlsOn: boolean): number {
  return compact && portrait && touchControlsOn ? DOCK_PX : 0;
}

/** Share of the remaining distance covered each 60 fps frame by the follow (Phaser's lerp 0.18). */
const FOLLOW_PER_FRAME = 0.18;

/**
 * One frame-rate-independent step of the camera target towards `target`: the same pull as Phaser's
 * `startFollow(…, 0.18)` per 60 fps frame, for any `dtMs`.
 */
export function followStep(cur: Pt, target: Pt, dtMs: number): Pt {
  const k = 1 - (1 - FOLLOW_PER_FRAME) ** (dtMs / (1000 / 60));
  return { x: cur.x + (target.x - cur.x) * k, z: cur.z + (target.z - cur.z) * k };
}

/**
 * Keep the view inside a region (tiles). The floor points under the screen's bottom-left and
 * bottom-right corners and under the top-centre must lie inside it. The camera never rotates, so
 * those offsets from the target depend only on (zoom, size, tilt, fov): they are measured from a
 * target at the origin. On an axis where the footprint is wider than the region, the target goes
 * to the region's centre on that axis.
 */
export function clampTarget(target: Pt, region: Rect, cam: Cam): Pt {
  const probe: Cam = { ...cam, tx: 0, tz: 0 };
  const pts = [
    unprojectFloor(probe, 0, cam.h),
    unprojectFloor(probe, cam.w, cam.h),
    unprojectFloor(probe, cam.w / 2, 0),
  ];
  // a view that cannot see the floor at some corner (never with the fixed tilt): keep the target
  if (pts.some((p) => p === null)) return target;
  const dx = pts.map((p) => p!.x);
  const dz = pts.map((p) => p!.z);
  const axis = (t: number, lo: number, size: number, offs: number[]) => {
    const min = Math.max(...offs.map((o) => lo - o));
    const max = Math.min(...offs.map((o) => lo + size - o));
    if (min > max) return lo + size / 2;
    return Math.min(max, Math.max(min, t));
  };
  return {
    x: axis(target.x, region.x, region.w, dx),
    z: axis(target.z, region.z, region.h, dz),
  };
}
