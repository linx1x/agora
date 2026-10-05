/**
 * Virtual joystick math (P8.2). The knob offset (dx, dy) from the base centre becomes a
 * unit direction once it leaves the dead zone; the walking speed stays the same as with
 * the keyboard (stepMove normalises), so the server's speed check is unchanged.
 */
export interface StickOut {
  /** unit direction, or [0, 0] inside the dead zone */
  dir: [number, number];
  /** knob position clamped to the base radius, for drawing */
  knob: [number, number];
}

export function stickVector(dx: number, dy: number, radius: number, dead = 0.25): StickOut {
  const len = Math.hypot(dx, dy);
  if (!len || !Number.isFinite(len) || radius <= 0) return { dir: [0, 0], knob: [0, 0] };
  const k = Math.min(1, radius / len);
  const knob: [number, number] = [dx * k, dy * k];
  if (len < radius * dead) return { dir: [0, 0], knob };
  return { dir: [dx / len, dy / len], knob };
}

/** Number of 45° sectors snapped to keep walking along corridors easy (8 = N, NE, E…). */
export function snapDir(dir: [number, number], sectors = 8): [number, number] {
  const [x, y] = dir;
  if (!x && !y) return [0, 0];
  const step = (Math.PI * 2) / sectors;
  const a = Math.round(Math.atan2(y, x) / step) * step;
  const r = (v: number) => (Math.abs(v) < 1e-9 ? 0 : v);
  return [r(Math.cos(a)), r(Math.sin(a))];
}
