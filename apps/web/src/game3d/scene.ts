/**
 * P16.4 (ADR-052): one map region → textured faces in 3D. Pure: no canvas, no Three.js, so it is
 * unit-tested and both the 2.5D view and any tool can use it.
 *
 * Units: 1 = one tile (32 px). Axes: x east, y up, z south (z = map y / 32). The camera looks
 * north, so faces looking north are never built.
 *
 * Shapes come from `shape3d` (packages/shared): floor tiles lie flat; walls are boxes (a wallTop
 * with a face tile south of it is one box two cells deep, so it covers both solid cells); desks,
 * tables and counters are extruded from their 3/4 art, joined runs (ADR-037) as one slab with a
 * front only on their south edge; everything else stands up as a card, `column` tiles stacked into
 * one card; vines hang on the wall face north of them. Faces of a joined object or a blended
 * ground cell carry its ADR-037 cache key so the renderer can draw the composed variant.
 */
import {
  BLEND_GEOM,
  TILE,
  TILE_DEFS,
  armSpan,
  furnitureKey,
  groundKey,
  joinMask,
  mapReader,
  shape3d,
  type Shape3D,
  type TileDef,
  type WorldMap,
} from '@agora/shared';

export type V3 = [number, number, number];

export interface Face3D {
  /** corners as seen from the camera: top-left, top-right, bottom-right, bottom-left */
  p: [V3, V3, V3, V3];
  /** tileset index of the art */
  tile: number;
  /** ADR-037 variant key (ground `g|…` or furniture `f|…`): draw that composed cell instead */
  blend?: string;
  /** source rect inside the 32 px cell */
  u0: number;
  v0: number;
  u1: number;
  v1: number;
  /** 0 lit (tops, floors, cards), 1 shaded (wall faces), 2 dark (sides) */
  shade: 0 | 1 | 2;
  kind: 'floor' | 'wall' | 'box' | 'card' | 'decal';
  /** map cell the face belongs to (edits rebuild by cell) */
  cx: number;
  cy: number;
}

export interface Light3D {
  x: number;
  y: number;
  z: number;
  kind: NonNullable<TileDef['light']>;
  /** the tile's biome, for its lamp colour (hub when it has none) */
  biome: string;
}

export interface Scene3D {
  faces: Face3D[];
  lights: Light3D[];
  /** region bounds in tiles */
  x0: number;
  z0: number;
  w: number;
  d: number;
}

/** Opaque extents of a tile's art (rows and columns, inclusive); r1 < 0 = fully transparent. */
export interface Extents {
  r0: number;
  r1: number;
  c0: number;
  c1: number;
}

export interface SceneOptions {
  /** wall height in tiles */
  wallH: number;
}

export const DEFAULT_SCENE: SceneOptions = { wallH: 1.5 };

const N = 1;
const E = 2;
const S = 4;
const W = 8;
const ABOVE_FLOOR = 0.005;

/** Region given in map px (as `WorldMap.regions` stores it), or the whole map. */
export function regionTiles(
  map: WorldMap,
  r?: { x: number; y: number; w: number; h: number },
): { x: number; y: number; w: number; h: number } {
  if (!r) return { x: 0, y: 0, w: map.width, h: map.height };
  return { x: r.x / TILE, y: r.y / TILE, w: r.w / TILE, h: r.h / TILE };
}

export function buildScene(
  map: WorldMap,
  region: { x: number; y: number; w: number; h: number },
  ext: readonly Extents[],
  opts: SceneOptions = DEFAULT_SCENE,
): Scene3D {
  const faces: Face3D[] = [];
  const lights: Light3D[] = [];
  const reader = mapReader(map);
  const inside = (cx: number, cy: number) =>
    cx >= region.x && cy >= region.y && cx < region.x + region.w && cy < region.y + region.h;
  const at = (layer: string, cx: number, cy: number): number => {
    if (!inside(cx, cy)) return -1;
    const g = map.layers[layer]?.[cy * map.width + cx] ?? 0;
    return g > 0 ? (g & 0x1fffffff) - 1 : -1;
  };
  const shapeAt = (layer: string, cx: number, cy: number): Shape3D | undefined => {
    const i = at(layer, cx, cy);
    return i >= 0 ? shape3d(TILE_DEFS[i]!) : undefined;
  };
  const isWall = (cx: number, cy: number) => shapeAt('walls', cx, cy)?.kind === 'wall';
  const isFace = (cx: number, cy: number) => {
    const s = shapeAt('walls', cx, cy);
    return s?.kind === 'wall' && !s.wallTop;
  };
  const H = opts.wallH;
  const add = (f: Omit<Face3D, 'u0' | 'v0' | 'u1' | 'v1'> & Partial<Face3D>) =>
    faces.push({ u0: 0, v0: 0, u1: 32, v1: 32, ...f });

  for (let cy = region.y; cy < region.y + region.h; cy++)
    for (let cx = region.x; cx < region.x + region.w; cx++) {
      const x = cx;
      const z = cy;

      // ── floor: always flat
      const fl = at('floor', cx, cy);
      if (fl >= 0) {
        const key = groundKey(reader, cx, cy);
        add({
          p: [
            [x, 0, z],
            [x + 1, 0, z],
            [x + 1, 0, z + 1],
            [x, 0, z + 1],
          ],
          tile: fl,
          ...(key ? { blend: key } : {}),
          shade: 0,
          kind: 'floor',
          cx,
          cy,
        });
      }

      // ── walls
      const wt = at('walls', cx, cy);
      if (wt >= 0) {
        const def = TILE_DEFS[wt]!;
        if (def.light)
          lights.push({ x: x + 0.5, y: 1, z: z + 1, kind: def.light, biome: def.biome ?? 'hub' });
        const top = shape3d(def).wallTop === true;
        // a face under its wallTop is drawn by that box
        if (!(isFace(cx, cy) && shapeAt('walls', cx, cy - 1)?.wallTop)) {
          const deep = top && isFace(cx, cy + 1) ? 2 : 1;
          const front = deep === 2 ? at('walls', cx, cy + 1) : wt;
          const zf = z + deep;
          for (let k = 0; k < deep; k++) {
            add({
              p: [
                [x, H, z + k],
                [x + 1, H, z + k],
                [x + 1, H, z + k + 1],
                [x, H, z + k + 1],
              ],
              tile: wt,
              shade: 0,
              kind: 'wall',
              cx,
              cy: cy + k,
            });
            for (const side of [-1, 1] as const) {
              if (isWall(cx + side, cy + k)) continue;
              const sx = side < 0 ? x : x + 1;
              const [za, zb] = side < 0 ? [z + k, z + k + 1] : [z + k + 1, z + k];
              add({
                p: [
                  [sx, H, za],
                  [sx, H, zb],
                  [sx, 0, zb],
                  [sx, 0, za],
                ],
                tile: front,
                shade: 2,
                kind: 'wall',
                cx,
                cy: cy + k,
              });
            }
          }
          if (!isWall(cx, cy + deep)) {
            // the face art fills the lowest tile; its upper stone rows repeat up to the top
            add({
              p: [
                [x, Math.min(1, H), zf],
                [x + 1, Math.min(1, H), zf],
                [x + 1, 0, zf],
                [x, 0, zf],
              ],
              tile: front,
              v0: H < 1 ? 32 * (1 - H) : 0,
              shade: 1,
              kind: 'wall',
              cx,
              cy: cy + deep - 1,
            });
            for (let y = 1; y < H - 1e-6; y += 0.5) {
              const y1 = Math.min(y + 0.5, H);
              add({
                p: [
                  [x, y1, zf],
                  [x + 1, y1, zf],
                  [x + 1, y, zf],
                  [x, y, zf],
                ],
                tile: front,
                v0: 16 - 32 * (y1 - y),
                v1: 16,
                shade: 1,
                kind: 'wall',
                cx,
                cy: cy + deep - 1,
              });
            }
          }
        }
      }

      // ── furniture
      const ft = at('furniture', cx, cy);
      if (ft >= 0) {
        const def = TILE_DEFS[ft]!;
        const shape = shape3d(def);
        const e = ext[ft] ?? { r0: 0, r1: 31, c0: 0, c1: 31 };
        if (def.light)
          lights.push({
            x: x + 0.5,
            y: def.light === 'fire' ? 0.4 : 1.1,
            z: z + 0.8,
            kind: def.light,
            biome: def.biome ?? 'hub',
          });
        if (shape.kind === 'none' || e.r1 < 0) {
          /* invisible blocker */
        } else if (shape.kind === 'flat' || shape.kind === 'wall') {
          add({
            p: [
              [x, ABOVE_FLOOR, z],
              [x + 1, ABOVE_FLOOR, z],
              [x + 1, ABOVE_FLOOR, z + 1],
              [x, ABOVE_FLOOR, z + 1],
            ],
            tile: ft,
            shade: 0,
            kind: 'floor',
            cx,
            cy,
          });
        } else if (shape.kind === 'box') {
          const m = joinMask(reader, cx, cy);
          const key = furnitureKey(reader, cx, cy);
          box(
            faces,
            cx,
            cy,
            ft,
            m ? joined(m, armSpan(reader, cx, cy)) : lone(e, shape.split ?? 21),
            key,
          );
        } else if (shape.column && shapeAt('furniture', cx, cy + 1)?.column) {
          /* drawn by the lowest tile of its column */
        } else {
          card(cx, cy, ft, e);
        }
      }

      // ── above: vines on a wall face; crowns are drawn by their column
      const ab = at('above', cx, cy);
      if (ab >= 0) {
        const shape = shape3d(TILE_DEFS[ab]!);
        const onColumn = shape.column && shapeAt('furniture', cx, cy + 1)?.column;
        if (onColumn) {
          /* part of the card below */
        } else if (shape.kind === 'decal' && isWall(cx, cy - 1)) {
          add({
            p: [
              [x, H, z + 0.01],
              [x + 1, H, z + 0.01],
              [x + 1, H - 1, z + 0.01],
              [x, H - 1, z + 0.01],
            ],
            tile: ab,
            shade: 0,
            kind: 'decal',
            cx,
            cy,
          });
        } else
          card(
            cx,
            cy,
            ab,
            ext[ab] ?? { r0: 0, r1: 31, c0: 0, c1: 31 },
            shape.kind === 'decal' ? H - 1 : 0,
          );
      }
    }
  return { faces, lights, x0: region.x, z0: region.y, w: region.w, d: region.h };

  /** An upright card on its lowest opaque row, with the rest of its column stacked above. */
  function card(cx: number, cy: number, t: number, e: Extents, lift = 0) {
    const zf = cy + (e.r1 + 1) / 32 - 0.03;
    const h = (e.r1 + 1) / 32;
    add({
      p: [
        [cx, lift + h, zf],
        [cx + 1, lift + h, zf],
        [cx + 1, lift, zf],
        [cx, lift, zf],
      ],
      tile: t,
      v1: e.r1 + 1,
      shade: 0,
      kind: 'card',
      cx,
      cy,
    });
    if (!shape3d(TILE_DEFS[t]!).column) return;
    for (let k = 1; ; k++) {
      const f = at('furniture', cx, cy - k);
      const a = at('above', cx, cy - k);
      const up =
        f >= 0 && shape3d(TILE_DEFS[f]!).column
          ? f
          : a >= 0 && shape3d(TILE_DEFS[a]!).column
            ? a
            : -1;
      if (up < 0) break;
      const y0 = lift + h + k - 1;
      add({
        p: [
          [cx, y0 + 1, zf],
          [cx + 1, y0 + 1, zf],
          [cx + 1, y0, zf],
          [cx, y0, zf],
        ],
        tile: up,
        shade: 0,
        kind: 'card',
        cx,
        cy: cy - k,
      });
    }
  }
}

/** Box geometry in art rows/columns: top face rows [t0, t1), front `hpx` tall, x span [x0, x1). */
interface BoxGeom {
  t0: number;
  t1: number;
  hpx: number;
  x0: number;
  x1: number;
  front: boolean;
  west: boolean;
  east: boolean;
}

/** A lone tile: geometry read off its art (rows above `split` are the top face). */
export function lone(e: Extents, split: number): BoxGeom {
  return {
    t0: e.r0,
    t1: split,
    hpx: e.r1 + 1 - split,
    x0: e.c0,
    x1: e.c1 + 1,
    front: true,
    west: true,
    east: true,
  };
}

/** A joined cell (ADR-037): one slab with the run's neighbours, front only on the south edge. */
export function joined(m: number, arm: [number, number] | null): BoxGeom {
  const ew = (m & (E | W)) !== 0;
  const [x0, x1] = !ew && arm ? arm : [0, 32];
  return {
    t0: m & N ? 0 : BLEND_GEOM.top,
    t1: m & S ? 32 : BLEND_GEOM.bottom,
    hpx: BLEND_GEOM.front,
    x0,
    x1,
    front: !(m & S),
    west: !(m & W),
    east: !(m & E),
  };
}

/**
 * Extrude a 3/4 drawing: a top-face pixel on row r sits `hpx` above the floor, so it is drawn
 * `hpx` px higher than its floor position; the front face hangs from the top's south edge.
 */
function box(faces: Face3D[], cx: number, cy: number, t: number, g: BoxGeom, key: string | null) {
  const h = g.hpx / 32;
  const zb = cy + (g.t0 + g.hpx) / 32;
  const zf = cy + (g.t1 + g.hpx) / 32;
  const xa = cx + g.x0 / 32;
  const xb = cx + g.x1 / 32;
  const blend = key ? { blend: key } : {};
  const base = { tile: t, u0: g.x0, u1: g.x1, kind: 'box' as const, cx, cy, ...blend };
  faces.push({
    ...base,
    p: [
      [xa, h, zb],
      [xb, h, zb],
      [xb, h, zf],
      [xa, h, zf],
    ],
    v0: g.t0,
    v1: g.t1,
    shade: 0,
  });
  if (g.front)
    faces.push({
      ...base,
      p: [
        [xa, h, zf],
        [xb, h, zf],
        [xb, 0, zf],
        [xa, 0, zf],
      ],
      v0: g.t1,
      v1: g.t1 + g.hpx,
      shade: 0,
    });
  // sides take the front art's edge column, darkened
  const side = (x: number, za: number, zz: number, col: number) =>
    faces.push({
      ...base,
      p: [
        [x, h, za],
        [x, h, zz],
        [x, 0, zz],
        [x, 0, za],
      ],
      u0: col,
      u1: col + 1,
      v0: Math.min(g.t1, 32 - g.hpx),
      v1: Math.min(g.t1, 32 - g.hpx) + g.hpx,
      shade: 2,
    });
  if (g.west) side(xa, zb, zf, g.x0);
  if (g.east) side(xb, zf, zb, g.x1 - 1);
}
