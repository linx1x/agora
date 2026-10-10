/**
 * Biome blending (ADR-053). A point in (temperature, humidity) space gets a weight per biome
 * from a smooth kernel around each biome centre, so borders are a mix of neighbours rather than
 * a cut. A cell then picks one biome from those weights with a hash value (dithering), so a
 * border shows both biomes in an irregular pattern.
 *
 * Determinism: distances are compared squared (no square roots), and only + - * / are used.
 */
import { WORLD_BIOMES, type WorldBiomeRegistry } from './registry';

/**
 * Weight of each biome at (temperature, humidity), aligned with `registry.list`.
 * Kernel: w = (1 - d^2 / r^2)^2 inside radius r, 0 outside. Weights sum to 1. Far from every
 * centre (all kernels zero) the nearest centre takes weight 1.
 */
export function biomeWeights(
  temperature: number,
  humidity: number,
  registry: WorldBiomeRegistry = WORLD_BIOMES,
): number[] {
  const r2 = registry.blendRadius * registry.blendRadius;
  const weights: number[] = [];
  let sum = 0;
  let nearest = 0;
  let nearestD2 = Infinity;
  registry.list.forEach((biome, i) => {
    const dt = temperature - biome.centre.temperature;
    const dh = humidity - biome.centre.humidity;
    const d2 = dt * dt + dh * dh;
    if (d2 < nearestD2) {
      nearestD2 = d2;
      nearest = i;
    }
    const k = d2 >= r2 ? 0 : 1 - d2 / r2;
    const w = k * k;
    weights.push(w);
    sum += w;
  });
  if (sum === 0) return weights.map((_, i) => (i === nearest ? 1 : 0));
  return weights.map((w) => w / sum);
}

/**
 * Pick one index from weights with a uniform value `u` in [0, 1): cumulative walk, so a cell
 * with weight 0.6 for biome A and 0.4 for B takes A when u < 0.6. Deterministic for a given u.
 */
export function pickBiome(weights: readonly number[], u: number): number {
  let acc = 0;
  for (let i = 0; i < weights.length; i++) {
    acc += weights[i] ?? 0;
    if (u < acc) return i;
  }
  // Rounding can leave acc a hair under 1: take the last biome that has any weight.
  for (let i = weights.length - 1; i >= 0; i--) {
    if ((weights[i] ?? 0) > 0) return i;
  }
  return 0;
}

/** Index of the largest weight (ties go to the lower index). */
export function dominantBiome(weights: readonly number[]): number {
  let best = 0;
  for (let i = 1; i < weights.length; i++) {
    if ((weights[i] ?? 0) > (weights[best] ?? 0)) best = i;
  }
  return best;
}
