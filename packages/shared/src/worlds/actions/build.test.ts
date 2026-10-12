import { describe, expect, it } from 'vitest';
import { BLOCKS, getBlock } from '../registry';
import { loadGameData } from '../gamedata/load';
import { cellKey, emptySim } from '../gamedata/state';
import { simulateDays } from '../clock';
import { envOf, viewOf } from './fixtures';
import { CHEST_SLOTS, planLower, planOpen, planPlaceBlock, planRaise, planRemove, planStash, planTake } from './build';
import { ACTION_PLANNERS } from './planners';
import type { ActionView } from './plan';
import type { WorldCell } from '../cells';

const data = loadGameData();
const env = envOf(data);
const at = { x: 5, y: 5 };
/** A tree on the cell: decor that a player did not place. */
const TREE: Partial<WorldCell> = { decor: "oak_tree", solid: true, walkable: false };
const key = cellKey(5, 5);

/** A view with a chest (or any sim override) on the cell. */
function withSim(view: ActionView, sim: Partial<ActionView['sim']>): ActionView {
  return { ...view, sim: { ...view.sim, ...sim } };
}

describe('placing a block from the bag (P17.24)', () => {
  it('a wall stands on the cell and one wall leaves the bag', () => {
    const out = planPlaceBlock(viewOf({ items: { wood_wall: 2 } }), { kind: 'place', at, item: 'wood_wall' }, env);
    expect(out).toMatchObject({ ok: true, plan: { changes: { items: { wood_wall: -1 } }, edits: [{ x: 5, y: 5, patch: { decor: 'wood_wall' } }] } });
  });

  it('a floor changes the ground block, not the decor', () => {
    const out = planPlaceBlock(viewOf({ items: { wood_floor: 1 } }), { kind: 'place', at, item: 'wood_floor' }, env);
    expect(out).toMatchObject({ ok: true, plan: { edits: [{ patch: { block: 'wood_floor' } }] } });
  });

  it('a chest gets an empty contents entry on its cell', () => {
    const out = planPlaceBlock(viewOf({ items: { chest: 1 } }), { kind: 'place', at, item: 'chest' }, env);
    expect(out.ok && out.plan.sim.chests?.[key]).toEqual({});
  });

  it('refuses: not a block item, none in the bag, someone on the cell, water, a plot, a decor already there', () => {
    expect(planPlaceBlock(viewOf({ items: { hoe_1: 1 } }), { kind: 'place', at, item: 'hoe_1' }, env)).toEqual({ ok: false, reason: 'invalid' });
    expect(planPlaceBlock(viewOf(), { kind: 'place', at, item: 'wood_wall' }, env)).toEqual({ ok: false, reason: 'missing' });
    const stood = viewOf({ items: { wood_wall: 1 }, occupied: [at] });
    expect(planPlaceBlock(stood, { kind: 'place', at, item: 'wood_wall' }, env)).toEqual({ ok: false, reason: 'occupied' });
    const water = viewOf({ items: { wood_wall: 1 }, cells: { [key]: { block: 'water', liquid: true, walkable: false } } });
    expect(planPlaceBlock(water, { kind: 'place', at, item: 'wood_wall' }, env)).toEqual({ ok: false, reason: 'invalid' });
    const plot = viewOf({ items: { wood_wall: 1 }, plots: { [key]: { tilled: true, wateredOn: 0, crop: null, sprinkler: null, fertilizer: null } } });
    expect(planPlaceBlock(plot, { kind: 'place', at, item: 'wood_wall' }, env)).toEqual({ ok: false, reason: 'invalid' });
    const full = viewOf({ items: { wood_wall: 1 }, cells: { [key]: TREE } });
    expect(planPlaceBlock(full, { kind: 'place', at, item: 'wood_wall' }, env)).toEqual({ ok: false, reason: 'gone' });
  });

  it('the place action sends a block item here and a sprinkler to the sprinkler rule', () => {
    const placed = ACTION_PLANNERS.place!(viewOf({ items: { wood_wall: 1 } }), { kind: 'place', at, item: 'wood_wall' }, env);
    expect(placed.ok && placed.plan.edits[0]?.patch).toEqual({ decor: 'wood_wall' });
    const notTilled = ACTION_PLANNERS.place!(viewOf({ items: { sprinkler_1: 1 } }), { kind: 'place', at, item: 'sprinkler_1' }, env);
    expect(notTilled).toEqual({ ok: false, reason: 'invalid' });
  });
});

describe('removing a placed block into the bag (P17.24)', () => {
  it('a wall goes back into the bag, and its cell is bare ground', () => {
    const out = planRemove(viewOf({ cells: { [key]: { decor: 'wood_wall', solid: true, walkable: false } } }), { kind: 'remove', at }, env);
    expect(out).toMatchObject({ ok: true, plan: { changes: { items: { wood_wall: 1 } }, edits: [{ patch: { decor: '' } }] } });
  });

  it('refuses: nothing there, a tree or a boulder (not placed), a chest with items in it', () => {
    expect(planRemove(viewOf(), { kind: 'remove', at }, env)).toEqual({ ok: false, reason: 'gone' });
    const tree = viewOf({ cells: { [key]: { decor: 'oak_tree', solid: true, walkable: false } } });
    expect(planRemove(tree, { kind: 'remove', at }, env)).toEqual({ ok: false, reason: 'invalid' });
    const full = withSim(viewOf({ cells: { [key]: { decor: 'chest', solid: true, walkable: false } } }), { chests: { [key]: { dawn_radish_seed: 2 } } });
    expect(planRemove(full, { kind: 'remove', at }, env)).toEqual({ ok: false, reason: 'invalid' });
  });

  it('an empty chest comes back with its entry gone', () => {
    const chest = withSim(viewOf({ cells: { [key]: { decor: 'chest', solid: true, walkable: false } } }), { chests: { [key]: {} } });
    const out = planRemove(chest, { kind: 'remove', at }, env);
    expect(out).toMatchObject({ ok: true, plan: { changes: { items: { chest: 1 } } } });
    expect(out.ok && out.plan.sim.chests?.[key]).toBeUndefined();
  });
});

describe('the shovel raises and lowers the ground by one level (P17.24)', () => {
  const shovel = { shovel_1: 1 };
  it('raises a cell one level and costs the shovel energy', () => {
    const out = planRaise(viewOf({ items: shovel }), { kind: 'raise', at, item: 'shovel_1' }, env);
    expect(out).toMatchObject({ ok: true, plan: { changes: { energy: -3 }, edits: [{ x: 5, y: 5, patch: { level: 1 } }] } });
  });

  it('lowers a cell one level', () => {
    const out = planLower(viewOf({ items: shovel, cells: { [key]: { level: 2 } } }), { kind: 'lower', at, item: 'shovel_1' }, env);
    expect(out).toMatchObject({ ok: true, plan: { edits: [{ patch: { level: 1 } }] } });
  });

  it('refuses: another tool, no shovel in the bag, not enough energy', () => {
    expect(planRaise(viewOf({ items: { hoe_1: 1 } }), { kind: 'raise', at, item: 'hoe_1' }, env)).toEqual({ ok: false, reason: 'tool' });
    expect(planRaise(viewOf(), { kind: 'raise', at, item: 'shovel_1' }, env)).toEqual({ ok: false, reason: 'missing' });
    expect(planRaise(viewOf({ items: shovel, energy: 2 }), { kind: 'raise', at, item: 'shovel_1' }, env)).toEqual({ ok: false, reason: 'energy' });
  });

  it('refuses the top and bottom levels, water, decor, plots and someone standing on the cell', () => {
    expect(planRaise(viewOf({ items: shovel, cells: { [key]: { level: 7 } } }), { kind: 'raise', at, item: 'shovel_1' }, env)).toEqual({ ok: false, reason: 'invalid' });
    expect(planLower(viewOf({ items: shovel }), { kind: 'lower', at, item: 'shovel_1' }, env)).toEqual({ ok: false, reason: 'invalid' });
    expect(planRaise(viewOf({ items: shovel, cells: { [key]: { block: 'water', liquid: true } } }), { kind: 'raise', at, item: 'shovel_1' }, env)).toEqual({ ok: false, reason: 'invalid' });
    expect(planRaise(viewOf({ items: shovel, cells: { [key]: TREE } }), { kind: 'raise', at, item: 'shovel_1' }, env)).toEqual({ ok: false, reason: 'invalid' });
    const plot = viewOf({ items: shovel, plots: { [key]: { tilled: true, wateredOn: 0, crop: null, sprinkler: null, fertilizer: null } } });
    expect(planRaise(plot, { kind: 'raise', at, item: 'shovel_1' }, env)).toEqual({ ok: false, reason: 'invalid' });
    expect(planRaise(viewOf({ items: shovel, occupied: [at] }), { kind: 'raise', at, item: 'shovel_1' }, env)).toEqual({ ok: false, reason: 'occupied' });
  });

  it('refuses a step that would trap a walkable neighbour: a wall of two levels is not built', () => {
    // the cell at level 1 next to flat ground: raising it to 2 leaves the flat neighbours two levels down
    const view = viewOf({ items: shovel, cells: { [key]: { level: 1 } } });
    expect(planRaise(view, { kind: 'raise', at, item: 'shovel_1' }, env)).toEqual({ ok: false, reason: 'trap' });
    // a flat step of one level is fine
    expect(planRaise(viewOf({ items: shovel }), { kind: 'raise', at, item: 'shovel_1' }, env).ok).toBe(true);
  });

  it('allows a two-level step when the neighbour is a ramp', () => {
    // the three other neighbours are walls, so only the ramp cell is tested
    const wall: Partial<WorldCell> = { solid: true, walkable: false };
    const cells = { [key]: { level: 1 }, '6,5': { level: 0, ramp: true, decor: 'stone_stairs', solid: false, walkable: true }, '4,5': wall, '5,4': wall, '5,6': wall };
    const out = planRaise(viewOf({ items: shovel, cells }), { kind: 'raise', at, item: 'shovel_1' }, env);
    expect(out.ok).toBe(true);
  });
});

describe('chests hold items on the farm layer (P17.24)', () => {
  const chestCell = { [key]: { decor: 'chest', solid: true, walkable: false } };

  it('opening a chest shows its contents to the actor alone and changes nothing', () => {
    const view = withSim(viewOf({ cells: chestCell }), { chests: { [key]: { dawn_radish_seed: 3 } } });
    const out = planOpen(view, { kind: 'open', at }, env);
    expect(out).toMatchObject({ ok: true, plan: { changes: { items: {} }, edits: [], reply: { chest: { at, items: { dawn_radish_seed: 3 } } } } });
  });

  it('refuses to open anything that is not a chest', () => {
    expect(planOpen(viewOf(), { kind: 'open', at }, env)).toEqual({ ok: false, reason: 'gone' });
    expect(planOpen(viewOf({ cells: { [key]: { decor: 'oak_tree', solid: true, walkable: false } } }), { kind: 'open', at }, env)).toEqual({ ok: false, reason: 'invalid' });
  });

  it('stashes the whole stack from the hand, and takes a stack back out', () => {
    const view = withSim(viewOf({ items: { dawn_radish_seed: 6 }, cells: chestCell }), { chests: { [key]: {} } });
    const put = planStash(view, { kind: 'stash', at, item: 'dawn_radish_seed' }, env);
    expect(put).toMatchObject({ ok: true, plan: { changes: { items: { dawn_radish_seed: -6 } }, reply: { chest: { items: { dawn_radish_seed: 6 } } } } });
    if (!put.ok) throw new Error('stash refused');
    const after = { ...view, inventory: { items: {}, money: 0 }, sim: put.plan.sim };
    const got = planTake(after, { kind: 'take', at, item: 'dawn_radish_seed' }, env);
    expect(got).toMatchObject({ ok: true, plan: { changes: { items: { dawn_radish_seed: 6 } } } });
  });

  it('refuses a stash with nothing in the bag, and a take of what the chest no longer has', () => {
    const view = withSim(viewOf({ cells: chestCell }), { chests: { [key]: {} } });
    expect(planStash(view, { kind: 'stash', at, item: 'dawn_radish_seed' }, env)).toEqual({ ok: false, reason: 'missing' });
    expect(planTake(view, { kind: 'take', at, item: 'dawn_radish_seed' }, env)).toEqual({ ok: false, reason: 'gone' });
  });

  it('a new stack is refused when the chest has all its slots, and an old stack still goes in', () => {
    const full: Record<string, number> = {};
    for (let i = 0; i < CHEST_SLOTS; i++) full[`item_${i}`] = 1;
    const view = withSim(viewOf({ items: { dawn_radish_seed: 1, item_0: 1 }, cells: chestCell }), { chests: { [key]: full } });
    expect(planStash(view, { kind: 'stash', at, item: 'dawn_radish_seed' }, env)).toEqual({ ok: false, reason: 'full' });
    expect(planStash(view, { kind: 'stash', at, item: 'item_0' }, env).ok).toBe(true);
  });

  it('conserves items: the bag and the chest together hold the same stacks after a stash and a take', () => {
    const start = withSim(viewOf({ items: { dawn_radish_seed: 4, clover_bulb_seed: 2 }, cells: chestCell }), { chests: { [key]: { clover_bulb_seed: 1 } } });
    const total = (inv: Record<string, number>, chest: Record<string, number>) => {
      const sum: Record<string, number> = {};
      for (const [k, n] of [...Object.entries(inv), ...Object.entries(chest)]) sum[k] = (sum[k] ?? 0) + n;
      return sum;
    };
    const before = total(start.inventory.items, start.sim.chests![key]!);
    const put = planStash(start, { kind: 'stash', at, item: 'dawn_radish_seed' }, env);
    if (!put.ok) throw new Error('stash refused');
    // the bag after the stash: the stash takes the whole stack out of it
    const bag1: Record<string, number> = { ...start.inventory.items, dawn_radish_seed: 0 };
    const mid = { ...start, inventory: { items: bag1, money: 0 }, sim: put.plan.sim };
    const took = planTake(mid, { kind: 'take', at, item: 'clover_bulb_seed' }, env);
    if (!took.ok) throw new Error('take refused');
    const bag2: Record<string, number> = { ...bag1, clover_bulb_seed: (bag1.clover_bulb_seed ?? 0) + (took.plan.changes.items.clover_bulb_seed ?? 0) };
    expect(total(bag2, took.plan.sim.chests![key]!)).toEqual(before);
  });
});

describe('the build rules and the data agree (P17.24)', () => {
  it('every item with a block names a placeable block', () => {
    for (const item of data.items) {
      if (item.block === undefined) continue;
      expect(getBlock(BLOCKS, item.block), item.id).toBeDefined();
      expect(getBlock(BLOCKS, item.block)?.placeable, item.id).toBe(true);
    }
  });

  it('every placeable decor block is an item, except the starter fittings', () => {
    // fittings of the starter stamp (P17.10, FIX-1): placed by the stamp, never bought or crafted
    const starterOnly = new Set(['shipping_bin', 'shop_board', 'door']);
    for (const block of BLOCKS.byId.values()) {
      if (!block.placeable || block.layer !== 'decor' || starterOnly.has(block.id)) continue;
      expect(data.items.some((item) => item.block === block.id), block.id).toBe(true);
    }
  });

  it('a chest survives the night: a catch-up over days keeps its contents', () => {
    const state = { ...emptySim(1), chests: { [key]: { dawn_radish_seed: 3 } } };
    const later = simulateDays(state, 1, 4, data, 1);
    expect(later.chests).toEqual({ [key]: { dawn_radish_seed: 3 } });
  });
});
