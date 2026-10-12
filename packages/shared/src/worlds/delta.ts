/**
 * Chunk deltas (ADR-053): the stored edits to a chunk's base terrain. Only the changed cells are
 * kept, keyed by local index (0..1023), so the base is always regenerated from the seed and the
 * stored state stays small. Client and server apply the same deltas to the same base.
 */
import { z } from 'zod';
import type { CellOverlay, CellPatch } from './cells';
import { CHUNK_SIZE, LEVEL_MAX } from './constants';
import type { BlockRegistry } from './registry';
import { CONTENT_ID, getBlock } from './registry';
import { chunkIndex, type Chunk } from './terrain';

export const CHUNK_CELLS = CHUNK_SIZE * CHUNK_SIZE;

const PatchSchema = z.strictObject({
  bedAxis: z.enum(['vertical', 'horizontal']).optional(),
  level: z.number().int().min(0).max(LEVEL_MAX).optional(),
  block: z.string().regex(CONTENT_ID, 'block id must be lower_snake').optional(),
  decor: z.union([z.string().regex(CONTENT_ID, 'decor id must be lower_snake'), z.literal('')]).optional(),
});

/** Patches by local cell index: `{ "0": { "block": "tilled_soil" }, "517": { "decor": "" } }`. */
export const ChunkDeltaSchema = z
  .record(z.string().regex(/^(0|[1-9]\d{0,3})$/, 'a cell index'), PatchSchema)
  .refine((delta) => Object.keys(delta).every((key) => Number(key) < CHUNK_CELLS), {
    message: `cell index must be below ${CHUNK_CELLS}`,
  });
export type ChunkDelta = Record<string, CellPatch>;

/** Number of patched cells in a delta (what the per-world cap counts). */
export function deltaCells(delta: ChunkDelta): number {
  return Object.keys(delta).length;
}

/**
 * Problems with the block ids of a delta, as readable lines: unknown ids, and decor written
 * on a ground block or ground written with a decor id. Empty when every id is right.
 */
export function deltaIdProblems(delta: ChunkDelta, blocks: BlockRegistry): string[] {
  const problems: string[] = [];
  for (const [key, patch] of Object.entries(delta)) {
    if (patch.block !== undefined) {
      const block = getBlock(blocks, patch.block);
      if (!block) problems.push(`${key}.block: unknown block "${patch.block}"`);
      else if (block.layer !== 'ground') problems.push(`${key}.block: "${patch.block}" is decor`);
    }
    if (patch.decor) {
      const decor = getBlock(blocks, patch.decor);
      if (!decor) problems.push(`${key}.decor: unknown block "${patch.decor}"`);
      else if (decor.layer !== 'decor') problems.push(`${key}.decor: "${patch.decor}" is ground`);
    }
  }
  return problems;
}

/**
 * The chunk with `delta` applied. The base is not modified: the arrays are copied, so a cached
 * base chunk can be shared safely.
 */
export function applyDelta(base: Chunk, delta: ChunkDelta): Chunk {
  const level = base.level.slice();
  const block = base.block.slice();
  const decor = base.decor.slice();
  const bedAxis = base.bedAxis?.slice() ?? [];
  for (const [key, patch] of Object.entries(delta)) {
    const k = Number(key);
    if (!Number.isInteger(k) || k < 0 || k >= CHUNK_CELLS) continue;
    if (patch.level !== undefined) level[k] = patch.level;
    if (patch.block !== undefined) block[k] = patch.block;
    if (patch.decor !== undefined) decor[k] = patch.decor;
    if (patch.bedAxis !== undefined) bedAxis[k] = patch.bedAxis;
  }
  return { cx: base.cx, cy: base.cy, level, block, decor, ...(bedAxis.length ? {bedAxis} : {}) };
}

/**
 * An overlay for WorldTerrain that reads deltas from `lookup(cx, cy)`, so a world's stored
 * edits show up in collision, pathfinding and rendering without copying chunks.
 */
export function deltaOverlay(lookup: (cx: number, cy: number) => ChunkDelta | undefined): CellOverlay {
  return (x, y) => {
    const cx = Math.floor(x / CHUNK_SIZE);
    const cy = Math.floor(y / CHUNK_SIZE);
    const delta = lookup(cx, cy);
    if (!delta) return undefined;
    return delta[String(chunkIndex(x - cx * CHUNK_SIZE, y - cy * CHUNK_SIZE))];
  };
}
