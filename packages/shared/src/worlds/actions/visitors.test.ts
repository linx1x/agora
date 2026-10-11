import { describe, expect, it } from 'vitest';
import { ACTION_KINDS } from './kinds';
import { canDo } from './permissions';
import { VISITOR_RULES } from './rules';
import {
  ALLOWED_KINDS,
  CHOICE_KINDS,
  VISITOR_CAP,
  applyVisitorEdit,
  awayAllows,
  awayOf,
  cleanGrants,
  grantsFor,
  visitorKinds,
  visitorsOf,
  type VisitorEdit,
} from './visitors';

const edit = (settings: Record<string, unknown>, e: VisitorEdit): Record<string, unknown> => {
  const r = applyVisitorEdit(settings, e);
  if (!r.ok) throw new Error(r.reason);
  return r.settings;
};

describe('the visitor matrix (P17.27, ADR-053)', () => {
  it('has the ADR-053 defaults: water open; harvest, chests, feeding and crafting the owner’s choice; the rest closed', () => {
    expect(ALLOWED_KINDS).toEqual(expect.arrayContaining(['water']));
    expect([...CHOICE_KINDS].sort()).toEqual(['craft', 'feed', 'harvest', 'open', 'stash', 'take']);
    for (const k of ['till', 'plant', 'chop', 'mine', 'raise', 'lower', 'remove', 'place', 'buy', 'ship', 'collect'] as const)
      expect(VISITOR_RULES[k]).toBe('deny');
  });

  it('a person’s own grants replace the world default, for that person only', () => {
    let s = edit({}, { op: 'defaults', grants: ['harvest'] });
    s = edit(s, { op: 'person', uid: 'u-ben', name: 'Benoît', grants: ['open', 'take'] });
    const world = { ownerId: 'u-owner', settings: s };
    expect(canDo(world, 'u-ben', 'harvest')).toBe(false);
    expect(canDo(world, 'u-ben', 'take')).toBe(true);
    expect(canDo(world, 'u-chloe', 'harvest')).toBe(true);
    expect(canDo(world, 'u-chloe', 'take')).toBe(false);
    // back to the default
    s = edit(s, { op: 'person', uid: 'u-ben', name: 'Benoît', grants: null });
    expect(canDo({ ownerId: 'u-owner', settings: s }, 'u-ben', 'harvest')).toBe(true);
    expect(visitorsOf(s)).toEqual({});
  });

  it('a grant never opens a closed kind, for everyone or for one person; the owner may do everything', () => {
    let s = edit({}, { op: 'defaults', grants: ['till', 'chop', 'harvest'] });
    s = edit(s, { op: 'person', uid: 'u-ben', name: 'Benoît', grants: ['raise', 'buy', 'feed'] });
    expect(s.grants).toEqual(['harvest']);
    expect(grantsFor(s, 'u-ben')).toEqual(['feed']);
    // even a hand-written settings row cannot open a closed kind
    const forged = { ownerId: 'u-owner', settings: { grants: ['till'], visitors: { 'u-ben': { name: 'B', grants: ['mine'] } } } };
    for (const k of ACTION_KINDS) {
      if (VISITOR_RULES[k] === 'deny') {
        expect(canDo(forged, 'u-ben', k)).toBe(false);
        expect(canDo(forged, 'u-chloe', k)).toBe(false);
      }
      expect(canDo(forged, 'u-owner', k)).toBe(true);
    }
  });

  it('every permission alone: each choice kind opens exactly itself', () => {
    for (const k of CHOICE_KINDS) {
      const s = edit({}, { op: 'person', uid: 'u-ben', name: 'Benoît', grants: [k] });
      const world = { ownerId: 'u-owner', settings: s };
      for (const other of CHOICE_KINDS) expect(canDo(world, 'u-ben', other), `${k} → ${other}`).toBe(other === k);
      expect(visitorKinds(s, 'u-ben')).toEqual(ACTION_KINDS.filter((x) => x === k || VISITOR_RULES[x] === 'allow'));
    }
  });

  it('the away rule: nobody by default; with the list, only listed people', () => {
    let s: Record<string, unknown> = {};
    expect(awayOf(s)).toBe('nobody');
    s = edit(s, { op: 'list', uid: 'u-ben', name: 'Benoît', on: true });
    expect(awayAllows(s, 'u-ben')).toBe(false);
    s = edit(s, { op: 'away', rule: 'list' });
    expect(awayAllows(s, 'u-ben')).toBe(true);
    expect(awayAllows(s, 'u-chloe')).toBe(false);
    s = edit(s, { op: 'list', uid: 'u-ben', name: 'Benoît', on: false });
    expect(awayAllows(s, 'u-ben')).toBe(false);
  });

  it('keeps other settings, caps the list, and forgets only someone known', () => {
    let s: Record<string, unknown> = { noise: { scale: 2 } };
    for (let i = 0; i < VISITOR_CAP; i++) s = edit(s, { op: 'list', uid: `u-${i}`, name: `P${i}`, on: true });
    expect(s.noise).toEqual({ scale: 2 });
    expect(applyVisitorEdit(s, { op: 'list', uid: 'u-extra', name: 'X', on: true })).toEqual({ ok: false, reason: 'full' });
    // someone already listed can still be changed at the cap
    expect(applyVisitorEdit(s, { op: 'person', uid: 'u-1', name: 'P1', grants: ['take'] }).ok).toBe(true);
    s = edit(s, { op: 'forget', uid: 'u-0' });
    expect(Object.keys(visitorsOf(s))).toHaveLength(VISITOR_CAP - 1);
    expect(applyVisitorEdit(s, { op: 'forget', uid: 'u-0' })).toEqual({ ok: false, reason: 'unknown' });
  });

  it('reads malformed settings safely', () => {
    expect(cleanGrants('harvest')).toEqual([]);
    expect(visitorsOf({ visitors: [1, 2] })).toEqual({});
    expect(visitorsOf({ visitors: { a: 3, b: { name: 7 }, c: { name: 'C', grants: 'x', listed: 'yes' } } })).toEqual({
      c: { name: 'C', grants: [] },
    });
    expect(awayOf({ away: 'everyone' })).toBe('nobody');
  });
});
