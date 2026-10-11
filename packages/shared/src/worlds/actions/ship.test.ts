import { describe, expect, it } from 'vitest';
import { loadGameData } from '../gamedata/load';
import { envOf, viewOf } from './fixtures';
import { SHIPPABLE_KINDS, planShip, sellShipping, shipUnitPrice } from './ship';
import type { ActionView } from './plan';

const data = loadGameData();
const env = envOf(data);
const at = { x: 5, y: 5 };
const BIN = { '5,5': { decor: 'shipping_bin', solid: true, walkable: false } };
const CROP = 'dawn_radish';
const VALUE = data.itemsById.get(CROP)!.value;

function withBin(view: ActionView, shipping: Record<string, number>): ActionView {
  return { ...view, sim: { ...view.sim, shipping } };
}

describe('the shipping bin takes produce from the bag (P17.26)', () => {
  it('a whole stack leaves the bag and sits in the bin; the same stack adds to what is there', () => {
    expect(planShip(viewOf({ items: { [CROP]: 3 }, cells: BIN }), { kind: 'ship', at, item: CROP }, env)).toMatchObject({
      ok: true,
      plan: { changes: { items: { [CROP]: -3 } }, edits: [], sim: { shipping: { [CROP]: 3 } } },
    });
    const more = withBin(viewOf({ items: { [CROP]: 2 }, cells: BIN }), { [CROP]: 3 });
    expect(planShip(more, { kind: 'ship', at, item: CROP }, env)).toMatchObject({
      ok: true,
      plan: { changes: { items: { [CROP]: -2 } }, sim: { shipping: { [CROP]: 5 } } },
    });
  });

  it('keeps the quality of a stack: a gold stack is its own stack in the bin', () => {
    const gold = `${CROP}~2`;
    expect(planShip(viewOf({ items: { [gold]: 1 }, cells: BIN }), { kind: 'ship', at, item: gold }, env)).toMatchObject({
      ok: true,
      plan: { changes: { items: { [gold]: -1 } }, sim: { shipping: { [gold]: 1 } } },
    });
  });

  it('refuses: no bin on the cell and an item that is not produce (invalid), a stack not in the bag (missing)', () => {
    expect(planShip(viewOf({ items: { [CROP]: 3 } }), { kind: 'ship', at, item: CROP }, env)).toEqual({ ok: false, reason: 'invalid' });
    expect(planShip(viewOf({ items: { dawn_radish_seed: 2 }, cells: BIN }), { kind: 'ship', at, item: 'dawn_radish_seed' }, env)).toEqual({
      ok: false,
      reason: 'invalid',
    });
    expect(planShip(viewOf({ items: { hoe_1: 1 }, cells: BIN }), { kind: 'ship', at, item: 'hoe_1' }, env)).toEqual({ ok: false, reason: 'invalid' });
    expect(planShip(viewOf({ cells: BIN }), { kind: 'ship', at, item: CROP }, env)).toEqual({ ok: false, reason: 'missing' });
  });
});

describe('the price at the bin (P17.26, research section 15)', () => {
  it('pays half the base value, rounded down, times 1.25, 1.5 and 2 for silver, gold and best', () => {
    expect(shipUnitPrice(100, 0)).toBe(50);
    expect(shipUnitPrice(100, 1)).toBe(62);
    expect(shipUnitPrice(100, 2)).toBe(75);
    expect(shipUnitPrice(100, 4)).toBe(100);
    expect(shipUnitPrice(1, 4)).toBe(0);
  });

  it('ships produce only: crops, forage, fish, products, materials and food; not seeds, tools, buildings, animals or machines', () => {
    expect(SHIPPABLE_KINDS).toEqual(expect.arrayContaining(['crop', 'forage', 'fish', 'product', 'material', 'food']));
    for (const kind of ['seed', 'tool', 'building', 'animal', 'machine', 'fertilizer', 'feed']) {
      expect(SHIPPABLE_KINDS, kind).not.toContain(kind);
    }
  });
});

describe('the bin is sold at the day change (P17.26)', () => {
  it('sums the bin stack by stack, at each stack\'s quality, and counts the units; an empty bin sells for nothing', () => {
    const bin = { [CROP]: 3, [`${CROP}~4`]: 1 };
    expect(sellShipping(bin, data)).toEqual({ money: 3 * shipUnitPrice(VALUE, 0) + shipUnitPrice(VALUE, 4), units: 4 });
    expect(sellShipping({}, data)).toBeNull();
    expect(sellShipping({ [CROP]: 0 }, data)).toBeNull();
  });

  it('a stack whose item is not shipped sells for nothing and is not counted', () => {
    expect(sellShipping({ hoe_1: 2, [CROP]: 1 }, data)).toEqual({ money: shipUnitPrice(VALUE, 0), units: 1 });
  });
});
