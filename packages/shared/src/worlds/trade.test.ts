import { describe, expect, it } from 'vitest';
import { loadGameData } from './gamedata';
import { TRADE_LIMITED_MAX, TRADE_MONEY_MAX, TRADE_STACKS_MAX, checkOffer, swapChanges, tradeable } from './trade';

const data = loadGameData();
const of = (category: string, kind?: string) =>
  data.items.find((i) => i.category === category && (!kind || i.kind === kind))!.id;

describe('trade rules (P17.29)', () => {
  it('open items trade freely, limited ones up to the cap, restricted and account-bound never', () => {
    expect(checkOffer(data, { items: { [of('open', 'crop')]: 50 }, money: 10 })).toEqual({ ok: true });
    expect(checkOffer(data, { items: { [of('limited')]: TRADE_LIMITED_MAX }, money: 0 })).toEqual({ ok: true });
    expect(checkOffer(data, { items: { [of('limited')]: TRADE_LIMITED_MAX + 1 }, money: 0 })).toEqual({ ok: false, reason: 'limit' });
    expect(checkOffer(data, { items: { [of('restricted', 'tool')]: 1 }, money: 0 })).toEqual({ ok: false, reason: 'restricted' });
    expect(tradeable(data, of('restricted'))).toBe(false);
    expect(tradeable(data, `${of('open', 'crop')}~2`)).toBe(true);
  });

  it('refuses odd numbers, unknown items, too much money and too many stacks', () => {
    const crop = of('open', 'crop');
    expect(checkOffer(data, { items: { [crop]: 0 }, money: 0 }).ok).toBe(false);
    expect(checkOffer(data, { items: { [crop]: 1.5 }, money: 0 }).ok).toBe(false);
    expect(checkOffer(data, { items: { nope: 1 }, money: 0 })).toEqual({ ok: false, reason: 'invalid' });
    expect(checkOffer(data, { items: {}, money: TRADE_MONEY_MAX + 1 })).toEqual({ ok: false, reason: 'invalid' });
    expect(checkOffer(data, { items: {}, money: -1 })).toEqual({ ok: false, reason: 'invalid' });
    const many = Object.fromEntries(
      data.items.filter((i) => i.category === 'open').slice(0, TRADE_STACKS_MAX + 1).map((i) => [i.id, 1]),
    );
    expect(checkOffer(data, { items: many, money: 0 })).toEqual({ ok: false, reason: 'limit' });
  });

  it('the swap: what one side gives leaves, what it gets comes in, and the same item nets out', () => {
    expect(swapChanges({ items: { a: 2, b: 1 }, money: 5 }, { items: { b: 1, c: 3 }, money: 20 })).toEqual({
      items: { a: -2, c: 3 },
      money: 15,
    });
  });
});
