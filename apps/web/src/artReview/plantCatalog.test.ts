import { describe, expect, it } from 'vitest';
import production from '../../../../packages/shared/data/worlds/crops.json';
import { ALL_PLANTS, REVIEW_CROPS, REVIEW_TREES } from './plantCatalog';
import { PLANT_ATLASES } from './plantAtlas';

describe('botanical art coverage', () => {
  it('covers every production crop without renaming its ID', () => {
    expect(
      REVIEW_CROPS.filter((c) => c.existing)
        .map((c) => c.id)
        .sort(),
    ).toEqual(production.crops.map((c) => c.id).sort());
    expect(new Set(ALL_PLANTS.map((p) => p.id)).size).toBe(ALL_PLANTS.length);
    expect(REVIEW_CROPS.filter((c) => !c.existing)).toHaveLength(6);
    expect(REVIEW_TREES).toHaveLength(10);
  });
  it('provides five measured growth frames for every new plant sheet', () => {
    const crops = new Set(['dawn_radish', 'meadow_kale', 'honey_pea']);
    for (const atlas of PLANT_ATLASES)
      for (const row of atlas.rows) {
        expect(row.rects).toHaveLength(5);
        for (const [x, y, w, h] of row.rects) {
          expect(x).toBeGreaterThanOrEqual(0);
          expect(y).toBeGreaterThanOrEqual(0);
          expect(w).toBeGreaterThan(10);
          expect(h).toBeGreaterThan(10);
        }
        if (atlas.kind !== 'tree') crops.add(row.id);
      }
    expect([...crops].sort()).toEqual(REVIEW_CROPS.map((c) => c.id).sort());
  });
});
