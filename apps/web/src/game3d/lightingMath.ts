/**
 * Lighting of the 2.5D view (P16.10, ADR-052): the Québec time of day as a sun, a sky and lamps.
 * Pure: no Three.js, so the maths is unit-tested; `lightRig.ts` only applies these numbers.
 *
 * The hour comes from the same curve as the 2D view (`timeOfDay` in game/lighting.ts, its
 * keyframes for ambient light, daylight and sky), so both views agree on dusk and dawn. The sun
 * is new: it rises in the east, passes south of the camera at noon and sets in the west.
 */
import { LAMP_COLORS } from '@agora/shared';
import { LAMP_COLOR, timeOfDay } from '../game/lighting';

export type V3 = [number, number, number];

/** Sun height at midday, degrees above the horizon (mid-October, Québec). */
export const NOON_ELEVATION = 46;
/** The sun's arc: it rises at DAY_START and sets at DAY_END (hours, Québec time). */
export const DAY_START = 6;
export const DAY_END = 20;
/** Sun intensity at full daylight (three.js DirectionalLight, before the time-of-day factor). */
export const SUN_INTENSITY = 1.6;
/** Bloom strength at its evening peak, and the daylight below which it starts (0 = night). */
export const BLOOM_MAX = 0.55;
const BLOOM_FROM = 0.8;
const BLOOM_SPAN = 0.6;

/** A lamp-like light of the world. */
export type LampKind = 'lamp' | 'window' | 'fire' | 'portal' | 'desk';

/** Range (tiles) and intensity (candela, three.js PointLight) of each kind at full strength. */
export const LAMP_SPEC: Record<LampKind, { distance: number; intensity: number }> = {
  lamp: { distance: 5.5, intensity: 3.2 },
  window: { distance: 5, intensity: 1.6 },
  fire: { distance: 6, intensity: 3.6 },
  portal: { distance: 2.6, intensity: 1.2 },
  desk: { distance: 3.4, intensity: 2.2 },
};

const FIRE_COLOR = '#ff8a3c';
const PORTAL_COLOR = '#5fd3c6';

export interface Sun {
  /** unit vector from the target to the sun: x east, y up, z south */
  dir: V3;
  /** degrees above the horizon (negative at night) */
  elevation: number;
  /** the sun's colour (hex), warmer as it sinks */
  color: string;
  /** the sun's intensity (0 at night) */
  intensity: number;
}

export interface Ambient {
  /** the sky's light (hex) and the warm ground bounce (hex) */
  sky: string;
  ground: string;
  /** the hemisphere light's intensity */
  intensity: number;
}

const clamp01 = (v: number) => Math.min(1, Math.max(0, v));

/** Mix two hex colours (`#rrggbb`) by t in 0..1. */
export function mixHex(a: string, b: string, t: number): string {
  const k = clamp01(t);
  const pa = parseInt(a.slice(1), 16);
  const pb = parseInt(b.slice(1), 16);
  const ch = (shift: number) => {
    const x = (pa >> shift) & 255;
    const y = (pb >> shift) & 255;
    return Math.round(x + (y - x) * k);
  };
  return `#${[16, 8, 0].map((s) => ch(s).toString(16).padStart(2, '0')).join('')}`;
}

/** A hex colour from linear-ish channels in 0..1. */
function hexOf(r: number, g: number, b: number): string {
  const c = (v: number) => Math.round(clamp01(v) * 255);
  return `#${[r, g, b].map((v) => c(v).toString(16).padStart(2, '0')).join('')}`;
}

/**
 * The sun at a Québec hour (0–24). It climbs to NOON_ELEVATION at the middle of the arc and
 * swings from east (sunrise) through south (noon) to west (sunset). Its colour and intensity
 * follow the 2D view's daylight and sky curve, and it fades in over the first degrees above the
 * horizon so it does not switch on at sunrise.
 */
export function sunAt(hour: number): Sun {
  const tod = timeOfDay(hour);
  const t = clamp01((hour - DAY_START) / (DAY_END - DAY_START));
  const elevation =
    hour >= DAY_START && hour <= DAY_END ? NOON_ELEVATION * Math.sin(Math.PI * t) : -10;
  const e = (elevation * Math.PI) / 180;
  const bearing = Math.PI * t; // 0 = east, π/2 = south, π = west
  const dir: V3 = [Math.cos(e) * Math.cos(bearing), Math.sin(e), Math.cos(e) * Math.sin(bearing)];
  const warm = 1 - clamp01(elevation / NOON_ELEVATION);
  return {
    dir,
    elevation,
    color: mixHex('#fff3dc', '#ff9a5c', warm * 0.85),
    intensity: SUN_INTENSITY * tod.day * clamp01(elevation / 8),
  };
}

/** The hemisphere light for a Québec hour: sky and ground tints (dark at night) and an intensity. */
export function ambientAt(hour: number): Ambient {
  const [r, g, b] = timeOfDay(hour).amb;
  const level = (r + g + b) / 3;
  return {
    sky: hexOf(r, g, b),
    ground: hexOf(r * 0.5, g * 0.42, b * 0.34),
    // the tint carries the level (a dark sky is a dark colour), so the intensity stays near 1 and
    // is only raised a little at night, so that the figures stay readable
    intensity: 1 + 0.6 * (1 - level),
  };
}

/**
 * How strong a lamp is now, 0..1 (as the 2D view composites them): windows follow daylight,
 * portals are always lit, other lamps are brighter at night. A desk lamp with no one at the desk
 * is dimmed.
 */
export function lampLevel(kind: LampKind, day: number, owned = true): number {
  if (kind === 'window') return clamp01(day);
  if (kind === 'portal') return 1;
  const k = 0.35 + 0.65 * (1 - clamp01(day));
  return kind === 'desk' && !owned ? k * 0.35 : k;
}

/**
 * The colour of a light: a lamp's biome colour, a window's sky, the fixed fire and portal tints,
 * and a desk lamp's own colour (`deskLamp`, from its decor).
 */
export function lampColor(kind: LampKind, biome: string, sky: string, deskLamp?: string): string {
  if (kind === 'window') return sky;
  if (kind === 'fire') return FIRE_COLOR;
  if (kind === 'portal') return PORTAL_COLOR;
  if (kind === 'desk') return deskLamp ?? LAMP_COLORS[0] ?? '#ffe2b0';
  return LAMP_COLOR[biome as keyof typeof LAMP_COLOR] ?? LAMP_COLOR.hub;
}

/** The flicker of a light, around 1 (fires flicker most; reduced motion holds it at 1). */
export function flicker(kind: LampKind, seconds: number, seed: number, reduced: boolean): number {
  if (reduced) return 1;
  const amp = kind === 'fire' ? 0.25 : kind === 'portal' ? 0.15 : 0.05;
  const speed = kind === 'fire' ? 9 : 2.3;
  const f = Math.sin(seconds * speed + seed) * 0.5 + Math.sin(seconds * 5.7 + seed * 2) * 0.5;
  return 1 + amp * f;
}

/** The bloom strength at a daylight level: none by day, the most at night. */
export function bloomStrength(day: number): number {
  return BLOOM_MAX * clamp01((BLOOM_FROM - day) / BLOOM_SPAN);
}

/** The `n` items nearest to a point on the floor (x, z), nearest first. */
export function nearestN<T extends { x: number; z: number }>(
  items: readonly T[],
  at: { x: number; z: number },
  n: number,
): T[] {
  if (n <= 0) return [];
  return items
    .map((it) => ({ it, d: (it.x - at.x) ** 2 + (it.z - at.z) ** 2 }))
    .sort((a, b) => a.d - b.d)
    .slice(0, n)
    .map((o) => o.it);
}
