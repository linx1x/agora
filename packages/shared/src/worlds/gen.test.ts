import { describe, expect, it } from 'vitest';
import { WORLDGEN, parseWorldGen, worldGenParamsFor, type WorldGenParams } from './gen';
import { WorldDataError } from './registry';

const base = {
  genVersion: 2,
  params: {
    elevation: { scale: 96, octaves: 5, contrast: 1.6 },
    temperature: { scale: 128, octaves: 3, contrast: 2.2 },
    humidity: { scale: 128, octaves: 3, contrast: 2.2 },
    seaElevation: 0.39,
    beachWidth: 0.03,
    alpineElevation: 0.7,
    rivers: { sourceGrid: 16, sourceChance: 0.3, sourceHeight: 0.2, maxSteps: 128, lakeRadius: 6, lakeRise: 0.008 },
  },
};

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

describe('shipped worldgen.json', () => {
  it('has a genVersion and params that match it', () => {
    expect(WORLDGEN.genVersion).toBe(1);
    expect(worldGenParamsFor(WORLDGEN, 1)).toBe(WORLDGEN.params);
  });

  it('refuses a version that was never shipped', () => {
    expect(() => worldGenParamsFor(WORLDGEN, 9)).toThrow(WorldDataError);
    expect(() => worldGenParamsFor(WORLDGEN, 9)).toThrow(/no params for genVersion 9/);
  });
});

describe('parseWorldGen', () => {
  it('keeps old params under versions so saved worlds still line up', () => {
    const old = clone(base.params) as WorldGenParams;
    const raw = clone({ ...base, versions: { '1': { ...old, seaElevation: 0.3 } } });
    const gen = parseWorldGen(raw);
    expect(worldGenParamsFor(gen, 1).seaElevation).toBe(0.3);
    expect(worldGenParamsFor(gen, 2).seaElevation).toBe(0.39);
  });

  it('rejects a version that is not older than genVersion', () => {
    const raw = clone({ ...base, versions: { '2': base.params } });
    expect(() => parseWorldGen(raw)).toThrow(/worldgen\.json: versions\.2: must be older than genVersion 2/);
  });

  it('names the path of a bad noise layer', () => {
    const raw = clone(base);
    (raw.params.elevation as { octaves: number }).octaves = 0;
    expect(() => parseWorldGen(raw)).toThrow(/worldgen\.json: params\.elevation\.octaves:/);
  });

  it('bounds the river tuning so regions stay small', () => {
    const raw = clone(base);
    raw.params.rivers.maxSteps = 1000;
    expect(() => parseWorldGen(raw)).toThrow(/params\.rivers\.maxSteps/);
  });

  it('rejects unknown keys and a sea level out of range', () => {
    const raw = clone(base);
    expect(() => parseWorldGen({ ...raw, params: { ...raw.params, seaLevel: 3 } })).toThrow(WorldDataError);
    expect(() => parseWorldGen({ ...raw, params: { ...raw.params, seaElevation: 1.4 } })).toThrow(
      /params\.seaElevation/,
    );
  });
});
