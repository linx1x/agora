import { z } from 'zod';
import { MAX_NAME_LEN } from './constants';
import { ASSIGNABLE_ROLES, type AssignableRole, type PlatformRole } from './roles';

/**
 * Invite-only accounts with passkeys (docs/AUTH.md, ADR-032, PLAN P2.13–P2.17).
 *
 * A *ticket* lets someone register a passkey: `setup` makes the owner (console link at
 * first boot or `pnpm owner:recover`), `invite` makes a new account (owner only, single
 * use, optional PIN sent separately), `recovery` adds a passkey to an existing account.
 */
export const TICKET_KINDS = ['setup', 'invite', 'recovery'] as const;
export type TicketKind = (typeof TICKET_KINDS)[number];

export const PIN_LENGTH = 6;
export const MAX_PIN_FAILURES = 5;
export const PIN_RE = /^\d{6}$/;
export const MAX_PASSKEY_LABEL = 40;
/** Invite lifetime choices offered in the People page (hours). */
export const INVITE_EXPIRY_HOURS = [1, 24, 24 * 7, 24 * 30] as const;
export const DEFAULT_INVITE_HOURS = 24 * 7;
export const RECOVERY_HOURS = 24;
export const SETUP_MINUTES = 30;

/** Ticket paths: the secret goes in the fragment so it never reaches logs or Referer. */
export const TICKET_PATH: Record<TicketKind, string> = {
  setup: '/setup',
  invite: '/join',
  recovery: '/recover',
};

export const NameSchema = z.string().trim().min(1).max(MAX_NAME_LEN);

export const CreateAccountInviteSchema = z.object({
  /** pre-filled at sign-up; the person may change it later */
  name: NameSchema,
  /** for the owner's records only (e.g. an email); never sent anywhere */
  note: z.string().trim().max(120).default(''),
  role: z.enum(ASSIGNABLE_ROLES).default('member'),
  /** invite-only spaces they may enter (open spaces are always allowed) */
  spaces: z.array(z.string().min(1).max(64)).max(100).default([]),
  expiresInHours: z
    .number()
    .int()
    .min(1)
    .max(24 * 30)
    .default(DEFAULT_INVITE_HOURS),
  /** pin: link + separate 6-digit PIN (default); open: whoever opens it first */
  protection: z.enum(['pin', 'open']).default('pin'),
  /** claim an access-code pilot identity (keeps desk, avatar, messages) */
  pilotUid: z.string().min(1).max(64).nullable().default(null),
});
export type CreateAccountInviteIn = z.input<typeof CreateAccountInviteSchema>;

export const UpdatePersonSchema = z
  .object({
    role: z.enum(ASSIGNABLE_ROLES).optional(),
    name: NameSchema.optional(),
    spaces: z.array(z.string().min(1).max(64)).max(100).optional(),
  })
  .refine((v) => v.role !== undefined || v.name !== undefined || v.spaces !== undefined, {
    message: 'empty',
  });

export const RecoverySchema = z.object({
  /** also delete their passkeys and end their sessions now (lost or stolen device) */
  revokeExisting: z.boolean().default(false),
});

export const PasskeyLabelSchema = z.object({
  label: z.string().trim().min(1).max(MAX_PASSKEY_LABEL),
});

/** Public: what a ticket link leads to (before the PIN). */
export interface TicketPreview {
  kind: TicketKind;
  /** the name the owner gave (invite), the account name (recovery), '' (setup) */
  name: string;
  expiresAt: number;
  needsPin: boolean;
}

export type TicketStatus = 'pending' | 'used' | 'expired' | 'revoked' | 'locked';

/** An invite or recovery link, as the owner sees it in the People page. */
export interface AccountInviteSummary {
  id: string;
  kind: 'invite' | 'recovery';
  name: string;
  note: string;
  role: AssignableRole | null;
  spaces: string[];
  protection: 'pin' | 'open';
  pilotUid: string | null;
  /** recovery: whose account */
  targetUid: string | null;
  status: TicketStatus;
  expiresAt: number;
  createdAt: number;
  usedAt: number | null;
  usedBy: string | null;
}

/** Returned once when a link is created: the secret parts are never shown again. */
export interface CreatedLink {
  invite: AccountInviteSummary;
  /** path + fragment, e.g. /join#abc… */
  path: string;
  pin: string | null;
}

export interface PersonSummary {
  uid: string;
  name: string;
  /** the name the owner put on the invite (to spot impersonation), if any */
  invitedName: string | null;
  role: PlatformRole;
  /** invite-only spaces on whose list they are (ids) */
  spaces: string[];
  createdAt: number;
  lastSeenAt: number;
  passkeys: number;
  sessions: number;
  disabled: boolean;
  /** an access-code pilot identity with no passkey yet */
  pilot: boolean;
}

export interface PasskeySummary {
  id: string;
  label: string;
  createdAt: number;
  lastUsedAt: number | null;
  /** synced by a password manager / platform (survives a lost device) */
  backedUp: boolean;
}

export interface SessionSummary {
  id: string;
  createdAt: number;
  lastUsedAt: number;
  expiresAt: number;
  shared: boolean;
  userAgent: string;
  ip: string;
  current: boolean;
}

/** Status of a ticket at `now`. */
export function ticketStatus(
  t: {
    expiresAt: number;
    revokedAt: number | null;
    usedAt: number | null;
    lockedAt: number | null;
  },
  now = Date.now(),
): TicketStatus {
  if (t.usedAt) return 'used';
  if (t.revokedAt) return 'revoked';
  if (t.lockedAt) return 'locked';
  if (t.expiresAt <= now) return 'expired';
  return 'pending';
}

/** Short device name from a user-agent, for passkey and session lists. */
export function deviceLabel(ua: string): string {
  const os = /iPhone|iPad/.test(ua)
    ? 'iOS'
    : /Android/.test(ua)
      ? 'Android'
      : /Mac OS X|Macintosh/.test(ua)
        ? 'macOS'
        : /Windows/.test(ua)
          ? 'Windows'
          : /CrOS/.test(ua)
            ? 'ChromeOS'
            : /Linux/.test(ua)
              ? 'Linux'
              : '';
  const browser = /Edg\//.test(ua)
    ? 'Edge'
    : /Firefox\//.test(ua)
      ? 'Firefox'
      : /Chrome\//.test(ua)
        ? 'Chrome'
        : /Safari\//.test(ua)
          ? 'Safari'
          : '';
  return [browser, os].filter(Boolean).join(' · ') || '—';
}
