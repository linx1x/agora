import { z } from 'zod';
import { zoneAt, type DeskSpot, type WorldMap } from './map';

/** Desk pod access set by its owner (ADR-017). Unclaimed pods are always open. */
export const DESK_ACCESS = ['open', 'knock', 'closed'] as const;
export type DeskAccess = (typeof DESK_ACCESS)[number];

export const PLANT_STYLES = [
  'monstera',
  'fern',
  'cactus',
  'bonsai',
  'orchid',
  'succulent',
] as const;
export const LAMP_COLORS = [
  '#ffb35c',
  '#fff1d6',
  '#ff8fa3',
  '#5fd3c6',
  '#b49cff',
  '#a6e36b',
] as const;
export const POSTERS = ['mountains', 'waves', 'sun', 'aurora', 'leaf', 'city'] as const;
export const MAX_PLATE_LEN = 40;

export const DeskDecorSchema = z.object({
  plant: z
    .number()
    .int()
    .min(0)
    .max(PLANT_STYLES.length - 1),
  lamp: z
    .number()
    .int()
    .min(0)
    .max(LAMP_COLORS.length - 1),
  poster: z
    .number()
    .int()
    .min(0)
    .max(POSTERS.length - 1),
  message: z.string().trim().max(MAX_PLATE_LEN),
});
export type DeskDecor = z.infer<typeof DeskDecorSchema>;

export const DEFAULT_DECOR: DeskDecor = { plant: 0, lamp: 0, poster: 0, message: '' };

export interface DeskState {
  id: string;
  /** owner's stable user id (never sent to clients) is kept server-side */
  ownerName: string | null;
  /** session id of the owner when online, for UI (locate, knock target) */
  ownerId: string | null;
  access: DeskAccess;
  decor: DeskDecor;
}

/**
 * May `playerId` be inside this pod? Owner always; unclaimed or open pods: anyone;
 * knock: only people the owner let in; closed: owner only.
 */
export function podAllows(
  desk: DeskState | undefined,
  isOwner: boolean,
  admitted: boolean,
): boolean {
  if (!desk || !desk.ownerName) return true;
  if (isOwner) return true;
  if (desk.access === 'open') return true;
  if (desk.access === 'knock') return admitted;
  return false;
}

/**
 * May someone stand at (x, y) as far as desk pods go? Anywhere outside a pod, yes; inside one,
 * `podAllows`. Avatars (room.allowedAt) and cats (apps/server/src/world/pets.ts) share this, so
 * a cat is never allowed where the same person would not be.
 */
export function podOpenAt(
  map: WorldMap,
  x: number,
  y: number,
  deskOf: (id: string) => DeskState | undefined,
  isOwner: boolean,
  admitted: (id: string) => boolean,
): boolean {
  const z = zoneAt(map, x, y);
  if (!z || z.kind !== 'desk') return true;
  return podAllows(deskOf(z.id), isOwner, admitted(z.id));
}

export function deskSpotAt(map: WorldMap, x: number, y: number): DeskSpot | undefined {
  return map.desks.find(
    (d) => x >= d.zone.x && y >= d.zone.y && x < d.zone.x + d.zone.w && y < d.zone.y + d.zone.h,
  );
}

/** Distance in tiles from a point to a pod's rectangle (0 when inside). */
export function distToPod(spot: DeskSpot, x: number, y: number, tile = 32): number {
  const z = spot.zone;
  const dx = Math.max(z.x - x, 0, x - (z.x + z.w));
  const dy = Math.max(z.y - y, 0, y - (z.y + z.h));
  return Math.hypot(dx, dy) / tile;
}
