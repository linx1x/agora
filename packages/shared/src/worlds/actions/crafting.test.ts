import { describe, expect, it } from 'vitest';
import { BLOCKS } from '../registry';
import { loadGameData } from '../gamedata/load';
import { cellKey, emptySim, type MachineState } from '../gamedata/state';
import { simulateDays } from '../clock';
import { envOf, viewOf } from './fixtures';
import { planCollect, planCollectOutput, planCraft } from './crafting';
import { planRemove } from './build';
import type { ActionView } from './plan';

const data = loadGameData();
const env = envOf(data);
const at = { x: 5, y: 5 };
const key = cellKey(5, 5);
const bench = { [key]: { decor: 'workbench', solid: true, walkable: false } };
const stove = { [key]: { decor: 'stove', solid: true, walkable: false } };
const furnace = { [key]: { decor: 'furnace', solid: true, walkable: false } };

function withSim(view: ActionView, sim: Partial<ActionView['sim']>): ActionView {
  return { ...view, sim: { ...view.sim, ...sim } };
}

function batch(extra: Partial<MachineState> = {}): MachineState {
  return { id: key, cell: key, machine: 'furnace', output: 'dull_bar', qty: 1, daysLeft: 1, ...extra };
}

describe('crafting at a bench (P17.25)', () => {
  it('a fence is made at once: its inputs leave the bag and the fence comes in', () => {
    const view = viewOf({ items: { softwood: 2, fiber: 1 }, cells: bench });
    expect(planCraft(view, { kind: 'craft', at, target: 'fence' }, env)).toMatchObject({
      ok: true,
      plan: { changes: { items: { softwood: -2, fiber: -1, fence: 1 } }, sim: { machines: [] } },
    });
  });

  it('refuses: no station on the cell, a recipe of another station, an unknown recipe', () => {
    expect(planCraft(viewOf({ items: { softwood: 2, fiber: 1 } }), { kind: 'craft', at, target: 'fence' }, env)).toEqual({ ok: false, reason: 'invalid' });
    expect(planCraft(viewOf({ items: { dull_ore: 2, softwood: 1 }, cells: bench }), { kind: 'craft', at, target: 'smelt_dull' }, env)).toEqual({
      ok: false,
      reason: 'invalid',
    });
    expect(planCraft(viewOf({ cells: bench }), { kind: 'craft', at, target: 'no_such_recipe' }, env)).toEqual({ ok: false, reason: 'invalid' });
  });

  it('a stove cooks a recipe of its own station (kitchen)', () => {
    const view = viewOf({ items: { dawn_radish: 1, meadow_kale: 1 }, cells: stove });
    expect(planCraft(view, { kind: 'craft', at, target: 'dawn_salad' }, env)).toMatchObject({
      ok: true,
      plan: { changes: { items: { dawn_radish: -1, meadow_kale: -1, dawn_salad: 1 } } },
    });
  });
});

describe('machines hold a timed batch on the world clock (P17.25)', () => {
  it('a furnace takes the inputs and holds the bar for a day; the bar is not in the bag yet', () => {
    const view = viewOf({ items: { dull_ore: 2, softwood: 1 }, cells: furnace });
    const out = planCraft(view, { kind: 'craft', at, target: 'smelt_dull' }, env);
    expect(out).toMatchObject({
      ok: true,
      plan: {
        changes: { items: { dull_ore: -2, softwood: -1 } },
        sim: { machines: [{ id: key, cell: key, machine: 'furnace', output: 'dull_bar', qty: 1, daysLeft: 1 }] },
      },
    });
  });

  it('a busy furnace refuses a second batch, and its output waits until the day change', () => {
    const busy = withSim(viewOf({ items: { dull_ore: 2, softwood: 1 }, cells: furnace }), { machines: [batch()] });
    expect(planCraft(busy, { kind: 'craft', at, target: 'smelt_dull' }, env)).toEqual({ ok: false, reason: 'busy' });
    expect(planCollectOutput(busy, { kind: 'collect', at }, env)).toEqual({ ok: false, reason: 'busy' });
  });

  it('the batch counts down at each day change, and then its output goes into the bag', () => {
    const state = { ...emptySim(3), machines: [batch({ daysLeft: 1 })] };
    const ready = simulateDays(state, 3, 4, data);
    expect(ready.machines[0]).toMatchObject({ daysLeft: 0 });
    const view = withSim(viewOf({ day: 4, cells: furnace }), { machines: ready.machines });
    const out = planCollect(view, { kind: 'collect', at }, env);
    expect(out).toMatchObject({ ok: true, plan: { changes: { items: { dull_bar: 1 } }, sim: { machines: [] } } });
  });

  it('collecting an empty furnace is refused as gone, and a finished batch of two comes out as two', () => {
    expect(planCollect(viewOf({ cells: furnace }), { kind: 'collect', at }, env)).toEqual({ ok: false, reason: 'gone' });
    const two = withSim(viewOf({ cells: furnace }), { machines: [batch({ daysLeft: 0, qty: 2, output: 'ember_bar' })] });
    expect(planCollect(two, { kind: 'collect', at }, env)).toMatchObject({ ok: true, plan: { changes: { items: { ember_bar: 2 } } } });
  });

  it('a furnace with a batch in it cannot be removed; an empty one can', () => {
    const busy = withSim(viewOf({ cells: furnace }), { machines: [batch()] });
    expect(planRemove(busy, { kind: 'remove', at }, env)).toEqual({ ok: false, reason: 'busy' });
    const empty = viewOf({ cells: furnace });
    expect(planRemove(empty, { kind: 'remove', at }, env)).toMatchObject({ ok: true, plan: { changes: { items: { furnace: 1 } } } });
  });
});

describe('the structures and recipes agree (P17.25)', () => {
  it('every station names a block, every crafting recipe has a block of its station, machines are placeable', () => {
    for (const block of BLOCKS.byId.values()) {
      if (block.station === undefined) continue;
      expect(block.placeable, block.id).toBe(true);
      expect(block.layer, block.id).toBe('decor');
    }
    for (const recipe of data.recipes) {
      expect(
        [...BLOCKS.byId.values()].some((b) => b.station === recipe.station && b.placeable),
        `${recipe.id} at ${recipe.station}`,
      ).toBe(true);
      if (recipe.station === 'furnace') expect(recipe.days, recipe.id).toBeGreaterThan(0);
    }
    for (const block of BLOCKS.byId.values()) {
      if (block.machine) expect(data.items.some((item) => item.block === block.id && item.kind === 'machine'), block.id).toBe(true);
    }
  });

  it('every housing names a building of its own kind and capacity, and every animal has a housing of its kind', () => {
    for (const block of BLOCKS.byId.values()) {
      if (block.housing === undefined) continue;
      expect(data.items.some((item) => item.block === block.id && item.kind === 'building'), block.id).toBe(true);
      expect(block.capacity).toBeGreaterThan(0);
    }
    for (const animal of data.animals) {
      expect(
        [...BLOCKS.byId.values()].some((b) => b.housing === animal.housing),
        animal.id,
      ).toBe(true);
      expect(data.itemsById.get(animal.feed)?.kind, animal.id).toBe('feed');
      expect(data.itemsById.get(animal.product)?.kind, animal.id).toBe('product');
      expect(data.itemsById.get(animal.id)?.kind, animal.id).toBe('animal');
    }
  });
});
