/**
 * How a tile stands in the 2.5D world (P16.4, ADR-052). Visual only: collision, zones and the
 * server never read it. A tile may set `TileDef.d3`; otherwise `shape3d` derives it from the
 * tile's name and blend metadata, so every existing tile has a shape.
 *
 * - `flat`: lies on the floor (ground, rugs, water, pond edges, fire pits).
 * - `wall`: part of a wall box; `wallTop` tiles are its top seen from above, the others
 *   (`wallFront`, `window`, `glassDoor`) its face.
 * - `box`: extruded from its 3/4 art; rows above `split` are the top face, rows below the front.
 *   Joined furniture (ADR-037) ignores `split` and uses `BLEND_GEOM`.
 * - `card`: stands upright on its lowest opaque row. `column` tiles stacked north–south (a tree
 *   and its crown, an arcade cabinet's two halves, a waterfall) make one card on the lowest one.
 * - `decal`: hangs on the face of the wall north of it (vines).
 * - `none`: draws nothing (invisible blockers).
 */
import type { TileDef } from './tileset';

export interface Shape3D {
  kind: 'flat' | 'wall' | 'box' | 'card' | 'decal' | 'none';
  /** box: art row where a lone tile's top face ends and its front starts */
  split?: number;
  /** card: part of a vertical run drawn as one card */
  column?: boolean;
  /** wall: this tile is the wall's top, not its face */
  wallTop?: boolean;
}

const FLAT =
  /^(floor|floorAlt|floorB|floorC|rug|mat|dirt|dirtB|zabuton|water|path\d+|pond\d+|firepit\d+)$/;
/** Lone-tile split rows, read off the art (spikes/world25d/stills). */
const SPLIT: Record<string, number> = {
  deskH: 21,
  deskMonitor: 21,
  deskMonitorBack: 21,
  deskCorner: 21,
  deskCornerUp: 24,
  deskV: 26,
  table: 20,
  coffeeTable: 22,
  counter: 20,
  reception: 20,
  border: 20,
  poolTableL: 20,
  poolTableR: 20,
  pingPongL: 20,
  pingPongR: 20,
};
/** Rows in each wing's waterfall grid: the last row is the pool, drawn flat. */
const FALL_ROWS: Record<string, number> = { jungle: 4, oasis: 3 };

export function shape3d(d: TileDef): Shape3D {
  if (d.d3) return d.d3;
  const b = d.base;
  if (b === 'empty' || b === 'slot') return { kind: 'none' };
  if (b === 'wallTop') return { kind: 'wall', wallTop: true };
  if (b === 'wallFront' || b === 'window' || b === 'glassDoor') return { kind: 'wall' };
  if (FLAT.test(b) || d.terrain) return { kind: 'flat' };
  const fall = /^fall(\d)\d$/.exec(b);
  if (fall) {
    const rows = FALL_ROWS[d.biome ?? ''] ?? 4;
    return Number(fall[1]) >= rows - 1 ? { kind: 'flat' } : { kind: 'card', column: true };
  }
  if (b === 'hanging') return { kind: 'decal' };
  if (SPLIT[b] !== undefined) return { kind: 'box', split: SPLIT[b] };
  if (d.join) return { kind: 'box', split: 21 };
  if (/^(treeBase|treeTop|cabana\d\d|arcade[AB](Top|Bot))$/.test(b))
    return { kind: 'card', column: true };
  return { kind: 'card' };
}
