/**
 * Three.js meshes for one map region (P16.6, ADR-052): the faces from `buildScene` merged into one
 * geometry with a texture atlas made from the app's tileset. Pixel-art sampling (nearest, no
 * mipmaps), so the 32 px tiles stay crisp at every zoom.
 */
import * as THREE from 'three';
import { TILESET_COLUMNS, TILE_DEFS } from '@agora/shared';
import type { Extents, Face3D, Scene3D } from './scene';
import { FADE_ATTR, ditherFade } from './occlusion';

/** Shade rows baked into the atlas: lit, front (×0.82) and side (×0.64), as the spike did. */
export const SHADES = [1, 0.82, 0.64] as const;

export interface Atlas {
  canvas: HTMLCanvasElement;
  rows: number;
  /** uv rect of a face: u0, v0 (top-left), u1, v1 (bottom-right), v top-down */
  uv(f: Face3D): [number, number, number, number];
}

/** The tileset three times, top to bottom, one per shade. */
export function makeAtlas(tileset: HTMLCanvasElement): Atlas {
  const rows = Math.ceil(TILE_DEFS.length / TILESET_COLUMNS);
  const cv = document.createElement('canvas');
  cv.width = tileset.width;
  cv.height = tileset.height * SHADES.length;
  const c = cv.getContext('2d')!;
  c.imageSmoothingEnabled = false;
  SHADES.forEach((k, i) => {
    c.drawImage(tileset, 0, i * tileset.height);
    if (k < 1) {
      c.globalCompositeOperation = 'source-atop';
      c.fillStyle = `rgba(0,0,0,${1 - k})`;
      c.fillRect(0, i * tileset.height, tileset.width, tileset.height);
      c.globalCompositeOperation = 'source-over';
    }
  });
  // a hair inside the texel edges so nearest sampling never picks the neighbouring tile
  const e = 0.02;
  const W = cv.width;
  const H = cv.height;
  return {
    canvas: cv,
    rows,
    uv(f) {
      const ox = (f.tile % TILESET_COLUMNS) * 32;
      const oy = Math.floor(f.tile / TILESET_COLUMNS) * 32 + f.shade * rows * 32;
      return [(ox + f.u0 + e) / W, (oy + f.v0 + e) / H, (ox + f.u1 - e) / W, (oy + f.v1 - e) / H];
    },
  };
}

/** Opaque extents of every tile's art, scanned once from the tileset canvas (see scene.ts). */
export function scanExtents(tileset: HTMLCanvasElement): Extents[] {
  const c = tileset.getContext('2d', { willReadFrequently: true })!;
  const data = c.getImageData(0, 0, tileset.width, tileset.height).data;
  return TILE_DEFS.map((_, i) => {
    const ox = (i % TILESET_COLUMNS) * 32;
    const oy = Math.floor(i / TILESET_COLUMNS) * 32;
    let r0 = 32;
    let r1 = -1;
    let c0 = 32;
    let c1 = -1;
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

/**
 * One mesh for every face of a region (four vertices per face, in face order, so face i owns
 * vertices 4i…4i+3). Faces that carry a blend key draw their base tile for now; the composed
 * variants come with P16.12. The `aFade` attribute starts solid (1) for every vertex.
 */
export function buildRegionMesh(scene: Scene3D, atlas: Atlas, tex: THREE.Texture): THREE.Mesh {
  const pos: number[] = [];
  const uvs: number[] = [];
  const nrm: number[] = [];
  const fade: number[] = [];
  const idx: number[] = [];
  const a = new THREE.Vector3();
  const b = new THREE.Vector3();
  const d = new THREE.Vector3();
  const n = new THREE.Vector3();
  for (const f of scene.faces) {
    const [u0, v0, u1, v1] = atlas.uv(f);
    const base = pos.length / 3;
    const [p0, p1, p2, p3] = f.p;
    for (const p of [p0, p1, p2, p3]) pos.push(p[0], p[1], p[2]);
    // three's uv v runs bottom-up
    uvs.push(u0, 1 - v0, u1, 1 - v0, u1, 1 - v1, u0, 1 - v1);
    n.subVectors(b.set(...p1), a.set(...p0))
      .cross(d.subVectors(b.set(...p3), a.set(...p0)))
      .normalize()
      .negate();
    for (let k = 0; k < 4; k++) nrm.push(n.x, n.y, n.z);
    fade.push(1, 1, 1, 1);
    idx.push(base, base + 3, base + 2, base, base + 2, base + 1);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geo.setAttribute('normal', new THREE.Float32BufferAttribute(nrm, 3));
  const fadeAttr = new THREE.Float32BufferAttribute(fade, 1);
  fadeAttr.setUsage(THREE.DynamicDrawUsage);
  geo.setAttribute(FADE_ATTR, fadeAttr);
  geo.setIndex(idx);
  const mat = new THREE.MeshLambertMaterial({ map: tex, alphaTest: 0.5, side: THREE.DoubleSide });
  ditherFade(mat);
  return new THREE.Mesh(geo, mat);
}

/** Free the geometry and material of every mesh under `root` (textures are the caller's). */
export function disposeTree(root: THREE.Object3D): void {
  root.traverse((o) => {
    if (o instanceof THREE.Mesh) {
      o.geometry.dispose();
      (Array.isArray(o.material) ? o.material : [o.material]).forEach((m) => m.dispose());
    }
  });
}

/** A texture for pixel art: nearest sampling, no mipmaps, sRGB. */
export function pixelTexture(c: HTMLCanvasElement): THREE.CanvasTexture {
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.magFilter = THREE.NearestFilter;
  t.minFilter = THREE.NearestFilter;
  t.generateMipmaps = false;
  return t;
}
