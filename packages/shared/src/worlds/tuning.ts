/**
 * The tuning panel's model (ADR-053, P17.12): every number of `worldgen.json` as a slider, a pure
 * way to change one of them (the schema still checks the result), and the preview of what those
 * params make, from the same `WorldTerrain` the game uses. Nothing here decides a world: worlds
 * keep the params of their `genVersion`, so the panel only shows and copies values.
 */
import { WorldGenParamsSchema, type WorldGenParams } from './gen';
import { WorldTerrain, type WorldCell } from './cells';

export type TuningGroup = 'elevation' | 'temperature' | 'humidity' | 'shape' | 'rivers';

export interface TuningField {
  /** dotted path into the params, e.g. `elevation.scale` */
  readonly key: string;
  readonly group: TuningGroup;
  /** the slider's range: always inside what the schema accepts */
  readonly min: number;
  readonly max: number;
  readonly step: number;
}

/** Every value of `worldgen.json` (a test checks that nothing is missing or extra). */
export const TUNING_FIELDS: readonly TuningField[] = [
  { key: 'elevation.scale', group: 'elevation', min: 8, max: 512, step: 1 },
  { key: 'elevation.octaves', group: 'elevation', min: 1, max: 6, step: 1 },
  { key: 'elevation.contrast', group: 'elevation', min: 0.5, max: 4, step: 0.05 },
  { key: 'temperature.scale', group: 'temperature', min: 8, max: 512, step: 1 },
  { key: 'temperature.octaves', group: 'temperature', min: 1, max: 6, step: 1 },
  { key: 'temperature.contrast', group: 'temperature', min: 0.5, max: 4, step: 0.05 },
  { key: 'humidity.scale', group: 'humidity', min: 8, max: 512, step: 1 },
  { key: 'humidity.octaves', group: 'humidity', min: 1, max: 6, step: 1 },
  { key: 'humidity.contrast', group: 'humidity', min: 0.5, max: 4, step: 0.05 },
  { key: 'seaElevation', group: 'shape', min: 0.05, max: 0.95, step: 0.01 },
  { key: 'beachWidth', group: 'shape', min: 0, max: 0.3, step: 0.01 },
  { key: 'alpineElevation', group: 'shape', min: 0.05, max: 1, step: 0.01 },
  { key: 'rivers.sourceGrid', group: 'rivers', min: 4, max: 64, step: 1 },
  { key: 'rivers.sourceChance', group: 'rivers', min: 0, max: 1, step: 0.01 },
  { key: 'rivers.sourceHeight', group: 'rivers', min: 0, max: 1, step: 0.01 },
  { key: 'rivers.maxSteps', group: 'rivers', min: 8, max: 256, step: 1 },
  { key: 'rivers.lakeRadius', group: 'rivers', min: 1, max: 16, step: 1 },
  { key: 'rivers.lakeRise', group: 'rivers', min: 0, max: 0.1, step: 0.001 },
];

/** The number at a dotted path. Throws when the path does not hold a number. */
export function tuningValue(p: WorldGenParams, key: string): number {
  let v: unknown = p;
  for (const k of key.split('.')) v = (v as Record<string, unknown> | undefined)?.[k];
  if (typeof v !== 'number') throw new Error(`no number at ${key}`);
  return v;
}

/**
 * The params with one value changed. A new object: the input is not touched. Throws when the
 * schema would refuse the result (the sliders stay inside it, so a refusal is a bug).
 */
export function withTuning(p: WorldGenParams, key: string, value: number): WorldGenParams {
  if (!TUNING_FIELDS.some((f) => f.key === key)) throw new Error(`no tuning field ${key}`);
  const next = structuredClone(p) as unknown as Record<string, unknown>;
  const path = key.split('.');
  const last = path.pop()!;
  let o = next;
  for (const k of path) o = o[k] as Record<string, unknown>;
  o[last] = value;
  return WorldGenParamsSchema.parse(next);
}

/** The params as the `params` block of worldgen.json, ready to paste into it. */
export function tuningJson(p: WorldGenParams): string {
  return JSON.stringify({ params: p }, null, 2);
}

/**
 * The cells of a square of `size` cells around the origin, from the shared generator: what a world
 * with these params and this seed is made of (no stored edits).
 */
export function previewCells(p: WorldGenParams, seed: number, size: number): WorldCell[] {
  const terrain = new WorldTerrain(seed, p, { chunkCapacity: 64 });
  const from = -Math.floor(size / 2);
  const out: WorldCell[] = [];
  for (let y = from; y < from + size; y++)
    for (let x = from; x < from + size; x++) out.push(terrain.cellAt(x, y));
  return out;
}

/** The share of water (ground or decor) in a preview, 0..1. */
export function waterShare(cells: readonly WorldCell[]): number {
  if (cells.length === 0) return 0;
  return cells.filter((c) => c.liquid).length / cells.length;
}
