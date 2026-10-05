/*
 * P9.8 spike — blended tiles from formulas (ADR-037, proposed).
 *
 * Pure renderer: given a grid of base tiles (ground, object, prop per cell) it computes
 * every pixel from the neighbourhood. Nothing here is cached per tile: a region renders
 * the same pixels whether it is drawn alone or as part of the whole map, which is what
 * makes the 3×3 build-mode preview equal the applied result.
 *
 *   Formula 1 (ground):  score_t = w_t(p) + A·(noise_t(p) − ½) + H·(height_t(p) − ½)
 *                        w_t = bilinear weight of terrain t over the 4 nearest cell centres
 *   Formula 2 (objects): d(p) = smin over boxes of one material, then smin across materials
 *                        smin(a,b,k) = min(a,b) − h²k/4,  h = max(k − |a−b|, 0)/k
 *                        top face d < 0, front face = top shape swept down FH px,
 *                        shading = dot(∇d, light) near the edge, outline on exposed edges only.
 *   Finish:              shading level snapped to the biome ramp with a 4×4 Bayer threshold.
 *
 * No DOM access except through the sprite pixels handed to `createBlend`.
 */
(function (root) {
  'use strict';

  const T = 32; // cell size in px
  const TOP = 8; // top face starts at this row in a free-standing cell (desks.py: rows 8-20)
  const BOT = 21; // top face ends here (front lip starts)
  const FH = 10; // front face height: lip 2 + apron 4 + legs 4 (rows 21-30)
  const APRON = 6; // front rows that are solid on a desk; below it only legs
  const EXT = 8; // how far a box reaches into a joined neighbour, so joints are interior
  const RAD = 2; // corner radius of a free-standing box
  // Smooth-min radius. Spike finding: any k > 0 bulges the silhouette wherever two parts
  // overlap (1-2 px dips along every joint), so furniture uses k = 0 (exact union).
  // smin stays for organic families (hedges, ponds) where the bulge is the point.
  const K = 0;
  const NOISE_A = 0.5; // formula 1 noise amplitude
  const HEIGHT_H = 0.28; // formula 1 texture-height amplitude
  const M = 3; // margin computed around a region (outline 1 px, shadow 2 px)
  const LIGHT = norm(-0.55, -0.83); // towards the light: top-left, mostly top
  const BAYER = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5];

  function norm(x, y) {
    const l = Math.hypot(x, y);
    return [x / l, y / l];
  }

  // ───────────────────────── deterministic noise (world space, no Math.random)
  function hash(x, y, s) {
    let h = (x | 0) * 374761393 + (y | 0) * 668265263 + (s | 0) * 2147483647;
    h = (h ^ (h >>> 13)) * 1274126177;
    h = h ^ (h >>> 16);
    return (h >>> 0) / 4294967295;
  }
  function vnoise(x, y, s) {
    const x0 = Math.floor(x);
    const y0 = Math.floor(y);
    const fx = x - x0;
    const fy = y - y0;
    const u = fx * fx * (3 - 2 * fx);
    const v = fy * fy * (3 - 2 * fy);
    const a = hash(x0, y0, s);
    const b = hash(x0 + 1, y0, s);
    const c = hash(x0, y0 + 1, s);
    const d = hash(x0 + 1, y0 + 1, s);
    return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
  }
  function fbm(x, y, s) {
    return vnoise(x / 6, y / 6, s) * 0.65 + vnoise(x / 2.5, y / 2.5, s + 7) * 0.35;
  }

  // ───────────────────────── distance functions
  function sdBox(px, py, b) {
    const qx = Math.abs(px - b.cx) - b.hx;
    const qy = Math.abs(py - b.cy) - b.hy;
    const ox = qx > 0 ? qx : 0;
    const oy = qy > 0 ? qy : 0;
    return Math.sqrt(ox * ox + oy * oy) + Math.min(Math.max(qx, qy), 0) - b.r;
  }
  function smin(a, b, k) {
    if (k <= 0) return Math.min(a, b);
    if (a === Infinity) return b;
    if (b === Infinity) return a;
    const h = Math.max(k - Math.abs(a - b), 0) / k;
    return Math.min(a, b) - (h * h * k) / 4;
  }

  /**
   * @param assets {
   *   sprite(name) -> Uint8ClampedArray(32*32*4) | null,
   *   palette: { name: [r,g,b] },
   * }
   */
  function createBlend(assets) {
    const P = assets.palette;
    const col = (n) => {
      const c = P[n];
      if (!c) throw new Error('palette colour missing: ' + n);
      return c;
    };

    // ── terrains (formula 1). group decides where a rim is drawn.
    const TERRAINS = [
      { id: 'grass', sprite: 'jungle.floor', group: 'green', prio: 1 },
      { id: 'flowers', sprite: 'jungle.floorB', group: 'green', prio: 2 },
      { id: 'dirt', sprite: 'jungle.dirt', group: 'dirt', prio: 0 },
    ];
    const TID = Object.fromEntries(TERRAINS.map((t, i) => [t.id, i]));
    for (const t of TERRAINS) {
      t.px = assets.sprite(t.sprite);
      // height map = normalised luminance of the texture itself (formula 1, h_t)
      const lum = new Float32Array(T * T);
      let lo = 1e9;
      let hi = -1e9;
      for (let i = 0; i < T * T; i++) {
        const l = 0.3 * t.px[i * 4] + 0.59 * t.px[i * 4 + 1] + 0.11 * t.px[i * 4 + 2];
        lum[i] = l;
        if (l < lo) lo = l;
        if (l > hi) hi = l;
      }
      for (let i = 0; i < T * T; i++) lum[i] = (lum[i] - lo) / Math.max(1, hi - lo);
      t.h = lum;
    }

    // ── materials (formula 2). Ramps are palette names, darkest first.
    const MATS = [
      {
        id: 'desk',
        ramp: ['wood0', 'wood1', 'wood2', 'wood3', 'wood4'],
        top: 3,
        legs: true,
      },
      {
        id: 'counter',
        ramp: ['stone0', 'stone1', 'stone2', 'stone3', 'pebble'],
        top: 2.75,
        legs: false,
      },
    ];
    const MID = Object.fromEntries(MATS.map((m, i) => [m.id, i]));
    for (const m of MATS) m.rgb = m.ramp.map(col);

    // ── props that rest on a surface. Bounds come from the sprite's own alpha.
    const PROPS = {
      lamp: { sprite: 'prop.lampOn', glow: true },
      laptop: { sprite: 'prop.laptopOpen' },
      coffee: { sprite: 'prop.coffee' },
      notebook: { sprite: 'prop.notebook' },
    };
    for (const k of Object.keys(PROPS)) {
      const p = PROPS[k];
      p.px = assets.sprite(p.sprite);
      let minx = 99;
      let maxx = -1;
      let miny = 99;
      let maxy = -1;
      for (let y = 0; y < T; y++)
        for (let x = 0; x < T; x++)
          if (p.px[(y * T + x) * 4 + 3] > 0) {
            if (x < minx) minx = x;
            if (x > maxx) maxx = x;
            if (y < miny) miny = y;
            if (y > maxy) maxy = y;
          }
      Object.assign(p, { minx, maxx, miny, maxy });
    }

    const SHADE = 0.75; // style guide: cast shadow = black at 25 %
    const UNDER = 0.58; // ground under a desk, between the legs

    // ───────────────────────── geometry from a grid
    function geometry(G) {
      const { w, h } = G;
      const at = (x, y) => (x < 0 || y < 0 || x >= w || y >= h ? null : G.obj[y * w + x]);
      const byCell = new Array(w * h).fill(null); // the core box of each cell
      const cellBoxes = new Array(w * h).fill(null); // core + connectors
      const box = (x0, y0, x1, y1, core) => ({
        mat: core.mat,
        vert: core.vert,
        cx: (x0 + x1) / 2,
        cy: (y0 + y1) / 2,
        hx: (x1 - x0) / 2 - RAD,
        hy: (y1 - y0) / 2 - RAD,
        r: RAD,
      });
      // local vertical extent of a cell's core: top face starts at TOP unless joined above
      const yr = (x, y) => [at(x, y - 1) ? 0 : TOP, at(x, y + 1) ? T : BOT];
      for (let y = 0; y < h; y++)
        for (let x = 0; x < w; x++) {
          const o = G.obj[y * w + x];
          if (!o) continue;
          // every object in this spike is in one join group ("surface")
          const N = !!at(x, y - 1);
          const S = !!at(x, y + 1);
          const W = !!at(x - 1, y);
          const E = !!at(x + 1, y);
          const ox = x * T;
          const oy = y * T;
          const [ya, yb] = yr(x, y);
          const core = {
            mat: MID[o],
            vert: (N || S) && !(E || W),
            restY: oy + (S ? T - 4 : BOT - 4),
          };
          Object.assign(core, box(ox, oy + ya, ox + T, oy + yb, core));
          const list = [core];
          // connectors overlap the shared edge by EXT on both sides, over the rows (or
          // columns) both cells cover, so a joint is deep inside the shape: no edge
          // shading, no outline, no bulge there
          if (E) {
            const [y2a, y2b] = yr(x + 1, y);
            list.push(box(ox + T - EXT, oy + Math.max(ya, y2a), ox + T + EXT, oy + Math.min(yb, y2b), core));
          }
          if (S) list.push(box(ox, oy + T - EXT, ox + T, oy + T + EXT, core));
          byCell[y * w + x] = core;
          cellBoxes[y * w + x] = list;
        }
      // boxes that can touch each cell (3×3 neighbourhood)
      const near = new Array(w * h);
      for (let y = 0; y < h; y++)
        for (let x = 0; x < w; x++) {
          const list = [];
          for (let dy = -1; dy <= 1; dy++)
            for (let dx = -1; dx <= 1; dx++) {
              const xx = x + dx;
              const yy = y + dy;
              if (xx < 0 || yy < 0 || xx >= w || yy >= h) continue;
              const b = cellBoxes[yy * w + xx];
              if (b) list.push(...b);
            }
          near[y * w + x] = list;
        }
      // props: placed on the surface of their cell
      const props = [];
      for (let i = 0; i < w * h; i++) {
        const k = G.prop[i];
        const b = byCell[i];
        if (!k || !b) continue; // a prop needs a surface (planEdit would refuse it)
        const p = PROPS[k];
        const cx = (i % w) * T;
        const ox = cx + 16 - Math.round((p.minx + p.maxx + 1) / 2);
        const oy = b.restY - p.maxy;
        props.push({ p, ox, oy, baseY: b.restY, x0: ox + p.minx, x1: ox + p.maxx, kind: k });
      }
      return { w, h, near, props, byCell };
    }

    const FAR = { d: Infinity, mat: -1, seam: false, box: null };

    /** Formula 2: signed distance of the merged object shape at a point. */
    function field(Ge, x, y) {
      let cx = Math.floor(x / T);
      let cy = Math.floor(y / T);
      if (cx < -1 || cy < -1 || cx > Ge.w || cy > Ge.h) return FAR;
      cx = Math.max(0, Math.min(Ge.w - 1, cx));
      cy = Math.max(0, Math.min(Ge.h - 1, cy));
      const list = Ge.near[cy * Ge.w + cx];
      if (!list.length) return FAR;
      let d0 = Infinity;
      let d1 = Infinity;
      let best = null;
      let bestD = Infinity;
      for (let i = 0; i < list.length; i++) {
        const b = list[i];
        const d = sdBox(x, y, b);
        if (d < bestD) {
          bestD = d;
          best = b;
        }
        if (b.mat === 0) d0 = smin(d0, d, K);
        else d1 = smin(d1, d, K);
      }
      const d = smin(d0, d1, K);
      // material = the object in the cell under the point, so a material change sits on the
      // cell edge (one clean seam) instead of wherever the two overlapping fields tie
      const ix = Math.floor(x / T);
      const iy = Math.floor(y / T);
      const own = ix >= 0 && iy >= 0 && ix < Ge.w && iy < Ge.h ? Ge.byCell[iy * Ge.w + ix] : null;
      const b = own || best;
      return { d, mat: b.mat, box: b };
    }

    /** Formula 1: which terrain owns a ground pixel. */
    function terrainAt(G, px, py) {
      const gx = (px + 0.5) / T - 0.5;
      const gy = (py + 0.5) / T - 0.5;
      const i0 = Math.floor(gx);
      const j0 = Math.floor(gy);
      let fx = gx - i0;
      let fy = gy - j0;
      fx = fx * fx * (3 - 2 * fx); // smoothstep: blobs keep the cell's shape
      fy = fy * fy * (3 - 2 * fy);
      const c = (i, j) => {
        i = Math.max(0, Math.min(G.w - 1, i));
        j = Math.max(0, Math.min(G.h - 1, j));
        return TID[G.ground[j * G.w + i]];
      };
      const a = c(i0, j0);
      const b = c(i0 + 1, j0);
      const cc = c(i0, j0 + 1);
      const dd = c(i0 + 1, j0 + 1);
      if (a === b && a === cc && a === dd) return a; // interior: no blend needed
      const wt = [0, 0, 0];
      wt[a] += (1 - fx) * (1 - fy);
      wt[b] += fx * (1 - fy);
      wt[cc] += (1 - fx) * fy;
      wt[dd] += fx * fy;
      const tx = ((px % T) + T) % T;
      const ty = ((py % T) + T) % T;
      let best = -1;
      let bestS = -1e9;
      for (let t = 0; t < TERRAINS.length; t++) {
        if (wt[t] === 0) continue;
        const s =
          wt[t] +
          NOISE_A * (fbm(px, py, 31 + t * 17) - 0.5) +
          HEIGHT_H * (TERRAINS[t].h[ty * T + tx] - 0.5) +
          TERRAINS[t].prio * 1e-4;
        if (s > bestS) {
          bestS = s;
          best = t;
        }
      }
      return best;
    }

    // classes in the work buffer
    const GROUND = 0;
    const TOPF = 1;
    const FRONT = 2;
    const LEG = 3;
    const UNDERC = 4;

    /**
     * Render a pixel region [rx, rx+rw) × [ry, ry+rh) of grid G.
     * opts.snap: true = palette ramp + Bayer dither, false = smooth interpolation.
     * Returns { data: Uint8ClampedArray(rw*rh*4), w: rw, h: rh }.
     */
    function render(G, rx, ry, rw, rh, opts) {
      const snap = !opts || opts.snap !== false;
      const Ge = geometry(G);
      const bx = rx - M;
      const by = ry - M;
      const bw = rw + 2 * M;
      const bh = rh + 2 * M;
      const n = bw * bh;
      const cls = new Uint8Array(n);
      const mat = new Int8Array(n).fill(-1);
      const lev = new Float32Array(n);
      const ter = new Int8Array(n);
      const outl = new Uint8Array(n); // 1 = outline, 2 = lit outline, 3 = seam

      const lamps = Ge.props.filter((q) => q.p.glow);

      // pass 1: classify every pixel and compute its continuous shading level
      for (let j = 0; j < bh; j++) {
        const py = by + j;
        for (let i = 0; i < bw; i++) {
          const px = bx + i;
          const k = j * bw + i;
          const sx = px + 0.5;
          const sy = py + 0.5;
          const f = field(Ge, sx, sy);
          if (f.d < 0) {
            cls[k] = TOPF;
            mat[k] = f.mat;
            const m = MATS[f.mat];
            let v = m.top;
            // light from the field gradient, only near the edge
            if (f.d > -3.5) {
              const gx = field(Ge, sx + 1, sy).d - field(Ge, sx - 1, sy).d;
              const gy = field(Ge, sx, sy + 1).d - field(Ge, sx, sy - 1).d;
              const gl = Math.hypot(gx, gy) || 1;
              const e = Math.min(1, Math.max(0, 1 + f.d / 3.5));
              v += 1.35 * e * ((gx / gl) * LIGHT[0] + (gy / gl) * LIGHT[1]);
            }
            // surface texture, in world coordinates so joints never repeat
            if (f.mat === MID.desk) {
              const along = f.box && f.box.vert ? py : px;
              const across = f.box && f.box.vert ? px : py;
              if (((across % 5) + 5) % 5 === 0) v -= 0.9; // plank seam
              else if (((across % 5) + 5) % 5 === 1) v += 0.35; // light line under a seam
              v += (vnoise(along / 4, across * 3, 5) - 0.5) * 0.8; // grain streaks
              if (hash(px, py, 9) < 0.004) v -= 1.4; // knot
            } else {
              v += (fbm(px * 1.4, py * 1.4, 11) - 0.5) * 0.7; // polished stone cloud
              if (hash(px, py, 13) < 0.025) v += 0.9; // speckle
            }
            // a lamp on the surface lights a warm pool around its base
            for (const L of lamps) {
              const dx = sx - (L.x0 + 4);
              const dy = (sy - (L.baseY - 2)) * 1.6;
              const r = Math.hypot(dx, dy);
              if (r < 18) v += 1.25 * Math.pow(1 - r / 18, 1.4);
            }
            lev[k] = v;
            continue;
          }
          // front face: is the top shape directly above, within FH px?
          let kk = 0;
          let g = null;
          for (let s = 1; s <= FH; s++) {
            const q = field(Ge, sx, sy - s);
            if (q.d < 0) {
              kk = s;
              g = q;
              break;
            }
          }
          if (kk) {
            const m = MATS[g.mat];
            mat[k] = g.mat;
            const qy = sy - kk;
            if (m.legs && kk > APRON) {
              const leftEnd = field(Ge, sx - 3, qy).d >= 0;
              const rightEnd = field(Ge, sx + 3, qy).d >= 0;
              if (leftEnd || rightEnd) {
                cls[k] = LEG;
                lev[k] = leftEnd && field(Ge, sx - 1, qy).d >= 0 ? 2.2 : 1.25;
              } else {
                cls[k] = UNDERC;
                ter[k] = terrainAt(G, px, py);
              }
              continue;
            }
            cls[k] = FRONT;
            let v;
            if (m.legs) {
              v = kk === 1 ? 4 : kk === 2 ? 2.9 : kk === APRON ? 1.2 : 2.05;
              // drawer pull every 32 px in world space
              const xm = ((px % 32) + 32) % 32;
              if (kk === 4 && xm >= 14 && xm <= 17) v = 4;
              if (kk === 5 && xm >= 14 && xm <= 17) v = 1.2;
            } else {
              v = kk === 1 ? 3.6 : kk === 2 ? 2.7 : kk >= FH - 1 ? 0.8 : 1.75;
              const xm = ((px % 24) + 24) % 24; // cupboard doors, 24 px pitch
              if (kk > 2 && kk < FH - 1 && xm === 0) v = 0.7;
              if (kk === 5 && (xm === 10 || xm === 13)) v = 3.2;
            }
            lev[k] = v;
            continue;
          }
          cls[k] = GROUND;
          ter[k] = terrainAt(G, px, py);
        }
      }

      const solid = (i, j) =>
        i >= 0 && j >= 0 && i < bw && j < bh && (cls[j * bw + i] === TOPF || cls[j * bw + i] === FRONT || cls[j * bw + i] === LEG);

      // pass 2: outlines only where the merged shape meets the outside
      for (let j = 1; j < bh - 1; j++)
        for (let i = 1; i < bw - 1; i++) {
          const k = j * bw + i;
          if (!solid(i, j)) continue;
          const up = !solid(i, j - 1);
          if (up || !solid(i - 1, j) || !solid(i + 1, j) || !solid(i, j + 1))
            outl[k] = up && cls[k] === TOPF ? 2 : 1;
          // seam: one dark pixel line where the material changes (left or above)
          else if (mat[k - 1] !== mat[k] || (cls[k - bw] === cls[k] && mat[k - bw] !== mat[k])) outl[k] = 3;
        }

      // pass 3: props drop a contact shadow onto the surface (one ramp step darker)
      for (const q of Ge.props) {
        const yy = q.baseY + 1 - by;
        for (let x = q.x0 + 1; x <= q.x1 + 1; x++) {
          const i = x - bx;
          if (i < 0 || i >= bw || yy < 0 || yy >= bh) continue;
          const k = yy * bw + i;
          if (cls[k] === TOPF) lev[k] -= 1;
        }
        for (let y = q.baseY - 1; y <= q.baseY; y++) {
          const i = q.x1 + 1 - bx;
          const jj = y - by;
          if (i < 0 || i >= bw || jj < 0 || jj >= bh) continue;
          if (cls[jj * bw + i] === TOPF) lev[jj * bw + i] -= 1;
        }
      }

      // pass 4: colour the region (margin dropped)
      const out = new Uint8ClampedArray(rw * rh * 4);
      for (let j = 0; j < rh; j++)
        for (let i = 0; i < rw; i++) {
          const bi = i + M;
          const bj = j + M;
          const k = bj * bw + bi;
          const px = rx + i;
          const py = ry + j;
          let r;
          let gg;
          let b;
          const c = cls[k];
          if (c === TOPF || c === FRONT || c === LEG) {
            const m = MATS[mat[k]];
            let rgb;
            if (outl[k] === 1 || outl[k] === 3) rgb = m.rgb[0];
            else if (outl[k] === 2) rgb = m.rgb[1];
            else rgb = ramp(m.rgb, lev[k], px, py, snap);
            r = rgb[0];
            gg = rgb[1];
            b = rgb[2];
          } else {
            const t = TERRAINS[ter[k]];
            const tx = ((px % T) + T) % T;
            const ty = ((py % T) + T) % T;
            const o = (ty * T + tx) * 4;
            r = t.px[o];
            gg = t.px[o + 1];
            b = t.px[o + 2];
            // rim where a green terrain meets dirt: lip shadow on the dirt, bright tip on grass
            if (t.group === 'dirt') {
              const above = ter[k - bw];
              const left = ter[k - 1];
              if (
                (cls[k - bw] === GROUND && TERRAINS[above].group === 'green') ||
                (cls[k - 1] === GROUND && TERRAINS[left].group === 'green')
              ) {
                [r, gg, b] = col('dirt0');
              }
            } else {
              const below = ter[k + bw];
              if (cls[k + bw] === GROUND && TERRAINS[below].group === 'dirt' && hash(px, py, 3) < 0.55)
                [r, gg, b] = col(hash(px, py, 4) < 0.5 ? 'leaf3' : 'moss3');
            }
            let mul = 1;
            if (c === UNDERC) mul *= UNDER;
            if (solid(bi - 2, bj - 2) || solid(bi - 1, bj - 2) || solid(bi - 2, bj - 1)) mul *= SHADE;
            r *= mul;
            gg *= mul;
            b *= mul;
          }
          const o = (j * rw + i) * 4;
          out[o] = r;
          out[o + 1] = gg;
          out[o + 2] = b;
          out[o + 3] = 255;
        }

      // pass 5: prop sprites on top (y-sorted, so a later row covers an earlier one)
      const order = Ge.props.slice().sort((a, b) => a.baseY - b.baseY);
      for (const q of order) {
        for (let y = 0; y < T; y++)
          for (let x = 0; x < T; x++) {
            const s = (y * T + x) * 4;
            if (q.p.px[s + 3] === 0) continue;
            const wx = q.ox + x - rx;
            const wy = q.oy + y - ry;
            if (wx < 0 || wy < 0 || wx >= rw || wy >= rh) continue;
            const o = (wy * rw + wx) * 4;
            const a = q.p.px[s + 3] / 255;
            out[o] = q.p.px[s] * a + out[o] * (1 - a);
            out[o + 1] = q.p.px[s + 1] * a + out[o + 1] * (1 - a);
            out[o + 2] = q.p.px[s + 2] * a + out[o + 2] * (1 - a);
          }
      }
      return { data: out, w: rw, h: rh };
    }

    /** Snap a continuous level to the ramp (Bayer threshold) or interpolate smoothly. */
    function ramp(rgb, v, x, y, snap) {
      const top = rgb.length - 1;
      if (snap) {
        const t = (BAYER[((y & 3) << 2) | (x & 3)] + 0.5) / 16;
        const i = Math.max(0, Math.min(top, Math.floor(v + t - 0.5)));
        return rgb[i];
      }
      const c = Math.max(0, Math.min(top, v - 0.5));
      const i = Math.min(top - 1, Math.floor(c));
      const f = c - i;
      const a = rgb[i];
      const b = rgb[i + 1];
      return [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f, a[2] + (b[2] - a[2]) * f];
    }

    /** Can this edit be placed? Mirrors the planEdit rule P9.11 would add. */
    function canPlace(G, x, y, tool) {
      if (PROPS[tool]) return !!G.obj[y * G.w + x];
      return true;
    }

    /** Apply a palette tool to a copy of the grid. */
    function apply(G, x, y, tool) {
      const C = { w: G.w, h: G.h, ground: G.ground.slice(), obj: G.obj.slice(), prop: G.prop.slice() };
      const i = y * G.w + x;
      if (TID[tool] !== undefined) C.ground[i] = tool;
      else if (MID[tool] !== undefined) C.obj[i] = tool;
      else if (PROPS[tool]) C.prop[i] = tool;
      else if (tool === 'erase') {
        if (C.prop[i]) C.prop[i] = null;
        else {
          C.obj[i] = null;
        }
      }
      if (!C.obj[i]) C.prop[i] = null; // a prop never floats without its surface
      return C;
    }

    return {
      T,
      render,
      apply,
      canPlace,
      terrains: TERRAINS.map((t) => t.id),
      materials: MATS.map((m) => m.id),
      props: Object.keys(PROPS),
      propSprite: (k) => PROPS[k].sprite,
    };
  }

  /** FNV-1a over pixels, for the determinism check. */
  function hashPixels(data) {
    let h = 0x811c9dc5;
    for (let i = 0; i < data.length; i++) {
      h ^= data[i];
      h = Math.imul(h, 0x01000193);
    }
    return (h >>> 0).toString(16).padStart(8, '0');
  }

  root.AgoraBlend = { createBlend, hashPixels };
})(typeof window !== 'undefined' ? window : globalThis);
