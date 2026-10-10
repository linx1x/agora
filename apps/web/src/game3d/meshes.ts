/**
 * Three.js meshes for one map region (P16.6, P16.12, ADR-052): the faces from `buildScene` merged
 * into one geometry with one texture atlas. The atlas holds the app's tileset, the frames of the
 * animated tiles (water, pond, waterfall, fire, portal: `animatedTiles`) and the composed ADR-037
 * variants of the blended cells (`blendSlots`). Pixel-art sampling (nearest, no mipmaps), so the
 * 32 px tiles stay crisp at every zoom.
 *
 * Shade (lit, front, side) is a vertex colour, so one band of art serves all three. Face i is
 * vertices 4i…4i+3 (the occlusion fade relies on it).
 */
import * as THREE from 'three';
import { TILESET_COLUMNS, TILE_DEFS } from '@agora/shared';
import type { Extents, Face3D, Scene3D } from './scene';
import { FADE_ATTR, ditherFade } from './occlusion';
import { animFrame, type BlendSlot } from './atlasMath';
import { makeAnimCanvas } from '../game/tiles';

/** Shade of a face: lit, front (×0.82) and side (×0.64), as the spike did. */
export const SHADES = [1, 0.82, 0.64] as const;

/** An animated tile of the region's atlas: its index, frame count and rate (`animatedTiles`). */
export interface AnimDef {
  name: string;
  index: number;
  frames: number;
  fps: number;
}

export interface Atlas {
  canvas: HTMLCanvasElement;
  /** uv rect of a face (u0, v0 top-left, u1, v1 bottom-right, v top-down), showing `frame` of an animated tile */
  uv(f: Face3D, frame: number): [number, number, number, number];
  /** the animation of a tile, or undefined when it is still */
  animOf(tile: number): { frames: number; fps: number } | undefined;
}

const CELL = 32;
/** a hair inside the texel edges so nearest sampling never picks the neighbouring cell */
const EDGE = 0.02;

/**
 * The atlas of a region: the tileset at the top, the animation strips under it (one row a tile,
 * one column a frame), then the blend slots, 8 to a row. `pixels` gives a slot's composed art.
 */
export function makeRegionAtlas(
  tileset: HTMLCanvasElement,
  anim: AnimDef[],
  slots: BlendSlot[],
  pixels: (s: BlendSlot) => Uint8ClampedArray,
): Atlas {
  const strip = anim.length ? makeAnimCanvas(anim) : null;
  const W = Math.max(tileset.width, strip?.width ?? 0);
  const cols = W / CELL;
  const tH = tileset.height;
  const aH = anim.length * CELL;
  const H = tH + aH + Math.ceil(slots.length / cols) * CELL;
  const cv = document.createElement('canvas');
  cv.width = W;
  cv.height = Math.max(CELL, H);
  const c = cv.getContext('2d')!;
  c.imageSmoothingEnabled = false;
  c.drawImage(tileset, 0, 0);
  if (strip) c.drawImage(strip, 0, tH);
  const cell = document.createElement('canvas');
  cell.width = CELL;
  cell.height = CELL;
  const cc = cell.getContext('2d')!;
  for (const s of slots) {
    const img = cc.createImageData(CELL, CELL);
    img.data.set(pixels(s));
    cc.putImageData(img, 0, 0);
    c.drawImage(cell, (s.slot % cols) * CELL, tH + aH + Math.floor(s.slot / cols) * CELL);
  }

  const animInfo = new Map<number, { row: number; frames: number; fps: number }>();
  anim.forEach((a, row) => animInfo.set(a.index, { row, frames: a.frames, fps: a.fps }));
  const blend = new Map(slots.map((s) => [s.key, s.slot]));
  const rect = (x0: number, y0: number, f: Face3D): [number, number, number, number] => [
    (x0 + f.u0 + EDGE) / W,
    (y0 + f.v0 + EDGE) / H,
    (x0 + f.u1 - EDGE) / W,
    (y0 + f.v1 - EDGE) / H,
  ];
  return {
    canvas: cv,
    uv(f, frame) {
      const bs = f.blend !== undefined ? blend.get(f.blend) : undefined;
      if (bs !== undefined) return rect((bs % cols) * CELL, tH + aH + Math.floor(bs / cols) * CELL, f);
      const an = animInfo.get(f.tile);
      if (an) return rect(frame * CELL, tH + an.row * CELL, f);
      return rect((f.tile % TILESET_COLUMNS) * CELL, Math.floor(f.tile / TILESET_COLUMNS) * CELL, f);
    },
    animOf(tile) {
      const an = animInfo.get(tile);
      return an ? { frames: an.frames, fps: an.fps } : undefined;
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

/** An animated face: its index in the mesh, its tile and rate. */
interface AnimRun {
  face: number;
  f: Face3D;
  tile: number;
  frames: number;
  fps: number;
}

/**
 * The frames of a region's animated tiles, turned on the mesh's uv at the slow tick of the view
 * (a few dozen faces change, one buffer write). Reduced motion holds the first frame.
 */
export class RegionAnim {
  /** the frame each animated tile shows now */
  private shown = new Map<number, number>();
  /** one entry per animated tile in the region (the per-frame check walks these, not the faces) */
  private readonly kinds: { tile: number; frames: number; fps: number }[];

  constructor(
    private readonly geo: THREE.BufferGeometry,
    private readonly atlas: Atlas,
    private readonly runs: AnimRun[],
  ) {
    const seen = new Map<number, { tile: number; frames: number; fps: number }>();
    for (const r of runs) if (!seen.has(r.tile)) seen.set(r.tile, r);
    this.kinds = [...seen.values()];
  }

  /** Per frame: move the uv of every face whose tile has a new frame. */
  tick(ms: number, reduced: boolean): void {
    const frames = new Map<number, number>();
    for (const k of this.kinds) frames.set(k.tile, animFrame(ms, k.fps, k.frames, reduced));
    let changed = false;
    for (const k of this.kinds) if (this.shown.get(k.tile) !== frames.get(k.tile)) changed = true;
    if (!changed) return;
    const uv = this.geo.getAttribute('uv') as THREE.BufferAttribute;
    for (const r of this.runs) {
      const [u0, v0, u1, v1] = this.atlas.uv(r.f, frames.get(r.tile) ?? 0);
      const b = r.face * 4;
      uv.setXY(b, u0, 1 - v0);
      uv.setXY(b + 1, u1, 1 - v0);
      uv.setXY(b + 2, u1, 1 - v1);
      uv.setXY(b + 3, u0, 1 - v1);
    }
    uv.needsUpdate = true;
    this.shown = frames;
  }
}

/**
 * One mesh for every face of a region, with its animation (null when no tile in it moves). The
 * caller owns the texture and disposes it with the region.
 */
export function buildRegionMesh(
  scene: Scene3D,
  atlas: Atlas,
  tex: THREE.Texture,
): { mesh: THREE.Mesh; anim: RegionAnim | null } {
  const pos: number[] = [];
  const uvs: number[] = [];
  const nrm: number[] = [];
  const col: number[] = [];
  const fade: number[] = [];
  const idx: number[] = [];
  const runs: AnimRun[] = [];
  const a = new THREE.Vector3();
  const b = new THREE.Vector3();
  const d = new THREE.Vector3();
  const n = new THREE.Vector3();
  scene.faces.forEach((f, i) => {
    const [u0, v0, u1, v1] = atlas.uv(f, 0);
    const base = pos.length / 3;
    const [p0, p1, p2, p3] = f.p;
    for (const p of [p0, p1, p2, p3]) pos.push(p[0], p[1], p[2]);
    // three's uv v runs bottom-up
    uvs.push(u0, 1 - v0, u1, 1 - v0, u1, 1 - v1, u0, 1 - v1);
    n.subVectors(b.set(...p1), a.set(...p0))
      .cross(d.subVectors(b.set(...p3), a.set(...p0)))
      .normalize()
      .negate();
    const shade = SHADES[f.shade];
    for (let k = 0; k < 4; k++) {
      nrm.push(n.x, n.y, n.z);
      col.push(shade, shade, shade);
    }
    fade.push(1, 1, 1, 1);
    idx.push(base, base + 3, base + 2, base, base + 2, base + 1);
    const an = atlas.animOf(f.tile);
    if (an) runs.push({ face: i, f, tile: f.tile, frames: an.frames, fps: an.fps });
  });
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  const uvAttr = new THREE.Float32BufferAttribute(uvs, 2);
  uvAttr.setUsage(THREE.DynamicDrawUsage);
  geo.setAttribute('uv', uvAttr);
  geo.setAttribute('normal', new THREE.Float32BufferAttribute(nrm, 3));
  geo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  const fadeAttr = new THREE.Float32BufferAttribute(fade, 1);
  fadeAttr.setUsage(THREE.DynamicDrawUsage);
  geo.setAttribute(FADE_ATTR, fadeAttr);
  geo.setIndex(idx);
  const mat = new THREE.MeshLambertMaterial({
    map: tex,
    vertexColors: true,
    alphaTest: 0.5,
    side: THREE.DoubleSide,
  });
  ditherFade(mat);
  const mesh = new THREE.Mesh(geo, mat);
  // shadows keep the art's cut-outs (a tree's shadow is a tree, not its card)
  mesh.customDepthMaterial = new THREE.MeshDepthMaterial({ map: tex, alphaTest: 0.5 });
  return { mesh, anim: runs.length ? new RegionAnim(geo, atlas, runs) : null };
}

/** Free the geometry and material of every mesh under `root` (textures are the caller's). */
export function disposeTree(root: THREE.Object3D): void {
  root.traverse((o) => {
    if (o instanceof THREE.Mesh) {
      o.geometry.dispose();
      (Array.isArray(o.material) ? o.material : [o.material]).forEach((m) => m.dispose());
      o.customDepthMaterial?.dispose();
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
