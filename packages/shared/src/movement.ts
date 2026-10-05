import { SPEED_PX } from './constants';
import { collides, segmentClear, type WorldMap } from './map';

export type MoveVerdict = { ok: true } | { ok: false; reason: 'speed' | 'collision' | 'bounds' };

/** Server-side validation of a client-predicted move (ARCHITECTURE §4). */
export function validateMove(
  map: WorldMap,
  from: { x: number; y: number },
  to: { x: number; y: number },
  elapsedMs: number,
): MoveVerdict {
  if (!Number.isFinite(to.x) || !Number.isFinite(to.y)) return { ok: false, reason: 'bounds' };
  if (to.x < 0 || to.y < 0 || to.x > map.pxWidth || to.y > map.pxHeight)
    return { ok: false, reason: 'bounds' };
  const dt = Math.min(Math.max(elapsedMs, 0), 1000) / 1000;
  const allowed = SPEED_PX * dt * 1.35 + 10;
  if (Math.hypot(to.x - from.x, to.y - from.y) > allowed) return { ok: false, reason: 'speed' };
  if (collides(map, to.x, to.y) || !segmentClear(map, from.x, from.y, to.x, to.y))
    return { ok: false, reason: 'collision' };
  return { ok: true };
}

/**
 * One step of local movement with wall sliding. Input vector is normalised so
 * diagonals are not faster.
 */
export function stepMove(
  map: WorldMap,
  x: number,
  y: number,
  ix: number,
  iy: number,
  dtSec: number,
  blocked?: (x: number, y: number) => boolean,
): { x: number; y: number } {
  const len = Math.hypot(ix, iy);
  if (!len) return { x, y };
  const d = SPEED_PX * Math.min(dtSec, 0.1);
  const dx = (ix / len) * d;
  const dy = (iy / len) * d;
  let nx = x;
  let ny = y;
  const hit = (px: number, py: number) => collides(map, px, py) || (blocked?.(px, py) ?? false);
  if (!hit(x + dx, y)) nx = x + dx;
  if (!hit(nx, y + dy)) ny = y + dy;
  return { x: nx, y: ny };
}
