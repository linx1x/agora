import * as THREE from 'three';
import { canvas } from '../art';
import type { BiomeDefinition } from './types';

export const BIOME_BLOCKS: Record<string, readonly string[]> = {
  meadow: ['meadow_grass', 'meadow_dirt', 'stone', 'water'],
  jungle: ['jungle_grass', 'jungle_mud', 'stone', 'water'],
  desert: ['desert_sand', 'desert_sandstone', 'sand', 'water'],
  taiga: ['taiga_moss', 'taiga_podzol', 'taiga_snow', 'stone', 'water'],
};
/** Continuous coordinates give material patches continuity across the block boundaries. */
export function pondDistance(x: number, z: number): number {
  return Math.hypot((x - 9.8) / 2.55, (z - 4.15) / 1.8) + Math.sin(x * 3 + z * 2) * 0.035;
}
export function inPond(x: number, z: number): boolean {
  return pondDistance(x, z) < 0.94;
}
export function terrainPixel(b: BiomeDefinition, x: number, z: number): string {
  const c = b.colors,
    f = Math.sin(x * 1.7 + Math.sin(z * 2.1)) * 0.6 + Math.cos(z * 1.9 - x * 0.8) * 0.4;
  const grain = Math.sin(x * 117.4 + z * 183.7) * Math.cos(z * 63.9 - x * 46.3);
  const bank = pondDistance(x, z),
    path =
      Math.abs(x - 5.4 - Math.sin(z * 0.8) * 0.4) <
      0.42 + Math.sin(z * 17 + x * 13) * 0.055 + grain * 0.045;
  const color = new THREE.Color(c.grass);
  if (path) color.set(c.dirt);
  else if (bank < 1.15) color.set(c.dirt).lerp(new THREE.Color(c.water), 0.13);
  else if (b.id === 'desert') {
    color.set(c.dirt);
    if (Math.sin(x * 0.7 - z * 0.6) > 0.86) color.set(c.stone);
  } else if (b.id === 'taiga' && f > 0.24) {
    color.set('#d7e1d8');
    if (f < 0.34) color.lerp(new THREE.Color(c.grass), 0.4);
  } else if (b.id === 'jungle' && f < -0.3) color.set(c.dirt).lerp(new THREE.Color(c.grass), 0.4);
  else if (f < -0.45) color.lerp(new THREE.Color(c.dirt), 0.35);
  const variation = 1 + f * 0.055 + grain * 0.035;
  color.multiplyScalar(variation);
  return `#${color.getHexString()}`;
}
/** Editable native terrain art, with sand ripples, needle litter and damp moss clusters. */
export function biomeGround(b: BiomeDefinition): HTMLCanvasElement {
  const cv = canvas(14 * 48, 11 * 48),
    ctx = cv.getContext('2d')!;
  for (let y = 0; y < cv.height; y += 2)
    for (let x = 0; x < cv.width; x += 2) {
      ctx.fillStyle = terrainPixel(b, x / 48, y / 48);
      ctx.fillRect(x, y, 2, 2);
    }
  let seed = 71;
  const random = () => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return seed / 4294967296;
  };
  for (let i = 0; i < 1800; i++) {
    const x = Math.floor(random() * cv.width),
      y = Math.floor(random() * cv.height);
    if (inPond(x / 48, y / 48)) continue;
    const wet = pondDistance(x / 48, y / 48) < 1.2;
    ctx.fillStyle = i % 3 ? b.colors.edge : b.colors.accent;
    ctx.globalAlpha = wet ? 0.28 : 0.19;
    if (b.id === 'desert') ctx.fillRect(x, y, 3 + random() * 7, 1);
    else {
      ctx.fillRect(x, y, 1, 2 + random() * 3);
      ctx.fillRect(x + 1, y - 1, 2, 1);
    }
    if (i % 9 === 0) {
      ctx.fillStyle = b.colors.stone;
      ctx.fillRect(x, y, 3, 2);
    }
  }
  ctx.globalAlpha = 1;
  // Root beds follow the same planting positions as scene props, fading irregularly outward.
  for (const [tx, tz] of [
    [1.1, 1.9],
    [4, 1.3],
    [7.1, 0.8],
    [12.3, 1.4],
    [0.9, 6.8],
  ]) {
    for (let i = 0; i < 120; i++) {
      const a = random() * Math.PI * 2,
        r = random();
      const x = (tx! + Math.cos(a) * r * 0.9) * 48,
        y = (tz! + Math.sin(a) * r * 0.46) * 48;
      ctx.globalAlpha = (1 - r) * 0.45;
      ctx.fillStyle = i % 2 ? b.colors.dirt : b.colors.edge;
      ctx.fillRect(x, y, 2 + random() * 4, 2);
    }
  }
  ctx.globalAlpha = 1;
  return cv;
}
