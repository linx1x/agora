/**
 * Blended tile compositor (ADR-037, P9.10). Pure: a tile reader and source pixels in, the
 * 32×32 RGBA pixels of one cell out. No DOM, no Phaser, no caching — so the build preview,
 * the live map and the tests all get the same pixels for the same neighbourhood.
 *
 *   Ground (formula 1)   score_t = w_t + A·(noise_t − ½) + H·(height_t − ½)
 *                        w_t: smoothstepped bilinear weight of terrain t over the 4 nearest
 *                        cell centres; texture sampled per cell, noise periodic (GROUND_PERIOD)
 *   Objects (formula 2)  d = min over the core and connector boxes of merged cells
 *                        top: d < 0 · front: top swept down · light: dot(∇d, top-left)
 *                        outline on the outer edge, seam where the material changes
 *   Finish               level → biome ramp through a 4×4 Bayer threshold
 *
 * Everything that varies inside a cell uses cell-local coordinates (px mod 32), so a cell's
 * pixels depend only on what its cache key (`groundKey` / `furnitureKey`) describes.
 */
import {
  BLEND_GEOM,
  GROUND_PERIOD,
  armSpan,
  isMerged,
  joinMask,
  propRestX,
  propRestY,
  type BlendMaterial,
  type Biome,
  type TileReader,
} from '@agora/shared';
import { RIM, materialLook, type MaterialLook, type RGB } from './ramps';

export const T = 32;
const { top: TOP, bottom: BOT, front: FH, apron: APRON, ext: EXT } = BLEND_GEOM;
const RAD = 2; // corner radius of a box
const M = 3; // margin computed around the cell (outline 1 px, shadow 2 px)
const NOISE_A = 0.5;
const HEIGHT_H = 0.28;
const LIGHT: [number, number] = (() => {
  const l = Math.hypot(-0.55, -0.83);
  return [-0.55 / l, -0.83 / l];
})();
const BAYER = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5];
/** cast shadow: black at 25 % (style guide); under a desk between its legs: darker */
const SHADOW_A = 64;
const UNDER_A = 107;
const PERIOD_PX = GROUND_PERIOD * T;

/** Pixels of a tile by name (32×32 RGBA), as drawn in the game's tileset. */
export interface TileSource {
  tile(name: string): Uint8ClampedArray | null;
}

export interface ComposeOptions {
  /** true (default): snap shading to the ramp with a Bayer threshold; false: smooth */
  snap?: boolean;
}

// ───────────────────────────────────────────── noise (deterministic, periodic)
function hash(x: number, y: number, s: number): number {
  let h = Math.imul(x | 0, 374761393) + Math.imul(y | 0, 668265263) + Math.imul(s | 0, 2147483647);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967295;
}
const wrap = (v: number, p: number) => ((v % p) + p) % p;
/** Value noise whose lattice wraps every `p` units, so the pattern tiles. */
function vnoise(x: number, y: number, s: number, p: number): number {
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const fx = x - x0;
  const fy = y - y0;
  const u = fx * fx * (3 - 2 * fx);
  const v = fy * fy * (3 - 2 * fy);
  const a = hash(wrap(x0, p), wrap(y0, p), s);
  const b = hash(wrap(x0 + 1, p), wrap(y0, p), s);
  const c = hash(wrap(x0, p), wrap(y0 + 1, p), s);
  const d = hash(wrap(x0 + 1, p), wrap(y0 + 1, p), s);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}
/** Two octaves, periodic over GROUND_PERIOD cells (6 px and 3 px features). */
function fbmGround(px: number, py: number, s: number): number {
  return (
    vnoise(px / 6, py / 6, s, PERIOD_PX / 6) * 0.65 +
    vnoise(px / 3, py / 3, s + 7, PERIOD_PX / 3) * 0.35
  );
}

function shade(rgb: RGB[], v: number, x: number, y: number, snap: boolean): RGB {
  const top = rgb.length - 1;
  if (snap) {
    const t = (BAYER[((y & 3) << 2) | (x & 3)]! + 0.5) / 16;
    return rgb[Math.max(0, Math.min(top, Math.floor(v + t - 0.5)))]!;
  }
  const c = Math.max(0, Math.min(top, v - 0.5));
  const i = Math.min(top - 1, Math.floor(c));
  const f = c - i;
  const a = rgb[i]!;
  const b = rgb[i + 1]!;
  return [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f, a[2] + (b[2] - a[2]) * f];
}

// ───────────────────────────────────────────── ground (formula 1)
interface Terrain {
  tex: string;
  group: string;
  px: Uint8ClampedArray;
  h: Float32Array;
  seed: number;
}
const heightCache = new WeakMap<Uint8ClampedArray, Float32Array>();
/** Height map of a texture: its own normalised luminance (grass blades stand up). */
function heightOf(px: Uint8ClampedArray): Float32Array {
  const hit = heightCache.get(px);
  if (hit) return hit;
  const h = new Float32Array(T * T);
  let lo = 1e9;
  let hi = -1e9;
  for (let i = 0; i < T * T; i++) {
    const l = 0.3 * px[i * 4]! + 0.59 * px[i * 4 + 1]! + 0.11 * px[i * 4 + 2]!;
    h[i] = l;
    if (l < lo) lo = l;
    if (l > hi) hi = l;
  }
  for (let i = 0; i < T * T; i++) h[i] = (h[i]! - lo) / Math.max(1, hi - lo);
  heightCache.set(px, h);
  return h;
}
const seedOf = (s: string) => {
  let h = 7;
  for (let i = 0; i < s.length; i++) h = (Math.imul(h, 31) + s.charCodeAt(i)) | 0;
  return h & 0xffff;
};

/** Ground pixels of one floor cell. Caller checks `groundKey` first; any cell works though. */
export function composeGround(
  r: TileReader,
  src: TileSource,
  cx: number,
  cy: number,
): Uint8ClampedArray {
  const out = new Uint8ClampedArray(T * T * 4);
  const ownDef = r.def('floor', cx, cy);
  const ownTerr = ownDef?.terrain;
  if (!ownDef || !ownTerr) {
    const p = ownDef ? src.tile(ownDef.name) : null;
    if (p) out.set(p);
    return out;
  }
  const cache = new Map<string, Terrain>();
  const terr = (tex: string, group: string): Terrain | null => {
    let t = cache.get(tex);
    if (!t) {
      const px = src.tile(tex);
      if (!px) return null;
      t = { tex, group, px, h: heightOf(px), seed: seedOf(tex) };
      cache.set(tex, t);
    }
    return t;
  };
  const own = terr(ownTerr.tex, ownTerr.group);
  if (!own) return out;
  // terrain of each cell in the 3×3 (crisp or missing ones count as this cell's own)
  const grid: Terrain[] = [];
  for (let dy = -1; dy <= 1; dy++)
    for (let dx = -1; dx <= 1; dx++) {
      const t = r.def('floor', cx + dx, cy + dy)?.terrain;
      grid.push((t && terr(t.tex, t.group)) || own);
    }
  const at = (gx: number, gy: number) => grid[(gy + 1) * 3 + (gx + 1)]!;

  // terrain index per pixel over the cell + 1 px margin (for the rims)
  const W = T + 2;
  const owner: Terrain[] = new Array(W * W);
  const ox = cx * T;
  const oy = cy * T;
  for (let j = -1; j <= T; j++)
    for (let i = -1; i <= T; i++) {
      const px = ox + i;
      const py = oy + j;
      // nearest four cell centres, relative to this cell (-1..1)
      const gx = (i + 0.5) / T - 0.5;
      const gy = (j + 0.5) / T - 0.5;
      const i0 = Math.floor(gx);
      const j0 = Math.floor(gy);
      let fx = gx - i0;
      let fy = gy - j0;
      fx = fx * fx * (3 - 2 * fx);
      fy = fy * fy * (3 - 2 * fy);
      const a = at(i0, j0);
      const b = at(i0 + 1, j0);
      const c = at(i0, j0 + 1);
      const d = at(i0 + 1, j0 + 1);
      let best = a;
      if (!(a === b && a === c && a === d)) {
        const ws = new Map<Terrain, number>();
        const add = (t: Terrain, w: number) => ws.set(t, (ws.get(t) ?? 0) + w);
        add(a, (1 - fx) * (1 - fy));
        add(b, fx * (1 - fy));
        add(c, (1 - fx) * fy);
        add(d, fx * fy);
        const tx = wrap(px, T);
        const ty = wrap(py, T);
        let bestS = -1e9;
        for (const [t, w] of ws) {
          const s =
            w +
            NOISE_A * (fbmGround(px, py, 31 + t.seed) - 0.5) +
            HEIGHT_H * (t.h[ty * T + tx]! - 0.5) +
            (t.tex < best.tex ? 1e-6 : 0);
          if (s > bestS) {
            bestS = s;
            best = t;
          }
        }
      }
      owner[(j + 1) * W + (i + 1)] = best;
    }

  for (let j = 0; j < T; j++)
    for (let i = 0; i < T; i++) {
      const t = owner[(j + 1) * W + (i + 1)]!;
      const o = (j * T + i) * 4;
      const s = (j * T + i) * 4; // texture sampled per cell (same as the plain tile)
      let rgb: RGB = [t.px[s]!, t.px[s + 1]!, t.px[s + 2]!];
      const up = owner[j * W + (i + 1)]!;
      const left = owner[(j + 1) * W + i]!;
      const down = owner[(j + 2) * W + (i + 1)]!;
      if (t.group === 'dirt' && (up.group === 'green' || left.group === 'green')) rgb = RIM.shadow;
      else if (t.group === 'green' && down.group === 'dirt' && hash(i, j, 3) < 0.55)
        rgb = hash(i, j, 4) < 0.5 ? RIM.tipA : RIM.tipB;
      out[o] = rgb[0];
      out[o + 1] = rgb[1];
      out[o + 2] = rgb[2];
      out[o + 3] = 255;
    }
  return out;
}

// ───────────────────────────────────────────── furniture (formula 2)
interface Box {
  cx: number;
  cy: number;
  hx: number;
  hy: number;
  look: MaterialLook;
  vert: boolean;
}
function sdBox(px: number, py: number, b: Box): number {
  const qx = Math.abs(px - b.cx) - b.hx;
  const qy = Math.abs(py - b.cy) - b.hy;
  const ox = qx > 0 ? qx : 0;
  const oy = qy > 0 ? qy : 0;
  return Math.sqrt(ox * ox + oy * oy) + Math.min(Math.max(qx, qy), 0) - RAD;
}
const box = (
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  look: MaterialLook,
  vert: boolean,
) => ({
  cx: (x0 + x1) / 2,
  cy: (y0 + y1) / 2,
  hx: (x1 - x0) / 2 - RAD,
  hy: (y1 - y0) / 2 - RAD,
  look,
  vert,
});

interface Prop {
  px: Uint8ClampedArray;
  ox: number;
  oy: number;
  baseY: number;
  x0: number;
  x1: number;
  glow: boolean;
}
const boundsCache = new WeakMap<Uint8ClampedArray, [number, number, number]>();
/** [minx, maxx, maxy] of a sprite's opaque pixels. */
function bounds(px: Uint8ClampedArray): [number, number, number] {
  const hit = boundsCache.get(px);
  if (hit) return hit;
  let minx = T;
  let maxx = -1;
  let maxy = -1;
  for (let y = 0; y < T; y++)
    for (let x = 0; x < T; x++)
      if (px[(y * T + x) * 4 + 3]! > 0) {
        if (x < minx) minx = x;
        if (x > maxx) maxx = x;
        if (y > maxy) maxy = y;
      }
  const b: [number, number, number] = maxx < 0 ? [0, T - 1, T - 1] : [minx, maxx, maxy];
  boundsCache.set(px, b);
  return b;
}

/**
 * Where a prop sprite sits when resting on the cell (world px). `blended` false: furniture is
 * drawn with its plain tiles, so props rest on the tile's own surface row.
 */
export function propPlacement(
  r: TileReader,
  px: Uint8ClampedArray,
  cx: number,
  cy: number,
  blended = true,
): { ox: number; oy: number; baseY: number; x0: number; x1: number } | null {
  const rest = blended ? propRestY(r, cx, cy) : (r.def('furniture', cx, cy)?.surface ?? null);
  if (rest === null) return null;
  const [minx, maxx, maxy] = bounds(px);
  const baseY = cy * T + rest;
  const ox = cx * T + Math.round((blended ? propRestX(r, cx, cy) : 16) - (minx + maxx + 1) / 2);
  return { ox, oy: baseY - maxy, baseY, x0: ox + minx, x1: ox + maxx };
}

/** Rows a slab cell (full-width arm) covers, reaching EXT past joined north/south edges. */
function slabRows(r: TileReader, x: number, y: number): [number, number] | null {
  const arm = armSpan(r, x, y);
  if (!arm || arm[1] - arm[0] < T) return null;
  const m = joinMask(r, x, y);
  return [m & 1 ? -EXT : TOP, m & 4 ? T + EXT : BOT];
}

// pixel classes
// 0 = nothing of the object here
const TOPF = 1;
const FRONT = 2;
const LEG = 3;
const UNDER = 4;

/** Furniture-layer pixels of one cell (with alpha). Caller checks `furnitureKey` first. */
export function composeFurniture(
  r: TileReader,
  src: TileSource,
  cx: number,
  cy: number,
  opts: ComposeOptions = {},
): Uint8ClampedArray {
  const snap = opts.snap !== false;
  const out = new Uint8ClampedArray(T * T * 4);

  // boxes of every merged cell in the 3×3: an east–west band (desk depth TOP..BOT across the
  // cell) and/or a north–south arm (ARM_W wide), plus connectors over each joined edge
  const boxes: Box[] = [];
  const own: (MaterialLook | null)[] = []; // material per 3×3 cell
  const props: Prop[] = [];
  for (let dy = -1; dy <= 1; dy++)
    for (let dx = -1; dx <= 1; dx++) {
      const x = cx + dx;
      const y = cy + dy;
      const d = r.def('furniture', x, y);
      if (!d?.join || !isMerged(r, x, y)) {
        own.push(null);
        continue;
      }
      const m = joinMask(r, x, y);
      const look = materialLook(d.join.mat as BlendMaterial, (d.biome ?? r.biome(x, y)) as Biome);
      own.push(look);
      const X = x * T;
      const Y = y * T;
      const arm = armSpan(r, x, y);
      if (m & 10 || !arm) boxes.push(box(X, Y + TOP, X + T, Y + BOT, look, false));
      // a full-width arm is part of a slab (a big table): planks keep running east–west
      const vert = !!arm && arm[1] - arm[0] < T;
      if (arm)
        boxes.push(
          box(X + arm[0], Y + (m & 1 ? 0 : TOP), X + arm[1], Y + (m & 4 ? T : BOT), look, vert),
        );
      // connectors overlap the shared edge by EXT on both sides
      if (m & 2) {
        // between two slab cells the connector spans their whole height (and past the
        // north/south edges they share), else just the desk-top band
        const [ya, yb] = slabRows(r, x, y) ?? [TOP, BOT];
        const [y2a, y2b] = slabRows(r, x + 1, y) ?? [TOP, BOT];
        const both = slabRows(r, x, y) && slabRows(r, x + 1, y);
        const y0 = both ? Math.max(ya, y2a) : TOP;
        const y1 = both ? Math.min(yb, y2b) : BOT;
        boxes.push(box(X + T - EXT, Y + y0, X + T + EXT, Y + y1, look, false));
      }
      if (m & 4 && arm)
        boxes.push(box(X + arm[0], Y + T - EXT, X + arm[1], Y + T + EXT, look, vert));
      // props resting here: baked-in ones (a monitor) and the props layer
      for (const name of [d.join.prop, r.def('props', x, y)?.name]) {
        if (!name) continue;
        const px = src.tile(name);
        const p = px && propPlacement(r, px, x, y);
        if (px && p) props.push({ px, ...p, glow: name === 'prop.lampOn' });
      }
    }
  const ownDef = r.def('furniture', cx, cy);
  if (!boxes.length) {
    const p = ownDef ? src.tile(ownDef.name) : null;
    if (p) out.set(p);
    return out;
  }

  const cellLook = (px: number, py: number): MaterialLook | null => {
    const gx = Math.floor(px / T) - cx + 1;
    const gy = Math.floor(py / T) - cy + 1;
    return gx >= 0 && gy >= 0 && gx < 3 && gy < 3 ? own[gy * 3 + gx]! : null;
  };
  /**
   * Distance to the merged shape, the nearest box (plank direction) and the material: the
   * one of the cell under the point, so a material change sits on the cell edge.
   */
  const field = (x: number, y: number): { d: number; b: Box; look: MaterialLook } => {
    let d = Infinity;
    let best = boxes[0]!;
    for (const b of boxes) {
      const v = sdBox(x, y, b);
      if (v < d) {
        d = v;
        best = b;
      }
    }
    return { d, b: best, look: cellLook(x, y) ?? best.look };
  };

  const B = T + 2 * M;
  const bx = cx * T - M;
  const by = cy * T - M;
  const cls = new Uint8Array(B * B);
  const lev = new Float32Array(B * B);
  const look: (MaterialLook | null)[] = new Array(B * B).fill(null);
  const face: (RGB[] | null)[] = new Array(B * B).fill(null);
  const lamps = props.filter((p) => p.glow);

  for (let j = 0; j < B; j++)
    for (let i = 0; i < B; i++) {
      const k = j * B + i;
      const px = bx + i;
      const py = by + j;
      const sx = px + 0.5;
      const sy = py + 0.5;
      const lx = wrap(px, T);
      const ly = wrap(py, T);
      const f = field(sx, sy);
      if (f.d < 0) {
        const L = f.look;
        cls[k] = TOPF;
        look[k] = L;
        face[k] = L.top;
        let v = L.topLevel;
        if (f.d > -3.5) {
          const gx = field(sx + 1, sy).d - field(sx - 1, sy).d;
          const gy = field(sx, sy + 1).d - field(sx, sy - 1).d;
          const gl = Math.hypot(gx, gy) || 1;
          const e = Math.min(1, Math.max(0, 1 + f.d / 3.5));
          v += 1.35 * e * ((gx / gl) * LIGHT[0] + (gy / gl) * LIGHT[1]);
        }
        if (L.grain === 'planks') {
          // wide, quiet planks: a desk top should not read like the plank floor around it
          const along = f.b.vert ? ly : lx;
          const across = f.b.vert ? lx : ly;
          if (across % 8 === 0) v -= 0.7;
          v += (vnoise(along / 4, across * 3, 5, 8) - 0.5) * 0.6;
          if (hash(lx, ly, 9) < 0.004) v -= 1.4;
        } else {
          v += (vnoise(lx / 4, ly / 4, 11, 8) - 0.5) * 0.7;
          if (hash(lx, ly, 13) < 0.025) v += 0.9;
        }
        for (const p of lamps) {
          const ddx = sx - (p.x0 + 4);
          const ddy = (sy - (p.baseY - 2)) * 1.6;
          const rr = Math.hypot(ddx, ddy);
          if (rr < 18) v += 1.25 * Math.pow(1 - rr / 18, 1.4);
        }
        lev[k] = v;
        continue;
      }
      // front face: the top shape straight above, within FH px
      let kk = 0;
      let g: { d: number; b: Box; look: MaterialLook } | null = null;
      for (let s = 1; s <= FH; s++) {
        const q = field(sx, sy - s);
        if (q.d < 0) {
          kk = s;
          g = q;
          break;
        }
      }
      if (!g) continue;
      const L = g.look;
      look[k] = L;
      face[k] = L.front;
      const qy = sy - kk;
      if (L.legs && kk > APRON) {
        const leftEnd = field(sx - 3, qy).d >= 0;
        const rightEnd = field(sx + 3, qy).d >= 0;
        if (leftEnd || rightEnd) {
          cls[k] = LEG;
          lev[k] = leftEnd && field(sx - 1, qy).d >= 0 ? 2.2 : 1.25;
        } else cls[k] = UNDER;
        continue;
      }
      cls[k] = FRONT;
      let v: number;
      if (L.legs) {
        v = kk === 1 ? 4 : kk === 2 ? 2.9 : kk === APRON ? 1.2 : 2.05;
        if (kk === 4 && lx >= 14 && lx <= 17) v = 4; // drawer pull, one per cell
        if (kk === 5 && lx >= 14 && lx <= 17) v = 1.2;
      } else {
        v = kk === 1 ? 3.6 : kk === 2 ? 2.7 : kk >= FH - 1 ? 0.8 : 1.75;
        if (kk > 2 && kk < FH - 1 && lx === 16) v = 0.7; // cupboard doors
        if (kk === 5 && (lx === 12 || lx === 20)) v = 3.2;
      }
      lev[k] = v;
    }

  const solid = (i: number, j: number) => {
    if (i < 0 || j < 0 || i >= B || j >= B) return false;
    const c = cls[j * B + i];
    return c === TOPF || c === FRONT || c === LEG;
  };
  // outline only where the merged shape meets the outside; seam where the material changes
  const outl = new Uint8Array(B * B);
  for (let j = 1; j < B - 1; j++)
    for (let i = 1; i < B - 1; i++) {
      const k = j * B + i;
      if (!solid(i, j)) continue;
      const up = !solid(i, j - 1);
      if (up || !solid(i - 1, j) || !solid(i + 1, j) || !solid(i, j + 1))
        outl[k] = up && cls[k] === TOPF ? 2 : 1;
      else if (look[k - 1] !== look[k] || (cls[k - B] === cls[k] && look[k - B] !== look[k]))
        outl[k] = 1;
    }
  // contact shadow under each prop: one ramp step darker on the top face
  for (const p of props) {
    const jj = p.baseY + 1 - by;
    for (let x = p.x0 + 1; x <= p.x1 + 1; x++) {
      const ii = x - bx;
      if (ii >= 0 && ii < B && jj >= 0 && jj < B && cls[jj * B + ii] === TOPF)
        lev[jj * B + ii]! -= 1;
    }
    for (let y = p.baseY - 1; y <= p.baseY; y++) {
      const ii = p.x1 + 1 - bx;
      const j2 = y - by;
      if (ii >= 0 && ii < B && j2 >= 0 && j2 < B && cls[j2 * B + ii] === TOPF)
        lev[j2 * B + ii]! -= 1;
    }
  }

  // colour the cell
  for (let j = 0; j < T; j++)
    for (let i = 0; i < T; i++) {
      const bi = i + M;
      const bj = j + M;
      const k = bj * B + bi;
      const o = (j * T + i) * 4;
      const c = cls[k];
      if (c === TOPF || c === FRONT || c === LEG) {
        const ramp = face[k]!;
        const rgb =
          outl[k] === 1
            ? look[k]!.outline
            : outl[k] === 2
              ? ramp[1]!
              : shade(ramp, lev[k]!, i, j, snap);
        out[o] = rgb[0];
        out[o + 1] = rgb[1];
        out[o + 2] = rgb[2];
        out[o + 3] = 255;
        continue;
      }
      // ground under the object (between legs) and its cast shadow: translucent black
      const cast = solid(bi - 2, bj - 2) || solid(bi - 1, bj - 2) || solid(bi - 2, bj - 1);
      let a = 0;
      if (c === UNDER) a = UNDER_A;
      if (cast) a = a ? 255 - ((255 - a) * (255 - SHADOW_A)) / 255 : SHADOW_A;
      out[o + 3] = a;
    }
  // this cell's own (not merged) furniture sits on top of any shadow
  if (ownDef && !(ownDef.join && isMerged(r, cx, cy))) {
    const p = src.tile(ownDef.name);
    if (p) over(out, p, 0, 0);
  }
  // baked-in props (monitors) of merged cells, clipped to this cell
  const ox = cx * T;
  const oy = cy * T;
  for (let dy = -1; dy <= 1; dy++)
    for (let dx = -1; dx <= 1; dx++) {
      const d = r.def('furniture', cx + dx, cy + dy);
      if (!d?.join?.prop || !isMerged(r, cx + dx, cy + dy)) continue;
      const px = src.tile(d.join.prop);
      const p = px && propPlacement(r, px, cx + dx, cy + dy);
      if (px && p) over(out, px, p.ox - ox, p.oy - oy);
    }
  return out;
}

/** Alpha-composite a 32×32 sprite onto a 32×32 cell at an offset (clipped). */
function over(dst: Uint8ClampedArray, src: Uint8ClampedArray, dx: number, dy: number) {
  for (let y = 0; y < T; y++) {
    const ty = y + dy;
    if (ty < 0 || ty >= T) continue;
    for (let x = 0; x < T; x++) {
      const tx = x + dx;
      if (tx < 0 || tx >= T) continue;
      const s = (y * T + x) * 4;
      const a = src[s + 3]! / 255;
      if (!a) continue;
      const o = (ty * T + tx) * 4;
      const da = dst[o + 3]! / 255;
      const oa = a + da * (1 - a);
      for (let c = 0; c < 3; c++)
        dst[o + c] = (src[s + c]! * a + dst[o + c]! * da * (1 - a)) / (oa || 1);
      dst[o + 3] = oa * 255;
    }
  }
}
