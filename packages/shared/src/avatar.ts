import { z } from 'zod';

/** Procedural avatar palette (placeholder art, pending HUMAN CHECKPOINT A / LPC layers). */
export const SKIN_TONES = [
  '#f6d7c3',
  '#eac2a3',
  '#d9a47f',
  '#c18660',
  '#a0674a',
  '#7d4f37',
  '#5c3a28',
  '#3f2a1f',
];
export const HAIR_COLORS = [
  '#1d1a19',
  '#4a3021',
  '#7a4b2a',
  '#b07a3f',
  '#e3c27a',
  '#c4553a',
  '#9aa3ab',
  '#6b4a8a',
];
export const TOP_COLORS = [
  '#17324d',
  '#2f7d5b',
  '#c2364b',
  '#4a5866',
  '#3d6fb6',
  '#e0e4e8',
  '#8a5a9e',
  '#d9822b',
];
export const BOTTOM_COLORS = ['#22313f', '#3b3b3b', '#5b4636', '#2c4a6e', '#6f7b85', '#1f3a2e'];
export const HAIR_STYLES = ['short', 'long', 'bun', 'curly', 'buzz', 'none'] as const;
export const ACCESSORIES = ['none', 'glasses', 'beanie', 'headphones'] as const;

export const AvatarSchema = z.object({
  skin: z
    .number()
    .int()
    .min(0)
    .max(SKIN_TONES.length - 1),
  hair: z
    .number()
    .int()
    .min(0)
    .max(HAIR_STYLES.length - 1),
  hairColor: z
    .number()
    .int()
    .min(0)
    .max(HAIR_COLORS.length - 1),
  top: z
    .number()
    .int()
    .min(0)
    .max(TOP_COLORS.length - 1),
  bottom: z
    .number()
    .int()
    .min(0)
    .max(BOTTOM_COLORS.length - 1),
  accessory: z
    .number()
    .int()
    .min(0)
    .max(ACCESSORIES.length - 1),
});
export type Avatar = z.infer<typeof AvatarSchema>;

export function randomAvatar(rand: () => number = Math.random): Avatar {
  const pick = (n: number) => Math.floor(rand() * n);
  return {
    skin: pick(SKIN_TONES.length),
    hair: pick(HAIR_STYLES.length),
    hairColor: pick(HAIR_COLORS.length),
    top: pick(TOP_COLORS.length),
    bottom: pick(BOTTOM_COLORS.length),
    accessory: pick(ACCESSORIES.length),
  };
}

export function avatarKey(a: Avatar): string {
  return `av-${a.skin}-${a.hair}-${a.hairColor}-${a.top}-${a.bottom}-${a.accessory}`;
}
