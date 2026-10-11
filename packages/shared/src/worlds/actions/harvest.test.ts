import { describe, expect, it } from 'vitest';
import { loadGameData } from '../gamedata/load';
import { DECOR, envOf, viewOf } from './fixtures';
import { planChop, planMine } from './harvest';

const data = loadGameData();
const at = { x: 1, y: 0 };
const tree = { cells: { '1,0': { decor: 'oak_tree', ...DECOR } } };
const jungle = { cells: { '1,0': { decor: 'jungle_tree', ...DECOR } } };
const boulder = { cells: { '1,0': { decor: 'boulder', ...DECOR } } };

describe('chop and mine: axes fell trees and picks break boulders (P17.21)', () => {
  it('an axe fells an oak: the decor is cleared, softwood drops in range, energy and xp are paid', () => {
    const out = planChop(viewOf({ items: { axe_1: 1 }, ...tree }), { kind: 'chop', item: 'axe_1', at }, envOf(data));
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    expect(out.plan.edits).toEqual([{ x: 1, y: 0, patch: { decor: '' } }]);
    const softwood = out.plan.changes.items.softwood ?? 0;
    expect(softwood).toBeGreaterThanOrEqual(2);
    expect(softwood).toBeLessThanOrEqual(4);
    expect(out.plan.changes).toMatchObject({ energy: -3, money: 0, xp: { foraging: 4 } });
  });

  it('the drops are the same for the same rng seed and span the whole range over many seeds', () => {
    const seen = new Set<number>();
    for (let seed = 1; seed <= 200; seed++) {
      const env = envOf(data, seed);
      const a = planChop(viewOf({ items: { axe_1: 1 }, ...tree }), { kind: 'chop', item: 'axe_1', at }, env);
      const b = planChop(viewOf({ items: { axe_1: 1 }, ...tree }), { kind: 'chop', item: 'axe_1', at }, envOf(data, seed));
      expect(a).toEqual(b);
      if (a.ok) seen.add(a.plan.changes.items.softwood ?? 0);
    }
    expect([...seen].sort()).toEqual([2, 3, 4]);
  });

  it('a tier-2 axe is needed for a jungle tree, and a tier-1 one is refused with tier', () => {
    expect(planChop(viewOf({ items: { axe_1: 1 }, ...jungle }), { kind: 'chop', item: 'axe_1', at }, envOf(data))).toEqual({
      ok: false,
      reason: 'tier',
    });
    const out = planChop(viewOf({ items: { axe_2: 1 }, ...jungle }), { kind: 'chop', item: 'axe_2', at }, envOf(data));
    expect(out.ok && out.plan.changes.items.hardwood).toBeGreaterThanOrEqual(3);
    expect(out.ok && out.plan.changes.energy).toBe(-4);
  });

  it('a pick breaks a boulder into stone, and an axe cannot', () => {
    const out = planMine(viewOf({ items: { pick_1: 1 }, ...boulder }), { kind: 'mine', item: 'pick_1', at }, envOf(data));
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    expect(out.plan.changes.items.stone).toBeGreaterThanOrEqual(1);
    expect(out.plan.changes).toMatchObject({ energy: -3, xp: { mining: 4 } });
    expect(planChop(viewOf({ items: { axe_1: 1 }, ...boulder }), { kind: 'chop', item: 'axe_1', at }, envOf(data))).toEqual({
      ok: false,
      reason: 'tool',
    });
    expect(planMine(viewOf({ items: { pick_1: 1 }, ...tree }), { kind: 'mine', item: 'pick_1', at }, envOf(data))).toEqual({
      ok: false,
      reason: 'tool',
    });
  });

  it('refuses with gone when the tree is already cut, and invalid for decor that cannot be harvested', () => {
    expect(planChop(viewOf({ items: { axe_1: 1 } }), { kind: 'chop', item: 'axe_1', at }, envOf(data))).toEqual({
      ok: false,
      reason: 'gone',
    });
    const torch = viewOf({ items: { axe_1: 1 }, cells: { '1,0': { decor: 'torch', ...DECOR } } });
    expect(planChop(torch, { kind: 'chop', item: 'axe_1', at }, envOf(data))).toEqual({ ok: false, reason: 'invalid' });
  });

  it('refuses with energy when the swing would take the actor below zero, and with invalid without a target', () => {
    expect(planChop(viewOf({ items: { axe_1: 1 }, energy: 2, ...tree }), { kind: 'chop', item: 'axe_1', at }, envOf(data))).toEqual({
      ok: false,
      reason: 'energy',
    });
    expect(planChop(viewOf({ items: { axe_1: 1 }, ...tree }), { kind: 'chop', item: 'axe_1' }, envOf(data))).toEqual({
      ok: false,
      reason: 'invalid',
    });
  });
});
