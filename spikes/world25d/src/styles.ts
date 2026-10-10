/**
 * P16.2 art styles, all made in code from the app's own tiles (ADR-022 pipeline, CC0):
 * - `storybookTileset`: each tile redrawn 4× with Scale2x twice (smooth edges, no pixel grid),
 *   ground softened, objects given a white cut-out edge, everything on a paper grain;
 * - `lowPoly`: the map rebuilt from simple flat-shaded models (no textures).
 */
import * as THREE from 'three';
import { TILESET_COLUMNS, TILE_DEFS, type WorldMap } from '@agora/shared';

const isGround = (name: string) => /(^|\.)(floor|floorAlt|floorB|floorC|dirt|dirtB|path\d+|rug|mat|pond\d+|water|fall3\d)$/.test(name);

/** Scale2x (EPX) on RGBA pixels. */
function scale2x(src: Uint32Array, w: number, h: number): Uint32Array {
  const out = new Uint32Array(w * 2 * h * 2);
  const at = (x: number, y: number) => src[Math.min(h - 1, Math.max(0, y)) * w + Math.min(w - 1, Math.max(0, x))]!;
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const P = at(x, y), A = at(x, y - 1), B = at(x + 1, y), C = at(x - 1, y), D = at(x, y + 1);
      let e0 = P, e1 = P, e2 = P, e3 = P;
      if (C === A && C !== D && A !== B) e0 = A;
      if (A === B && A !== C && B !== D) e1 = B;
      if (D === C && D !== B && C !== A) e2 = C;
      if (B === D && B !== A && D !== C) e3 = D;
      const o = y * 2 * w * 2 + x * 2;
      out[o] = e0;
      out[o + 1] = e1;
      out[o + w * 2] = e2;
      out[o + w * 2 + 1] = e3;
    }
  return out;
}

function grain(size: number, seed = 3): HTMLCanvasElement {
  const cv = document.createElement('canvas');
  cv.width = cv.height = size;
  const c = cv.getContext('2d')!;
  const d = c.createImageData(size, size);
  let s = seed;
  for (let i = 0; i < size * size; i++) {
    s = (s * 1103515245 + 12345) >>> 0;
    const fiber = (s >>> 16) % 100;
    const v = 238 + (fiber % 18);
    d.data[i * 4] = v;
    d.data[i * 4 + 1] = v - 3;
    d.data[i * 4 + 2] = v - 10;
    d.data[i * 4 + 3] = 255;
  }
  c.putImageData(d, 0, 0);
  return cv;
}

/** The whole tileset redrawn at 128 px per tile in the storybook look. */
export function storybookTileset(tileset: HTMLCanvasElement): HTMLCanvasElement {
  const T = 32, K = 4, C = T * K;
  const rows = Math.ceil(TILE_DEFS.length / TILESET_COLUMNS);
  const out = document.createElement('canvas');
  out.width = TILESET_COLUMNS * C;
  out.height = rows * C;
  const oc = out.getContext('2d')!;
  const src = tileset.getContext('2d', { willReadFrequently: true })!;
  const paper = grain(C);
  const cell = document.createElement('canvas');
  cell.width = cell.height = C;
  const cc = cell.getContext('2d', { willReadFrequently: true })!;
  const tmp = document.createElement('canvas');
  tmp.width = tmp.height = C + 16;
  const tc = tmp.getContext('2d')!;
  const painted = document.createElement('canvas');
  painted.width = painted.height = C;
  const pc = painted.getContext('2d', { willReadFrequently: true })!;
  const wrap = document.createElement('canvas');
  wrap.width = wrap.height = C * 3;
  const wc = wrap.getContext('2d')!;
  const alpha = document.createElement('canvas');
  alpha.width = alpha.height = C;
  const ac = alpha.getContext('2d')!;
  TILE_DEFS.forEach((d, i) => {
    const sx = (i % TILESET_COLUMNS) * T, sy = Math.floor(i / TILESET_COLUMNS) * T;
    const px = new Uint32Array(src.getImageData(sx, sy, T, T).data.buffer.slice(0));
    const big = scale2x(scale2x(px, T, T), T * 2, T * 2);
    cc.clearRect(0, 0, C, C);
    cc.putImageData(new ImageData(new Uint8ClampedArray(big.buffer as ArrayBuffer), C, C), 0, 0);
    const ground = isGround(d.name);
    const dx = (i % TILESET_COLUMNS) * C, dy = Math.floor(i / TILESET_COLUMNS) * C;
    pc.globalCompositeOperation = 'source-over';
    pc.clearRect(0, 0, C, C);
    if (ground) {
      // soften texture detail into painted patches; neighbours wrap so tiles still meet
      // tile 3×3 first, then blur once, so the edges wrap and stay opaque
      for (let oy = 0; oy < 3; oy++) for (let ox = 0; ox < 3; ox++) wc.drawImage(cell, ox * C, oy * C);
      pc.filter = 'blur(5px) saturate(1.1)';
      pc.drawImage(wrap, -C, -C);
      pc.filter = 'none';
      // posterize into flat painted zones
      const im = pc.getImageData(0, 0, C, C);
      for (let k = 0; k < im.data.length; k += 4)
        for (let ch = 0; ch < 3; ch++) im.data[k + ch] = Math.round(im.data[k + ch]! / 22) * 22;
      pc.putImageData(im, 0, 0);
    } else {
      // white cut-out edge under the object (not on walls), then the object
      tc.clearRect(0, 0, tmp.width, tmp.height);
      tc.drawImage(cell, 8, 8);
      tc.globalCompositeOperation = 'source-in';
      tc.fillStyle = '#fbf8f0';
      tc.fillRect(0, 0, tmp.width, tmp.height);
      tc.globalCompositeOperation = 'source-over';
      if (!/wall|window/.test(d.name))
        for (let a = 0; a < 16; a++)
          pc.drawImage(tmp, -8 + Math.cos((a / 16) * Math.PI * 2) * 5, -8 + Math.sin((a / 16) * Math.PI * 2) * 5);
      pc.filter = 'saturate(1.1)';
      pc.drawImage(cell, 0, 0);
      pc.filter = 'none';
    }
    // paper grain multiplied over the painted pixels, alpha kept
    ac.clearRect(0, 0, C, C);
    ac.drawImage(painted, 0, 0);
    pc.globalCompositeOperation = 'multiply';
    pc.drawImage(paper, 0, 0);
    pc.globalCompositeOperation = 'destination-in';
    pc.drawImage(alpha, 0, 0);
    oc.drawImage(painted, dx, dy);
  });
  return out;
}

/** Average colour of a tile's opaque pixels. */
export function tileColors(tileset: HTMLCanvasElement): THREE.Color[] {
  const c = tileset.getContext('2d', { willReadFrequently: true })!;
  const data = c.getImageData(0, 0, tileset.width, tileset.height).data;
  return TILE_DEFS.map((_, i) => {
    const ox = (i % TILESET_COLUMNS) * 32, oy = Math.floor(i / TILESET_COLUMNS) * 32;
    let r = 0, g = 0, b = 0, n = 0;
    for (let y = 0; y < 32; y++)
      for (let x = 0; x < 32; x++) {
        const o = ((oy + y) * tileset.width + ox + x) * 4;
        if (data[o + 3]! < 128) continue;
        r += data[o]!;
        g += data[o + 1]!;
        b += data[o + 2]!;
        n++;
      }
    return n ? new THREE.Color().setRGB(r / n / 255, g / n / 255, b / n / 255, THREE.SRGBColorSpace) : new THREE.Color(0x888888);
  });
}

const base = (n: string) => n.replace(/^(jungle|oasis|boreal|zen|hub)\./, '');

/** The region rebuilt from flat-shaded models. Returns the group and its lamp positions. */
export function lowPoly(map: WorldMap, region: { x: number; y: number; w: number; h: number }, colors: THREE.Color[], wallH: number): THREE.Group {
  const g = new THREE.Group();
  const mats = new Map<string, THREE.MeshLambertMaterial>();
  const mat = (col: THREE.Color | number, extra: Partial<THREE.MeshLambertMaterialParameters> = {}) => {
    const c = col instanceof THREE.Color ? col : new THREE.Color(col);
    const k = c.getHexString() + JSON.stringify(extra);
    let m = mats.get(k);
    if (!m) mats.set(k, (m = new THREE.MeshLambertMaterial({ color: c, flatShading: true, ...extra })));
    return m;
  };
  const add = (geo: THREE.BufferGeometry, m: THREE.Material, x: number, y: number, z: number) => {
    const mesh = new THREE.Mesh(geo, m);
    mesh.position.set(x, y, z);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    g.add(mesh);
    return mesh;
  };
  const at = (layer: string, cx: number, cy: number) => {
    if (cx < region.x || cy < region.y || cx >= region.x + region.w || cy >= region.y + region.h) return -1;
    const v = map.layers[layer]?.[cy * map.width + cx] ?? 0;
    return v ? v - 1 : -1;
  };
  const name = (layer: string, cx: number, cy: number) => {
    const i = at(layer, cx, cy);
    return i >= 0 ? base(TILE_DEFS[i]!.name) : '';
  };
  let seed = 9;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  const leaf = [0x3f8a43, 0x4f9d4a, 0x2f7a3c, 0x5aa652].map((h) => new THREE.Color(h));
  const wood = new THREE.Color(0xa86d3d), woodD = new THREE.Color(0x7b4a27), stone = new THREE.Color(0x8a9a7a), dark = new THREE.Color(0x2f3640);
  const water = new THREE.MeshLambertMaterial({ color: 0x3b9ccf, transparent: true, opacity: 0.85 });
  const floorGeo = new THREE.BoxGeometry(1, 0.1, 1);
  for (let cy = region.y; cy < region.y + region.h; cy++)
    for (let cx = region.x; cx < region.x + region.w; cx++) {
      const x = cx + 0.5, z = cy + 0.5;
      const fl = at('floor', cx, cy);
      const fn = name('floor', cx, cy);
      const fu = name('furniture', cx, cy);
      if (fl >= 0) {
        const col = colors[fl]!.clone().offsetHSL(0, 0.04, (rnd() - 0.5) * 0.03);
        const raised = /floorAlt|rug|mat/.test(fn) ? 0.04 : 0;
        add(floorGeo, mat(col), x, -0.05 + raised, z).castShadow = false;
      }
      if (at('walls', cx, cy) >= 0) {
        const h = wallH + (rnd() - 0.5) * 0.1;
        add(new THREE.BoxGeometry(1, h, 1), mat(stone.clone().offsetHSL(0, 0, (rnd() - 0.5) * 0.06)), x, h / 2, z);
        if (name('walls', cx, cy) === 'window') add(new THREE.BoxGeometry(0.6, 0.5, 0.05), mat(0xbfe6f5), x, 0.9, z + 0.5);
        continue;
      }
      if (!fu || fu === 'slot') continue;
      if (/^pond|^fall3/.test(fu)) {
        add(new THREE.BoxGeometry(1, 0.06, 1), water, x, 0.0, z).castShadow = false;
      } else if (/^fall[0-2]/.test(fu)) {
        const row = Number(fu[4]);
        const h = 2.4 - row * 0.6;
        add(new THREE.BoxGeometry(1, h, 1), mat(stone.clone().offsetHSL(0, -0.05, -0.08 + rnd() * 0.04)), x, h / 2, z);
        if (fu.endsWith('1')) add(new THREE.BoxGeometry(0.8, h, 0.08), water, x, h / 2, z + 0.52);
      } else if (/^desk/.test(fu)) {
        add(new THREE.BoxGeometry(1.0, 0.08, 0.7), mat(wood), x, 0.5, z);
        for (const [lx, lz] of [[-0.42, -0.28], [0.42, -0.28], [-0.42, 0.28], [0.42, 0.28]]) add(new THREE.BoxGeometry(0.06, 0.5, 0.06), mat(woodD), x + lx!, 0.25, z + lz!);
        if (/Monitor/.test(fu)) {
          add(new THREE.BoxGeometry(0.5, 0.32, 0.04), mat(dark), x, 0.78, z - 0.1);
          add(new THREE.BoxGeometry(0.44, 0.26, 0.01), mat(0x5ec3e8, { emissive: 0x2a6f8a }), x, 0.78, z - 0.08 + (fu.endsWith('Back') ? -0.04 : 0.02));
        }
      } else if (/^chair/.test(fu)) {
        add(new THREE.BoxGeometry(0.42, 0.08, 0.42), mat(dark), x, 0.32, z);
        add(new THREE.CylinderGeometry(0.04, 0.04, 0.3, 6), mat(dark), x, 0.15, z);
        const dir = fu.slice(5);
        const off = { Up: [0, 0.2], Down: [0, -0.2], Left: [0.2, 0], Right: [-0.2, 0] }[dir] ?? [0, 0];
        add(new THREE.BoxGeometry(off[0] ? 0.08 : 0.42, 0.4, off[1] ? 0.08 : 0.42), mat(dark), x + off[0]!, 0.55, z + off[1]!);
      } else if (fu === 'table') {
        add(new THREE.CylinderGeometry(0.45, 0.45, 0.07, 10), mat(wood), x, 0.45, z);
        add(new THREE.CylinderGeometry(0.06, 0.12, 0.45, 6), mat(woodD), x, 0.22, z);
      } else if (fu === 'treeBase') {
        add(new THREE.CylinderGeometry(0.16, 0.24, 1.6, 7), mat(woodD), x, 0.8, z);
        for (let k = 0; k < 3; k++)
          add(new THREE.IcosahedronGeometry(0.75 - k * 0.12, 0), mat(leaf[k % leaf.length]!), x + (rnd() - 0.5) * 0.5, 1.7 + k * 0.45, z + (rnd() - 0.5) * 0.4).rotation.set(rnd() * 3, rnd() * 3, 0);
      } else if (/^plant|border|hanging|decor/.test(fu)) {
        add(new THREE.CylinderGeometry(0.22, 0.16, 0.3, 8), mat(0xb5653a), x, 0.15, z + 0.1);
        for (let k = 0; k < 4; k++)
          add(new THREE.ConeGeometry(0.16, 0.6 + rnd() * 0.3, 5), mat(leaf[k % 4]!), x + (rnd() - 0.5) * 0.3, 0.6, z + 0.1 + (rnd() - 0.5) * 0.3).rotation.set((rnd() - 0.5) * 0.8, 0, (rnd() - 0.5) * 0.8);
      } else if (fu === 'lamp') {
        add(new THREE.CylinderGeometry(0.04, 0.06, 1.2, 6), mat(woodD), x, 0.6, z);
        add(new THREE.BoxGeometry(0.22, 0.26, 0.22), mat(0xffd27a, { emissive: 0xffb347, emissiveIntensity: 0.9 }), x, 1.3, z);
      } else {
        const col = at('furniture', cx, cy) >= 0 ? colors[at('furniture', cx, cy)]! : new THREE.Color(0x999999);
        add(new THREE.BoxGeometry(0.85, 0.7, 0.7), mat(col), x, 0.35, z);
      }
    }
  return g;
}
