/**
 * Portals (ADR-053, P17.8): a floor rectangle that sends the person who steps through it to a
 * world. Triggers use the office's pixel grid (TILE 32, the same convention as zones), so one
 * rule set serves the office and the worlds. Only the server decides: `checkPortal` is run on the
 * server's own position and the visitor's rights, never on what the client claims.
 *
 * Desk portals reuse the three pod access rules (ADR-017, `DESK_ACCESS`) and resolve their
 * destination from the owner's world when someone steps through, so the owner's world id is
 * looked up server-side and sent only to the person who asked.
 */
import { z } from 'zod';
import type { DeskAccess } from './desks';
import { DESK_ACCESS } from './desks';

/** Portal ids: lower-case, digits, `-`, `_`, `:` (a desk portal is `desk:<deskId>`). */
export const PORTAL_ID = /^[a-z0-9][a-z0-9:_-]{0,63}$/;

/** A trigger rectangle in pixels, half-open: [x, x + w) × [y, y + h). */
export const PortalRectSchema = z.strictObject({
  x: z.number().finite(),
  y: z.number().finite(),
  w: z.number().positive().finite(),
  h: z.number().positive().finite(),
});
export type PortalRect = z.infer<typeof PortalRectSchema>;

export const PortalSchema = z.strictObject({
  id: z.string().regex(PORTAL_ID),
  trigger: PortalRectSchema,
  /** who may step through: the same rules as a desk pod (owner, open, knock, closed) */
  access: z.enum(DESK_ACCESS),
  target: z.strictObject({
    /** opaque world id; never derived from a user id, because it is sent to visitors */
    worldId: z.string().min(1).max(64),
    /** feet position in world pixels where the visitor arrives */
    spawn: z.strictObject({ x: z.number().finite(), y: z.number().finite() }),
  }),
});
export type Portal = z.infer<typeof PortalSchema>;

/** Why a step through a portal is refused (`portal:refused`). */
export const PORTAL_REFUSALS = ['disabled', 'unknown', 'outside', 'no_permission', 'no_world'] as const;
export type PortalRefusal = (typeof PORTAL_REFUSALS)[number];

/**
 * Feet point where visitors arrive: the middle of cell (0, 0), the origin of every world. The
 * starter stamp (P17.10) is built around it.
 */
export const WORLD_SPAWN = { x: 16, y: 26 } as const;

/** Is the feet point (x, y) on the trigger? Same half-open rule as office zones. */
export function inPortal(trigger: PortalRect, x: number, y: number): boolean {
  return x >= trigger.x && y >= trigger.y && x < trigger.x + trigger.w && y < trigger.y + trigger.h;
}

/**
 * The pod rules (ADR-017) for any portal with an `access` field: the owner always; open for
 * everyone; knock only for people the owner admitted; closed for nobody but the owner. Equal to
 * `podAllows` for every input (tested), so a desk portal and its pod never disagree.
 */
export function portalAllows(access: DeskAccess, isOwner: boolean, admitted: boolean): boolean {
  if (isOwner || access === 'open') return true;
  if (access === 'knock') return admitted;
  return false;
}

/** A portal before its destination is known: enough to decide whether someone may step in. */
export type PortalGate = Pick<Portal, 'id' | 'trigger' | 'access'>;

export interface PortalVisitor {
  isOwner: boolean;
  admitted: boolean;
}

/**
 * The verdict on a step through a portal, from the visitor's real position and rights. Trigger
 * first: standing outside is refused before the rights are looked at.
 */
export function checkPortal(
  gate: PortalGate,
  at: { x: number; y: number },
  visitor: PortalVisitor,
): 'ok' | 'outside' | 'no_permission' {
  if (!inPortal(gate.trigger, at.x, at.y)) return 'outside';
  if (!portalAllows(gate.access, visitor.isOwner, visitor.admitted)) return 'no_permission';
  return 'ok';
}

/** The portal of a desk pod. */
export function deskPortalId(deskId: string): string {
  return `desk:${deskId}`;
}

/** The desk a portal id names, or null for any other portal. */
export function deskOfPortal(id: string): string | null {
  if (!id.startsWith('desk:')) return null;
  const deskId = id.slice('desk:'.length);
  return deskId.length > 0 ? deskId : null;
}

/** The gate of a desk's portal: the pod rectangle and the pod's access. */
export function deskGate(deskId: string, pod: PortalRect, access: DeskAccess): PortalGate {
  return { id: deskPortalId(deskId), trigger: { ...pod }, access };
}

/** A full portal once the destination world is known. */
export function portalTo(gate: PortalGate, worldId: string): Portal {
  return { ...gate, target: { worldId, spawn: { ...WORLD_SPAWN } } };
}
