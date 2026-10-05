/**
 * Platform roles and what each may do (docs/AUTH.md, ADR-032, PLAN P2.12).
 * One matrix, imported by the server (which enforces it on every route and world
 * message) and by the client (which only hides what the server would refuse).
 */

/** Strongest first. Exactly one account is the owner. */
export const PLATFORM_ROLES = ['owner', 'moderator', 'builder', 'member'] as const;
export type PlatformRole = (typeof PLATFORM_ROLES)[number];
/** Roles the owner may give to someone (ownership is never handed out). */
export const ASSIGNABLE_ROLES = ['moderator', 'builder', 'member'] as const;
export type AssignableRole = (typeof ASSIGNABLE_ROLES)[number];

export const PLATFORM_ACTIONS = [
  /** enter open spaces, chat, claim a desk, use media */
  'space.enter',
  /** enter every invite-only space without being on its list */
  'space.enter_any',
  /** build mode: edit the map */
  'map.build',
  /** mute someone or kick them out of a space */
  'moderate.mute_kick',
  /** ban for at most MAX_TIMED_BAN_DAYS */
  'moderate.ban_timed',
  /** ban without end */
  'moderate.ban_permanent',
  /** name, capacity, radii, access of an existing space */
  'space.settings',
  'space.create',
  'space.archive',
  'invite.manage',
  /** change someone's role, rename them, choose their spaces */
  'account.manage',
  'account.remove',
  'account.recovery',
  /** see and revoke other people's sessions */
  'session.manage_others',
  'audit.view',
] as const;
export type PlatformAction = (typeof PLATFORM_ACTIONS)[number];

export const MAX_TIMED_BAN_DAYS = 7;

const MEMBER: readonly PlatformAction[] = ['space.enter'];
const BUILDER: readonly PlatformAction[] = [...MEMBER, 'map.build'];
const MODERATOR: readonly PlatformAction[] = [
  ...MEMBER,
  'moderate.mute_kick',
  'moderate.ban_timed',
  'space.settings',
];

/** The matrix. Anything not listed is refused. The owner may do everything. */
export const PERMISSIONS: Readonly<Record<PlatformRole, ReadonlySet<PlatformAction>>> = {
  owner: new Set(PLATFORM_ACTIONS),
  moderator: new Set(MODERATOR),
  builder: new Set(BUILDER),
  member: new Set(MEMBER),
};

/** May someone with this role do this? No role (signed out, unknown) may do nothing. */
export function can(role: PlatformRole | null | undefined, action: PlatformAction): boolean {
  return !!role && PERMISSIONS[role].has(action);
}

const rank = (r: PlatformRole) => PLATFORM_ROLES.indexOf(r);

/**
 * May `actor` take a moderation action against `target`? The owner may act on anyone but
 * themself; a moderator only on builders and members (never on the owner or another
 * moderator); nobody else on anyone.
 */
export function canModerate(
  actor: PlatformRole | null | undefined,
  target: PlatformRole | null | undefined,
  action: 'moderate.mute_kick' | 'moderate.ban_timed' | 'moderate.ban_permanent',
): boolean {
  if (!can(actor, action)) return false;
  if (!target) return true;
  if (actor === 'owner') return target !== 'owner';
  return rank(target) > rank(actor!);
}

export const isPlatformRole = (v: unknown): v is PlatformRole =>
  typeof v === 'string' && (PLATFORM_ROLES as readonly string[]).includes(v);
