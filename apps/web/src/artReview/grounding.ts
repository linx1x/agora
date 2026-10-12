import * as THREE from 'three';
import { TILT } from '../game3d/camera';

/** Direction away from the upper-left sun, in floor tiles per tile of height. */
export const SUN_SHADOW = { x: 0.48, z: 0.32 };
export const FLOOR_CLEARANCE = 0.004;

export interface SpriteSupport {
  /** Bottom edge of the last visible pixel, measured down from the texture top. */
  bottom: number;
  /** Height of the painted footprint to lay onto the floor, in world tiles. */
  footHeight: number;
}

/** Fold the painted footprint onto the floor, preserving its vertical screen projection.
 * Upper pixels remain upright. Rear feet and roots now have actual floor depth instead
 * of hovering higher up a vertical card. The 35-degree view never rotates.
 */
export function groundedPoint(
  x: number,
  paintedHeight: number,
  footHeight: number,
): [number, number, number] {
  const floorPart = Math.min(Math.max(0, paintedHeight), footHeight);
  return [
    x,
    Math.max(0, paintedHeight - footHeight),
    -floorPart / Math.tan((TILT * Math.PI) / 180),
  ];
}

export function supportOf(source: HTMLCanvasElement, footHeight: number): SpriteSupport {
  const { width, height } = source;
  const data = source.getContext('2d')!.getImageData(0, 0, width, height).data;
  for (let y = height - 1; y >= 0; y--) {
    for (let x = 0; x < width; x++) {
      if (data[(y * width + x) * 4 + 3]! >= 128) return { bottom: (y + 1) / height, footHeight };
    }
  }
  return { bottom: 1, footHeight: 0 };
}

/** One shared silhouette drives the object, cast shadow and near-ground occlusion. */
export function groundedGeometry(
  w: number,
  h: number,
  support: SpriteSupport,
  rows = 72,
): THREE.BufferGeometry {
  const position: number[] = [],
    colour: number[] = [],
    uv: number[] = [],
    index: number[] = [];
  for (let row = 0; row <= rows; row++) {
    const v = row / rows;
    for (const x of [-w / 2, w / 2]) {
      const p = groundedPoint(x, (support.bottom - v) * h, support.footHeight);
      position.push(p[0], p[1] + FLOOR_CLEARANCE, p[2]);
      // Shared ambient contact shading, independent of the sprite's painted light.
      const shade = 1 - 0.2 * Math.exp(-p[1] / 0.18);
      colour.push(shade, shade, shade);
      uv.push(x < 0 ? 0 : 1, 1 - v);
    }
    if (row < rows) {
      const i = row * 2;
      index.push(i, i + 2, i + 1, i + 1, i + 2, i + 3);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(position, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setAttribute('color', new THREE.Float32BufferAttribute(colour, 3));
  g.setIndex(index);
  g.computeBoundingSphere();
  return g;
}

export function shadowGeometry(
  object: THREE.BufferGeometry,
  contact: boolean,
  length = 1,
): THREE.BufferGeometry {
  const g = object.clone();
  const pos = g.getAttribute('position');
  const colours: number[] = [];
  for (let i = 0; i < pos.count; i++) {
    const height = Math.max(0, pos.getY(i) - FLOOR_CLEARANCE);
    pos.setXYZ(
      i,
      pos.getX(i) + height * SUN_SHADOW.x * length,
      contact ? 0.002 : 0.001,
      pos.getZ(i) + height * SUN_SHADOW.z * length,
    );
    const alpha = contact ? Math.exp(-height / 0.07) : 0.85 - Math.min(0.25, height * 0.08);
    colours.push(1, 1, 1, alpha);
  }
  g.setAttribute('color', new THREE.Float32BufferAttribute(colours, 4));
  g.computeBoundingSphere();
  return g;
}

/** A rendering mask only: the approved artwork itself is untouched. */
export function silhouetteMask(source: HTMLCanvasElement, contact = false): HTMLCanvasElement {
  const mask = document.createElement('canvas');
  mask.width = source.width;
  mask.height = source.height;
  const c = mask.getContext('2d')!;
  if (contact) {
    // One texture pixel of soft occlusion peeks around roots and feet. No generic footprint.
    c.globalAlpha = 0.18;
    for (const [dx, dy] of [
      [-1, 0],
      [1, 0],
      [0, -1],
      [0, 1],
    ])
      c.drawImage(source, dx!, dy!);
    c.globalAlpha = 1;
  }
  c.drawImage(source, 0, 0);
  c.globalCompositeOperation = 'source-in';
  c.fillStyle = '#ffffff';
  c.fillRect(0, 0, mask.width, mask.height);
  return mask;
}
