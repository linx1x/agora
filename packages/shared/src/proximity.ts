import { CONNECT_R, DISCONNECT_R, FULL_R, NEARBY_CHAT_R, TILE } from './constants';
import type { WorldMap, Zone } from './map';

export interface Placed {
  id: string;
  x: number;
  y: number;
  /** Rule-bearing zone id/kind from the server (undefined = open floor). */
  zoneId?: string;
  zoneKind?: Zone['kind'];
}

export function distTiles(a: { x: number; y: number }, b: { x: number; y: number }): number {
  return Math.hypot(a.x - b.x, a.y - b.y) / TILE;
}

/** Volume 1.0 within FULL_R, smoothstep down to 0 at CONNECT_R. */
export function falloff(dTiles: number, full = FULL_R, connect = CONNECT_R): number {
  if (dTiles <= full) return 1;
  if (dTiles >= connect) return 0;
  const t = (dTiles - full) / (connect - full);
  return 1 - t * t * (3 - 2 * t);
}

export interface Radii {
  connect: number;
  disconnect: number;
}

/** Private rooms and desk pods both isolate (ADR-017). */
const isPrivate = (p: Placed) => p.zoneKind === 'private' || p.zoneKind === 'desk';
const isQuiet = (p: Placed) => p.zoneKind === 'quiet';

/**
 * Whether two people may exchange audio/video. Server-authoritative:
 * - quiet zone on either side → never
 * - private zone → only with people in the very same private zone, any distance
 * - open floor → distance with hysteresis (connect ≤ R1, stay until > R2)
 */
export function mediaLinked(
  a: Placed,
  b: Placed,
  wasLinked: boolean,
  r: Radii = { connect: CONNECT_R, disconnect: DISCONNECT_R },
): boolean {
  if (isQuiet(a) || isQuiet(b)) return false;
  if (isPrivate(a) || isPrivate(b)) return isPrivate(a) && isPrivate(b) && a.zoneId === b.zoneId;
  const d = distTiles(a, b);
  return wasLinked ? d <= r.disconnect : d <= r.connect;
}

/** Whether `to` receives a nearby-chat message sent by `from`. */
export function chatReaches(from: Placed, to: Placed, radius = NEARBY_CHAT_R): boolean {
  if (isPrivate(from) || isPrivate(to))
    return isPrivate(from) && isPrivate(to) && from.zoneId === to.zoneId;
  return distTiles(from, to) <= radius;
}

/**
 * Which media room someone belongs to (SFU backend, ADR-031):
 * - `floor`: the open floor room; who hears whom is still decided by `mediaLinked`
 * - `zone`: their own private room or desk pod, one SFU room per zone
 * - `none`: a quiet zone, publishing nowhere
 */
export type MediaScope = { kind: 'floor' } | { kind: 'zone'; zoneId: string } | { kind: 'none' };

export function mediaScope(p: Placed): MediaScope {
  if (isQuiet(p)) return { kind: 'none' };
  if (isPrivate(p) && p.zoneId) return { kind: 'zone', zoneId: p.zoneId };
  return { kind: 'floor' };
}

export const scopeKey = (s: MediaScope) => (s.kind === 'zone' ? `zone:${s.zoneId}` : s.kind);

export const pairKey = (a: string, b: string) => (a < b ? `${a}|${b}` : `${b}|${a}`);

/** Recompute the authoritative set of media links, keeping hysteresis from `prev`. */
export function computeLinks(people: Placed[], prev: Set<string>, r?: Radii): Set<string> {
  const next = new Set<string>();
  for (let i = 0; i < people.length; i++)
    for (let j = i + 1; j < people.length; j++) {
      const a = people[i]!;
      const b = people[j]!;
      const k = pairKey(a.id, b.id);
      if (mediaLinked(a, b, prev.has(k), r)) next.add(k);
    }
  return next;
}

export function peersOf(id: string, links: Set<string>): string[] {
  const out: string[] = [];
  for (const k of links) {
    const [a, b] = k.split('|') as [string, string];
    if (a === id) out.push(b);
    else if (b === id) out.push(a);
  }
  return out.sort();
}

export type { WorldMap };
