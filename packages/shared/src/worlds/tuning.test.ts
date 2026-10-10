import { describe, expect, it } from 'vitest';
import { WORLDGEN } from './gen';
import { worldSeedFor } from './noise';
import { TUNING_FIELDS, previewCells, tuningJson, tuningValue, waterShare, withTuning } from './tuning';

const P = WORLDGEN.params;
const SEED = worldSeedFor('tuning-test');

/** Every number in a params object, by dotted path. */
function leaves(o: Record<string, unknown>, prefix = ''): string[] {
  return Object.entries(o).flatMap(([k, v]) =>
    typeof v === 'number'
      ? [prefix + k]
      : leaves(v as Record<string, unknown>, `${prefix}${k}.`),
  );
}

describe('tuning fields and worldgen.json', () => {
  it('there is one slider for every value in worldgen.json, and no other', () => {
    expect(TUNING_FIELDS.map((f) => f.key).sort()).toEqual(leaves(P as unknown as Record<string, unknown>).sort());
  });

  it('every slider range is inside what the schema accepts, and holds the current value', () => {
    for (const f of TUNING_FIELDS) {
      expect(() => withTuning(P, f.key, f.min), f.key).not.toThrow();
      expect(() => withTuning(P, f.key, f.max), f.key).not.toThrow();
      const v = tuningValue(P, f.key);
      expect(v, f.key).toBeGreaterThanOrEqual(f.min);
      expect(v, f.key).toBeLessThanOrEqual(f.max);
    }
  });
});

describe('changing one value', () => {
  it('changes that value only, and leaves the input alone', () => {
    const before = structuredClone(P);
    const next = withTuning(P, 'seaElevation', 0.5);
    expect(next.seaElevation).toBe(0.5);
    expect(P).toEqual(before);
    expect({ ...next, seaElevation: P.seaElevation }).toEqual(P);
    const deep = withTuning(P, 'rivers.lakeRadius', 9);
    expect(deep.rivers).toEqual({ ...P.rivers, lakeRadius: 9 });
  });

  it('a value the schema refuses is refused, and nothing changes', () => {
    expect(() => withTuning(P, 'elevation.octaves', 9)).toThrow();
    expect(() => withTuning(P, 'nope', 1)).toThrow(/no tuning field/);
  });

  it('the copied JSON is the params block of worldgen.json, and reads back to the same params', () => {
    expect(JSON.parse(tuningJson(P))).toEqual({ params: P });
  });
});

describe('the preview follows the params', () => {
  it('the same params and seed give the same cells, every time', () => {
    const a = previewCells(P, SEED, 48).map((c) => `${c.block}|${c.level}|${c.liquid}`);
    const b = previewCells(P, SEED, 48).map((c) => `${c.block}|${c.level}|${c.liquid}`);
    expect(a).toEqual(b);
    expect(a).toHaveLength(48 * 48);
  });

  it('a higher sea level makes more water in the same square', () => {
    const dry = waterShare(previewCells(withTuning(P, 'seaElevation', 0.2), SEED, 64));
    const wet = waterShare(previewCells(withTuning(P, 'seaElevation', 0.6), SEED, 64));
    expect(wet).toBeGreaterThan(dry);
  });
});
