/**
 * Cells of a personal world as the server and the client read them (ADR-053): the base terrain
 * from terrain.ts with optional patches on top (stored edits, P17.7). Chunks are generated on
 * demand and kept in a small LRU, so single-cell reads in collision and pathfinding stay cheap.
 */
import { CHUNK_SIZE } from './constants';
import type { WorldGenParams } from './gen';
import { chunkIndex, generateChunk, type Chunk } from './terrain';
import { BLOCKS, WORLD_BIOMES, getBlock, type BlockRegistry, type WorldBiomeRegistry } from './registry';

/** What a walker sees on one cell. Unknown block ids make a cell non-walkable (fail closed). */
export interface WorldCell {
  readonly level: number;
  /** Top block id. */
  readonly block: string;
  /** Decor block id, or '' for none. */
  readonly decor: string;
  /** The decor blocks movement (trees, walls, boulders). */
  readonly solid: boolean;
  /** Water on the ground or in decor: never walked on. */
  readonly liquid: boolean;
  /** Stairs or a ramp: a level change of 2 is allowed onto or off it. */
  readonly ramp: boolean;
  readonly walkable: boolean;
}

/** A stored change to one cell, applied over the generated base (P17.7 deltas). */
export interface CellPatch {
  readonly level?: number;
  readonly block?: string;
  readonly decor?: string;
}

export type CellOverlay = (x: number, y: number) => CellPatch | undefined;

export interface WorldTerrainOptions {
  readonly biomes?: WorldBiomeRegistry;
  readonly blocks?: BlockRegistry;
  readonly overlay?: CellOverlay;
  /** Chunks kept in memory. Default 256 (about 1 MB of cell arrays). */
  readonly chunkCapacity?: number;
}

/** Derive the walking flags of a cell from its block ids. Pure. */
export function describeCell(
  level: number,
  block: string,
  decor: string,
  blocks: BlockRegistry = BLOCKS,
): WorldCell {
  const ground = getBlock(blocks, block);
  const deco = decor ? getBlock(blocks, decor) : undefined;
  const known = ground !== undefined && (decor === '' || deco !== undefined);
  const liquid = (ground?.liquid ?? false) || (deco?.liquid ?? false);
  const solid = deco?.solid ?? false;
  return {
    level,
    block,
    decor,
    solid,
    liquid,
    ramp: deco?.ramp ?? false,
    walkable: known && !solid && !liquid,
  };
}

/** Terrain of one world: generated chunks plus an optional overlay of patches. */
export class WorldTerrain {
  readonly seed: number;
  readonly params: WorldGenParams;
  private readonly biomes: WorldBiomeRegistry;
  private readonly blocks: BlockRegistry;
  private readonly overlay: CellOverlay | undefined;
  private readonly capacity: number;
  private readonly chunks = new Map<string, Chunk>();

  constructor(seed: number, params: WorldGenParams, options: WorldTerrainOptions = {}) {
    this.seed = seed;
    this.params = params;
    this.biomes = options.biomes ?? WORLD_BIOMES;
    this.blocks = options.blocks ?? BLOCKS;
    this.overlay = options.overlay;
    this.capacity = Math.max(1, options.chunkCapacity ?? 256);
  }

  /** Base chunk (cx, cy), generated once and kept while recently used. Never includes patches. */
  chunkAt(cx: number, cy: number): Chunk {
    const key = `${cx},${cy}`;
    const hit = this.chunks.get(key);
    if (hit) {
      this.chunks.delete(key);
      this.chunks.set(key, hit);
      return hit;
    }
    const chunk = generateChunk(this.seed, cx, cy, this.params, this.biomes);
    this.chunks.set(key, chunk);
    if (this.chunks.size > this.capacity) {
      const oldest = this.chunks.keys().next().value;
      if (oldest !== undefined) this.chunks.delete(oldest);
    }
    return chunk;
  }

  /** The cell at world coordinates (cells), with patches applied. */
  cellAt(x: number, y: number): WorldCell {
    const cx = Math.floor(x / CHUNK_SIZE);
    const cy = Math.floor(y / CHUNK_SIZE);
    const chunk = this.chunkAt(cx, cy);
    const k = chunkIndex(x - cx * CHUNK_SIZE, y - cy * CHUNK_SIZE);
    const patch = this.overlay?.(x, y);
    return describeCell(
      patch?.level ?? chunk.level[k] ?? 0,
      patch?.block ?? chunk.block[k] ?? '',
      patch?.decor ?? chunk.decor[k] ?? '',
      this.blocks,
    );
  }
}
