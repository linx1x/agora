import { z } from 'zod';

/**
 * Spaces, roles and invites (PLAN P2.3, P2.4; ARCHITECTURE §7–8; ADR-029).
 * Shared so the client hides what the server would refuse anyway.
 */

/** The default space every deployment has (its map and data predate spaces). */
export const DEFAULT_SPACE = 'hq';

/** Roles per space, strongest first (ARCHITECTURE §7). */
export const SPACE_ROLES = ['owner', 'admin', 'builder', 'member', 'guest'] as const;
export type SpaceRole = (typeof SPACE_ROLES)[number];
/** Roles an invite may grant (ownership is never handed out by link). */
export const INVITE_ROLES = ['admin', 'builder', 'member', 'guest'] as const;
export type InviteRole = (typeof INVITE_ROLES)[number];

/** `open`: anyone signed in may enter. `invite`: members only (invite link or admin). */
export const SPACE_ACCESS = ['open', 'invite'] as const;
export type SpaceAccess = (typeof SPACE_ACCESS)[number];

/** Map templates a space can start from (P9.5 adds more). */
export const SPACE_TEMPLATES = ['hq'] as const;
export type SpaceTemplate = (typeof SPACE_TEMPLATES)[number];

export const MAX_OWNED_SPACES = 5;
export const MAX_SPACE_NAME = 60;

/** 2–32 chars, lowercase letters, digits and inner dashes. */
export const SLUG_RE = /^[a-z0-9](?:[a-z0-9-]{0,30})[a-z0-9]$/;
/** Paths the app uses at the top level; never valid as slugs. */
const RESERVED = new Set(['api', 'join', 'world', 'assets', 'admin', 'new', 'healthz', 'readyz']);

export const SlugSchema = z
  .string()
  .trim()
  .toLowerCase()
  .regex(SLUG_RE)
  .refine((s) => !RESERVED.has(s) && !s.includes('--'), 'reserved');

/** Name → URL slug suggestion ("Équipe Ventes" → "equipe-ventes"). */
export function slugify(name: string): string {
  const s = name
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 32)
    .replace(/-+$/g, '');
  return s.length >= 3 ? s : `${s}${s ? '-' : ''}space`.slice(0, 32);
}

const rank = (r: SpaceRole | null | undefined) => (r ? SPACE_ROLES.indexOf(r) : 99);
/** a is at least as strong as b */
export const roleAtLeast = (a: SpaceRole | null | undefined, b: SpaceRole) => rank(a) <= rank(b);
/** The stronger of two roles (invites never downgrade). */
export const strongerRole = (a: SpaceRole | null | undefined, b: SpaceRole): SpaceRole =>
  rank(a) <= rank(b) ? a! : b;

/**
 * Space-level permissions. P6.1 grows this into the full matrix; for now:
 * manage = settings and invites, build = map editing.
 */
export type SpaceAction = 'manage' | 'build' | 'enter';
export function spaceCan(
  role: SpaceRole | null | undefined,
  action: SpaceAction,
  access: SpaceAccess = 'open',
): boolean {
  switch (action) {
    case 'manage':
      return roleAtLeast(role, 'admin');
    case 'build':
      return roleAtLeast(role, 'builder');
    case 'enter':
      return access === 'open' || !!role;
  }
}

/** Editable settings. Media numbers are optional overrides of the server defaults. */
export const SpaceSettingsSchema = z
  .object({
    name: z.string().trim().min(1).max(MAX_SPACE_NAME),
    access: z.enum(SPACE_ACCESS),
    capacity: z.number().int().min(2).max(200),
    connectR: z.number().min(2).max(12),
    disconnectR: z.number().min(2.5).max(14),
    videoCap: z.number().int().min(1).max(25),
  })
  .refine((s) => s.disconnectR > s.connectR, { path: ['disconnectR'], message: 'hysteresis' });
export type SpaceSettings = z.infer<typeof SpaceSettingsSchema>;

export const CreateSpaceSchema = z.object({
  name: z.string().trim().min(1).max(MAX_SPACE_NAME),
  slug: SlugSchema,
  access: z.enum(SPACE_ACCESS).default('invite'),
  template: z.enum(SPACE_TEMPLATES).default('hq'),
});
export type CreateSpaceIn = z.input<typeof CreateSpaceSchema>;

export const CreateInviteSchema = z.object({
  role: z.enum(INVITE_ROLES).default('member'),
  /** null = never expires */
  expiresInHours: z
    .number()
    .int()
    .min(1)
    .max(24 * 90)
    .nullable()
    .default(24 * 7),
  /** null = unlimited */
  maxUses: z.number().int().min(1).max(500).nullable().default(null),
  label: z.string().trim().max(60).default(''),
});
export type CreateInviteIn = z.input<typeof CreateInviteSchema>;

export const DisplayNameSchema = z.object({
  displayName: z.string().trim().max(40).nullable(),
});

/** What the space list and the space header show. */
export interface SpaceSummary {
  id: string;
  slug: string;
  name: string;
  access: SpaceAccess;
  /** my role, null when I am not a member of an open space */
  role: SpaceRole | null;
  online: number;
  isDefault: boolean;
}

export interface SpaceDetail extends SpaceSummary {
  settings: SpaceSettings;
  /** may change settings */
  canManage: boolean;
  /** may create and revoke invite links */
  canInvite: boolean;
  /** my name in this space (null = my account name) */
  displayName: string | null;
}

export interface InviteSummary {
  id: string;
  role: InviteRole;
  label: string;
  expiresAt: number | null;
  maxUses: number | null;
  uses: number;
  createdAt: number;
  /** expired, used up or revoked */
  active: boolean;
}

export interface InvitePreview {
  spaceName: string;
  slug: string;
  role: InviteRole;
  valid: boolean;
  reason?: 'expired' | 'used_up' | 'revoked' | 'not_found';
}

/** Is an invite usable right now? */
export function inviteState(
  inv: { expiresAt: number | null; maxUses: number | null; uses: number; revokedAt: number | null },
  now = Date.now(),
): { valid: true } | { valid: false; reason: 'expired' | 'used_up' | 'revoked' } {
  if (inv.revokedAt) return { valid: false, reason: 'revoked' };
  if (inv.expiresAt !== null && inv.expiresAt <= now) return { valid: false, reason: 'expired' };
  if (inv.maxUses !== null && inv.uses >= inv.maxUses) return { valid: false, reason: 'used_up' };
  return { valid: true };
}
