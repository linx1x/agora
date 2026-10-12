import { describe, expect, it } from 'vitest';
import { simulateDays } from './clock';
import { emptySim, loadGameData, type WorldSimState } from './gamedata';
import {
  animalsShelter,
  fishingWaitMultiplier,
  rainWaters,
  waterFromWeather,
  weatherForDay,
  weatherForecast,
} from './weather';

const data = loadGameData();
const wetSeed = Array.from({ length: 100 }, (_, i) => i).find((seed) =>
  rainWaters(weatherForDay(seed, 5)),
)!;
const drySeed = Array.from({ length: 100 }, (_, i) => i).find(
  (seed) => !rainWaters(weatherForDay(seed, 5)),
)!;
const planted = (day: number): WorldSimState => ({
  ...emptySim(day),
  plots: {
    '0,0': {
      tilled: true,
      wateredOn: 0,
      sprinkler: null,
      fertilizer: null,
      crop: {
        crop: 'dawn_radish',
        stage: 0,
        daysInStage: 0,
        ripe: false,
        regrowLeft: null,
        stages: [3, 3],
        fertilizer: null,
      },
    },
    '1,0': { tilled: false, wateredOn: 0, sprinkler: 'sprinkler_1', fertilizer: null, crop: null },
  },
});

describe('daily seasonal weather', () => {
  it('has a clear welcome day, matching forecasts across years and repeatable seeds', () => {
    const kinds = new Set();
    for (let seed = 0; seed < 20; seed++) {
      expect(weatherForDay(seed, 1)).toBe('clear');
      for (let day = 1; day < 225; day++) {
        const forecast = weatherForecast(seed, day);
        expect(weatherForecast(seed, day)).toEqual(forecast);
        expect(forecast.tomorrow).toBe(weatherForecast(seed, day + 1).today);
        const winter = Math.floor((day - 1) / 28) % 4 === 3;
        if (!winter) expect(forecast.today).not.toBe('snow');
        if (winter) expect(rainWaters(forecast.today)).toBe(false);
        kinds.add(forecast.today);
      }
    }
    expect(kinds.size).toBe(5);
    expect(() => weatherForDay(1, 0)).toThrow(RangeError);
  });

  it('waters tilled soil immediately and idempotently, without consuming a growth day', () => {
    const original = planted(5);
    const next = waterFromWeather(original, wetSeed);
    expect(original.plots['0,0']!.wateredOn).toBe(0);
    expect(next.plots['0,0']!.wateredOn).toBe(6);
    expect(next.plots['0,0']!.crop!.daysInStage).toBe(0);
    expect(next.plots['1,0']!.wateredOn).toBe(0);
    expect(waterFromWeather(next, wetSeed)).toBe(next);
    expect(waterFromWeather(original, drySeed)).toBe(original);
  });

  it('credits the previous day’s rain at dawn, including newly tilled soil and offline time', () => {
    const farm = planted(5);
    expect(simulateDays(farm, 5, 6, data, wetSeed, true).plots['0,0']!.crop!.daysInStage).toBe(1);
    expect(simulateDays(farm, 5, 6, data, drySeed, true).plots['0,0']!.crop!.daysInStage).toBe(0);
    expect(simulateDays(farm, 5, 6, data, wetSeed, false).plots['0,0']!.crop!.daysInStage).toBe(0);
    let stepped = farm;
    for (let day = 6; day <= 25; day++)
      stepped = simulateDays(stepped, day - 1, day, data, wetSeed, true);
    expect(simulateDays(farm, 5, 25, data, wetSeed, true)).toEqual(stepped);
  });

  it('shelters animals in precipitation and leaves production and feed intact', () => {
    expect(
      ['clear', 'cloudy', 'rain', 'thunderstorm', 'snow'].map((kind) =>
        animalsShelter(kind as Parameters<typeof animalsShelter>[0]),
      ),
    ).toEqual([false, false, true, true, true]);
    expect(rainWaters('snow')).toBe(false);
    const animals = [
      { id: 'a1', animal: 'plume_hen', cell: '2,2', fedOn: 6, progress: 0, pending: 0 },
    ];
    const farm = { ...emptySim(5), animals };
    expect(simulateDays(farm, 5, 6, data, wetSeed, true).animals).toEqual(
      simulateDays(farm, 5, 6, data, drySeed, true).animals,
    );
    expect(fishingWaitMultiplier('rain')).toBe(0.8);
    expect(fishingWaitMultiplier('snow')).toBe(1.1);
  });
});
