import { describe, expect, it } from 'vitest';
import { PET_CELL, petFrameIndex, petSprite, petTo3D } from './petFigures';

describe('the office cat in 2.5D (P16.23)', () => {
  it('picks the side walk for left and right, the up and down walks for those, and the pose by name', () => {
    expect(petSprite({ coat: 'ginger', a: 'walk', d: 'left' })).toBe('cat.ginger.walk');
    expect(petSprite({ coat: 'ginger', a: 'walk', d: 'up' })).toBe('cat.ginger.walkUp');
    expect(petSprite({ coat: 'ginger', a: 'walk', d: 'down' })).toBe('cat.ginger.walkDown');
    expect(petSprite({ coat: 'tabby', a: 'sleep', d: 'down' })).toBe('cat.tabby.sleep');
  });

  it('cycles loops, plays the stretch once and holds it, and holds still under reduced motion', () => {
    const loop = { frames: 4, fps: 8 };
    expect(petFrameIndex(loop, 'walk', 0, false)).toBe(0);
    expect(petFrameIndex(loop, 'walk', 260, false)).toBe(2);
    expect(petFrameIndex(loop, 'walk', 600, false)).toBe(0); // 4.8 frames in: wraps
    expect(petFrameIndex(loop, 'stretch', 5000, false)).toBe(3);
    expect(petFrameIndex(loop, 'walk', 260, true)).toBe(0);
    expect(petFrameIndex(loop, 'stretch', 0, true)).toBe(3);
    expect(petFrameIndex({ frames: 1, fps: 0 }, 'sit', 999, false)).toBe(0);
  });

  it('stands on the floor, or on the desk top it perched on, as far south as that top (like a prop)', () => {
    expect(petTo3D(64, 96, 0)).toEqual([2, 0, 3]);
    const [x, h, z] = petTo3D(64, 96, 12);
    expect([x, h * PET_CELL, z * PET_CELL]).toEqual([2, 12, 108]);
  });
});
