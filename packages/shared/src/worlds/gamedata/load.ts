import { z } from 'zod';
import {
  AnimalsFileSchema,
  CropsFileSchema,
  FishFileSchema,
  GiftsFileSchema,
  ItemsFileSchema,
  RecipesFileSchema,
  ToolsFileSchema,
  type Animal,
  type Crop,
  type Fish,
  type Item,
  type ItemKind,
  type Recipe,
  type Tool,
  type ToolKind,
} from './schema';
import itemsJson from '../../../data/worlds/items.json';
import cropsJson from '../../../data/worlds/crops.json';
import toolsJson from '../../../data/worlds/tools.json';
import recipesJson from '../../../data/worlds/recipes.json';
import animalsJson from '../../../data/worlds/animals.json';
import fishJson from '../../../data/worlds/fish.json';
import giftsJson from '../../../data/worlds/npc-gifts.json';

export interface GameData {
  readonly items: readonly Item[];
  readonly itemsById: ReadonlyMap<string, Item>;
  readonly crops: readonly Crop[];
  readonly tools: readonly Tool[];
  readonly recipes: readonly Recipe[];
  readonly animals: readonly Animal[];
  readonly fish: readonly Fish[];
  readonly gifts: z.infer<typeof GiftsFileSchema>;
}

/** The raw JSON of each data file, before validation. */
export interface RawGameData {
  readonly items: unknown;
  readonly crops: unknown;
  readonly tools: unknown;
  readonly recipes: unknown;
  readonly animals: unknown;
  readonly fish: unknown;
  readonly gifts: unknown;
}

export class GameDataError extends Error {
  readonly issues: readonly string[];

  constructor(issues: readonly string[]) {
    super(`world game data is invalid:\n${issues.join('\n')}`);
    this.name = 'GameDataError';
    this.issues = issues;
  }
}

const formatZod = (file: string, error: z.ZodError): string[] =>
  error.issues.map((issue) => {
    const path = issue.path.map(String).join('.');
    return `${file}${path ? `.${path}` : ''}: ${issue.message}`;
  });

const duplicates = (ids: readonly string[]): string[] => {
  const seen = new Set<string>();
  const dup = new Set<string>();
  for (const id of ids) (seen.has(id) ? dup : seen).add(id);
  return [...dup];
};

/**
 * Cross-file checks: every reference resolves to a row of the right kind, and
 * every item of a kind has the row that makes it work (a crop item needs a
 * crop, a food item needs a recipe that cooks it, and so on).
 * Returns an empty list when the data is consistent.
 */
export function checkCrossRefs(data: Omit<GameData, 'itemsById'>): string[] {
  const issues: string[] = [];
  const itemsById = new Map(data.items.map((item) => [item.id, item] as const));
  const kindOf = (id: string): ItemKind | undefined => itemsById.get(id)?.kind;

  for (const id of duplicates(data.items.map((i) => i.id))) issues.push(`items: duplicate id ${id}`);
  for (const id of duplicates(data.crops.map((c) => c.id))) issues.push(`crops: duplicate id ${id}`);
  for (const id of duplicates(data.tools.map((t) => t.id))) issues.push(`tools: duplicate id ${id}`);
  for (const id of duplicates(data.recipes.map((r) => r.id))) issues.push(`recipes: duplicate id ${id}`);
  for (const id of duplicates(data.animals.map((a) => a.id))) issues.push(`animals: duplicate id ${id}`);
  for (const id of duplicates(data.fish.map((f) => f.id))) issues.push(`fish: duplicate id ${id}`);

  const expectKind = (file: string, ref: string, kind: ItemKind) => {
    const found = kindOf(ref);
    if (found === undefined) issues.push(`${file}: unknown item ${ref}`);
    else if (found !== kind) issues.push(`${file}: ${ref} is ${found}, expected ${kind}`);
  };

  // Crops: product and seed items, one crop per seed.
  const seedsFromCrops = new Set<string>();
  const productsFromCrops = new Set<string>();
  for (const crop of data.crops) {
    expectKind(`crops.${crop.id}.item`, crop.item, 'crop');
    expectKind(`crops.${crop.id}.seed`, crop.seed, 'seed');
    if (seedsFromCrops.has(crop.seed)) issues.push(`crops: seed ${crop.seed} used by two crops`);
    seedsFromCrops.add(crop.seed);
    productsFromCrops.add(crop.item);
  }
  for (const item of data.items) {
    if (item.kind === 'seed' && !seedsFromCrops.has(item.id)) issues.push(`items: seed ${item.id} has no crop`);
    if (item.kind === 'crop' && !productsFromCrops.has(item.id)) issues.push(`items: crop ${item.id} has no crop row`);
  }

  // Tools: one row per tool item; each tool kind has tiers 1..3 once.
  const toolItems = new Set(data.items.filter((i) => i.kind === 'tool').map((i) => i.id));
  const toolRowIds = new Set<string>();
  const tiersByKind = new Map<ToolKind, number[]>();
  for (const tool of data.tools) {
    expectKind(`tools.${tool.id}`, tool.id, 'tool');
    toolRowIds.add(tool.id);
    tiersByKind.set(tool.tool, [...(tiersByKind.get(tool.tool) ?? []), tool.tier]);
  }
  for (const id of toolItems) if (!toolRowIds.has(id)) issues.push(`tools: item ${id} has no tool row`);
  for (const [kind, tiers] of tiersByKind) {
    if (tiers.length !== new Set(tiers).size) issues.push(`tools: ${kind} repeats a tier`);
  }

  // Recipes: references resolve; each station makes its own output kind.
  const producedBy = new Set<string>();
  for (const recipe of data.recipes) {
    const out = `recipes.${recipe.id}.output`;
    if (!itemsById.has(recipe.output.item)) issues.push(`${out}: unknown item ${recipe.output.item}`);
    producedBy.add(recipe.output.item);
    const outKind = kindOf(recipe.output.item);
    if (recipe.station === 'kitchen' && outKind !== 'food') issues.push(`${out}: kitchen makes food, not ${outKind}`);
    if (recipe.station === 'furnace' && outKind !== 'material')
      issues.push(`${out}: furnace makes materials, not ${outKind}`);
    for (const input of recipe.inputs) {
      if (!itemsById.has(input.item)) issues.push(`recipes.${recipe.id}.inputs: unknown item ${input.item}`);
    }
  }
  for (const item of data.items) {
    if ((item.kind === 'food' || item.kind === 'machine' || item.kind === 'building') && !producedBy.has(item.id)) {
      issues.push(`items: ${item.kind} ${item.id} has no recipe`);
    }
  }

  // Animals and fish.
  const animalItems = new Set(data.items.filter((i) => i.kind === 'animal').map((i) => i.id));
  for (const animal of data.animals) {
    expectKind(`animals.${animal.id}`, animal.id, 'animal');
    if (!itemsById.has(animal.product)) issues.push(`animals.${animal.id}.product: unknown item ${animal.product}`);
    expectKind(`animals.${animal.id}.feed`, animal.feed, 'feed');
    animalItems.delete(animal.id);
  }
  for (const id of animalItems) issues.push(`animals: item ${id} has no animal row`);

  const fishItems = new Set(data.items.filter((i) => i.kind === 'fish').map((i) => i.id));
  for (const fish of data.fish) {
    expectKind(`fish.${fish.id}`, fish.id, 'fish');
    fishItems.delete(fish.id);
  }
  for (const id of fishItems) issues.push(`fish: item ${id} has no fish row`);

  // Gifts: every item exists.
  for (const profile of data.gifts.npcs) {
    const refs = [...profile.love, ...profile.like, ...profile.dislike, ...profile.hate];
    for (const ref of refs) {
      if (!itemsById.has(ref)) issues.push(`gifts.${profile.npc}: unknown item ${ref}`);
    }
  }

  return issues;
}

/**
 * Validates raw JSON for all world data files. Collects every problem and
 * throws one GameDataError listing them, so a bad row is found in one run.
 */
export function parseGameData(raw: RawGameData): GameData {
  const issues: string[] = [];
  const take = <S extends z.ZodType>(file: string, schema: S, value: unknown): z.output<S> | undefined => {
    const result = schema.safeParse(value);
    if (result.success) return result.data as z.output<S>;
    issues.push(...formatZod(file, result.error));
    return undefined;
  };
  const items = take('items', ItemsFileSchema, raw.items);
  const crops = take('crops', CropsFileSchema, raw.crops);
  const tools = take('tools', ToolsFileSchema, raw.tools);
  const recipes = take('recipes', RecipesFileSchema, raw.recipes);
  const animals = take('animals', AnimalsFileSchema, raw.animals);
  const fish = take('fish', FishFileSchema, raw.fish);
  const gifts = take('gifts', GiftsFileSchema, raw.gifts);
  if (
    issues.length > 0 ||
    items === undefined ||
    crops === undefined ||
    tools === undefined ||
    recipes === undefined ||
    animals === undefined ||
    fish === undefined ||
    gifts === undefined
  ) {
    throw new GameDataError(issues);
  }
  const data = {
    items: items.items,
    crops: crops.crops,
    tools: tools.tools,
    recipes: recipes.recipes,
    animals: animals.animals,
    fish: fish.fish,
    gifts,
  };
  const refIssues = checkCrossRefs(data);
  if (refIssues.length > 0) throw new GameDataError(refIssues);
  return { ...data, itemsById: new Map(data.items.map((item) => [item.id, item] as const)) };
}

let cached: GameData | undefined;

/** The game data bundled with this package, validated once and cached. */
export function loadGameData(): GameData {
  cached ??= parseGameData({
    items: itemsJson,
    crops: cropsJson,
    tools: toolsJson,
    recipes: recipesJson,
    animals: animalsJson,
    fish: fishJson,
    gifts: giftsJson,
  });
  return cached;
}
