import { describe, expect, it } from 'vitest';
import { SlugSchema, inviteState, roleAtLeast, slugify, spaceCan, strongerRole } from './spaces';

describe('spaces helpers', () => {
  it('suggests valid slugs from names', () => {
    expect(slugify('Équipe Ventes — Montréal')).toBe('equipe-ventes-montreal');
    expect(slugify('A')).toBe('a-space');
    expect(slugify('')).toBe('space');
    for (const n of ['Équipe Ventes', 'x', '###', 'a'.repeat(80)])
      expect(SlugSchema.safeParse(slugify(n)).success).toBe(true);
  });
  it('rejects reserved and malformed slugs', () => {
    for (const s of ['api', 'join', 'a', '-ab', 'ab-', 'a--b', 'A b', 'x'.repeat(33)])
      expect(SlugSchema.safeParse(s).success).toBe(false);
    expect(SlugSchema.parse(' HQ ')).toBe('hq');
  });
  it('orders roles and never downgrades', () => {
    expect(roleAtLeast('owner', 'admin')).toBe(true);
    expect(roleAtLeast('member', 'builder')).toBe(false);
    expect(roleAtLeast(null, 'guest')).toBe(false);
    expect(strongerRole('admin', 'member')).toBe('admin');
    expect(strongerRole(null, 'member')).toBe('member');
    expect(strongerRole('guest', 'builder')).toBe('builder');
  });
  it('decides who may enter, build and manage', () => {
    expect(spaceCan(null, 'enter', 'open')).toBe(true);
    expect(spaceCan(null, 'enter', 'invite')).toBe(false);
    expect(spaceCan('guest', 'enter', 'invite')).toBe(true);
    expect(spaceCan('builder', 'build')).toBe(true);
    expect(spaceCan('builder', 'manage')).toBe(false);
    expect(spaceCan('admin', 'manage')).toBe(true);
  });
  it('knows when an invite is usable', () => {
    const base = { expiresAt: null, maxUses: null, uses: 0, revokedAt: null };
    expect(inviteState(base).valid).toBe(true);
    expect(inviteState({ ...base, expiresAt: 1000 }, 2000)).toEqual({
      valid: false,
      reason: 'expired',
    });
    expect(inviteState({ ...base, maxUses: 2, uses: 2 })).toEqual({
      valid: false,
      reason: 'used_up',
    });
    expect(inviteState({ ...base, revokedAt: 5 })).toEqual({ valid: false, reason: 'revoked' });
  });
});
