/**
 * Which chunks a person is shown (ADR-053, P17.9): the square of chunks around the one under their
 * feet. The server streams deltas for exactly these; the client generates the base chunks itself
 * from the seed, so nothing else crosses the wire.
 */
import { CHUNK_SIZE, WORLD_CELL_PX } from './constants';

export interface ChunkCoord {
  readonly cx: number;
  readonly cy: number;
}

/** The chunk containing world pixel (x, y). Negative positions floor toward minus infinity. */
export function chunkOfPoint(x: number, y: number): ChunkCoord {
  const size = WORLD_CELL_PX * CHUNK_SIZE;
  return { cx: Math.floor(x / size), cy: Math.floor(y / size) };
}

/** The (2r + 1)² chunks around `center`, row by row from the top-left. */
export function chunksInView(center: ChunkCoord, radius: number): ChunkCoord[] {
  const out: ChunkCoord[] = [];
  for (let cy = center.cy - radius; cy <= center.cy + radius; cy++)
    for (let cx = center.cx - radius; cx <= center.cx + radius; cx++) out.push({ cx, cy });
  return out;
}

/** Key of a chunk in maps and sets. */
export function chunkKey(cx: number, cy: number): string {
  return `${cx},${cy}`;
}
