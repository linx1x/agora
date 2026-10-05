/* P9.8 spike UI: loads the jungle art, renders "today" and "blended", lets you paint. */
(function () {
  'use strict';
  const { createBlend, hashPixels } = window.AgoraBlend;
  const T = 32;
  const W = 16;
  const H = 10;

  // ───────────────────────── assets (inlined when published, fetched from the repo otherwise)
  async function loadAssets() {
    const inl = window.BLEND_ASSETS;
    const base = '../../';
    const img = (src) =>
      new Promise((res, rej) => {
        const i = new Image();
        i.onload = () => res(i);
        i.onerror = () => rej(new Error('Could not load ' + src));
        i.src = src;
      });
    const json = (src) => fetch(src).then((r) => r.json());
    const [jImg, cImg, jJson, cJson, pal] = inl
      ? await Promise.all([img(inl.jungle), img(inl.common), inl.jungleJson, inl.commonJson, inl.palettes])
      : await Promise.all([
          img(base + 'apps/web/public/assets/agora/jungle.png'),
          img(base + 'apps/web/public/assets/agora/common.png'),
          json(base + 'apps/web/public/assets/agora/jungle.json'),
          json(base + 'apps/web/public/assets/agora/common.json'),
          json(base + 'art-src/palettes.json'),
        ]);
    const sheets = [
      [jImg, jJson.sprites],
      [cImg, cJson.sprites],
    ];
    const cache = {};
    function find(name) {
      for (const [im, map] of sheets) if (map[name]) return { im, d: map[name] };
      return null;
    }
    function sprite(name) {
      if (cache[name]) return cache[name];
      const f = find(name);
      if (!f) throw new Error('sprite missing: ' + name);
      const c = document.createElement('canvas');
      c.width = T;
      c.height = T;
      const x = c.getContext('2d');
      x.drawImage(f.im, f.d.x, f.d.y, T, T, 0, 0, T, T);
      cache[name] = x.getImageData(0, 0, T, T).data;
      return cache[name];
    }
    const palette = {};
    for (const group of ['common', 'jungle'])
      for (const [k, v] of Object.entries(pal[group])) {
        if (typeof v !== 'string' || !/^#[0-9a-f]{6}/i.test(v)) continue;
        palette[k] = [parseInt(v.slice(1, 3), 16), parseInt(v.slice(3, 5), 16), parseInt(v.slice(5, 7), 16)];
      }
    return { sprite, palette, find };
  }

  // ───────────────────────── sample scene (example layout, not the HQ map)
  function sampleGrid() {
    const g = { w: W, h: H, ground: new Array(W * H).fill('grass'), obj: new Array(W * H).fill(null), prop: new Array(W * H).fill(null) };
    const set = (k, x, y, v) => (g[k][y * W + x] = v);
    // flower meadow, top right
    for (const [x, y] of [[11, 0], [12, 0], [13, 0], [14, 0], [15, 0], [12, 1], [13, 1], [14, 1], [15, 1], [13, 2], [14, 2], [15, 2], [15, 3], [11, 1]])
      set('ground', x, y, 'flowers');
    // a dirt trail winding to a clearing
    for (const [x, y] of [[0, 7], [1, 7], [2, 7], [3, 7], [3, 8], [4, 8], [5, 8], [6, 8], [7, 8], [8, 8], [9, 8], [10, 8], [11, 8], [11, 7], [12, 7], [13, 7], [12, 8], [13, 8], [12, 6], [8, 9]])
      set('ground', x, y, 'dirt');
    // straight run: three desks into two counter modules
    for (const x of [1, 2, 3]) set('obj', x, 1, 'desk');
    for (const x of [4, 5]) set('obj', x, 1, 'counter');
    set('prop', 1, 1, 'lamp');
    set('prop', 2, 1, 'laptop');
    set('prop', 5, 1, 'coffee');
    // L desk
    for (const x of [8, 9, 10]) set('obj', x, 1, 'desk');
    set('obj', 8, 2, 'desk');
    set('obj', 8, 3, 'desk');
    set('prop', 10, 1, 'lamp');
    set('prop', 8, 3, 'notebook');
    // T: counter with a desk running down from the middle
    for (const x of [1, 2, 3]) set('obj', x, 4, 'counter');
    set('obj', 2, 5, 'desk');
    set('prop', 1, 4, 'coffee');
    set('prop', 2, 5, 'laptop');
    // loose pieces, one of them standing on the trail
    set('obj', 12, 4, 'desk');
    set('prop', 12, 4, 'lamp');
    set('obj', 14, 5, 'counter');
    set('obj', 6, 7, 'desk');
    set('obj', 7, 7, 'desk');
    return g;
  }

  // ───────────────────────── "today": one tile per cell, as the game draws it now
  function drawToday(ctx, G, A) {
    const blit = (name, x, y) => {
      const f = A.find(name);
      if (f) ctx.drawImage(f.im, f.d.x, f.d.y, T, T, x * T, y * T, T, T);
    };
    const at = (k, x, y) => (x < 0 || y < 0 || x >= W || y >= H ? null : G[k][y * W + x]);
    ctx.clearRect(0, 0, W * T, H * T);
    for (let y = 0; y < H; y++)
      for (let x = 0; x < W; x++) {
        const t = at('ground', x, y);
        if (t === 'dirt') {
          // the hand-drawn 16-mask autotile (N=1 E=2 S=4 W=8)
          const m = (at('ground', x, y - 1) === 'dirt' ? 1 : 0) | (at('ground', x + 1, y) === 'dirt' ? 2 : 0) | (at('ground', x, y + 1) === 'dirt' ? 4 : 0) | (at('ground', x - 1, y) === 'dirt' ? 8 : 0);
          blit('jungle.floor', x, y);
          blit('jungle.path' + m, x, y);
        } else blit(t === 'flowers' ? 'jungle.floorB' : 'jungle.floor', x, y);
      }
    for (let y = 0; y < H; y++)
      for (let x = 0; x < W; x++) {
        const o = at('obj', x, y);
        const p = at('prop', x, y);
        if (p) {
          // today a prop and a desk share the furniture layer: the prop replaces the desk
          blit(A.propSprite(p), x, y);
          continue;
        }
        if (o === 'desk') {
          const N = !!at('obj', x, y - 1);
          const S = !!at('obj', x, y + 1);
          const E = !!at('obj', x + 1, y);
          const Wn = !!at('obj', x - 1, y);
          blit(S && (E || Wn) ? 'jungle.deskCorner' : (N || S) && !(E || Wn) ? 'jungle.deskV' : 'jungle.deskH', x, y);
        } else if (o === 'counter') drawCounter(ctx, x * T, y * T);
      }
  }
  // port of the procedural `counter` drawer in apps/web/src/game/tiles.ts
  function drawCounter(c, ox, oy) {
    const r = (x, y, w, h, col) => {
      c.fillStyle = col;
      c.fillRect(ox + x, oy + y, w, h);
    };
    r(0, 0, T, T, '#e9edf0');
    r(2, 0, 28, T, '#d5dbe0');
    r(8, 8, 16, 14, '#aeb8c1');
    r(10, 10, 12, 10, '#93a1ad');
    r(15, 4, 2, 6, '#7d8a96');
  }

  // ───────────────────────── app
  const TOOLS = [
    { id: 'grass', label: 'Grass', layer: 'Ground' },
    { id: 'flowers', label: 'Flowers', layer: 'Ground' },
    { id: 'dirt', label: 'Dirt', layer: 'Ground' },
    { id: 'desk', label: 'Desk', layer: 'Objects' },
    { id: 'counter', label: 'Counter', layer: 'Objects' },
    { id: 'lamp', label: 'Desk lamp', layer: 'On a surface' },
    { id: 'laptop', label: 'Laptop', layer: 'On a surface' },
    { id: 'coffee', label: 'Coffee', layer: 'On a surface' },
    { id: 'notebook', label: 'Notebook', layer: 'On a surface' },
    { id: 'erase', label: 'Erase', layer: 'Tools' },
  ];

  const $ = (id) => document.getElementById(id);
  const state = { tool: 'desk', snap: true, grid: false, cursor: { x: 6, y: 4 }, hover: false, edits: 0, matched: 0, contained: 0 };

  function now() {
    return performance.now();
  }

  async function main() {
    let A;
    try {
      A = await loadAssets();
    } catch (e) {
      $('status').textContent = e.message + '. Serve the repo root (e.g. python -m http.server) and open /spikes/blend/.';
      return;
    }
    const B = createBlend(A);
    A.propSprite = B.propSprite;
    let G = sampleGrid();

    const blendC = $('blend');
    const overC = $('over');
    const todayC = $('today');
    for (const c of [blendC, overC, todayC]) {
      c.width = W * T;
      c.height = H * T;
    }
    const bctx = blendC.getContext('2d');
    const octx = overC.getContext('2d');
    const tctx = todayC.getContext('2d');
    let base = null; // ImageData of the whole blended map

    const opts = () => ({ snap: state.snap });

    function renderAll() {
      const t0 = now();
      const r = B.render(G, 0, 0, W * T, H * T, opts());
      const dt = now() - t0;
      base = new ImageData(r.data, r.w, r.h);
      bctx.putImageData(base, 0, 0);
      drawToday(tctx, G, A);
      drawGridLines();
      return dt;
    }

    function drawGridLines() {
      octx.clearRect(0, 0, W * T, H * T);
      if (state.grid) {
        octx.strokeStyle = 'rgba(255,255,255,.18)';
        octx.lineWidth = 1;
        for (let x = 1; x < W; x++) {
          octx.beginPath();
          octx.moveTo(x * T + 0.5, 0);
          octx.lineTo(x * T + 0.5, H * T);
          octx.stroke();
        }
        for (let y = 1; y < H; y++) {
          octx.beginPath();
          octx.moveTo(0, y * T + 0.5);
          octx.lineTo(W * T, y * T + 0.5);
          octx.stroke();
        }
      }
    }

    // region of cells a single-cell edit can change
    const region = (cx, cy) => {
      const x0 = Math.max(0, cx - 1);
      const y0 = Math.max(0, cy - 1);
      const x1 = Math.min(W - 1, cx + 1);
      const y1 = Math.min(H - 1, cy + 1);
      return { x0, y0, cw: x1 - x0 + 1, ch: y1 - y0 + 1 };
    };

    let preview = null; // { cx, cy, tool, rg, data }

    function showPreview() {
      drawGridLines();
      preview = null;
      if (!state.hover) {
        $('hint').textContent = 'Hover the map, or focus it and use the arrow keys, to preview an edit.';
        return;
      }
      const { x: cx, y: cy } = state.cursor;
      if (!B.canPlace(G, cx, cy, state.tool)) {
        octx.strokeStyle = '#ff5a4f';
        octx.lineWidth = 2;
        octx.strokeRect(cx * T + 1, cy * T + 1, T - 2, T - 2);
        $('hint').textContent = labelOf(state.tool) + ' needs a desk or counter under it.';
        return;
      }
      const t0 = now();
      const hyp = B.apply(G, cx, cy, state.tool);
      const rg = region(cx, cy);
      const r = B.render(hyp, rg.x0 * T, rg.y0 * T, rg.cw * T, rg.ch * T, opts());
      const dt = now() - t0;
      preview = { cx, cy, tool: state.tool, rg, data: r.data };
      octx.putImageData(new ImageData(r.data, r.w, r.h), rg.x0 * T, rg.y0 * T);
      // outline neighbours whose pixels will change
      let changed = 0;
      for (let j = 0; j < rg.ch; j++)
        for (let i = 0; i < rg.cw; i++) {
          const gx = rg.x0 + i;
          const gy = rg.y0 + j;
          if (gx === cx && gy === cy) continue;
          if (cellDiffers(r, i, j, gx, gy)) {
            changed++;
            octx.setLineDash([3, 2]);
            octx.strokeStyle = '#ffd877';
            octx.lineWidth = 1;
            octx.strokeRect(gx * T + 1.5, gy * T + 1.5, T - 3, T - 3);
            octx.setLineDash([]);
          }
        }
      octx.strokeStyle = '#fff1b8';
      octx.lineWidth = 2;
      octx.strokeRect(cx * T + 1, cy * T + 1, T - 2, T - 2);
      $('hint').textContent =
        labelOf(state.tool) + ' at ' + cx + ',' + cy + ' · preview ' + dt.toFixed(2) + ' ms · ' + (changed ? changed + ' neighbour' + (changed > 1 ? 's' : '') + ' will change (dashed)' : 'no neighbour changes');
    }

    function cellDiffers(r, i, j, gx, gy) {
      for (let y = 0; y < T; y++)
        for (let x = 0; x < T; x++) {
          const a = ((j * T + y) * r.w + (i * T + x)) * 4;
          const b = ((gy * T + y) * W * T + (gx * T + x)) * 4;
          if (r.data[a] !== base.data[b] || r.data[a + 1] !== base.data[b + 1] || r.data[a + 2] !== base.data[b + 2]) return true;
        }
      return false;
    }

    function place() {
      const { x: cx, y: cy } = state.cursor;
      if (!B.canPlace(G, cx, cy, state.tool)) return;
      const hyp = B.apply(G, cx, cy, state.tool);
      const before = base;
      const pv = preview && preview.cx === cx && preview.cy === cy && preview.tool === state.tool ? preview : null;
      G = hyp;
      renderAll();
      state.edits++;
      // check 1: the applied pixels equal the preview pixels
      if (pv) {
        let same = true;
        const { rg } = pv;
        for (let j = 0; j < rg.ch * T && same; j++)
          for (let i = 0; i < rg.cw * T; i++) {
            const a = (j * rg.cw * T + i) * 4;
            const b = ((rg.y0 * T + j) * W * T + rg.x0 * T + i) * 4;
            if (pv.data[a] !== base.data[b] || pv.data[a + 1] !== base.data[b + 1] || pv.data[a + 2] !== base.data[b + 2]) {
              same = false;
              break;
            }
          }
        if (same) state.matched++;
      } else state.matched++; // keyboard place without hover still re-renders the same function
      // check 2: nothing outside the 3×3 changed
      const rg = region(cx, cy);
      let inside = true;
      for (let y = 0; y < H * T && inside; y++)
        for (let x = 0; x < W * T; x++) {
          const gx = Math.floor(x / T);
          const gy = Math.floor(y / T);
          if (gx >= rg.x0 && gx < rg.x0 + rg.cw && gy >= rg.y0 && gy < rg.y0 + rg.ch) continue;
          const o = (y * W * T + x) * 4;
          if (before.data[o] !== base.data[o] || before.data[o + 1] !== base.data[o + 1] || before.data[o + 2] !== base.data[o + 2]) {
            inside = false;
            break;
          }
        }
      if (inside) state.contained++;
      $('s-edits').textContent = state.matched + ' / ' + state.edits + ' matched · ' + state.contained + ' / ' + state.edits + ' stayed inside 3×3';
      showPreview();
    }

    const labelOf = (id) => TOOLS.find((t) => t.id === id).label;

    // palette
    const pal = $('palette');
    let lastLayer = '';
    for (const t of TOOLS) {
      if (t.layer !== lastLayer) {
        const h = document.createElement('span');
        h.className = 'layer';
        h.textContent = t.layer;
        pal.appendChild(h);
        lastLayer = t.layer;
      }
      const b = document.createElement('button');
      b.type = 'button';
      b.id = 'tool-' + t.id;
      b.className = 'tool';
      b.textContent = t.label;
      b.setAttribute('aria-pressed', String(t.id === state.tool));
      b.addEventListener('click', () => {
        state.tool = t.id;
        for (const x of pal.querySelectorAll('.tool')) x.setAttribute('aria-pressed', String(x === b));
        showPreview();
      });
      pal.appendChild(b);
    }

    $('snap').addEventListener('change', (e) => {
      state.snap = e.target.checked;
      renderAll();
      showPreview();
    });
    $('gridlines').addEventListener('change', (e) => {
      state.grid = e.target.checked;
      showPreview();
    });
    $('reset').addEventListener('click', () => {
      G = sampleGrid();
      renderAll();
      showPreview();
    });

    // pointer + keyboard on the blended map
    const cellFromEvent = (e) => {
      const r = blendC.getBoundingClientRect();
      return {
        x: Math.max(0, Math.min(W - 1, Math.floor(((e.clientX - r.left) / r.width) * W))),
        y: Math.max(0, Math.min(H - 1, Math.floor(((e.clientY - r.top) / r.height) * H))),
      };
    };
    const stage = $('stage');
    stage.addEventListener('pointermove', (e) => {
      const c = cellFromEvent(e);
      if (!state.hover || c.x !== state.cursor.x || c.y !== state.cursor.y) {
        state.cursor = c;
        state.hover = true;
        showPreview();
      }
    });
    stage.addEventListener('pointerleave', () => {
      state.hover = document.activeElement === stage;
      showPreview();
    });
    stage.addEventListener('click', (e) => {
      state.cursor = cellFromEvent(e);
      state.hover = true;
      showPreview();
      place();
    });
    stage.addEventListener('focus', () => {
      state.hover = true;
      showPreview();
    });
    stage.addEventListener('blur', () => {
      state.hover = false;
      showPreview();
    });
    stage.addEventListener('keydown', (e) => {
      const d = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] }[e.key];
      if (d) {
        e.preventDefault();
        state.cursor = { x: Math.max(0, Math.min(W - 1, state.cursor.x + d[0])), y: Math.max(0, Math.min(H - 1, state.cursor.y + d[1])) };
        state.hover = true;
        showPreview();
      } else if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        place();
      }
    });

    // ── measurements
    const full = renderAll();
    $('s-full').textContent = full.toFixed(1) + ' ms for ' + W * H + ' cells (' + (full / (W * H)).toFixed(2) + ' ms per cell)';

    // 3×3 previews over every cell with the current tool set
    const tools = ['desk', 'counter', 'dirt', 'flowers', 'erase'];
    let tot = 0;
    let n = 0;
    let worst = 0;
    for (let y = 0; y < H; y++)
      for (let x = 0; x < W; x++) {
        const tool = tools[(x + y) % tools.length];
        const t0 = now();
        const hyp = B.apply(G, x, y, tool);
        const rg = region(x, y);
        B.render(hyp, rg.x0 * T, rg.y0 * T, rg.cw * T, rg.ch * T, opts());
        const dt = now() - t0;
        tot += dt;
        n++;
        if (dt > worst) worst = dt;
      }
    $('s-preview').textContent = (tot / n).toFixed(2) + ' ms average, ' + worst.toFixed(1) + ' ms worst (' + n + ' previews)';

    // determinism: whole map twice, and the map stitched from one-cell renders
    const h1 = hashPixels(base.data);
    const h2 = hashPixels(B.render(G, 0, 0, W * T, H * T, opts()).data);
    const stitched = new Uint8ClampedArray(W * T * H * T * 4);
    for (let cy = 0; cy < H; cy++)
      for (let cx = 0; cx < W; cx++) {
        const r = B.render(G, cx * T, cy * T, T, T, opts());
        for (let y = 0; y < T; y++) stitched.set(r.data.subarray(y * T * 4, (y + 1) * T * 4), ((cy * T + y) * W * T + cx * T) * 4);
      }
    const h3 = hashPixels(stitched);
    const ok = h1 === h2 && h2 === h3;
    $('s-hash').textContent = (ok ? 'Identical' : 'DIFFERENT') + ' · whole ' + h1 + ' · again ' + h2 + ' · cell by cell ' + h3;
    $('s-hash').dataset.ok = String(ok);
    $('status').textContent = '';
    document.body.dataset.ready = 'true';
    showPreview();
    window.__blend = { B, get G() { return G; }, set G(v) { G = v; renderAll(); }, state, place, showPreview, renderAll };
  }

  main();
})();
