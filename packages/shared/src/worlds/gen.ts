/**
 * Generation parameters for personal worlds (ADR-053): `worldgen.json` schema and loader.
 *
 * Every world stores the `genVersion` it was created with. The current params are used for
 * new worlds; `versions[<n>]` keeps the params of older versions so that saved deltas still
 * line up with the base terrain they were made on. Changing any value that changes terrain
 * output needs a new genVersion (ADR-053).
 */
import { z } from 'zod';
import worldgenJson from '../../data/worlds/worldgen.json';
import { WorldDataError, formatWorldDataIssues } from './registry';

/** One fractal noise layer: `scale` is the wavelength in cells, `contrast` stretches values around 0.5. */
export const NoiseLayerSchema = z.strictObject({
  scale: z.number().min(8).max(4096),
  octaves: z.number().int().min(1).max(6),
  contrast: z.number().min(0.5).max(4),
});
export type NoiseLayer = z.infer<typeof NoiseLayerSchema>;

/** River tuning (rivers.ts): where water starts, how far it may run, and how lakes form. */
export const RiverParamsSchema = z.strictObject({
  /** One candidate source per sourceGrid x sourceGrid block of cells. */
  sourceGrid: z.number().int().min(4).max(64),
  /** Chance that a block's candidate becomes a source. */
  sourceChance: z.number().min(0).max(1),
  /** A source must be this far (0..1 elevation) above the sea. */
  sourceHeight: z.number().min(0).max(1),
  /** Longest trace in steps; longer traces are dropped everywhere. Max 256 keeps regions bounded. */
  maxSteps: z.number().int().min(8).max(256),
  /** Lakes spread this many cells from their lowest cell. */
  lakeRadius: z.number().int().min(1).max(16),
  /** A lake floods land up to this elevation above its lowest cell. */
  lakeRise: z.number().min(0).max(0.1),
});
export type RiverParams = z.infer<typeof RiverParamsSchema>;

export const WorldGenParamsSchema = z.strictObject({
  elevation: NoiseLayerSchema,
  temperature: NoiseLayerSchema,
  humidity: NoiseLayerSchema,
  /** Elevation (0..1) below which a cell is water. */
  seaElevation: z.number().min(0.05).max(0.95),
  /** Land this far (0..1 elevation) above the sea is beach sand. */
  beachWidth: z.number().min(0).max(0.3),
  /** Elevation (0..1) from which a biome's alpine block is used. */
  alpineElevation: z.number().min(0.05).max(1),
  rivers: RiverParamsSchema,
});
export type WorldGenParams = z.infer<typeof WorldGenParamsSchema>;

export const WorldGenFileSchema = z
  .strictObject({
    genVersion: z.number().int().min(1),
    params: WorldGenParamsSchema,
    versions: z.record(z.string().regex(/^[1-9]\d*$/, 'a version number'), WorldGenParamsSchema).default({}),
  })
  .superRefine((file, ctx) => {
    for (const key of Object.keys(file.versions)) {
      if (Number(key) >= file.genVersion) {
        ctx.addIssue({
          code: 'custom',
          path: ['versions', key],
          message: `must be older than genVersion ${file.genVersion}`,
        });
      }
    }
  });

export interface WorldGen {
  readonly genVersion: number;
  readonly params: WorldGenParams;
  readonly versions: ReadonlyMap<number, WorldGenParams>;
}

/** Validate raw worldgen data (parsed JSON) and index its versions. Throws WorldDataError. */
export function parseWorldGen(raw: unknown, file = 'worldgen.json'): WorldGen {
  const parsed = WorldGenFileSchema.safeParse(raw);
  if (!parsed.success) throw new WorldDataError(formatWorldDataIssues(file, parsed.error));
  const versions = new Map<number, WorldGenParams>();
  for (const [key, params] of Object.entries(parsed.data.versions)) versions.set(Number(key), params);
  return { genVersion: parsed.data.genVersion, params: parsed.data.params, versions };
}

/** The params a world created at `version` was generated with. Unknown versions are an error. */
export function worldGenParamsFor(gen: WorldGen, version: number): WorldGenParams {
  if (version === gen.genVersion) return gen.params;
  const old = gen.versions.get(version);
  if (!old) throw new WorldDataError(`worldgen.json: no params for genVersion ${version}`);
  return old;
}

/** The shipped generation params. */
export const WORLDGEN: WorldGen = parseWorldGen(worldgenJson);
