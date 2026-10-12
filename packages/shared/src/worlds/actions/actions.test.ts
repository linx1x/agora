import { describe, expect, it } from 'vitest';
import { loadGameData } from '../gamedata';
import { ACTION_KINDS, WORLD_REFUSALS, changesAreEmpty, noChanges } from './kinds';
import { VISITOR_RULES, canDo, grantsOf } from './permissions';
import { INVENTORY_SLOTS, applyInventoryChanges, countOf, emptyInventory, totalsOf, type Inventory } from './inventory';
import { REACH_CELLS, cellsAround, chunkOfCell, chunksCovering, inReach, localIndexOf } from './plan';
import { WORLD_CELL_PX, CHUNK_SIZE } from '../constants';

const game = loadGameData();
const stackOf = (id: string) => game.itemsById.get(id)?.stack;
const WORLD = { ownerId: 'owner', settings: {} };

describe('action vocabulary', () => {
  it('gives every action kind a visitor rule, and every refusal is a lower_snake word', () => {
    expect(Object.keys(VISITOR_RULES).sort()).toEqual([...ACTION_KINDS].sort());
    for (const reason of WORLD_REFUSALS) expect(reason).toMatch(/^[a-z_]+$/);
  });

  it('treats an empty change record as no change', () => {
    expect(changesAreEmpty(noChanges())).toBe(true);
    expect(changesAreEmpty({ ...noChanges(), money: 1 })).toBe(false);
  });
});

describe('canDo (visitor matrix)', () => {
  it('lets the owner do every kind, and a visitor only the open kinds', () => {
    for (const kind of ACTION_KINDS) expect(canDo(WORLD, 'owner', kind)).toBe(true);
    expect(canDo(WORLD, 'guest', 'water')).toBe(true);
    expect(canDo(WORLD, 'guest', 'till')).toBe(false);
    expect(canDo(WORLD, 'guest', 'chop')).toBe(false);
  });

  it('opens a choice kind to a visitor only when the owner granted it', () => {
    expect(canDo(WORLD, 'guest', 'harvest')).toBe(false);
    const granted = { ownerId: 'owner', settings: { grants: ['harvest', 'not_a_kind'] } };
    expect(canDo(granted, 'guest', 'harvest')).toBe(true);
    expect(canDo(granted, 'guest', 'plant')).toBe(false);
  });

  it('ignores grants that are not a list of known kinds', () => {
    expect(grantsOf({ grants: 'harvest' })).toEqual([]);
    expect(grantsOf({ grants: [1, 'till', 'bogus'] })).toEqual(['till']);
  });
});

describe('inventory arithmetic', () => {
  const kit: Inventory = { items: { hoe_1: 1, dawn_radish_seed: 6 }, money: 500 };

  it('adds and takes stacks, and drops a stack that reaches zero', () => {
    const r = applyInventoryChanges(kit, { items: { dawn_radish_seed: -6 }, money: 0 }, stackOf);
    expect(r).toEqual({ ok: true, inventory: { items: { hoe_1: 1 }, money: 500 } });
  });

  it('refuses a take the inventory cannot cover, and changes nothing', () => {
    expect(applyInventoryChanges(kit, { items: { dawn_radish_seed: -7 }, money: 0 }, stackOf)).toEqual({
      ok: false,
      reason: 'missing',
    });
    expect(applyInventoryChanges(kit, { items: {}, money: -501 }, stackOf)).toEqual({ ok: false, reason: 'missing' });
  });

  it('refuses an unknown item and a stack past its limit', () => {
    expect(applyInventoryChanges(kit, { items: { nope: 1 }, money: 0 }, stackOf)).toEqual({ ok: false, reason: 'invalid' });
    const limit = stackOf('dawn_radish_seed') ?? 99;
    expect(applyInventoryChanges(kit, { items: { dawn_radish_seed: limit }, money: 0 }, stackOf)).toEqual({
      ok: false,
      reason: 'full',
    });
  });

  it('refuses a new stack past the slot count', () => {
    const ids = game.items.map((item) => item.id).slice(0, INVENTORY_SLOTS);
    const full: Record<string, number> = Object.fromEntries(ids.map((id) => [id, 1]));
    expect(applyInventoryChanges({ items: full, money: 0 }, { items: {}, money: 0 }, stackOf).ok).toBe(true);
    const extra = game.items[INVENTORY_SLOTS]!.id;
    expect(applyInventoryChanges({ items: full, money: 0 }, { items: { [extra]: 1 }, money: 0 }, stackOf)).toEqual({
      ok: false,
      reason: 'full',
    });
  });

  it('conserves items and money across a sequence of grants and takes', () => {
    let inv = emptyInventory();
    let granted = { items: 0, money: 0 };
    const steps: { items: Record<string, number>; money: number }[] = [
      { items: { stone: 5 }, money: 10 },
      { items: { stone: -2 }, money: -4 },
      { items: { fiber: 3, stone: -3 }, money: 0 },
      { items: { stone: -9 }, money: 0 },
    ];
    for (const step of steps) {
      const r = applyInventoryChanges(inv, step, stackOf);
      if (!r.ok) continue;
      inv = r.inventory;
      granted = { items: granted.items + Object.values(step.items).reduce((a, b) => a + b, 0), money: granted.money + step.money };
    }
    expect(totalsOf(inv)).toEqual(granted);
    expect(countOf(inv, 'stone')).toBe(0);
  });
});

describe('plan helpers', () => {
  it('reaches a cell whose centre is within 1.5 cells of the feet, and no further', () => {
    const at = { x: 10, y: 10 };
    const centre = (10.5 * WORLD_CELL_PX);
    expect(inReach(centre, 10.5 * WORLD_CELL_PX, at)).toBe(true);
    expect(inReach(centre + REACH_CELLS * WORLD_CELL_PX - 1, 10.5 * WORLD_CELL_PX, at)).toBe(true);
    expect(inReach(centre + 2 * WORLD_CELL_PX, 10.5 * WORLD_CELL_PX, at)).toBe(false);
  });

  it('lists the square around a cell in a fixed order', () => {
    expect(cellsAround({ x: 0, y: 0 }, 0)).toEqual([{ x: 0, y: 0 }]);
    expect(cellsAround({ x: 0, y: 0 }, 1)).toHaveLength(9);
    expect(cellsAround({ x: 0, y: 0 }, 1)[0]).toEqual({ x: -1, y: -1 });
  });

  it('maps negative cells to the chunk that contains them, with a local index inside it', () => {
    expect(chunkOfCell(-1, -1)).toEqual({ cx: -1, cy: -1 });
    expect(localIndexOf(-1, -1)).toBe(String((CHUNK_SIZE - 1) * CHUNK_SIZE + (CHUNK_SIZE - 1)));
    expect(localIndexOf(33, 0)).toBe('1');
  });

  it('lists each chunk that covers the cells once', () => {
    const chunks = chunksCovering(cellsAround({ x: 32, y: 32 }, 1));
    expect(chunks).toHaveLength(4);
  });
});
