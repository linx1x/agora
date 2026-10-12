import * as THREE from 'three';
import type { ReviewCrop } from './crops';

export const CROP_STAGES = ['Sprout', 'Seedling', 'Leafy', 'Developing', 'Harvest-ready'];

/** World-space planting depth; mature radish shoulders emerge while the taproot stays buried. */
export function plantingDepth(species: ReviewCrop, stage: number): number {
  if (species === 'rust_yam') return [0.009, 0.014, 0.025, 0.065, 0.14][stage]!;
  if (species === 'clover_bulb' || species === 'pearl_onion')
    return [0.009, 0.014, 0.025, 0.04, 0.065][stage]!;
  return species === 'dawn_radish'
    ? [0.009, 0.014, 0.02, 0.03, 0.055][stage]!
    : 0.01 + stage * 0.006;
}

/** One continuous earth surface, flush at tile edges, with a broken ridge around the stem. */
export function soilHeight(x: number, z: number, stage: number, variant: number): number {
  if (x <= 0 || x >= 1 || z <= 0 || z >= 1) return 0;
  const width = 0.15 + stage * 0.027;
  const dx = (x - 0.5) / width,
    dz = (z - 0.59) / (width * 0.7);
  const edge = Math.min(1, x * 10, (1 - x) * 10, z * 10, (1 - z) * 10);
  const irregular = 0.82 + 0.12 * Math.sin(x * 39 + variant) + 0.06 * Math.cos(z * 51 - variant);
  return (0.012 + stage * 0.009) * Math.exp(-(dx * dx + dz * dz) * 0.8) * irregular * edge;
}

export function plantedSoilGeometry(stage: number, variant: number): THREE.BufferGeometry {
  const g = new THREE.PlaneGeometry(1, 1, 32, 32);
  g.rotateX(-Math.PI / 2);
  const p = g.getAttribute('position');
  for (let i = 0; i < p.count; i++)
    p.setY(i, soilHeight(p.getX(i) + 0.5, p.getZ(i) + 0.5, stage, variant));
  g.computeBoundingSphere();
  return g;
}

/** Paint over the existing native soil material; never modify the approved crop bitmap. */
export function plantedSoilTexture(
  base: HTMLCanvasElement,
  stage: number,
  variant: number,
): HTMLCanvasElement {
  const out = document.createElement('canvas');
  out.width = out.height = 64;
  const c = out.getContext('2d')!;
  c.drawImage(base, 0, 0);
  let seed = (variant * 931 + 17) >>> 0;
  const rand = () => (seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 4294967296;
  const width = 10 + stage * 2.4;
  // Furrows break into irregular crumbly earth near expanding roots, with no outlined disc.
  for (let y = 18; y < 56; y++) {
    for (let x = 9; x < 55; x++) {
      const d = ((x - 32) / width) ** 2 + ((y - 38) / (width * 0.64)) ** 2;
      if (d > 1.5 + rand() * 0.9) continue;
      const r = rand();
      c.fillStyle = r < 0.24 ? '#624833' : r < 0.64 ? '#77563b' : '#856141';
      c.fillRect(x, y, 1, 1);
    }
  }
  // A narrow planting slit grows into a root collar; its front edge overlaps the buried base.
  const slit = 3 + stage;
  c.fillStyle = '#3f3226';
  c.fillRect(32 - slit, 36, slit * 2, 2);
  for (let i = 0; i < 10 + stage * 4; i++) {
    const x = Math.round(32 + (rand() - 0.5) * width * 2.2);
    const y = Math.round(38 + (rand() - 0.5) * width * 1.3);
    const w = 2 + Math.floor(rand() * 3),
      h = 1 + Math.floor(rand() * 2);
    c.fillStyle = '#513d2c';
    c.fillRect(x, y + 1, w, h);
    c.fillStyle = i % 3 ? '#99714a' : '#806044';
    c.fillRect(x, y, w - 1, h);
  }
  if (stage >= 3) {
    // Tiny displaced crust fragments, not exposed white roots or a decorative border.
    c.fillStyle = '#49382a';
    for (let i = 0; i < stage; i++) {
      const x = 20 + Math.floor(rand() * 24),
        y = 32 + Math.floor(rand() * 15);
      c.fillRect(x, y, 3, 1);
      c.fillRect(x + 2, y - 1, 2, 1);
    }
  }
  return out;
}
