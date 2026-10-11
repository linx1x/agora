import { describe, expect, it } from 'vitest';
import { loadGameData } from '../gamedata/load';
import { cellKey, type PlotState } from '../gamedata/state';
import { DECOR, envOf, viewOf } from './fixtures';
import { planTill } from './till';

const data = loadGameData();
const at = { x: 4, y: 4 };
const env = envOf(data);
const plotAt = (plots: Record<string, PlotState>, x: number, y: number) => plots[cellKey(x, y)];

describe('till: a hoe turns ground into a plot on the farm layer (P17.21)', () => {
  it('a hoe tills the cell it is aimed at, costs its energy and edits no terrain', () => {
    const out = planTill(viewOf({ items: { hoe_1: 1 } }), { kind: 'till', item: 'hoe_1', at }, env);
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    expect(plotAt(out.plan.sim.plots, 4, 4)).toEqual({ tilled: true, wateredOn: 0, crop: null, sprinkler: null });
    expect(out.plan.changes).toMatchObject({ energy: -2, money: 0, items: {}, xp: {} });
    expect(out.plan.edits).toEqual([]);
  });

  it('a hoe of tier 2 tills the 3 x 3 square around the target', () => {
    const out = planTill(viewOf({ items: { hoe_2: 1 } }), { kind: 'till', item: 'hoe_2', at }, env);
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    expect(Object.keys(out.plan.sim.plots)).toHaveLength(9);
    expect(out.plan.changes.energy).toBe(-3);
  });

  it('skips cells that cannot be tilled and keeps the plots already there', () => {
    const view = viewOf({
      items: { hoe_2: 1 },
      cells: { '3,4': { block: 'stone' }, '5,4': { decor: 'oak_tree', ...DECOR }, '4,3': { liquid: true } },
      plots: { '4,4': { tilled: true, wateredOn: 9, crop: null, sprinkler: null } },
    });
    const out = planTill(view, { kind: 'till', item: 'hoe_2', at }, env);
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    expect(plotAt(out.plan.sim.plots, 4, 4)?.wateredOn).toBe(9); // untouched
    expect(plotAt(out.plan.sim.plots, 3, 4)).toBeUndefined();
    expect(plotAt(out.plan.sim.plots, 5, 4)).toBeUndefined();
    expect(plotAt(out.plan.sim.plots, 4, 3)).toBeUndefined();
    expect(plotAt(out.plan.sim.plots, 4, 5)?.tilled).toBe(true);
  });

  it('refuses with invalid when no cell in the area can be tilled, and costs nothing', () => {
    const view = viewOf({ items: { hoe_1: 1 }, cells: { '4,4': { block: 'stone' } } });
    expect(planTill(view, { kind: 'till', item: 'hoe_1', at }, env)).toEqual({ ok: false, reason: 'invalid' });
    const tilled = viewOf({ items: { hoe_1: 1 }, plots: { '4,4': { tilled: true, wateredOn: 0, crop: null, sprinkler: null } } });
    expect(planTill(tilled, { kind: 'till', item: 'hoe_1', at }, env)).toEqual({ ok: false, reason: 'invalid' });
  });

  it('refuses with invalid when there is no target', () => {
    expect(planTill(viewOf({ items: { hoe_1: 1 } }), { kind: 'till', item: 'hoe_1' }, env)).toEqual({ ok: false, reason: 'invalid' });
  });

  it('refuses with the tool and energy reasons, and with missing for a tool not held', () => {
    expect(planTill(viewOf({ items: { can_1: 1 } }), { kind: 'till', item: 'can_1', at }, env)).toEqual({ ok: false, reason: 'tool' });
    expect(planTill(viewOf({ items: { hoe_1: 1 }, energy: 1 }), { kind: 'till', item: 'hoe_1', at }, env)).toEqual({
      ok: false,
      reason: 'energy',
    });
    expect(planTill(viewOf(), { kind: 'till', item: 'hoe_1', at }, env)).toEqual({ ok: false, reason: 'missing' });
  });

  it('the farming level lowers the cost: level 6 makes a basic hoe cost 1', () => {
    const skills = { farming: data.progression.levelXp[5]! };
    const out = planTill(viewOf({ items: { hoe_1: 1 }, skills }), { kind: 'till', item: 'hoe_1', at }, env);
    expect(out.ok && out.plan.changes.energy).toBe(-1);
  });
});
