import { describe, expect, it } from 'vitest';
import { loadGameData } from '../gamedata/load';
import { cellKey, type PlotState } from '../gamedata/state';
import { envOf, viewOf } from './fixtures';
import { planWater } from './water';

const data = loadGameData();
const env = envOf(data);
const dry = (): PlotState => ({ tilled: true, wateredOn: 0, crop: null, sprinkler: null });
const at = { x: 2, y: 2 };

describe('water: a watering can wets tilled plots for tomorrow (P17.21)', () => {
  it('a player watering on day D sets wateredOn to D + 1 and pays the can energy', () => {
    const view = viewOf({ day: 5, items: { can_1: 1 }, plots: { '2,2': dry() } });
    const out = planWater(view, { kind: 'water', item: 'can_1', at }, env);
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    expect(out.plan.sim.plots[cellKey(2, 2)]).toMatchObject({ tilled: true, wateredOn: 6 });
    expect(out.plan.changes.energy).toBe(-2);
    expect(out.plan.edits).toEqual([]);
  });

  it('a can of tier 2 waters every tilled plot in its 3 x 3 area and nothing else', () => {
    const plots = { '1,1': dry(), '3,3': dry(), '2,1': dry(), '5,5': dry() };
    const out = planWater(viewOf({ day: 5, items: { can_2: 1 }, plots }), { kind: 'water', item: 'can_2', at }, env);
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    const wet = Object.entries(out.plan.sim.plots)
      .filter(([, p]) => p.wateredOn === 6)
      .map(([k]) => k)
      .sort();
    expect(wet).toEqual(['1,1', '2,1', '3,3']);
    expect(out.plan.changes.energy).toBe(-3);
  });

  it('refuses with invalid for dry ground or a plot already wet for tomorrow, at no cost', () => {
    expect(planWater(viewOf({ items: { can_1: 1 } }), { kind: 'water', item: 'can_1', at }, env)).toEqual({
      ok: false,
      reason: 'invalid',
    });
    const wet = viewOf({ day: 5, items: { can_1: 1 }, plots: { '2,2': { ...dry(), wateredOn: 6 } } });
    expect(planWater(wet, { kind: 'water', item: 'can_1', at }, env)).toEqual({ ok: false, reason: 'invalid' });
  });

  it('refuses a hoe and an empty energy bar', () => {
    const plots = { '2,2': dry() };
    expect(planWater(viewOf({ items: { hoe_1: 1 }, plots }), { kind: 'water', item: 'hoe_1', at }, env)).toEqual({
      ok: false,
      reason: 'tool',
    });
    expect(planWater(viewOf({ items: { can_1: 1 }, energy: 0, plots }), { kind: 'water', item: 'can_1', at }, env)).toEqual({
      ok: false,
      reason: 'energy',
    });
  });
});
