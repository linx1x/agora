/**
 * Time of day and the lamp colours, shared by the 2.5D lighting (game3d/lightingMath.ts and
 * game3d/lightRig.ts). The flat view's ray-cast 2D lighting (ADR-018) went with that view (ADR-054).
 */
import type { Biome } from '@agora/shared';

/** Warm light of a lamp, by biome (also the 2.5D lamps, P16.10). */
export const LAMP_COLOR: Record<Biome, string> = {
  hub: '#ffe2b0',
  jungle: '#ffb35c',
  boreal: '#ffbf66',
  oasis: '#ffa94d',
  zen: '#ffdca0',
};

// ───────────────────────────────────────────── time of day (America/Toronto)
interface Key {
  h: number;
  amb: [number, number, number];
  day: number;
  sky: string;
}
const KEYS: Key[] = [
  { h: 0, amb: [0.2, 0.22, 0.34], day: 0, sky: '#9fb8ff' },
  { h: 5.5, amb: [0.22, 0.24, 0.36], day: 0, sky: '#9fb8ff' },
  { h: 7, amb: [0.68, 0.7, 0.8], day: 0.6, sky: '#ffd2b0' },
  { h: 9, amb: [0.86, 0.88, 0.93], day: 1, sky: '#dcecff' },
  { h: 15, amb: [0.9, 0.88, 0.85], day: 1, sky: '#fff3dc' },
  { h: 17, amb: [0.86, 0.7, 0.52], day: 0.7, sky: '#ffc07a' },
  { h: 19, amb: [0.46, 0.38, 0.42], day: 0.15, sky: '#ff9a6a' },
  { h: 21, amb: [0.26, 0.26, 0.38], day: 0, sky: '#9fb8ff' },
  { h: 24, amb: [0.2, 0.22, 0.34], day: 0, sky: '#9fb8ff' },
];

export function quebecHour(now = new Date()): number {
  const override = new URLSearchParams(location.search).get('hour');
  if (override !== null && !Number.isNaN(Number(override))) return Number(override);
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Toronto',
    hour: 'numeric',
    minute: 'numeric',
    hourCycle: 'h23',
  }).formatToParts(now);
  const h = Number(parts.find((p) => p.type === 'hour')?.value ?? 12);
  const m = Number(parts.find((p) => p.type === 'minute')?.value ?? 0);
  return h + m / 60;
}

export function timeOfDay(hour: number): {
  amb: [number, number, number];
  day: number;
  sky: string;
  phase: 'night' | 'morning' | 'day' | 'golden' | 'evening';
} {
  let i = 0;
  while (i < KEYS.length - 2 && KEYS[i + 1]!.h <= hour) i++;
  const a = KEYS[i]!;
  const b = KEYS[i + 1]!;
  const f = Math.min(1, Math.max(0, (hour - a.h) / (b.h - a.h)));
  const amb = a.amb.map((v, k) => v + (b.amb[k]! - v) * f) as [number, number, number];
  const day = a.day + (b.day - a.day) * f;
  const phase =
    hour < 6 || hour >= 21
      ? 'night'
      : hour < 10
        ? 'morning'
        : hour < 16
          ? 'day'
          : hour < 18.5
            ? 'golden'
            : 'evening';
  return { amb, day, sky: f < 0.5 ? a.sky : b.sky, phase };
}
