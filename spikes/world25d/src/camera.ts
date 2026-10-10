/**
 * Fixed-tilt perspective camera (ADR-052): it looks north, tilted `tilt` degrees down from the
 * horizon, at `dist` tiles from its target. No rotation, so this small maths is all the Phaser
 * variant needs, and Three's camera is placed with the same numbers.
 */
import type { V3 } from './scene';

export interface Cam {
  /** target on the floor, tiles */
  tx: number;
  tz: number;
  tilt: number;
  dist: number;
  /** vertical field of view, degrees */
  fov: number;
  w: number;
  h: number;
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
  const f = c.h / 2 / Math.tan(((c.fov / 2) * Math.PI) / 180);
  return { x: c.w / 2 + (vx * f) / zc, y: c.h / 2 - (yc * f) / zc, s: f / zc, depth: zc };
}

/** Screen px → point on the floor (y = 0), for click-to-move. */
export function unprojectFloor(c: Cam, sx: number, sy: number): { x: number; z: number } | null {
  const t = (c.tilt * Math.PI) / 180;
  const st = Math.sin(t);
  const ct = Math.cos(t);
  const f = c.h / 2 / Math.tan(((c.fov / 2) * Math.PI) / 180);
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
 * Card flip (ADR-052): the side sprites are mirrors of each other, so the new side drawn mirrored
 * looks like the old one. Scale x goes −1 → 0 → +1 over the flip (k = 0…1).
 */
export function flipScale(k: number): number {
  if (k >= 1) return 1;
  const s = -Math.cos(Math.PI * Math.max(0, k));
  return Math.abs(s) < 0.04 ? Math.sign(s || 1) * 0.04 : s;
}
