import { describe, expect, it } from 'vitest';
import { loadGameData } from './gamedata/load';
import { stockOf } from './actions/shop';
import { giftNpcOf, giftable, officeDayOf, planOfficeBuy } from './office';

const data = loadGameData();

describe('the office side of shop and friendship (P17.26b)', () => {
  it('counts Québec calendar days: the day changes at local midnight, not at UTC midnight', () => {
    // 2026-10-11 23:30 in Toronto (UTC-4) is already 2026-10-12 03:30 UTC
    const lateEvening = Date.UTC(2026, 9, 12, 3, 30);
    const nextMorning = Date.UTC(2026, 9, 12, 13, 0);
    expect(officeDayOf(nextMorning) - officeDayOf(lateEvening)).toBe(1);
    expect(officeDayOf(Date.UTC(2026, 9, 11, 14, 0))).toBe(officeDayOf(lateEvening));
    expect(officeDayOf(Date.UTC(1970, 0, 1, 12, 0))).toBe(1);
  });

  it('knows the three characters by their id, with or without the npc: prefix, and nobody else', () => {
    expect(giftNpcOf('npc:zoe')).toBe('zoe');
    expect(giftNpcOf('theo')).toBe('theo');
    expect(giftNpcOf('npc:alice')).toBeNull();
  });

  it('takes crops, food and the like as gifts, never tools, buildings or account-bound items', () => {
    const kinds = (kind: string) => data.items.filter((i) => i.kind === kind);
    expect(
      kinds('crop').every((i) => giftable(data, i.id) === (i.category !== 'account-bound')),
    ).toBe(true);
    expect(kinds('tool').some((i) => giftable(data, i.id))).toBe(false);
    expect(kinds('building').some((i) => giftable(data, i.id))).toBe(false);
    const crop = kinds('crop')[0]!;
    expect(giftable(data, `${crop.id}~2`)).toBe(true); // a quality stack
    expect(giftable(data, 'no_such_item')).toBe(false);
  });

  it('sells what a world board sells, at the same stable price, and refuses short money', () => {
    const first = stockOf(data)[0]!;
    const plan = planOfficeBuy(data, first.price, first.id);
    expect(plan).toEqual({
      ok: true,
      changes: { items: { [first.id]: 1 }, money: -first.price, energy: 0, xp: {} },
    });
    expect(planOfficeBuy(data, first.price - 1, first.id)).toEqual({ ok: false, reason: 'money' });
    const tool = data.items.find((i) => i.kind === 'tool')!;
    expect(planOfficeBuy(data, 1_000_000, tool.id)).toEqual({ ok: false, reason: 'invalid' });
  });
});
