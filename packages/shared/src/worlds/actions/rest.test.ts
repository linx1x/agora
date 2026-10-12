import { describe, expect, it } from 'vitest';
import { C2S } from '../../protocol';
import { loadGameData } from '../gamedata/load';
import { cellKey } from '../gamedata/state';
import { envOf, viewOf } from './fixtures';
import { qualityOfStack, stackKey } from './farm';
import { bedShare, exhaustedShare, foodRestore, passOutFine, passOutRest, planEat, planSleep, restoredEnergy, settleDay, type EnergyState } from './rest';

const data = loadGameData();
const MAX = data.progression.energy.max;
const food = data.items.find((i) => i.kind === 'food' && i.edibility !== undefined)!;
const bedAt = { x: 2, y: 2 };
const bedCells = { [cellKey(bedAt.x, bedAt.y)]: { decor: 'bed' } };
const state = (over: Partial<EnergyState> = {}): EnergyState => ({ energy: 100, day: 3, rest: null, ...over });

describe('the bed restore (research section 9, P17.23)', () => {
  it('restores all the energy in bed by midnight', () => {
    expect(bedShare(22, 0)).toBe(1);
    expect(bedShare(23, 59)).toBe(1);
    expect(bedShare(0, 0)).toBe(1);
  });

  it('loses 2.5 points per 10 clock minutes after midnight and half at 02:00', () => {
    expect(bedShare(0, 10)).toBeCloseTo(0.975, 10);
    expect(bedShare(1, 0)).toBeCloseTo(0.75, 10);
    expect(bedShare(2, 0)).toBeCloseTo(0.5, 10);
  });

  it('halves the restore when the person goes to bed with no energy left', () => {
    expect(exhaustedShare(0)).toBe(0.5);
    expect(exhaustedShare(1)).toBe(1);
  });

  it('never restores below 1 or above max', () => {
    expect(restoredEnergy(MAX, 0)).toBe(1);
    expect(restoredEnergy(MAX, 0.5)).toBe(135);
    expect(restoredEnergy(MAX, 2)).toBe(MAX);
  });
});

describe('settling the day (rollover, P17.23)', () => {
  it('leaves an energy state alone when it is already settled for today', () => {
    const settled = state({ day: 4 });
    expect(settleDay(settled, 4, MAX)).toBe(settled);
  });

  it('a set rest restores at the rollover and the rest is over', () => {
    const slept = state({ energy: 0, rest: { fraction: 1 } });
    expect(settleDay(slept, 4, MAX)).toEqual({ energy: MAX, day: 4, rest: null });
  });

  it('a late bed restores less', () => {
    const late = state({ energy: 10, rest: { fraction: bedShare(1, 0) } });
    expect(settleDay(late, 4, MAX).energy).toBe(Math.round(MAX * 0.75));
  });

  it('nobody who set a rest passes out at the rollover: half the energy, a quarter at 0', () => {
    expect(settleDay(state({ energy: 100 }), 4, MAX).energy).toBe(135);
    expect(settleDay(state({ energy: 0 }), 4, MAX).energy).toBe(Math.round(MAX * 0.25));
    expect(passOutRest(0).fraction).toBe(0.25);
  });

  it('each further day away is a pass-out at the energy the one before left', () => {
    expect(settleDay(state({ energy: 0, day: 1 }), 4, MAX).energy).toBe(135);
    expect(settleDay(state({ energy: 100, day: 2, rest: { fraction: 1 } }), 4, MAX).energy).toBe(135);
  });
});

describe('the money fine for passing out away from home (P17.23)', () => {
  it('takes the share of money, up to the cap, never below 0', () => {
    expect(passOutFine(500, 10, 1000)).toBe(50);
    expect(passOutFine(50_000, 10, 1000)).toBe(1000);
    expect(passOutFine(0, 10, 1000)).toBe(0);
  });
});

describe('food (P17.23)', () => {
  it('restores ceil(2.5 x edibility) + quality x edibility', () => {
    expect(foodRestore(4, 0)).toBe(10);
    expect(foodRestore(3, 1)).toBe(11);
    expect(foodRestore(4, 2)).toBe(18);
  });

  it('eats one food from the bag and restores its energy', () => {
    const outcome = planEat(viewOf({ energy: 100, items: { [food.id]: 2 } }), { kind: 'eat', item: food.id }, envOf(data));
    expect(outcome).toEqual({
      ok: true,
      plan: {
        changes: { items: { [food.id]: -1 }, money: 0, energy: foodRestore(food.edibility!, 0), xp: {} },
        edits: [],
        sim: expect.anything(),
      },
    });
  });

  it('a higher quality of the same food restores more', () => {
    const key = stackKey(food.id, 4);
    const outcome = planEat(viewOf({ energy: 0, items: { [key]: 1 } }), { kind: 'eat', item: key }, envOf(data));
    expect(outcome.ok && outcome.plan.changes.energy).toBe(foodRestore(food.edibility!, 4));
    expect(outcome.ok && outcome.plan.changes.items).toEqual({ [key]: -1 });
  });

  it('never restores above max', () => {
    const outcome = planEat(viewOf({ energy: MAX - 1, items: { [food.id]: 1 } }), { kind: 'eat', item: food.id }, envOf(data));
    expect(outcome.ok && outcome.plan.changes.energy).toBe(1);
  });

  it('refuses a food the person does not hold, and anything that is not food', () => {
    expect(planEat(viewOf(), { kind: 'eat', item: food.id }, envOf(data))).toEqual({ ok: false, reason: 'missing' });
    expect(planEat(viewOf({ items: { hoe_1: 1 } }), { kind: 'eat', item: 'hoe_1' }, envOf(data))).toEqual({ ok: false, reason: 'invalid' });
    expect(planEat(viewOf(), { kind: 'eat' }, envOf(data))).toEqual({ ok: false, reason: 'invalid' });
  });
});

describe('sleep (P17.23)', () => {
  it('sets the rest for the bedtime, with the exhaustion rule', () => {
    const late = planSleep(viewOf({ cells: bedCells, time: { hour: 1, minute: 0 }, energy: 0 }), { kind: 'sleep', at: bedAt }, envOf(data));
    expect(late).toEqual({ ok: true, plan: expect.objectContaining({ rest: { fraction: 0.75 * 0.5 } }) });
    const early = planSleep(viewOf({ cells: bedCells, time: { hour: 23, minute: 30 } }), { kind: 'sleep', at: bedAt }, envOf(data));
    expect(early).toEqual({ ok: true, plan: expect.objectContaining({ rest: { fraction: 1 } }) });
  });

  it('refuses a cell that is not a bed, and a request with no cell', () => {
    expect(planSleep(viewOf({ cells: bedCells }), { kind: 'sleep', at: { x: 0, y: 0 } }, envOf(data))).toEqual({ ok: false, reason: 'invalid' });
    expect(planSleep(viewOf({ cells: bedCells }), { kind: 'sleep' }, envOf(data))).toEqual({ ok: false, reason: 'invalid' });
  });
});

describe('the item in a world action (P17.23)', () => {
  const act = (item: string) => ({ t: 'world:act', op: 1, kind: 'eat', item, key: 'k-eat-item-check' });

  it('accepts a plain item and a quality stack of 1, 2 or 4, and nothing else', () => {
    expect(C2S.safeParse(act('dawn_radish')).success).toBe(true);
    expect(C2S.safeParse(act('dawn_radish~1')).success).toBe(true);
    expect(C2S.safeParse(act('dawn_radish~4')).success).toBe(true);
    expect(C2S.safeParse(act('dawn_radish~3')).success).toBe(false);
    expect(C2S.safeParse(act('dawn_radish~')).success).toBe(false);
    expect(C2S.safeParse(act('Dawn_radish~2')).success).toBe(false);
  });

  it('reads the quality of a stack key, 0 for a plain item or an unknown level', () => {
    expect(qualityOfStack('dawn_radish')).toBe(0);
    expect(qualityOfStack('dawn_radish~2')).toBe(2);
    expect(qualityOfStack('dawn_radish~3')).toBe(0);
  });
});
