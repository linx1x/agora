import { describe, expect, it } from 'vitest';
import {
  ASSIGNABLE_ROLES,
  PLATFORM_ACTIONS,
  PLATFORM_ROLES,
  can,
  canModerate,
  isPlatformRole,
  type PlatformAction,
  type PlatformRole,
} from './roles';

/** The table in docs/AUTH.md, written out by hand so a change to the matrix is deliberate. */
const EXPECTED: Record<PlatformAction, PlatformRole[]> = {
  'space.enter': ['owner', 'moderator', 'builder', 'member'],
  'space.enter_any': ['owner'],
  'map.build': ['owner', 'builder'],
  'moderate.mute_kick': ['owner', 'moderator'],
  'moderate.ban_timed': ['owner', 'moderator'],
  'moderate.ban_permanent': ['owner'],
  'space.settings': ['owner', 'moderator'],
  'space.create': ['owner'],
  'space.archive': ['owner'],
  'invite.manage': ['owner'],
  'account.manage': ['owner'],
  'account.remove': ['owner'],
  'account.recovery': ['owner'],
  'session.manage_others': ['owner'],
  'audit.view': ['owner'],
};

describe('permission matrix (P2.12)', () => {
  it('covers every action', () => {
    expect(Object.keys(EXPECTED).sort()).toEqual([...PLATFORM_ACTIONS].sort());
  });

  for (const action of PLATFORM_ACTIONS)
    it(`${action}: only ${EXPECTED[action].join(', ')}`, () => {
      for (const role of PLATFORM_ROLES)
        expect({ role, ok: can(role, action) }).toEqual({
          role,
          ok: EXPECTED[action].includes(role),
        });
      expect(can(null, action)).toBe(false);
      expect(can(undefined, action)).toBe(false);
    });

  it('never lets ownership be assigned', () => {
    expect(ASSIGNABLE_ROLES).not.toContain('owner');
  });

  it('recognises roles', () => {
    expect(isPlatformRole('moderator')).toBe(true);
    expect(isPlatformRole('admin')).toBe(false);
    expect(isPlatformRole(undefined)).toBe(false);
  });
});

describe('who may moderate whom', () => {
  it('owner acts on everyone but themself', () => {
    for (const t of ['moderator', 'builder', 'member'] as const)
      expect(canModerate('owner', t, 'moderate.ban_permanent')).toBe(true);
    expect(canModerate('owner', 'owner', 'moderate.mute_kick')).toBe(false);
  });
  it('moderators act on builders and members only, and never ban for good', () => {
    expect(canModerate('moderator', 'member', 'moderate.mute_kick')).toBe(true);
    expect(canModerate('moderator', 'builder', 'moderate.ban_timed')).toBe(true);
    expect(canModerate('moderator', 'moderator', 'moderate.mute_kick')).toBe(false);
    expect(canModerate('moderator', 'owner', 'moderate.mute_kick')).toBe(false);
    expect(canModerate('moderator', 'member', 'moderate.ban_permanent')).toBe(false);
  });
  it('builders and members moderate nobody', () => {
    for (const a of ['builder', 'member'] as const)
      expect(canModerate(a, 'member', 'moderate.mute_kick')).toBe(false);
  });
});
