import { describe, expect, it } from 'vitest';
import type { AnimalState, MachineState } from '@agora/shared';
import { ANIMAL_KINDS, MARK_KINDS, animalPixels, farmSprites, markPixels, markSprite } from './farmArt';

/** How many pixels of a frame are drawn (alpha above zero). */
const drawn = (px: Uint8ClampedArray) => {
  let n = 0;
  for (let i = 3; i < px.length; i += 4) if (px[i]! > 0) n++;
  return n;
};

describe('the farm art (P17.21c)', () => {
  it('every animal is a 32 px frame with a body, and the kinds look different', () => {
    const frames = ANIMAL_KINDS.map((k) => animalPixels(k));
    for (const f of frames) {
      expect(f.length).toBe(32 * 32 * 4);
      expect(drawn(f)).toBeGreaterThan(40);
    }
    expect(new Set(frames.map((f) => f.join(','))).size).toBe(ANIMAL_KINDS.length);
  });

  it('an unknown animal still draws a plain body, not an empty frame', () => {
    expect(drawn(animalPixels('no_such_animal'))).toBeGreaterThan(20);
  });

  it('the busy flame and the ready coin are different frames', () => {
    const busy = markPixels(MARK_KINDS[0]);
    const ready = markPixels(MARK_KINDS[1]);
    expect(drawn(busy)).toBeGreaterThan(20);
    expect(busy.join(',')).not.toBe(ready.join(','));
  });
});

const animal = (over: Partial<AnimalState>): AnimalState => ({
  id: 'a1',
  animal: 'plume_hen',
  cell: '3,4',
  fedOn: 0,
  progress: 0,
  pending: 0,
  ...over,
});

const machine = (over: Partial<MachineState>): MachineState => ({
  id: 'm1',
  cell: '5,5',
  machine: 'furnace',
  output: 'bar',
  qty: 1,
  daysLeft: 1,
  ...over,
});

describe('farmSprites: the farm by cell', () => {
  it('lists the animals of a housing cell in the order they came, and marks a housing with products', () => {
    const f = farmSprites(
      [animal({ id: 'a1' }), animal({ id: 'a2', animal: 'milk_cow' }), animal({ id: 'a3', cell: '9,9', pending: 2 })],
      [],
    );
    expect(f.animals.get('3,4')).toEqual(['animal:plume_hen', 'animal:milk_cow']);
    expect(f.marks.get('3,4')).toBeUndefined();
    expect(f.marks.get('9,9')).toBe(markSprite('ready'));
  });

  it('a machine still working is busy, and a finished batch is ready', () => {
    const f = farmSprites([], [machine({ cell: '1,1', daysLeft: 2 }), machine({ cell: '2,2', daysLeft: 0 })]);
    expect(f.marks.get('1,1')).toBe(markSprite('busy'));
    expect(f.marks.get('2,2')).toBe(markSprite('ready'));
  });
});
