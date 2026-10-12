/**
 * Which decor stays solid while I work on it (P17.21d, ADR-053). The cell my swing lands on stays
 * out of the occlusion fade (P16.9) for the swing and a short hold after it, and so does the cell in
 * front of me when it is in reach: a tree or rock I chop must not fade just because I stand between
 * it and the camera. Pure: the view passes its clock, my feet and facing, and my swings; it gets back
 * the occluder keys (`cx,cy`, as `scene.ts` names the cells) that never fade.
 */
import { inReach, type CellRef, type Dir } from '@agora/shared';
import { faceCell } from '../inputActs';
import { TARGET_HOLD_MS } from '../tools/swing';

/** One swing of mine: the cell it lands on, and when it ends (ms, on the clock the view reads). */
export interface OwnSwing {
  readonly cell: CellRef;
  readonly endAt: number;
}

/** The occluder key of a map cell, as `occlusionMath.occluderObjects` makes it. */
export const cellKey = (cx: number, cy: number): string => `${cx},${cy}`;

/** My swings still in their hold at `now`: the rest are dropped by the view. */
export function liveSwings(swings: readonly OwnSwing[], now: number): OwnSwing[] {
  return swings.filter((s) => now < s.endAt + TARGET_HOLD_MS);
}

/**
 * The keys of the cells whose decor does not fade now: each live swing's cell, and the faced cell
 * when my feet can reach it (the same reach as a click or Space, `inReach`).
 */
export function targetCells(p: {
  now: number;
  feetX: number;
  feetY: number;
  dir: Dir;
  swings: readonly OwnSwing[];
}): Set<string> {
  const out = new Set<string>();
  for (const s of liveSwings(p.swings, p.now)) out.add(cellKey(s.cell.x, s.cell.y));
  const faced = faceCell(p.feetX, p.feetY, p.dir);
  if (inReach(p.feetX, p.feetY, faced)) out.add(cellKey(faced.x, faced.y));
  return out;
}
