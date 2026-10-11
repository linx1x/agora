import { z } from 'zod';

/**
 * Zod contract for the Agora world game data (ADR-053). Each JSON file in
 * packages/shared/data/worlds has one schema here. Adding content means adding
 * rows; code must not branch on a specific id.
 */

export const ITEM_KINDS = [
  'seed',
  'crop',
  'forage',
  'material',
  'product',
  'feed',
  'animal',
  'tool',
  'machine',
  'building',
  'food',
  'fish',
] as const;
export const ITEM_CATEGORIES = ['open', 'limited', 'restricted', 'account-bound'] as const;
export const SEASONS = ['spring', 'summer', 'autumn', 'winter'] as const;
export const HABITATS = ['river', 'lake', 'ocean'] as const;
export const STATIONS = ['bench', 'kitchen', 'furnace'] as const;
export const HOUSING = ['coop', 'barn'] as const;
export const TOOLS = ['hoe', 'can', 'axe', 'pick', 'rod'] as const;
export const GIFT_NPCS = ['zoe', 'felix', 'theo'] as const;

/** A season has 28 game days; a crop's stages must fit in one season. */
export const SEASON_DAYS = 28;

export type ItemKind = (typeof ITEM_KINDS)[number];
export type ItemCategory = (typeof ITEM_CATEGORIES)[number];
export type Season = (typeof SEASONS)[number];
export type Habitat = (typeof HABITATS)[number];
export type Station = (typeof STATIONS)[number];
export type Housing = (typeof HOUSING)[number];
export type ToolKind = (typeof TOOLS)[number];
export type GiftNpc = (typeof GIFT_NPCS)[number];

export const IdSchema = z
  .string()
  .max(40)
  .regex(/^[a-z][a-z0-9_]*$/, 'id must be lower_snake and start with a letter');

const int = (min: number, max: number) => z.number().int().min(min).max(max);

const unique = (values: readonly string[]) => new Set(values).size === values.length;

export const ItemSchema = z
  .object({
    id: IdSchema,
    kind: z.enum(ITEM_KINDS),
    category: z.enum(ITEM_CATEGORIES),
    /** Stable shop price; null when the item is not sold in shops. */
    buy: z.number().int().positive().nullable(),
    /** Base value before quality; shipping pays half of it (research section 15). */
    value: z.number().int().positive(),
    stack: int(1, 999).default(99),
    /** Food only: energy restore basis (research section 9). */
    edibility: int(1, 100).optional(),
    /** Buildings only: what the building does each night. */
    effect: z.object({ kind: z.literal('sprinkler'), radius: int(0, 2) }).optional(),
  })
  .superRefine((item, ctx) => {
    if (item.kind === 'food' && item.edibility === undefined) {
      ctx.addIssue({ code: 'custom', path: ['edibility'], message: 'food needs edibility' });
    }
    if (item.kind !== 'food' && item.edibility !== undefined) {
      ctx.addIssue({ code: 'custom', path: ['edibility'], message: 'only food has edibility' });
    }
    if (item.effect !== undefined && item.kind !== 'building') {
      ctx.addIssue({ code: 'custom', path: ['effect'], message: 'only buildings have an effect' });
    }
  });
export type Item = z.infer<typeof ItemSchema>;

export const CropSchema = z
  .object({
    id: IdSchema,
    /** Harvested product item (kind crop). */
    item: IdSchema,
    /** Seed item (kind seed). */
    seed: IdSchema,
    seasons: z.array(z.enum(SEASONS)).min(1).max(4),
    /** Days per growth stage; the crop is ripe after the last stage. */
    stages: z.array(int(1, SEASON_DAYS)).min(1).max(6),
    /** Days back to ripe after a harvest; null means the plant is removed. */
    regrowDays: int(1, SEASON_DAYS).nullable(),
    yield: z.object({ min: int(1, 20), max: int(1, 20) }),
  })
  .superRefine((crop, ctx) => {
    const total = crop.stages.reduce((sum, days) => sum + days, 0);
    if (total > SEASON_DAYS) {
      ctx.addIssue({
        code: 'custom',
        path: ['stages'],
        message: `stages sum to ${total}, must be <= ${SEASON_DAYS}`,
      });
    }
    if (crop.yield.max < crop.yield.min) {
      ctx.addIssue({ code: 'custom', path: ['yield'], message: 'max must be >= min' });
    }
    if (!unique(crop.seasons)) {
      ctx.addIssue({ code: 'custom', path: ['seasons'], message: 'seasons must be unique' });
    }
  });
export type Crop = z.infer<typeof CropSchema>;

export const ToolSchema = z
  .object({
    /** Item id (kind tool). */
    id: IdSchema,
    tool: z.enum(TOOLS),
    tier: int(1, 3),
    /** Energy per use before the farming-level reduction. */
    energy: int(0, 10),
    power: int(1, 5),
    /** Multiplier on the action time; 1 is the base speed. */
    speed: z.number().min(0.5).max(3),
    /** 0 = one tile; 1 = the 3 x 3 block around the target. */
    radius: int(0, 2),
    /** Fishing rods only: extra bar height in pixels. */
    barBonus: int(0, 32).default(0),
  })
  .superRefine((tool, ctx) => {
    if (tool.tool !== 'rod' && tool.barBonus !== 0) {
      ctx.addIssue({ code: 'custom', path: ['barBonus'], message: 'only rods have barBonus' });
    }
  });
export type Tool = z.infer<typeof ToolSchema>;

const Qty = int(1, 99);

export const RecipeSchema = z
  .object({
    id: IdSchema,
    station: z.enum(STATIONS),
    output: z.object({ item: IdSchema, qty: Qty }),
    inputs: z.array(z.object({ item: IdSchema, qty: Qty })).min(1).max(6),
  })
  .superRefine((recipe, ctx) => {
    const ids = recipe.inputs.map((input) => input.item);
    if (!unique(ids)) {
      ctx.addIssue({ code: 'custom', path: ['inputs'], message: 'each input item once' });
    }
    if (ids.includes(recipe.output.item)) {
      ctx.addIssue({ code: 'custom', path: ['output'], message: 'output cannot be an input' });
    }
  });
export type Recipe = z.infer<typeof RecipeSchema>;

export const AnimalSchema = z.object({
  /** Item id (kind animal). */
  id: IdSchema,
  housing: z.enum(HOUSING),
  /** Product item. */
  product: IdSchema,
  productDays: int(1, 14),
  /** Feed item (kind feed). */
  feed: IdSchema,
  feedPerDay: int(1, 4),
});
export type Animal = z.infer<typeof AnimalSchema>;

export const FishSchema = z
  .object({
    /** Item id (kind fish). */
    id: IdSchema,
    habitat: z.enum(HABITATS),
    seasons: z.array(z.enum(SEASONS)).min(1).max(4),
    /** Local hours, 06 = day start, 26 = 02:00 the next night. */
    hours: z.object({ from: int(6, 26), to: int(6, 26) }),
    difficulty: int(1, 10),
    /** Relative rarity weight. */
    weight: int(1, 100),
    /** Multiplier on the bar's movement speed. */
    barSpeed: z.number().min(0.5).max(2),
  })
  .superRefine((fish, ctx) => {
    if (fish.hours.to <= fish.hours.from) {
      ctx.addIssue({ code: 'custom', path: ['hours'], message: 'to must be after from' });
    }
    if (!unique(fish.seasons)) {
      ctx.addIssue({ code: 'custom', path: ['seasons'], message: 'seasons must be unique' });
    }
  });
export type Fish = z.infer<typeof FishSchema>;

export const GiftPointsSchema = z.object({
  love: int(1, 500),
  like: int(1, 500),
  neutral: int(0, 500),
  talk: int(0, 500),
  dislike: int(-500, -1),
  hate: int(-500, -1),
});
export type GiftPoints = z.infer<typeof GiftPointsSchema>;

export const GiftLimitsSchema = z.object({
  perDay: int(1, 5),
  perWeek: int(1, 10),
  weeklyBonus: int(0, 100),
});
export type GiftLimits = z.infer<typeof GiftLimitsSchema>;

export const GiftProfileSchema = z
  .object({
    npc: z.enum(GIFT_NPCS),
    love: z.array(IdSchema).min(1).max(8),
    like: z.array(IdSchema).max(8),
    dislike: z.array(IdSchema).max(8),
    hate: z.array(IdSchema).max(8),
  })
  .superRefine((profile, ctx) => {
    const all = [...profile.love, ...profile.like, ...profile.dislike, ...profile.hate];
    if (!unique(all)) {
      ctx.addIssue({
        code: 'custom',
        path: [],
        message: 'an item may appear in only one of love, like, dislike, hate',
      });
    }
  });
export type GiftProfile = z.infer<typeof GiftProfileSchema>;

export const SKILLS = ['farming', 'foraging', 'mining'] as const;
export type Skill = (typeof SKILLS)[number];

const XpGrantSchema = z.object({ skill: z.enum(SKILLS), amount: int(1, 100) });
export type XpGrant = z.infer<typeof XpGrantSchema>;

/** Energy, the starter kit and the xp of each action (P17.20; costs of tools live in tools.json). */
export const ProgressionSchema = z.object({
  energy: z.object({ max: int(1, 999) }),
  starterKit: z.object({
    money: int(0, 1_000_000),
    /** Item id to quantity. Granted once per account through the ledger. */
    items: z.record(IdSchema, Qty),
  }),
  xp: z.object({ harvest: XpGrantSchema, chop: XpGrantSchema, mine: XpGrantSchema }),
});
export type Progression = z.infer<typeof ProgressionSchema>;

export const ProgressionFileSchema = z.object({ progression: ProgressionSchema });

export const ItemsFileSchema = z.object({ items: z.array(ItemSchema).min(1) });
export const CropsFileSchema = z.object({ crops: z.array(CropSchema).min(1) });
export const ToolsFileSchema = z.object({ tools: z.array(ToolSchema).min(1) });
export const RecipesFileSchema = z.object({ recipes: z.array(RecipeSchema).min(1) });
export const AnimalsFileSchema = z.object({ animals: z.array(AnimalSchema).min(1) });
export const FishFileSchema = z.object({ fish: z.array(FishSchema).min(1) });
export const GiftsFileSchema = z
  .object({
    points: GiftPointsSchema,
    limits: GiftLimitsSchema,
    npcs: z.array(GiftProfileSchema).min(1),
  })
  .superRefine((file, ctx) => {
    if (!unique(file.npcs.map((profile) => profile.npc))) {
      ctx.addIssue({ code: 'custom', path: ['npcs'], message: 'one profile per npc' });
    }
  });
