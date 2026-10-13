import { z } from 'zod';

/** Shared, save-compatible wardrobe. Existing palette and option indices stay stable. */
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
export const HAIR_STYLES = [
  'short',
  'long',
  'bun',
  'curly',
  'buzz',
  'none',
  'bob',
  'ponytail',
  'braids',
  'mohawk',
] as const;
export const ACCESSORIES = [
  'none',
  'glasses',
  'beanie',
  'headphones',
  'strawHat',
  'flower',
  'earrings',
  'goggles',
] as const;

export const GENDERS = ['neutral', 'woman', 'man', 'nonbinary'] as const;
export const TOP_STYLES = ['shirt', 'tshirt', 'sweater', 'tunic'] as const;
export const BOTTOM_STYLES = ['trousers', 'shorts', 'skirt'] as const;
export const SHOES = ['boots', 'sneakers', 'sandals', 'tallBoots'] as const;
export const SHOE_COLORS = ['#70462f', '#302e36', '#ac7950', '#e4d9b9', '#596948', '#873f3b'];
export const BELTS = ['none', 'leather', 'sash'] as const;
export const BUCKLES = ['none', 'brass', 'silver', 'leaf'] as const;
export const VESTS = ['none', 'waistcoat', 'utility', 'knit'] as const;
export const VEST_COLORS = ['#735039', '#355e50', '#b79a65', '#463f59', '#b56346', '#303d4c'];
export const COSTUMES = ['none', 'farmer', 'ranger', 'mage', 'artisan'] as const;

export const AVATAR_DEFAULTS = {
  gender: 0,
  topStyle: 0,
  bottomStyle: 0,
  shoes: 0,
  shoeColor: 0,
  belt: 0,
  buckle: 0,
  vest: 0,
  vestColor: 0,
  costume: 0,
} as const;
const choice = (values: readonly string[]) =>
  z
    .number()
    .int()
    .min(0)
    .max(values.length - 1);
export const AvatarSchema = z.object({
  skin: choice(SKIN_TONES),
  hair: choice(HAIR_STYLES),
  hairColor: choice(HAIR_COLORS),
  top: choice(TOP_COLORS),
  bottom: choice(BOTTOM_COLORS),
  accessory: choice(ACCESSORIES),
  gender: choice(GENDERS).default(0),
  topStyle: choice(TOP_STYLES).default(0),
  bottomStyle: choice(BOTTOM_STYLES).default(0),
  shoes: choice(SHOES).default(0),
  shoeColor: choice(SHOE_COLORS).default(0),
  belt: choice(BELTS).default(0),
  buckle: choice(BUCKLES).default(0),
  vest: choice(VESTS).default(0),
  vestColor: choice(VEST_COLORS).default(0),
  costume: choice(COSTUMES).default(0),
});
/** Legacy six-field avatars remain valid in local saves, fixtures and NPC definitions. */
export type Avatar = z.input<typeof AvatarSchema>;
export function wardrobe(a: Avatar): z.output<typeof AvatarSchema> {
  const result = { ...AVATAR_DEFAULTS, ...a };
  for (const key of Object.keys(AVATAR_DEFAULTS) as (keyof typeof AVATAR_DEFAULTS)[])
    result[key] = a[key] ?? AVATAR_DEFAULTS[key];
  return result;
}
export function randomAvatar(rand: () => number = Math.random): Avatar {
  const pick = (n: number) => Math.min(n - 1, Math.max(0, Math.floor(rand() * n)));
  return {
    skin: pick(SKIN_TONES.length),
    hair: pick(HAIR_STYLES.length),
    hairColor: pick(HAIR_COLORS.length),
    top: pick(TOP_COLORS.length),
    bottom: pick(BOTTOM_COLORS.length),
    accessory: pick(ACCESSORIES.length),
    gender: pick(GENDERS.length),
    topStyle: pick(TOP_STYLES.length),
    bottomStyle: pick(BOTTOM_STYLES.length),
    shoes: pick(SHOES.length),
    shoeColor: pick(SHOE_COLORS.length),
    belt: pick(BELTS.length),
    buckle: pick(BUCKLES.length),
    vest: pick(VESTS.length),
    vestColor: pick(VEST_COLORS.length),
    costume: pick(COSTUMES.length),
  };
}
export function avatarKey(a: Avatar): string {
  const v = wardrobe(a);
  return `av2-${v.skin}-${v.hair}-${v.hairColor}-${v.top}-${v.bottom}-${v.accessory}-${v.gender}-${v.topStyle}-${v.bottomStyle}-${v.shoes}-${v.shoeColor}-${v.belt}-${v.buckle}-${v.vest}-${v.vestColor}-${v.costume}`;
}
