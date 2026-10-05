/**
 * Blended tiles (ADR-037, P9.9): which cells need a computed look and what it depends on.
 *
 * Maps keep base tile names; the look of a cell is derived on the client from its 3×3
 * neighbourhood. Everything here is pure and shared so the client compositor, the build
 * preview and the tests agree on exactly which cells an edit changes.
 *
 * - Ground: a cell whose terrain blends gets a variant when any neighbour has another
 *   blending texture (formula 1 mixes the 4 nearest cell centres per pixel).
 * - Furniture: joinable tiles (`join`) with at least one joined neighbour merge into one
 *   object (formula 2). A joinable tile on its own keeps its hand-drawn art. Cells next to
 *   a merged object get a variant too, for its cast shadow.
 */
import type { EditLayer } from './edit';
import type { WorldMap } from './map';
import { BIOMES, TILE_DEFS, tileDef, type Biome, type TileDef } from './tileset';

/** Geometry of merged objects, in px inside a 32 px cell (3/4 view, desks.py). */
export const BLEND_GEOM = {
  /** top face starts here in a cell with no joined neighbour above */
  top: 8,
  /** top face ends here (front lip starts) when nothing is joined below */
  bottom: 21,
  /** front face height: lip 2 + apron 4 + legs 4 */
  front: 10,
  /** front rows that stay solid on furniture with legs */
  apron: 6,
  /** how far a connector reaches past the shared edge (keeps joints inside the shape) */
  ext: 8,
} as const;

/** Period, in cells, of the ground noise (variants repeat every PERIOD × PERIOD cells). */
export const GROUND_PERIOD = 3;

/** Read-only view of tile layers; lets the build preview ask "what if" without copying. */
export interface TileReader {
  width: number;
  height: number;
  def(l: EditLayer, x: number, y: number): TileDef | undefined;
  biome(x: number, y: number): Biome;
}

const byName = new Map(TILE_DEFS.map((d) => [d.name, d]));
export const defByName = (name: string | null | undefined): TileDef | undefined =>
  name ? byName.get(name) : undefined;

/**
 * Reader over a live map. `over` maps `layer:x:y` to a tile name (or null) that replaces
 * what the map holds, for previews.
 */
export function mapReader(map: WorldMap, over?: Map<string, string | null>): TileReader {
  const biomeOf = regionBiomes(map);
  return {
    width: map.width,
    height: map.height,
    def(l, x, y) {
      if (x < 0 || y < 0 || x >= map.width || y >= map.height) return undefined;
      if (over) {
        const k = `${l}:${x}:${y}`;
        if (over.has(k)) return defByName(over.get(k));
      }
      return tileDef(map.layers[l]?.[y * map.width + x] ?? 0);
    },
    biome: biomeOf,
  };
}

function regionBiomes(map: WorldMap): (x: number, y: number) => Biome {
  const T = map.tile;
  return (x, y) => {
    const px = x * T + T / 2;
    const py = y * T + T / 2;
    const r = map.regions.find((q) => px >= q.x && py >= q.y && px < q.x + q.w && py < q.y + q.h);
    return (BIOMES as readonly string[]).includes(r?.biome ?? '') ? (r!.biome as Biome) : 'hub';
  };
}

// ───────────────────────────────────────────── furniture

/** Join group of the furniture at a cell, if it can join. */
export function joinAt(r: TileReader, x: number, y: number): TileDef['join'] {
  return r.def('furniture', x, y)?.join;
}

/** Joined neighbours as a bit mask: N = 1, E = 2, S = 4, W = 8. */
export function joinMask(r: TileReader, x: number, y: number): number {
  const j = joinAt(r, x, y);
  if (!j) return 0;
  const same = (dx: number, dy: number) => {
    const o = joinAt(r, x + dx, y + dy);
    if (o?.group !== j.group) return false;
    // north–south links need both sides to allow them
    return dy === 0 || (!j.eastWestOnly && !o.eastWestOnly);
  };
  return (
    (same(0, -1) ? 1 : 0) | (same(1, 0) ? 2 : 0) | (same(0, 1) ? 4 : 0) | (same(-1, 0) ? 8 : 0)
  );
}

/** True if the furniture here is drawn merged (joinable and joined to something). */
export function isMerged(r: TileReader, x: number, y: number): boolean {
  return joinMask(r, x, y) !== 0;
}

/** Width of a desk arm running north–south (the same depth as an east–west desk top). */
export const ARM_W = 14;
const N = 1;
const E = 2;
const S = 4;
const W = 8;
/** Arm alignment from a cell where the arm meets an east–west run: flush with its open end. */
const alignOf = (m: number): 'L' | 'R' | 'C' =>
  m & E && !(m & W) ? 'L' : m & W && !(m & E) ? 'R' : 'C';

/**
 * Horizontal span [x0, x1] (px in the cell) of the north–south arm of a merged object, or null
 * when the cell has no north–south link. Arms are as deep as a desk top; under a corner they
 * sit flush with the run's open end (an L), otherwise centred (a T). A straight arm takes the
 * alignment of the corner up to two cells away along it, so desk pods keep their L.
 */
export function armSpan(r: TileReader, x: number, y: number): [number, number] | null {
  const m = joinMask(r, x, y);
  if (!(m & (N | S))) return null;
  const T = 32;
  let a: 'L' | 'R' | 'C' = 'C';
  if (m & (E | W)) {
    // two east–west runs on top of each other are one slab (a big table): fill between them
    const up = m & N && joinMask(r, x, y - 1) & (E | W);
    const down = m & S && joinMask(r, x, y + 1) & (E | W);
    if (up || down) return [0, T];
    a = alignOf(m);
  } else
    outer: for (const dir of [-1, 1]) {
      const link = dir < 0 ? N : S;
      let cur = m;
      for (let step = 1; step <= 2; step++) {
        if (!(cur & link)) break;
        cur = joinMask(r, x, y + dir * step);
        if (cur & (E | W)) {
          a = alignOf(cur);
          break outer;
        }
      }
    }
  return a === 'L' ? [0, ARM_W] : a === 'R' ? [T - ARM_W, T] : [(T - ARM_W) / 2, (T + ARM_W) / 2];
}

/**
 * Row (px from the cell top) where a prop's base rests, or null when nothing here can hold
 * a prop. Merged objects rest props near the front of their top face.
 */
export function propRestY(r: TileReader, x: number, y: number): number | null {
  const d = r.def('furniture', x, y);
  if (d?.surface === undefined) return null;
  if (!isMerged(r, x, y)) return d.surface;
  return joinMask(r, x, y) & S ? 32 - 4 : BLEND_GEOM.bottom - 4;
}

/** Column (px from the cell left) a prop is centred on: the arm's middle on a north–south arm. */
export function propRestX(r: TileReader, x: number, y: number): number {
  const m = isMerged(r, x, y) ? joinMask(r, x, y) : 0;
  const arm = m & (E | W) ? null : armSpan(r, x, y);
  return arm ? (arm[0] + arm[1]) / 2 : 16;
}

const animated = new Set<string>();
/** Tiles the compositor must leave alone (their animation overlay sits on top). */
export function markAnimated(names: Iterable<string>) {
  for (const n of names) animated.add(n);
}
const isAnimated = (d: TileDef | undefined) => !!d && animated.has(d.name);

/**
 * Cache key for a furniture-layer cell, or null when it keeps its plain tile.
 * Non-null when a merged object sits in the 3×3 around it (its own shape, a joint, or a
 * cast shadow). Equal keys always give equal pixels.
 */
export function furnitureKey(r: TileReader, x: number, y: number): string | null {
  const own = r.def('furniture', x, y);
  if (isAnimated(own)) return null;
  let any = false;
  const parts: string[] = [r.biome(x, y)];
  for (let dy = -1; dy <= 1; dy++)
    for (let dx = -1; dx <= 1; dx++) {
      const d = r.def('furniture', x + dx, y + dy);
      const m = d?.join ? joinMask(r, x + dx, y + dy) : 0;
      if (m) any = true;
      // props only change merged tops (contact shadow, lamp light), so only key them there
      const p = m ? (r.def('props', x + dx, y + dy)?.name ?? '') : '';
      const arm = m ? (armSpan(r, x + dx, y + dy)?.[0] ?? '') : '';
      parts.push(`${d?.name ?? ''}/${m}/${arm}/${p}`);
    }
  return any ? `f|${parts.join('|')}` : null;
}

// ───────────────────────────────────────────── ground

/** Blending terrain at a cell, if any. */
export function terrainAt(r: TileReader, x: number, y: number): TileDef['terrain'] {
  return r.def('floor', x, y)?.terrain;
}

/**
 * Cache key for a floor cell, or null when it keeps its plain tile: crisp floors, and
 * blending cells whose 8 neighbours share their texture (or are crisp).
 */
export function groundKey(r: TileReader, x: number, y: number): string | null {
  const own = r.def('floor', x, y);
  if (!own?.terrain || isAnimated(own)) return null;
  const tex: string[] = [];
  let mixed = false;
  for (let dy = -1; dy <= 1; dy++)
    for (let dx = -1; dx <= 1; dx++) {
      const t = terrainAt(r, x + dx, y + dy);
      // crisp or missing neighbours count as this cell's own terrain: they never bleed in
      const name = t?.tex ?? own.terrain.tex;
      if (name !== own.terrain.tex) mixed = true;
      tex.push(name);
    }
  if (!mixed) return null;
  const px = ((x % GROUND_PERIOD) + GROUND_PERIOD) % GROUND_PERIOD;
  const py = ((y % GROUND_PERIOD) + GROUND_PERIOD) % GROUND_PERIOD;
  return `g|${px},${py}|${tex.join('|')}`;
}

/**
 * Cells whose look can change when (x, y) changes on any layer. Radius 3, not 1: an edit can
 * turn a lone neighbour into a merged one, which changes the cells next to *it*, and a corner
 * sets the alignment of the arm up to two cells along.
 */
export const BLEND_RADIUS = 3;
export function blendNeighbourhood(map: { width: number; height: number }, x: number, y: number) {
  const out: { cx: number; cy: number }[] = [];
  const R = BLEND_RADIUS;
  for (let dy = -R; dy <= R; dy++)
    for (let dx = -R; dx <= R; dx++) {
      const cx = x + dx;
      const cy = y + dy;
      if (cx >= 0 && cy >= 0 && cx < map.width && cy < map.height) out.push({ cx, cy });
    }
  return out;
}
