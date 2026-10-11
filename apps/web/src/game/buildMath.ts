/**
 * Pure build-mode helpers of the 2.5D build mode (game3d/BuildMode3D.ts): the directions of the
 * keyboard, the runs of joined furniture and what a run grows with. No Phaser or Three.js here,
 * so the tests can run them without a browser.
 */
import {
  PALETTE,
  TILE_DEFS,
  joinMask,
  type Cell,
  type PaintLayer,
  type TileReader,
} from '@agora/shared';
import type { BuildGroup } from '../state/store';

export type Dir = 'n' | 'e' | 's' | 'w';
export const DIRV: Record<Dir, [number, number]> = {
  n: [0, -1],
  e: [1, 0],
  s: [0, 1],
  w: [-1, 0],
};
export const ARROW_DIR: Record<string, Dir> = {
  ArrowUp: 'n',
  ArrowRight: 'e',
  ArrowDown: 's',
  ArrowLeft: 'w',
};

/** The palette layer a build group paints on. */
export const groupLayer = (g: BuildGroup): PaintLayer => PALETTE.find((p) => p.group === g)!.layer;
/** A prop's raise, clamped to 0..max px (the views clamp alike). */
export const clampZ = (z: number, max: number) => Math.max(0, Math.min(max, z));

/** A straight run of joined furniture through a cell, and where it can grow (P9.18). */
export interface Run {
  cells: Cell[];
  axes: ('h' | 'v')[];
  /** end cell per direction it can grow or shrink towards */
  ends: Partial<Record<Dir, Cell>>;
}

export function runAt(r: TileReader, x: number, y: number): Run | null {
  const d = r.def('furniture', x, y);
  if (!d?.join) return null;
  const m = joinMask(r, x, y);
  const walk = (dx: number, dy: number, bit: number) => {
    const out: Cell[] = [];
    let cx = x;
    let cy = y;
    while (joinMask(r, cx, cy) & bit) {
      cx += dx;
      cy += dy;
      out.push({ cx, cy });
      if (out.length > 200) break;
    }
    return out;
  };
  if (m & 10 || (!(m & 5) && d.join.eastWestOnly)) {
    const w = walk(-1, 0, 8).reverse();
    const e = walk(1, 0, 2);
    const cells = [...w, { cx: x, cy: y }, ...e];
    return { cells, axes: ['h'], ends: { w: cells[0]!, e: cells.at(-1)! } };
  }
  if (m & 5) {
    const n = walk(0, -1, 1).reverse();
    const s = walk(0, 1, 4);
    const cells = [...n, { cx: x, cy: y }, ...s];
    return { cells, axes: ['v'], ends: { n: cells[0]!, s: cells.at(-1)! } };
  }
  // a lone joinable tile can start a run either way
  const c = { cx: x, cy: y };
  return { cells: [c], axes: ['h', 'v'], ends: { n: c, e: c, s: c, w: c } };
}

/** Tile a run grows with: its end's tile, but a desk with a monitor grows as a plain desk. */
export function growTile(name: string): string {
  const def = TILE_DEFS.find((d) => d.name === name);
  if (def?.join?.prop && def.biome) return `${def.biome}.deskH`;
  return name;
}
