import { TILE } from '../constants';

/** One world cell is one 32 px tile on the same grid as the office (ADR-053). */
export const WORLD_CELL_PX = TILE;
/** Cells per chunk side: a chunk is 32 x 32 cells. */
export const CHUNK_SIZE = 32;
/** Integer height levels run 0..LEVEL_MAX (ADR-053). */
export const LEVEL_MAX = 7;
/** World coordinates (cells) stay within +-2^20 so every float stays exact (ADR-053). */
export const WORLD_COORD_LIMIT = 1 << 20;
/**
 * Most patched cells one world may store across all its chunks (ADR-053: unbounded exploration
 * storage is a risk, so edits are capped). Tunable; checked when a delta is saved.
 */
export const WORLD_DELTA_CELL_CAP = 40000;
