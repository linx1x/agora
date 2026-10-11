/**
 * Pure geometry of the 2.5D world view (P17.15, ADR-053): how high a raised cell stands, the cliff
 * face it leaves on its south edge, the cell a view ray meets, and which chunks the camera sees.
 * No Three.js here, so it is unit-tested. Units are tiles (1 = 32 px): x east, y up, z south, as
 * camera.ts and scene.ts. The walker's own position stays in world pixels, as in the flat view.
 */
import { CHUNK_SIZE, WORLD_CELL_PX, type GridCell } from '@agora/shared';
import { LEVEL_PX, type CellWindow } from '../view2d/math';

type V3 = readonly [number, number, number];

/** The height of one level in tiles: 12 px of the flat view over 32 px a tile (ADR-053). */
export const LEVEL_TILES = LEVEL_PX / WORLD_CELL_PX;

/** Height of a cell's top face above the floor, in tiles. */
export function heightOf(level: number): number {
  return level * LEVEL_TILES;
}

/** The face on a cell's south edge that a raised cell leaves above its southern neighbour. */
export interface CliffFace {
  /** height of the neighbour's top (the bottom of the face), tiles */
  readonly low: number;
  /** height of the cell's own top (the top of the face), tiles */
  readonly high: number;
  /** a drop of two or more levels: the darker cliff shade of the flat view */
  readonly steep: boolean;
}

/** The south face of a cell, or null when the cell is level with or below its southern neighbour. */
export function southFace(level: number, southLevel: number): CliffFace | null {
  const drop = level - southLevel;
  if (drop <= 0) return null;
  return { low: heightOf(southLevel), high: heightOf(level), steep: drop >= 2 };
}

/**
 * The first cell a view ray meets: the ray goes from the eye `o` along `d` and stops at the first
 * point that is at or under the top of the cell it is over. The floor is level 0, so a ray that
 * reaches the floor always meets a cell. Null when the ray points up or never gets there.
 */
export function cellOnRay(
  o: V3,
  d: V3,
  levelAt: (cx: number, cy: number) => number,
  step = 0.1,
  maxSteps = 4000,
): GridCell | null {
  if (d[1] >= 0) return null;
  const len = Math.hypot(d[0], d[1], d[2]);
  const dx = d[0] / len;
  const dy = d[1] / len;
  const dz = d[2] / len;
  for (let i = 0; i < maxSteps; i++) {
    const t = i * step;
    const px = o[0] + dx * t;
    const py = o[1] + dy * t;
    const pz = o[2] + dz * t;
    const cx = Math.floor(px);
    const cy = Math.floor(pz);
    if (py <= heightOf(levelAt(cx, cy))) return { cx, cy };
  }
  return null;
}

/** Cells the camera can see, from floor points (tiles, x and z), with margins for raised tops and tall decor. */
export const WINDOW_MARGIN = { up: 6, side: 2, down: 2 } as const;

export function windowOf(
  floor: readonly { readonly x: number; readonly z: number }[],
  margin: { up: number; side: number; down: number } = WINDOW_MARGIN,
): CellWindow {
  const xs = floor.map((p) => p.x);
  const zs = floor.map((p) => p.z);
  return {
    x0: Math.floor(Math.min(...xs)) - margin.side,
    y0: Math.floor(Math.min(...zs)) - margin.up,
    x1: Math.floor(Math.max(...xs)) + margin.side,
    y1: Math.floor(Math.max(...zs)) + margin.down,
  };
}

/** A chunk of cells, by its index (cell x divided by the chunk size, rounded down). */
export interface ChunkIndex {
  readonly ix: number;
  readonly iy: number;
}

export const chunkKey = (c: ChunkIndex): string => `${c.ix},${c.iy}`;

/** The chunks a cell window touches (negative cells are in chunk -1, as the terrain counts them). */
export function chunksIn(w: CellWindow): ChunkIndex[] {
  const out: ChunkIndex[] = [];
  const ix0 = Math.floor(w.x0 / CHUNK_SIZE);
  const iy0 = Math.floor(w.y0 / CHUNK_SIZE);
  const ix1 = Math.floor(w.x1 / CHUNK_SIZE);
  const iy1 = Math.floor(w.y1 / CHUNK_SIZE);
  for (let iy = iy0; iy <= iy1; iy++) for (let ix = ix0; ix <= ix1; ix++) out.push({ ix, iy });
  return out;
}
