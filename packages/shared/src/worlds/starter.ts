/**
 * The starter stamp (ADR-053, P17.10): a hand-drawn house with a bed, an 8 × 8 farm plot, a
 * shipping bin, a shop board and a return pad, stamped at the origin of every personal world on a
 * square of flattened ground. The stamp is a layer under the stored edits: `starterPatches` gives
 * the stamp's chunk deltas and `mergeDeltas` puts a world's stored edits over them (stored wins).
 * The drawing lives in `packages/maps/worlds/starter.json` and is read by the server.
 */
import { z } from 'zod';
import type { CellPatch } from './cells';
import { CHUNK_SIZE, LEVEL_MAX, WORLD_CELL_PX } from './constants';
import { deltaIdProblems, type ChunkDelta } from './delta';
import type { PortalRect } from '../portals';
import { BLOCKS, CONTENT_ID, WorldDataError, formatWorldDataIssues } from './registry';
import { chunkIndex } from './terrain';
import { chunkKey } from './view';

/** The portal id of the return pad: stepping on it takes a person back to the office. */
export const RETURN_PORTAL_ID = 'return';

const LegendEntry = z.strictObject({
  block: z.string().regex(CONTENT_ID, 'block id must be lower_snake'),
  decor: z.string().regex(CONTENT_ID, 'decor id must be lower_snake').optional(),
});

export const StarterSchema = z.strictObject({
  version: z.literal(1),
  about: z.string().optional(),
  flatten: z.strictObject({
    /** every cell with max(|x|, |y|) <= radius is flattened */
    radius: z.number().int().min(1).max(32),
    level: z.number().int().min(0).max(LEVEL_MAX),
    block: z.string().regex(CONTENT_ID, 'block id must be lower_snake'),
  }),
  /** one character per drawn cell; `.` keeps the flattened ground */
  legend: z.record(
    z
      .string()
      .length(1)
      .regex(/^[^.]$/, 'a legend key is one character, not "."'),
    LegendEntry,
  ),
  /** rows from y = -half to +half, columns from x = -half to +half; the origin is the middle */
  rows: z.array(z.string()).min(1),
  /** the return pad, in cells from the origin */
  ret: z.strictObject({ x: z.number().int(), y: z.number().int() }),
});
export type Starter = z.infer<typeof StarterSchema>;

/** The grid's half-size in cells (the grid is square and odd-sized). */
function halfOf(s: Starter): number {
  return (s.rows.length - 1) / 2;
}

/**
 * Parse and check a starter: a square odd-sized drawing, every character in the legend, nothing
 * drawn outside the flatten square, the return pad inside it, and every block id known.
 */
export function parseStarter(raw: unknown, file = 'starter.json'): Starter {
  const parsed = StarterSchema.safeParse(raw);
  if (!parsed.success) throw new WorldDataError(formatWorldDataIssues(file, parsed.error));
  const s = parsed.data;
  const issues: string[] = [];
  const n = s.rows.length;
  if (n % 2 === 0)
    issues.push(`rows: ${n} rows, but the drawing must have an odd size around the origin`);
  const half = halfOf(s);
  const R = s.flatten.radius;
  if (R > half) issues.push(`flatten.radius ${R} is larger than the drawing (half ${half})`);
  s.rows.forEach((row, j) => {
    if (row.length !== n) issues.push(`rows[${j}]: ${row.length} columns, expected ${n}`);
    [...row].forEach((ch, i) => {
      if (ch === '.') return;
      if (!s.legend[ch]) issues.push(`rows[${j}][${i}]: "${ch}" is not in the legend`);
      const x = i - half;
      const y = j - half;
      if (Math.max(Math.abs(x), Math.abs(y)) > R)
        issues.push(`rows[${j}][${i}]: "${ch}" is drawn outside the flatten square`);
    });
  });
  if (Math.max(Math.abs(s.ret.x), Math.abs(s.ret.y)) > R)
    issues.push(`ret (${s.ret.x}, ${s.ret.y}) is outside the flatten square`);
  if (issues.length > 0) throw new WorldDataError(`${file}: ${issues.join('; ')}`);
  const problems = [...starterPatches(s).values()].flatMap((delta) =>
    deltaIdProblems(delta, BLOCKS),
  );
  if (problems.length > 0) throw new WorldDataError(`${file}: ${problems.join('; ')}`);
  return s;
}

/**
 * The stamp's patches, by chunk key: first the flatten square (level, ground, no decor), then the
 * drawing over it, cell by cell. Only chunks the stamp touches appear.
 */
export function starterPatches(s: Starter): Map<string, ChunkDelta> {
  const out = new Map<string, ChunkDelta>();
  const put = (x: number, y: number, patch: CellPatch) => {
    const cx = Math.floor(x / CHUNK_SIZE);
    const cy = Math.floor(y / CHUNK_SIZE);
    const key = chunkKey(cx, cy);
    const delta = out.get(key) ?? {};
    const k = String(chunkIndex(x - cx * CHUNK_SIZE, y - cy * CHUNK_SIZE));
    delta[k] = { ...delta[k], ...patch };
    out.set(key, delta);
  };
  const R = s.flatten.radius;
  for (let y = -R; y <= R; y++)
    for (let x = -R; x <= R; x++)
      put(x, y, { level: s.flatten.level, block: s.flatten.block, decor: '' });
  const half = halfOf(s);
  s.rows.forEach((row, j) => {
    [...row].forEach((ch, i) => {
      if (ch === '.') return;
      const e = s.legend[ch];
      if (!e) return;
      put(i - half, j - half, { block: e.block, decor: e.decor ?? '' });
    });
  });
  return out;
}

/** Stored edits over a base layer, cell by cell: a cell's stored patch wins, the rest of the layer stays. */
export function mergeDeltas(
  base: ChunkDelta | undefined,
  over: ChunkDelta | undefined,
): ChunkDelta {
  const out: ChunkDelta = {};
  for (const [k, p] of Object.entries(base ?? {})) out[k] = { ...p };
  for (const [k, p] of Object.entries(over ?? {})) out[k] = { ...out[k], ...p };
  return out;
}

/** The return pad as a trigger rectangle in world pixels (one cell). */
export function returnTrigger(s: Starter): PortalRect {
  return {
    x: s.ret.x * WORLD_CELL_PX,
    y: s.ret.y * WORLD_CELL_PX,
    w: WORLD_CELL_PX,
    h: WORLD_CELL_PX,
  };
}
