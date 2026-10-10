/**
 * Scene description for the 2.5D spike (ADR-052): turns one region of the 2D map into textured
 * faces in 3D, so both engines draw exactly the same thing. Units: 1 = one tile (32 px).
 * Axes: x east, y up, z south (z = map y / 32). The camera always looks north.
 *
 * Mapping rules (first draft of P16.4):
 * - floor layer → flat quads at y = 0 (water too: ponds and the waterfall pool collide anyway);
 * - walls → boxes; a `wallTop` with a `wallFront` (or window) south of it is one box two cells deep
 *   whose front face shows the front art (collision is unchanged: both cells were solid);
 * - furniture with a surface (desks) → boxes extruded from the 3/4 art: rows above `split` are
 *   the top face, rows below it the front face;
 * - other furniture and `above` tiles → upright cards standing on their lowest opaque row; a
 *   `…Top` / `treeTop` tile north of its base joins the same card; waterfall columns are one card;
 * - `hanging` above-tiles directly south of a wall become decals on the wall's front face.
 */
import { TILE_DEFS, type WorldMap } from '@agora/shared';

export type V3 = [number, number, number];
export interface Face {
  /** corners in screen order: top-left, top-right, bottom-right, bottom-left */
  p: [V3, V3, V3, V3];
  tile: number;
  /** source rect inside the 32 px tile */
  u0: number;
  v0: number;
  u1: number;
  v1: number;
  /** 0 = lit (tops, floor), 1 = shaded (fronts), 2 = dark (sides) */
  shade: 0 | 1 | 2;
  /** painter's sort key (bigger = nearer the camera); floor faces get -1 */
  key: number;
  kind: 'floor' | 'wall' | 'box' | 'card' | 'decal';
}
export interface LightSpot {
  x: number;
  y: number;
  z: number;
  kind: string;
}
export interface SceneDesc {
  faces: Face[];
  lights: LightSpot[];
  /** region bounds in tiles */
  x0: number;
  z0: number;
  w: number;
  d: number;
  /** wall boxes, for occlusion and the minimal walls-only stats */
  wallCells: number;
}

/** Opaque extents of every tile's art, scanned once from the tileset canvas. */
export interface Extents {
  r0: number;
  r1: number;
  c0: number;
  c1: number;
}
export function scanExtents(tileset: HTMLCanvasElement, cols: number): Extents[] {
  const c = tileset.getContext('2d', { willReadFrequently: true })!;
  const data = c.getImageData(0, 0, tileset.width, tileset.height).data;
  return TILE_DEFS.map((_, i) => {
    const ox = (i % cols) * 32;
    const oy = Math.floor(i / cols) * 32;
    let r0 = 32, r1 = -1, c0 = 32, c1 = -1;
    for (let y = 0; y < 32; y++)
      for (let x = 0; x < 32; x++) {
        if (data[((oy + y) * tileset.width + ox + x) * 4 + 3]! < 128) continue;
        r0 = Math.min(r0, y);
        r1 = Math.max(r1, y);
        c0 = Math.min(c0, x);
        c1 = Math.max(c1, x);
      }
    return r1 < 0 ? { r0: 0, r1: -1, c0: 0, c1: -1 } : { r0, r1, c0, c1 };
  });
}

/** Row where a desk's top face ends and its front begins (from the art, ADR-037 band rows 8–21). */
const SPLIT: Record<string, number> = {
  deskH: 21,
  deskMonitor: 21,
  deskMonitorBack: 21,
  deskCorner: 21,
  deskCornerUp: 24,
  deskV: 26,
};

const base = (name: string) => name.replace(/^(jungle|oasis|boreal|zen|hub)\./, '');

export interface BuildOpts {
  wallH: number;
}

export function buildScene(
  map: WorldMap,
  region: { x: number; y: number; w: number; h: number },
  ext: Extents[],
  opts: BuildOpts,
): SceneDesc {
  const faces: Face[] = [];
  const lights: LightSpot[] = [];
  const W = map.width;
  const fg = 1; // single tileset, firstgid 1
  const at = (layer: string, cx: number, cy: number): number => {
    if (cx < region.x || cy < region.y || cx >= region.x + region.w || cy >= region.y + region.h)
      return -1;
    const g = map.layers[layer]?.[cy * W + cx] ?? 0;
    return g ? g - fg : -1;
  };
  const nameAt = (layer: string, cx: number, cy: number) => {
    const i = at(layer, cx, cy);
    return i >= 0 ? base(TILE_DEFS[i]!.name) : '';
  };
  const isWall = (cx: number, cy: number) => at('walls', cx, cy) >= 0;
  const wallH = opts.wallH;

  const quad = (f: Omit<Face, 'u0' | 'v0' | 'u1' | 'v1'> & Partial<Face>): void => {
    faces.push({ u0: 0, v0: 0, u1: 32, v1: 32, ...f } as Face);
  };

  for (let cy = region.y; cy < region.y + region.h; cy++)
    for (let cx = region.x; cx < region.x + region.w; cx++) {
      const x = cx, z = cy;
      // ── floor
      const fl = at('floor', cx, cy);
      if (fl >= 0)
        quad({ p: [[x, 0, z], [x + 1, 0, z], [x + 1, 0, z + 1], [x, 0, z + 1]], tile: fl, shade: 0, key: -1, kind: 'floor' });

      // ── walls
      const wt = at('walls', cx, cy);
      if (wt >= 0) {
        const nm = nameAt('walls', cx, cy);
        const north = nameAt('walls', cx, cy - 1);
        // a front cell under its wallTop is drawn by that box
        if ((nm === 'wallFront' || nm === 'window') && north === 'wallTop') continue;
        const southName = nameAt('walls', cx, cy + 1);
        const deep = nm === 'wallTop' && (southName === 'wallFront' || southName === 'window') ? 2 : 1;
        const frontTile = deep === 2 ? at('walls', cx, cy + 1) : wt;
        const zf = z + deep;
        // top (one quad per cell so the stone texture keeps square pixels)
        for (let k = 0; k < deep; k++)
          quad({ p: [[x, wallH, z + k], [x + 1, wallH, z + k], [x + 1, wallH, z + k + 1], [x, wallH, z + k + 1]], tile: wt, shade: 0, key: zf, kind: 'wall' });
        // front face, unless another wall continues south
        if (!isWall(cx, cy + deep)) {
          const frontName = base(TILE_DEFS[frontTile]!.name);
          const ft = frontName === 'wallTop' ? (at('walls', cx, cy) >= 0 ? frontTile : wt) : frontTile;
          // lower tile: the front art; above it, the art's upper stone rows repeat
          quad({ p: [[x, 1, zf], [x + 1, 1, zf], [x + 1, 0, zf], [x, 0, zf]], tile: ft, shade: 1, key: zf, kind: 'wall' });
          for (let y = 1; y < wallH - 1e-6; y += 0.5)
            quad({ p: [[x, Math.min(y + 0.5, wallH), zf], [x + 1, Math.min(y + 0.5, wallH), zf], [x + 1, y, zf], [x, y, zf]], tile: ft, v0: 0, v1: 16 * Math.min(1, (wallH - y) / 0.5), shade: 1, key: zf, kind: 'wall' });
          // hanging vines on this face
          const hang = at('above', cx, cy + deep);
          if (hang >= 0 && nameAt('above', cx, cy + deep) === 'hanging')
            quad({ p: [[x, wallH, zf + 0.01], [x + 1, wallH, zf + 0.01], [x + 1, wallH - 1, zf + 0.01], [x, wallH - 1, zf + 0.01]], tile: hang, shade: 0, key: zf + 0.01, kind: 'decal' });
        }
        // sides where the wall ends
        if (!isWall(cx - 1, cy))
          quad({ p: [[x, wallH, z], [x, wallH, zf], [x, 0, zf], [x, 0, z]], tile: frontTile, shade: 2, key: zf - 0.001, kind: 'wall' });
        if (!isWall(cx + 1, cy))
          quad({ p: [[x + 1, wallH, zf], [x + 1, wallH, z], [x + 1, 0, z], [x + 1, 0, zf]], tile: frontTile, shade: 2, key: zf - 0.001, kind: 'wall' });
      }

      // ── furniture
      const ft = at('furniture', cx, cy);
      if (ft >= 0) {
        const nm = nameAt('furniture', cx, cy);
        const def = TILE_DEFS[ft]!;
        const e = ext[ft]!;
        if (def.light) lights.push({ x: x + 0.5, y: 1, z: z + 0.8, kind: def.light });
        if (nm === 'slot' || e.r1 < 0) {
          /* invisible blocker */
        } else if (/^pond/.test(nm) || /^fall3/.test(nm)) {
          quad({ p: [[x, 0.005, z], [x + 1, 0.005, z], [x + 1, 0.005, z + 1], [x, 0.005, z + 1]], tile: ft, shade: 0, key: -1, kind: 'floor' });
        } else if (/^fall[12]/.test(nm)) {
          /* part of the waterfall card drawn from its fall2x row */
        } else if (/^fall2/.test(nm) || /^fall0/.test(nm)) {
          // waterfall column: fall0x / fall1x / fall2x stacked into one card standing on row 2
          if (/^fall0/.test(nm)) {
            const zf = z + 3;
            const stack = [ft, at('furniture', cx, cy + 1), at('furniture', cx, cy + 2)];
            stack.forEach((t, k) => {
              if (t < 0) return;
              const yTop = 3 - k;
              quad({ p: [[x, yTop, zf], [x + 1, yTop, zf], [x + 1, yTop - 1, zf], [x, yTop - 1, zf]], tile: t, shade: 0, key: zf, kind: 'card' });
            });
          }
        } else if (def.surface !== undefined && SPLIT[nm] !== undefined) {
          box(faces, x, z, ft, e, SPLIT[nm]!);
        } else if (/Top$/.test(nm) && /Bot$|Base$/.test(nameAt('furniture', cx, cy + 1))) {
          /* drawn with its base below */
        } else {
          // upright card, base on the lowest opaque row; a Top tile north of it joins the card
          const zf = z + (e.r1 + 1) / 32 - 0.03;
          const h = (e.r1 + 1) / 32;
          quad({ p: [[x, h, zf], [x + 1, h, zf], [x + 1, 0, zf], [x, 0, zf]], tile: ft, v1: e.r1 + 1, shade: 0, key: zf, kind: 'card' });
          const topF = at('furniture', cx, cy - 1);
          const topA = at('above', cx, cy - 1);
          const top = /Top$/.test(nameAt('furniture', cx, cy - 1)) ? topF : nameAt('above', cx, cy - 1) === 'treeTop' ? topA : -1;
          if (top >= 0)
            quad({ p: [[x, h + 1, zf], [x + 1, h + 1, zf], [x + 1, h, zf], [x, h, zf]], tile: top, shade: 0, key: zf, kind: 'card' });
        }
      }
    }
  return {
    faces,
    lights,
    x0: region.x,
    z0: region.y,
    w: region.w,
    d: region.h,
    wallCells: faces.filter((f) => f.kind === 'wall').length,
  };
}

/** A desk extruded from its 3/4 art: top face = rows [r0, split), front = rows [split, r1]. */
function box(faces: Face[], cx: number, cy: number, t: number, e: Extents, split: number) {
  const zf = cy + (e.r1 + 1) / 32;
  const zb = zf - (split - e.r0) / 32;
  const h = (e.r1 + 1 - split) / 32;
  const x0 = cx + e.c0 / 32;
  const x1 = cx + (e.c1 + 1) / 32;
  const k = zf;
  faces.push({ p: [[x0, h, zb], [x1, h, zb], [x1, h, zf], [x0, h, zf]], tile: t, u0: e.c0, u1: e.c1 + 1, v0: e.r0, v1: split, shade: 0, key: k, kind: 'box' });
  faces.push({ p: [[x0, h, zf], [x1, h, zf], [x1, 0, zf], [x0, 0, zf]], tile: t, u0: e.c0, u1: e.c1 + 1, v0: split, v1: e.r1 + 1, shade: 0, key: k, kind: 'box' });
  // sides: the front art's edge column, dark
  faces.push({ p: [[x0, h, zb], [x0, h, zf], [x0, 0, zf], [x0, 0, zb]], tile: t, u0: e.c0, u1: e.c0 + 1, v0: split, v1: e.r1 + 1, shade: 2, key: k - 0.001, kind: 'box' });
  faces.push({ p: [[x1, h, zf], [x1, h, zb], [x1, 0, zb], [x1, 0, zf]], tile: t, u0: e.c1, u1: e.c1 + 1, v0: split, v1: e.r1 + 1, shade: 2, key: k - 0.001, kind: 'box' });
}
