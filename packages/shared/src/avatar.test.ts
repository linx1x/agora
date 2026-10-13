import { describe, expect, it } from 'vitest';
import { AvatarSchema, AVATAR_DEFAULTS, avatarKey, randomAvatar, wardrobe } from './avatar';

const legacy = { skin: 2, hair: 0, hairColor: 1, top: 1, bottom: 0, accessory: 0 };
describe('saved avatar wardrobe', () => {
  it('loads legacy player and NPC appearances with stable defaults', () => {
    expect(AvatarSchema.parse(legacy)).toEqual({ ...legacy, ...AVATAR_DEFAULTS });
    expect(avatarKey(legacy)).toBe(avatarKey(wardrobe(legacy)));
    expect(wardrobe({ ...legacy, vest: undefined }).vest).toBe(0);
  });
  it('round-trips every new wardrobe field through profile validation', () => {
    const a = {
      ...legacy,
      gender: 2,
      topStyle: 3,
      bottomStyle: 2,
      shoes: 3,
      shoeColor: 5,
      belt: 2,
      buckle: 3,
      vest: 3,
      vestColor: 5,
      costume: 4,
      hair: 9,
      accessory: 7,
    };
    expect(AvatarSchema.parse(JSON.parse(JSON.stringify(a)))).toEqual(a);
  });
  it('invalidates cached textures for each changed layer', () => {
    for (const key of Object.keys(AVATAR_DEFAULTS)) {
      expect(avatarKey({ ...legacy, [key]: 1 })).not.toBe(avatarKey(legacy));
    }
  });
  it('rejects invalid wardrobe indices at the protocol boundary', () => {
    for (const key of Object.keys(AVATAR_DEFAULTS)) {
      for (const value of [-1, 100, 0.5, '1', null])
        expect(AvatarSchema.safeParse({ ...legacy, [key]: value }).success).toBe(false);
    }
  });
  it('randomizes valid complete wardrobes at both ends of the palette', () => {
    for (const value of [0, 0.3, 0.999999, 1])
      expect(AvatarSchema.safeParse(randomAvatar(() => value)).success).toBe(true);
  });
});
