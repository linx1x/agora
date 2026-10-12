import * as THREE from 'three';
import { FLOOR_CLEARANCE, SUN_SHADOW } from './grounding';

import { CROP_BY_ID, type ReviewCrop } from './plantCatalog';
export { REVIEW_CROPS, type ReviewCrop } from './plantCatalog';

/** Motion is weighted above the root collar: bulbs and ground contacts stay planted. */
export function cropDisplacement(
  species: ReviewCrop,
  x: number,
  height: number,
  time: number,
  phase: number,
  wateredAgo = Infinity,
): [number, number] {
  const h = Math.max(0, height - 0.13);
  if (h === 0) return [0, 0];
  const breeze = Math.sin(time * 1.55 + phase) + 0.32 * Math.sin(time * 2.7 + phase * 1.9);
  const flutter = Math.sin(time * 5.6 + phase + x * 11 + height * 9);
  const response =
    wateredAgo >= 0 && wateredAgo < 2.5
      ? Math.sin(wateredAgo * 10) * Math.exp(-wateredAgo * 2.4)
      : 0;
  const motion = CROP_BY_ID[species].motion;
  if (motion === 'vine') return [h * (breeze * 0.065 + response * 0.12), h * flutter * 0.005];
  if (motion === 'grass')
    return [h * (breeze * 0.05 + flutter * 0.008 + response * 0.1), h * flutter * 0.003];
  if (motion === 'flower')
    return [
      h * (breeze * 0.04 + response * 0.12),
      h * (Math.sin(time * 2.3 + phase) * 0.012 + response * 0.04),
    ];
  if (motion === 'broad')
    return [h * (breeze * 0.025 + flutter * 0.013), h * (flutter * 0.026 + response * 0.18)];
  return [h * (breeze * 0.043 + flutter * 0.012 + response * 0.14), h * flutter * 0.014];
}

/** Deform the cutout and both projected silhouettes from the same resting geometry. */
export class CropMotion {
  private body: THREE.BufferGeometry;
  private cast: THREE.BufferGeometry;
  private contact: THREE.BufferGeometry;
  private resting: Float32Array;
  private shadowAlpha: Float32Array[];
  tipOffset = 0;

  constructor(
    readonly group: THREE.Group,
    readonly species: ReviewCrop,
    readonly phase: number,
    private earthHeight: (x: number, z: number) => number = () => 0,
  ) {
    this.body = (group.children[0] as THREE.Mesh).geometry;
    this.cast = (group.children[1] as THREE.Mesh).geometry;
    this.contact = (group.children[2] as THREE.Mesh).geometry;
    this.resting = new Float32Array(this.body.getAttribute('position').array);
    this.shadowAlpha = [this.cast, this.contact].map(
      (g) => new Float32Array(g.getAttribute('color').array),
    );
    // Include the maximum sway in frustum bounds without recomputing them each frame.
    for (const g of [this.body, this.cast, this.contact]) g.boundingSphere!.radius += 0.2;
  }

  update(time: number, wateredAgo: number): void {
    const body = this.body.getAttribute('position');
    const cast = this.cast.getAttribute('position');
    const contact = this.contact.getAttribute('position');
    for (let i = 0; i < body.count; i++) {
      const x = this.resting[i * 3]!;
      const y = this.resting[i * 3 + 1]!;
      const z = this.resting[i * 3 + 2]!;
      const [dx, dy] = cropDisplacement(this.species, x, y, time, this.phase, wateredAgo);
      body.setXYZ(i, x + dx, y + dy, z);
      const height = Math.max(0, y + dy - FLOOR_CLEARANCE);
      for (const [index, target] of [cast, contact].entries()) {
        const sx = x + dx + height * SUN_SHADOW.x,
          sz = z + height * SUN_SHADOW.z;
        target.setXYZ(i, sx, this.earthHeight(sx, sz) + (index ? 0.002 : 0.001), sz);
        const color = (index ? this.contact : this.cast).getAttribute('color');
        // Buried root pixels must not leave a duplicate silhouette on top of the soil.
        const exposed = Math.min(1, Math.max(0, (y + dy - this.earthHeight(x + dx, z)) / 0.018));
        color.setW(i, this.shadowAlpha[index]![i * 4 + 3]! * exposed);
      }
      if (i === 0) this.tipOffset = dx;
    }
    body.needsUpdate = cast.needsUpdate = contact.needsUpdate = true;
    this.cast.getAttribute('color').needsUpdate = this.contact.getAttribute('color').needsUpdate =
      true;
  }
}
