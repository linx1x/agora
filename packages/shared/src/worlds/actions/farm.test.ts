import { describe, expect, it } from 'vitest';
import { loadGameData } from '../gamedata/load';
import { cellKey, type CropState, type PlotState } from '../gamedata/state';
import { envOf, viewOf } from './fixtures';
import { baseItemOf, harvestQuality, planFertilize, planHarvest, planPlace, planPlant, speedStages, stackKey } from './farm';

const data = loadGameData();
const at = { x: 2, y: 2 };
const key = cellKey(2, 2);
const tilled = (over: Partial<PlotState> = {}): PlotState => ({ tilled: true, wateredOn: 0, crop: null, sprinkler: null, fertilizer: null, ...over });
const grown = (crop: string, over: Partial<CropState> = {}): CropState => ({
  crop,
  stage: 0,
  daysInStage: 0,
  ripe: false,
  regrowLeft: null,
  stages: data.crops.find((c) => c.id === crop)!.stages,
  fertilizer: null,
  ...over,
});
const spring = 3; // day 3 is spring
const summer = 29;

describe('quality keys and the quality roll (P17.22)', () => {
  it('a normal item keeps its id, a quality item carries its level after a tilde', () => {
    expect(stackKey('dawn_radish', 0)).toBe('dawn_radish');
    expect(stackKey('dawn_radish', 4)).toBe('dawn_radish~4');
    expect(baseItemOf('dawn_radish~4')).toBe('dawn_radish');
    expect(baseItemOf('dawn_radish')).toBe('dawn_radish');
  });

  it('a basic farmer and fertilizer give mostly normal quality (research section 6 table)', () => {
    expect(harvestQuality(0, 0, 0.005)).toBe(2); // gold under v = 1 %
    expect(harvestQuality(0, 0, 0.015)).toBe(1); // silver under s = 2 %
    expect(harvestQuality(0, 0, 0.5)).toBe(0);
  });

  it('the top fertilizer at farming level 10 can give best, gold, and always silver or better', () => {
    expect(harvestQuality(3, 10, 0.4)).toBe(4); // best under v / 2 = 40.5 %
    expect(harvestQuality(3, 10, 0.5)).toBe(2); // gold under v = 81 %
    expect(harvestQuality(3, 10, 0.9)).toBe(1); // silver guaranteed with the top fertilizer
    expect(harvestQuality(2, 10, 0.9)).toBe(0); // no guarantee below it
  });

  it('speed takes off ceil(total x pct) days, one at a time, in order', () => {
    expect(speedStages([3, 4], 10)).toEqual([2, 4]); // ceil(0.7) = 1
    expect(speedStages([5, 5, 4], 33)).toEqual([3, 3, 3]); // ceil(4.62) = 5
    expect(speedStages([1, 1], 100)).toEqual([1, 1]); // never below one day
    expect(speedStages([3, 4], 0)).toEqual([3, 4]);
  });
});

describe('plant: a seed goes into a tilled plot in its season (P17.22)', () => {
  it('plants the seed, moves the plot fertilizer to the crop and uses the seed', () => {
    const view = viewOf({ day: spring, items: { dawn_radish_seed: 2 }, plots: { [key]: tilled({ fertilizer: 'fertilizer_1' }) } });
    const out = planPlant(view, { kind: 'plant', item: 'dawn_radish_seed', at }, envOf(data));
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    expect(out.plan.sim.plots[key]).toMatchObject({
      tilled: true,
      fertilizer: null,
      crop: { crop: 'dawn_radish', stage: 0, daysInStage: 0, ripe: false, regrowLeft: null, fertilizer: 'fertilizer_1' },
    });
    expect(out.plan.sim.plots[key]?.crop?.stages).toEqual(speedStages([3, 4], 10));
    expect(out.plan.changes.items).toEqual({ dawn_radish_seed: -1 });
    expect(out.plan.changes.energy).toBe(0);
  });

  it('refuses a crop out of its season, an empty bag, a seed in the wrong hand and a busy plot', () => {
    const plots = { [key]: tilled() };
    expect(planPlant(viewOf({ day: summer, items: { dawn_radish_seed: 1 }, plots }), { kind: 'plant', item: 'dawn_radish_seed', at }, envOf(data))).toEqual({
      ok: false,
      reason: 'invalid',
    });
    expect(planPlant(viewOf({ day: spring, plots }), { kind: 'plant', item: 'dawn_radish_seed', at }, envOf(data))).toEqual({
      ok: false,
      reason: 'missing',
    });
    expect(planPlant(viewOf({ day: spring, items: { hoe_1: 1 }, plots }), { kind: 'plant', item: 'hoe_1', at }, envOf(data))).toEqual({
      ok: false,
      reason: 'invalid',
    });
    const busy = viewOf({ day: spring, items: { dawn_radish_seed: 1 }, plots: { [key]: tilled({ crop: grown('dawn_radish') }) } });
    expect(planPlant(busy, { kind: 'plant', item: 'dawn_radish_seed', at }, envOf(data))).toEqual({ ok: false, reason: 'invalid' });
    const untilled = viewOf({ day: spring, items: { dawn_radish_seed: 1 } });
    expect(planPlant(untilled, { kind: 'plant', item: 'dawn_radish_seed', at }, envOf(data))).toEqual({ ok: false, reason: 'invalid' });
  });
});

describe('harvest: a ripe crop goes to the bag at its quality (P17.22)', () => {
  it('collects a ripe crop as a normal stack, earns farming xp and clears the plot', () => {
    const view = viewOf({ plots: { [key]: tilled({ crop: grown('dawn_radish', { ripe: true, stage: 1, daysInStage: 4 }) }) } });
    const out = planHarvest(view, { kind: 'harvest', at }, { data, rng: () => 0.5 });
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    expect(out.plan.changes).toMatchObject({ items: { dawn_radish: 1 }, xp: { farming: 8 }, energy: 0 });
    expect(out.plan.sim.plots[key]?.crop).toBeNull();
  });

  it('a lucky roll gives a quality stack, and a fertilized crop keeps its fertilizer quality', () => {
    const view = viewOf({
      plots: { [key]: tilled({ crop: grown('dawn_radish', { ripe: true, fertilizer: 'fertilizer_3' }) }) },
      skills: { farming: data.progression.levelXp[9]! },
    });
    const out = planHarvest(view, { kind: 'harvest', at }, { data, rng: () => 0.001 });
    expect(out.ok && Object.keys(out.plan.changes.items)).toEqual(['dawn_radish~4']);
  });

  it('a regrowing crop stays on the plot with its regrow days to count', () => {
    const view = viewOf({ plots: { [key]: tilled({ crop: grown('honey_pea', { ripe: true, stage: 2 }) }) } });
    const out = planHarvest(view, { kind: 'harvest', at }, envOf(data));
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    expect(out.plan.sim.plots[key]?.crop).toMatchObject({ ripe: false, regrowLeft: 4, stage: 2 });
  });

  it('refuses an empty plot as gone and an unripe crop as invalid', () => {
    expect(planHarvest(viewOf({ plots: { [key]: tilled() } }), { kind: 'harvest', at }, envOf(data))).toEqual({ ok: false, reason: 'gone' });
    const young = viewOf({ plots: { [key]: tilled({ crop: grown('dawn_radish') }) } });
    expect(planHarvest(young, { kind: 'harvest', at }, envOf(data))).toEqual({ ok: false, reason: 'invalid' });
  });
});

describe('fertilize and place: what goes on the soil (P17.22)', () => {
  it('spreads fertilizer on empty tilled soil, using one from the bag', () => {
    const out = planFertilize(viewOf({ items: { fertilizer_2: 1 }, plots: { [key]: tilled() } }), { kind: 'fertilize', item: 'fertilizer_2', at }, envOf(data));
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    expect(out.plan.sim.plots[key]?.fertilizer).toBe('fertilizer_2');
    expect(out.plan.changes.items).toEqual({ fertilizer_2: -1 });
  });

  it('refuses fertilizer on planted or already fertilized soil, and a non-fertilizer item', () => {
    const planted = viewOf({ items: { fertilizer_1: 1 }, plots: { [key]: tilled({ crop: grown('dawn_radish') }) } });
    expect(planFertilize(planted, { kind: 'fertilize', item: 'fertilizer_1', at }, envOf(data))).toEqual({ ok: false, reason: 'invalid' });
    const done = viewOf({ items: { fertilizer_1: 1 }, plots: { [key]: tilled({ fertilizer: 'fertilizer_1' }) } });
    expect(planFertilize(done, { kind: 'fertilize', item: 'fertilizer_1', at }, envOf(data))).toEqual({ ok: false, reason: 'invalid' });
    const seed = viewOf({ items: { dawn_radish_seed: 1 }, plots: { [key]: tilled() } });
    expect(planFertilize(seed, { kind: 'fertilize', item: 'dawn_radish_seed', at }, envOf(data))).toEqual({ ok: false, reason: 'invalid' });
    expect(planFertilize(viewOf({ plots: { [key]: tilled() } }), { kind: 'fertilize', item: 'fertilizer_1', at }, envOf(data))).toEqual({
      ok: false,
      reason: 'missing',
    });
  });

  it('places a sprinkler on tilled soil once, and refuses anything else', () => {
    const out = planPlace(viewOf({ items: { sprinkler_1: 1 }, plots: { [key]: tilled() } }), { kind: 'place', item: 'sprinkler_1', at }, envOf(data));
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    expect(out.plan.sim.plots[key]?.sprinkler).toBe('sprinkler_1');
    const twice = viewOf({ items: { sprinkler_1: 2 }, plots: { [key]: tilled({ sprinkler: 'sprinkler_1' }) } });
    expect(planPlace(twice, { kind: 'place', item: 'sprinkler_1', at }, envOf(data))).toEqual({ ok: false, reason: 'invalid' });
    const fence = viewOf({ items: { fence: 1 }, plots: { [key]: tilled() } });
    expect(planPlace(fence, { kind: 'place', item: 'fence', at }, envOf(data))).toEqual({ ok: false, reason: 'invalid' });
    expect(planPlace(viewOf({ items: { sprinkler_1: 1 } }), { kind: 'place', item: 'sprinkler_1', at }, envOf(data))).toEqual({
      ok: false,
      reason: 'invalid',
    });
  });
});
