import { describe, it, expect } from 'vitest';
import type { WorldCell } from '@agora/shared';
import { habitatOf, safeWildlifeStep } from './lifePlacement';
const ground: WorldCell = {
  block: 'meadow_grass',
  decor: '',
  level: 0,
  walkable: true,
  solid: false,
  liquid: false,
  ramp: false,
};
describe('wildlife movement respects the playable world', () => {
  it('does not classify buildings or cave stone as animal habitats', () => {
    expect(habitatOf({ ...ground, block: 'wood_floor' })).toBeNull();
    expect(habitatOf({ ...ground, block: 'stone' })).toBeNull();
    expect(habitatOf({ ...ground, block: 'taiga_snow' })).toBe('taiga');
  });
  it.each([{ liquid: true }, { decor: 'chest' }, { level: 1 }, { walkable: false }])(
    'cannot cross an intervening obstacle %o',
    (patch) => {
      const read = (x: number) => (x === 1 ? { ...ground, ...patch } : ground);
      expect(safeWildlifeStep(read, () => false, { x: 0.5, z: 0.5 }, { x: 2.5, z: 0.5 }, 0)).toBe(
        false,
      );
    },
  );
  it('keeps animals out of crops while allowing an open same-level path', () => {
    expect(
      safeWildlifeStep(
        () => ground,
        (x) => x === 1,
        { x: 0.5, z: 0.5 },
        { x: 2.5, z: 0.5 },
        0,
      ),
    ).toBe(false);
    expect(
      safeWildlifeStep(
        () => ground,
        () => false,
        { x: 0.5, z: 0.5 },
        { x: 2.5, z: 0.5 },
        0,
      ),
    ).toBe(true);
  });
});
