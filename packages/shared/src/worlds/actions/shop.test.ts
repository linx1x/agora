import { describe, expect, it } from 'vitest';
import { loadGameData } from '../gamedata/load';
import { envOf, viewOf } from './fixtures';
import { planBuy } from './shop';

const data = loadGameData();
const env = envOf(data);
const at = { x: 5, y: 5 };
const key = '5,5';
const BOARD = { [key]: { decor: 'shop_board', solid: true, walkable: false } };
const PRICE = data.itemsById.get('dawn_radish_seed')!.buy!;

describe('the shop board sells an item for money (P17.25)', () => {
  it('a seed leaves the price in money and comes into the bag', () => {
    const out = planBuy(viewOf({ money: PRICE, cells: BOARD }), { kind: 'buy', at, item: 'dawn_radish_seed' }, env);
    expect(out).toMatchObject({ ok: true, plan: { changes: { items: { dawn_radish_seed: 1 }, money: -PRICE }, edits: [] } });
  });

  it('sells an animal too (limited stock is still sold, at its stable price)', () => {
    const hen = data.itemsById.get('plume_hen')!.buy!;
    const out = planBuy(viewOf({ money: hen, cells: BOARD }), { kind: 'buy', at, item: 'plume_hen' }, env);
    expect(out).toMatchObject({ ok: true, plan: { changes: { items: { plume_hen: 1 }, money: -hen } } });
  });

  it('refuses: no shop board on the cell, an item that is not for sale, an item it does not know, too little money', () => {
    expect(planBuy(viewOf({ money: 999 }), { kind: 'buy', at, item: 'dawn_radish_seed' }, env)).toEqual({ ok: false, reason: 'invalid' });
    expect(planBuy(viewOf({ money: 999, cells: BOARD }), { kind: 'buy', at, item: 'softwood' }, env)).toEqual({ ok: false, reason: 'invalid' });
    expect(planBuy(viewOf({ money: 999, cells: BOARD }), { kind: 'buy', at, item: 'hoe_2' }, env)).toEqual({ ok: false, reason: 'invalid' });
    expect(planBuy(viewOf({ money: 999, cells: BOARD }), { kind: 'buy', at, item: 'nothing_here' }, env)).toEqual({ ok: false, reason: 'invalid' });
    expect(planBuy(viewOf({ money: PRICE - 1, cells: BOARD }), { kind: 'buy', at, item: 'dawn_radish_seed' }, env)).toEqual({ ok: false, reason: 'money' });
  });
});
