import { describe, expect, it } from 'vitest';
import { DEFAULT_DAY_MS, MAX_SIM_DAYS, simulateDays, sprinklerCovers, worldTime } from './clock';
import { cellKey, loadGameData, type CropState, type PlotState, type WorldSimState } from './gamedata';

const data = loadGameData();
const plot = (over: Partial<PlotState> = {}): PlotState => ({ tilled: true, wateredOn: 0, crop: null, sprinkler: null, ...over });
const crop = (id: string, over: Partial<CropState> = {}): CropState => ({
  crop: id,
  stage: 0,
  daysInStage: 0,
  ripe: false,
  regrowLeft: null,
  ...over,
});
const world = (day: number, plots: Record<string, PlotState> = {}, extra: Partial<WorldSimState> = {}): WorldSimState => ({
  day,
  plots,
  animals: [],
  machines: [],
  ...extra,
});
const at = (s: WorldSimState, x: number, y: number) => s.plots[cellKey(x, y)]!;

describe('worldTime', () => {
  it('starts at 06:00 on day 1 of spring, year 1', () => {
    expect(worldTime(0, 0)).toEqual({ day: 1, season: 'spring', year: 1, hour: 6, minute: 0, dayOfSeason: 1 });
  });

  it('runs 20 clock hours from 06:00 to 02:00 the next morning', () => {
    expect(worldTime(0, 10 * 60_000)).toMatchObject({ day: 1, hour: 16, minute: 0 });
    expect(worldTime(0, DEFAULT_DAY_MS - 1)).toMatchObject({ day: 1, hour: 1, minute: 59 });
    expect(worldTime(0, DEFAULT_DAY_MS)).toMatchObject({ day: 2, hour: 6, minute: 0 });
  });

  it('changes season every 28 days and year every 112', () => {
    expect(worldTime(0, 28 * DEFAULT_DAY_MS)).toMatchObject({ day: 29, season: 'summer', dayOfSeason: 1, year: 1 });
    expect(worldTime(0, 112 * DEFAULT_DAY_MS)).toMatchObject({ day: 113, season: 'spring', year: 2, dayOfSeason: 1 });
  });

  it('clamps times before creation to day 1', () => {
    expect(worldTime(1000, 0)).toMatchObject({ day: 1, hour: 6 });
  });

  it('keeps the same clock for a shorter dev day', () => {
    expect(worldTime(0, 60_000, 120_000)).toMatchObject({ day: 1, hour: 16, minute: 0 });
  });

  it('refuses a day shorter than one millisecond per game minute', () => {
    expect(() => worldTime(0, 0, 1000)).toThrow(RangeError);
  });
});

describe('sprinkler coverage', () => {
  const count = (radius: number) => {
    let n = 0;
    for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) if (sprinklerCovers(radius, dx, dy)) n++;
    return n;
  };
  it('covers 4, 8 and 24 cells for radius 0, 1 and 2', () => {
    expect([count(0), count(1), count(2)]).toEqual([4, 8, 24]);
  });
  it('never covers its own cell', () => {
    expect(sprinklerCovers(2, 0, 0)).toBe(false);
  });
});

describe('simulateDays', () => {
  it('does not grow an unwatered crop', () => {
    const s = world(0, { '0,0': plot({ crop: crop('dawn_radish') }) });
    const next = simulateDays(s, 0, 3, data);
    expect(at(next, 0, 0).crop).toMatchObject({ stage: 0, daysInStage: 0, ripe: false });
    expect(next.day).toBe(3);
  });

  it('grows a crop on the day it is watered, and only then', () => {
    const s = world(0, { '0,0': plot({ wateredOn: 1, crop: crop('dawn_radish') }) });
    const day1 = simulateDays(s, 0, 1, data);
    expect(at(day1, 0, 0).crop?.daysInStage).toBe(1);
    const day2 = simulateDays(day1, 1, 2, data);
    expect(at(day2, 0, 0).crop?.daysInStage).toBe(1);
  });

  it('ripens a crop after its last stage, using a sprinkler for water', () => {
    // river_melon: stages 6 + 6 + 6 = 18 watered days, summer.
    const s = world(28, {
      '5,5': plot({ wateredOn: 29, crop: crop('river_melon') }),
      '5,6': plot({ tilled: false, sprinkler: 'sprinkler_1' }),
    });
    const before = simulateDays(s, 28, 45, data);
    expect(at(before, 5, 5).crop).toMatchObject({ stage: 2, daysInStage: 5, ripe: false });
    const after = simulateDays(before, 45, 46, data);
    expect(at(after, 5, 5).crop?.ripe).toBe(true);
  });

  it('waters with a sprinkler for the next night, not the same night', () => {
    const s = world(0, {
      '0,0': plot({ tilled: false, sprinkler: 'sprinkler_1' }),
      '1,0': plot({ crop: crop('dawn_radish') }),
    });
    const night1 = simulateDays(s, 0, 1, data);
    expect(at(night1, 1, 0).crop?.daysInStage).toBe(0);
    expect(at(night1, 1, 0).wateredOn).toBe(2);
    const night2 = simulateDays(night1, 1, 2, data);
    expect(at(night2, 1, 0).crop?.daysInStage).toBe(1);
  });

  it('waters only the cells in the sprinkler radius and only tilled plots', () => {
    const s = world(0, {
      '0,0': plot({ tilled: false, sprinkler: 'sprinkler_1' }),
      '1,1': plot(), // diagonal: outside radius 0
      '0,1': plot({ tilled: false }), // untilled: not watered
    });
    const next = simulateDays(s, 0, 1, data);
    expect(at(next, 1, 1).wateredOn).toBe(0);
    expect(at(next, 0, 1).wateredOn).toBe(0);
    const bigger = world(0, { '0,0': plot({ tilled: false, sprinkler: 'sprinkler_2' }), '1,1': plot() });
    expect(at(simulateDays(bigger, 0, 1, data), 1, 1).wateredOn).toBe(2);
  });

  it('withers a crop that is out of season at the season change', () => {
    const s = world(28, {
      '0,0': plot({ wateredOn: 29, crop: crop('dawn_radish') }), // spring only
      '1,0': plot({ wateredOn: 29, crop: crop('ember_pepper') }), // summer
    });
    const next = simulateDays(s, 28, 29, data);
    expect(at(next, 0, 0).crop).toBeNull();
    expect(at(next, 1, 0).crop?.daysInStage).toBe(1);
  });

  it('does not wither on day 1 (the world starts in spring)', () => {
    const s = world(0, { '0,0': plot({ crop: crop('dawn_radish') }) });
    expect(at(simulateDays(s, 0, 1, data), 0, 0).crop).not.toBeNull();
  });

  it('regrows a harvested crop after its regrow days of watering', () => {
    // ember_pepper regrows in 3 watered days (summer).
    const s = world(28, {
      '0,0': plot({ wateredOn: 29, crop: crop('ember_pepper', { stage: 2, regrowLeft: 3 }) }),
      '0,1': plot({ tilled: false, sprinkler: 'sprinkler_1' }),
    });
    const two = simulateDays(s, 28, 30, data);
    expect(at(two, 0, 0).crop).toMatchObject({ regrowLeft: 1, ripe: false });
    const three = simulateDays(two, 30, 31, data);
    expect(at(three, 0, 0).crop).toMatchObject({ regrowLeft: null, ripe: true });
  });

  it('feeds animals: a fed day adds progress and a product when it is complete', () => {
    const s = world(0, {}, { animals: [{ id: 'a1', animal: 'plume_hen', fedOn: 1, progress: 0, pending: 0 }] });
    const next = simulateDays(s, 0, 1, data);
    expect(next.animals[0]).toMatchObject({ progress: 0, pending: 1 });
    const cow = world(0, {}, { animals: [{ id: 'c1', animal: 'milk_cow', fedOn: 1, progress: 0, pending: 0 }] });
    expect(simulateDays(cow, 0, 1, data).animals[0]).toMatchObject({ progress: 1, pending: 0 });
  });

  it('does not progress an unfed animal and stops at the product cap', () => {
    const unfed = world(0, {}, { animals: [{ id: 'a1', animal: 'plume_hen', fedOn: 0, progress: 0, pending: 0 }] });
    expect(simulateDays(unfed, 0, 1, data).animals[0]).toMatchObject({ progress: 0, pending: 0 });
    const full = world(0, {}, { animals: [{ id: 'a1', animal: 'plume_hen', fedOn: 1, progress: 0, pending: 9 }] });
    expect(simulateDays(full, 0, 1, data).animals[0]?.pending).toBe(9);
  });

  it('counts machines down and stops at zero', () => {
    const s = world(0, {}, { machines: [{ id: 'm1', cell: '0,0', machine: 'cask', output: 'rune_cheese', daysLeft: 2 }] });
    expect(simulateDays(s, 0, 5, data).machines[0]?.daysLeft).toBe(0);
  });

  it('simulates at most one year of a longer gap', () => {
    const s = world(0, {}, { machines: [{ id: 'm1', cell: '0,0', machine: 'cask', output: 'rune_cheese', daysLeft: 200 }] });
    const next = simulateDays(s, 0, 500, data);
    expect(next.day).toBe(500);
    expect(next.machines[0]?.daysLeft).toBe(200 - MAX_SIM_DAYS);
  });

  it('is pure and deterministic', () => {
    const s = world(28, {
      '0,0': plot({ wateredOn: 29, crop: crop('river_melon') }),
      '0,1': plot({ tilled: false, sprinkler: 'sprinkler_2' }),
    });
    const before = JSON.stringify(s);
    const a = simulateDays(s, 28, 60, data);
    expect(JSON.stringify(s)).toBe(before);
    expect(simulateDays(s, 28, 60, data)).toEqual(a);
  });

  it('returns the same state when there is no time to run', () => {
    const s = world(5);
    expect(simulateDays(s, 5, 5, data)).toBe(s);
  });

  it('refuses a state that is not at fromDay', () => {
    expect(() => simulateDays(world(3), 0, 5, data)).toThrow(RangeError);
  });
});
