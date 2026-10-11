/**
 * Content registries for personal worlds (ADR-053): zod schemas, loaders with
 * path-level errors, and the sprite resolver. Content is data: blocks, biomes and
 * the other tables live as JSON in `packages/shared/data/worlds/` and are checked
 * here when the module loads, so a bad row fails at startup with its file and path.
 */
import { z } from 'zod';
import biomesJson from '../../data/worlds/biomes.json';
import blocksJson from '../../data/worlds/blocks.json';
import { LEVEL_MAX } from './constants';
import { HOUSING, STATIONS } from './gamedata/schema';

/**
 * Tool kinds a harvest can require. They are the kinds of tools.json (P17.18) plus `hand` and
 * `shovel` (the shovel comes with terrain edits, P17.24). Renamed from `ToolKind` in P17.20, where
 * gamedata/ gained a `ToolKind` of its own and the barrel export clashed.
 */
export const TOOL_KINDS = ['hand', 'hoe', 'can', 'axe', 'pick', 'shovel'] as const;
export type HarvestToolKind = (typeof TOOL_KINDS)[number];

/** Lower_snake content id such as `meadow_grass` or `oak_tree`. */
export const CONTENT_ID = /^[a-z][a-z0-9_]{1,39}$/;
/** Sprite key: `worlds/<biome or shared>/<name>`. A file path is never written in data. */
export const SPRITE_KEY = /^worlds\/[a-z0-9_]+\/[a-z0-9_]+$/;
const STATE_NAME = /^[a-z][a-z0-9_]{0,23}$/;

export const HarvestDropSchema = z
  .strictObject({
    item: z.string().regex(CONTENT_ID, 'item id must be lower_snake'),
    min: z.number().int().min(0).max(99),
    max: z.number().int().min(0).max(99),
  })
  .refine((drop) => drop.min <= drop.max, { message: 'min must be <= max' });

export const HarvestSchema = z.strictObject({
  tool: z.enum(TOOL_KINDS),
  minTier: z.number().int().min(0).max(3),
  hits: z.number().int().min(1).max(20),
  drops: z.array(HarvestDropSchema).max(6),
});

export const BlockSchema = z
  .strictObject({
    id: z.string().regex(CONTENT_ID, 'lower_snake id, 2 to 40 characters'),
    layer: z.enum(['ground', 'decor']),
    sprite: z.string().regex(SPRITE_KEY, 'expected worlds/<biome or shared>/<name>'),
    solid: z.boolean(),
    liquid: z.boolean(),
    /** Block height in levels above its cell (0 = flat ground). */
    height: z.number().int().min(0).max(LEVEL_MAX),
    placeable: z.boolean().default(false),
    /** Stairs or a ramp: walking may change level by 2 onto or off it (walk.ts). */
    ramp: z.boolean().default(false),
    /** A chest: it holds items on the farm layer, owner only by default (P17.24, ADR-053). Decor only. */
    container: z.boolean().default(false),
    /** A coop or a barn: the animals of this housing live on the cell, up to `capacity` (P17.25). */
    housing: z.enum(HOUSING).optional(),
    capacity: z.number().int().min(1).max(12).optional(),
    /** A crafting station: recipes of this station are made with the block in reach (P17.25). */
    station: z.enum(STATIONS).optional(),
    /** A machine holds one timed batch at a time, collected once its days are done (P17.25). */
    machine: z.boolean().default(false),
    /** A shop board: items are bought with money here (P17.25). */
    shop: z.boolean().default(false),
    /** A hoe can till this ground block into a plot (P17.21). Ground blocks only. */
    tillable: z.boolean().default(false),
    light: z.number().int().min(0).max(15).default(0),
    states: z.array(z.string().regex(STATE_NAME)).max(8).default([]),
    /** Biome ids where this block may appear. Empty means every biome. */
    biomes: z.array(z.string().regex(CONTENT_ID)).max(4).default([]),
    harvest: HarvestSchema.optional(),
  })
  .superRefine((block, ctx) => {
    if (block.liquid && block.solid) {
      ctx.addIssue({ code: 'custom', path: ['solid'], message: 'a liquid cannot also be solid' });
    }
    if (block.layer === 'ground' && block.height !== 0) {
      ctx.addIssue({ code: 'custom', path: ['height'], message: 'ground blocks have height 0' });
    }
    if (block.tillable && block.layer !== 'ground') {
      ctx.addIssue({ code: 'custom', path: ['tillable'], message: 'only ground blocks can be tilled' });
    }
    if (block.ramp && (block.layer !== 'decor' || block.solid || block.liquid)) {
      ctx.addIssue({ code: 'custom', path: ['ramp'], message: 'a ramp is a walkable decor block' });
    }
    if (block.layer === 'ground' && block.harvest) {
      ctx.addIssue({ code: 'custom', path: ['harvest'], message: 'only decor blocks are harvested' });
    }
    if ((block.housing === undefined) !== (block.capacity === undefined)) {
      ctx.addIssue({ code: 'custom', path: ['capacity'], message: 'housing and capacity go together' });
    }
    if (block.machine && block.station === undefined) {
      ctx.addIssue({ code: 'custom', path: ['machine'], message: 'a machine is a station' });
    }
    if ((block.housing !== undefined || block.station !== undefined || block.shop) && block.layer !== 'decor') {
      ctx.addIssue({ code: 'custom', path: ['layer'], message: 'housing, stations and shops are decor' });
    }
  });
export type Block = z.infer<typeof BlockSchema>;

export const BlocksFileSchema = z
  .strictObject({
    version: z.literal(1),
    blocks: z.array(BlockSchema).min(1),
  })
  .superRefine((file, ctx) => {
    const seen = new Set<string>();
    file.blocks.forEach((block, index) => {
      if (seen.has(block.id)) {
        ctx.addIssue({
          code: 'custom',
          path: ['blocks', index, 'id'],
          message: `duplicate id "${block.id}"`,
        });
      }
      seen.add(block.id);
    });
  });

export interface BlockRegistry {
  readonly list: readonly Block[];
  readonly byId: ReadonlyMap<string, Block>;
}

/** A content file failed validation. The message lists every problem with its file and path. */
export class WorldDataError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'WorldDataError';
  }
}

/** One line per issue: `<file>: <path>: <message>`, so the fix is findable without a debugger. */
export function formatWorldDataIssues(file: string, error: z.ZodError): string {
  return error.issues
    .map((issue) => {
      const path = issue.path.map(String).join('.') || '(root)';
      return `${file}: ${path}: ${issue.message}`;
    })
    .join('\n');
}

function indexBlocks(list: readonly Block[]): BlockRegistry {
  return { list, byId: new Map(list.map((block) => [block.id, block] as const)) };
}

/** Validate raw block data (already parsed JSON) and index it. Throws WorldDataError. */
export function parseBlockRegistry(raw: unknown, file = 'blocks.json'): BlockRegistry {
  const parsed = BlocksFileSchema.safeParse(raw);
  if (!parsed.success) throw new WorldDataError(formatWorldDataIssues(file, parsed.error));
  return indexBlocks(parsed.data.blocks);
}

/** The shipped block registry. Loading it fails fast if `blocks.json` is malformed. */
export const BLOCKS: BlockRegistry = parseBlockRegistry(blocksJson);

/** The block for an id, or undefined. Unknown ids are data errors upstream, not code branches. */
export function getBlock(registry: BlockRegistry, id: string): Block | undefined {
  return registry.byId.get(id);
}

/** Office wing palettes (art-src/palettes.json) a biome borrows: Zen, Oasis, Jungle, Boreal. */
export const BIOME_PALETTES = ['zen', 'oasis', 'jungle', 'boreal'] as const;
const UNIT = z.number().min(0).max(1);

export const WorldBiomeSchema = z
  .strictObject({
    id: z.string().regex(CONTENT_ID, 'lower_snake id, 2 to 40 characters'),
    palette: z.enum(BIOME_PALETTES),
    /** Centre in (temperature, humidity) space, both 0..1. Cold is 0, dry is 0. */
    centre: z.strictObject({ temperature: UNIT, humidity: UNIT }),
    surface: z.string().regex(CONTENT_ID),
    subsurface: z.string().regex(CONTENT_ID),
    deep: z.string().regex(CONTENT_ID),
    /** Surface used above the snowline (P17.4). Optional. */
    alpine: z.string().regex(CONTENT_ID).optional(),
    /** Per-cell chance of each decor block, tested with a hash; densities add up to at most 1. */
    decor: z
      .array(z.strictObject({ block: z.string().regex(CONTENT_ID), density: UNIT }))
      .max(8)
      .default([]),
  })
  .superRefine((biome, ctx) => {
    const total = biome.decor.reduce((sum, entry) => sum + entry.density, 0);
    if (total > 1) {
      ctx.addIssue({
        code: 'custom',
        path: ['decor'],
        message: `decor densities add up to ${total.toFixed(3)}, above 1`,
      });
    }
  });
export type WorldBiome = z.infer<typeof WorldBiomeSchema>;

export const WorldBiomesFileSchema = z
  .strictObject({
    version: z.literal(1),
    blend: z.strictObject({ radius: z.number().min(0.05).max(0.9) }),
    biomes: z.array(WorldBiomeSchema).min(1).max(8),
  })
  .superRefine((file, ctx) => {
    const seen = new Set<string>();
    file.biomes.forEach((biome, index) => {
      if (seen.has(biome.id)) {
        ctx.addIssue({
          code: 'custom',
          path: ['biomes', index, 'id'],
          message: `duplicate id "${biome.id}"`,
        });
      }
      seen.add(biome.id);
    });
  });

export interface WorldBiomeRegistry {
  readonly list: readonly WorldBiome[];
  readonly byId: ReadonlyMap<string, WorldBiome>;
  /** Half-width of the blend kernel in (temperature, humidity) units. */
  readonly blendRadius: number;
}

/**
 * Validate biome data and check every block reference against the block registry:
 * surface, subsurface, deep and alpine must be ground blocks that are not liquid; decor
 * entries must be decor blocks; a block's `biomes` must name biomes that exist.
 */
export function parseWorldBiomeRegistry(
  raw: unknown,
  blocks: BlockRegistry,
  file = 'biomes.json',
): WorldBiomeRegistry {
  const parsed = WorldBiomesFileSchema.safeParse(raw);
  if (!parsed.success) throw new WorldDataError(formatWorldDataIssues(file, parsed.error));

  const problems: string[] = [];
  const biomeIds = new Set(parsed.data.biomes.map((biome) => biome.id));
  const checkBlock = (path: string, id: string, layer: Block['layer']) => {
    const block = blocks.byId.get(id);
    if (!block) problems.push(`${file}: ${path}: unknown block "${id}"`);
    else if (block.layer !== layer) {
      problems.push(`${file}: ${path}: "${id}" is a ${block.layer} block, expected ${layer}`);
    } else if (block.liquid) problems.push(`${file}: ${path}: "${id}" is liquid; water comes from sea level and rivers`);
  };
  parsed.data.biomes.forEach((biome, i) => {
    const at = `biomes.${i}`;
    checkBlock(`${at}.surface`, biome.surface, 'ground');
    checkBlock(`${at}.subsurface`, biome.subsurface, 'ground');
    checkBlock(`${at}.deep`, biome.deep, 'ground');
    if (biome.alpine) checkBlock(`${at}.alpine`, biome.alpine, 'ground');
    biome.decor.forEach((entry, j) => checkBlock(`${at}.decor.${j}.block`, entry.block, 'decor'));
  });
  blocks.list.forEach((block, i) => {
    block.biomes.forEach((biomeId, j) => {
      if (!biomeIds.has(biomeId)) {
        problems.push(`blocks.json: blocks.${i}.biomes.${j}: unknown biome "${biomeId}"`);
      }
    });
  });
  if (problems.length > 0) throw new WorldDataError(problems.join('\n'));

  return {
    list: parsed.data.biomes,
    byId: new Map(parsed.data.biomes.map((biome) => [biome.id, biome] as const)),
    blendRadius: parsed.data.blend.radius,
  };
}

/** The shipped biome registry, checked against the shipped blocks. */
export const WORLD_BIOMES: WorldBiomeRegistry = parseWorldBiomeRegistry(biomesJson, BLOCKS);

export interface SpriteSource {
  /** `file` when the registry has an art file for the key, `placeholder` when code draws it. */
  readonly kind: 'file' | 'placeholder';
  readonly key: string;
}

/**
 * Resolve a sprite key against the set of art files that exist. Missing files fall back to the
 * code placeholder (P17.13), so real art is a file drop plus a registry row.
 */
export function resolveSprite(key: string, files: ReadonlySet<string>): SpriteSource {
  return { kind: files.has(key) ? 'file' : 'placeholder', key };
}
