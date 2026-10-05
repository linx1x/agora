import { createHash, createHmac, randomBytes, randomInt, timingSafeEqual } from 'node:crypto';
import {
  PIN_LENGTH,
  TICKET_PATH,
  isPlatformRole,
  ticketStatus,
  type AccountInviteSummary,
  type AssignableRole,
  type PlatformRole,
  type TicketKind,
} from '@agora/shared';
import type { Store, StoredTicket } from '../db/store';

/**
 * Setup, invite and recovery links (PLAN P2.13, P2.15, P2.16).
 *
 * The link token is 256 random bits, stored as SHA-256. The optional PIN is 6 digits,
 * stored as HMAC-SHA-256 keyed by SESSION_SECRET and the ticket id, so a database copy
 * alone cannot brute-force it offline, and 5 wrong tries lock the ticket.
 */

export const hashToken = (t: string) => createHash('sha256').update(t).digest('base64url');

export const hashPin = (secret: string, ticketId: string, pin: string) =>
  createHmac('sha256', secret).update(`pin:${ticketId}:${pin}`).digest('base64url');

export function pinMatches(secret: string, t: StoredTicket, pin: string): boolean {
  if (!t.pinHash) return true;
  const a = Buffer.from(hashPin(secret, t.id, pin));
  const b = Buffer.from(t.pinHash);
  return a.length === b.length && timingSafeEqual(a, b);
}

export const newPin = () => String(randomInt(0, 10 ** PIN_LENGTH)).padStart(PIN_LENGTH, '0');

export interface NewTicket {
  kind: TicketKind;
  name: string;
  note?: string;
  role: PlatformRole | null;
  spaces?: string[];
  targetUid?: string | null;
  pilotUid?: string | null;
  expiresAt: number;
  createdBy: string | null;
  withPin: boolean;
}

/** Create a ticket; the token and PIN are returned once and never stored in clear. */
export async function issueTicket(
  store: Store,
  secret: string,
  n: NewTicket,
  now = Date.now(),
): Promise<{ ticket: StoredTicket; token: string; pin: string | null; path: string }> {
  const token = randomBytes(32).toString('base64url');
  const id = `t-${randomBytes(9).toString('base64url')}`;
  const pin = n.withPin ? newPin() : null;
  const ticket: StoredTicket = {
    id,
    kind: n.kind,
    tokenHash: hashToken(token),
    pinHash: pin ? hashPin(secret, id, pin) : null,
    name: n.name,
    note: n.note ?? '',
    role: n.role,
    spaces: n.spaces ?? [],
    targetUid: n.targetUid ?? null,
    pilotUid: n.pilotUid ?? null,
    expiresAt: n.expiresAt,
    createdBy: n.createdBy,
    createdAt: now,
    revokedAt: null,
    usedAt: null,
    usedBy: null,
    pinFailures: 0,
    lockedAt: null,
  };
  await store.createTicket(ticket);
  return { ticket, token, pin, path: `${TICKET_PATH[n.kind]}#${token}` };
}

export function ticketSummary(t: StoredTicket, now = Date.now()): AccountInviteSummary {
  return {
    id: t.id,
    kind: t.kind === 'recovery' ? 'recovery' : 'invite',
    name: t.name,
    note: t.note,
    role:
      t.role && isPlatformRole(t.role) && t.role !== 'owner' ? (t.role as AssignableRole) : null,
    spaces: t.spaces,
    protection: t.pinHash ? 'pin' : 'open',
    pilotUid: t.pilotUid,
    targetUid: t.targetUid,
    status: ticketStatus(t, now),
    expiresAt: t.expiresAt,
    createdAt: t.createdAt,
    usedAt: t.usedAt,
    usedBy: t.usedBy,
  };
}
