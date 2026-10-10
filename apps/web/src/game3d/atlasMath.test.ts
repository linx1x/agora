import { describe, expect, it } from 'vitest';
import { MAX_BLEND, animFrame, blendSlots } from './atlasMath';

describe('blendSlots (the blended variants of a region)', () => {
  it('gives one slot per distinct key, in first-seen order, and skips faces without a key', () => {
    const faces = [
      { blend: 'g|a', cx: 1, cy: 2 },
      { cx: 0, cy: 0 },
      { blend: 'f|b', cx: 3, cy: 4 },
      { blend: 'g|a', cx: 5, cy: 6 },
    ];
    const { slots, slotOf } = blendSlots(faces);
    expect(slots.map((s) => s.key)).toEqual(['g|a', 'f|b']);
    expect(slotOf.get('g|a')).toBe(0);
    expect(slotOf.get('f|b')).toBe(1);
    expect(slotOf.has('g|z')).toBe(false);
  });

  it('takes the kind from the key prefix and a cell that carries the key', () => {
    const { slots } = blendSlots([
      { blend: 'f|x', cx: 7, cy: 8 },
      { blend: 'g|y', cx: 9, cy: 10 },
    ]);
    expect(slots[0]).toMatchObject({ kind: 'f', cx: 7, cy: 8, slot: 0 });
    expect(slots[1]).toMatchObject({ kind: 'g', cx: 9, cy: 10, slot: 1 });
  });

  it('holds at most `cap` variants: the keys past it draw their base tile', () => {
    const faces = Array.from({ length: 10 }, (_, i) => ({ blend: `g|${i}`, cx: i, cy: 0 }));
    const { slots, slotOf } = blendSlots(faces, 4);
    expect(slots).toHaveLength(4);
    expect(slotOf.has('g|3')).toBe(true);
    expect(slotOf.has('g|4')).toBe(false);
  });

  it('caps at MAX_BLEND by default', () => {
    const faces = Array.from({ length: MAX_BLEND + 5 }, (_, i) => ({ blend: `f|${i}`, cx: 0, cy: 0 }));
    expect(blendSlots(faces).slots).toHaveLength(MAX_BLEND);
  });
});

describe('animFrame (the frame of an animated tile)', () => {
  it('steps through the frames at fps and loops', () => {
    // 4 frames at 4 fps: one frame every 250 ms
    expect(animFrame(0, 4, 4, false)).toBe(0);
    expect(animFrame(249, 4, 4, false)).toBe(0);
    expect(animFrame(250, 4, 4, false)).toBe(1);
    expect(animFrame(750, 4, 4, false)).toBe(3);
    expect(animFrame(1000, 4, 4, false)).toBe(0);
  });

  it('holds the first frame under reduced motion, and for a still tile', () => {
    expect(animFrame(5000, 8, 6, true)).toBe(0);
    expect(animFrame(5000, 8, 1, false)).toBe(0);
    expect(animFrame(5000, 0, 6, false)).toBe(0);
  });
});
