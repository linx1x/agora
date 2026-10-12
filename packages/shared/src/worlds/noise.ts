/**
 * Deterministic integer hashing, a seeded PRNG and 2D simplex noise (ADR-053).
 *
 * Determinism rules, because the client and the server must agree bit for bit:
 * - hashing uses only Math.imul, shifts and xor (exact 32-bit integer arithmetic);
 * - the PRNG divides by 2^32 (exact in IEEE 754);
 * - simplex uses literal skew constants and integer gradients: no Math.sqrt,
 *   sin, cos, pow, exp or log, whose last bits are implementation-defined;
 * - fBm uses power-of-two lacunarity and gain by default (exact multiples).
 */

/** Skew factor of 2D simplex, (sqrt(3) - 1) / 2, as a literal. */
const F2 = 0.3660254037844386;
/** Unskew factor of 2D simplex, (3 - sqrt(3)) / 6, as a literal. */
const G2 = 0.21132486540518713;

/** Gradient components: the 12 edge directions of 3D simplex projected to 2D (integers). */
const GRAD_X: readonly number[] = [1, -1, 1, -1, 1, -1, 1, -1, 0, 0, 0, 0];
const GRAD_Y: readonly number[] = [1, 1, -1, -1, 0, 0, 0, 0, 1, -1, 1, -1];

/** Murmur3 finaliser: a full-avalanche mix of one 32-bit word. Returns uint32. */
function fmix32(input: number): number {
  let h = input;
  h ^= h >>> 16;
  h = Math.imul(h, 0x85ebca6b);
  h ^= h >>> 13;
  h = Math.imul(h, 0xc2b2ae35);
  h ^= h >>> 16;
  return h >>> 0;
}

/**
 * Hash a string to a uint32 (xmur3 with a murmur finaliser).
 * World seeds are `hash32("agora-world:" + userId)`.
 */
export function hash32(text: string): number {
  let h = (1779033703 ^ text.length) | 0;
  for (let i = 0; i < text.length; i++) {
    h = Math.imul(h ^ text.charCodeAt(i), 3432918353);
    h = (h << 13) | (h >>> 19);
  }
  h = Math.imul(h ^ (h >>> 16), 2246822507);
  h = Math.imul(h ^ (h >>> 13), 3266489909);
  return (h ^ (h >>> 16)) >>> 0;
}

/** Seed of a personal world: `hash32("agora-world:" + userId)` (ADR-053). */
export function worldSeedFor(userId: string): number {
  return hash32(`agora-world:${userId}`);
}

/** Hash two signed integers and a seed to a uint32. Used for lattice gradients and decor. */
export function hashCell(seed: number, i: number, j: number): number {
  const a = fmix32((seed ^ Math.imul(i, 0x27d4eb2d)) >>> 0);
  return fmix32((a ^ Math.imul(j, 0x165667b1)) >>> 0);
}

/** Hash a cell to a value in [0, 1). Exact: the division is by 2^32. */
export function hashUnit(seed: number, i: number, j: number): number {
  return hashCell(seed, i, j) / 4294967296;
}

/**
 * Seeded PRNG (mulberry32). Returns a function producing floats in [0, 1).
 * Same seed, same sequence, on every platform.
 */
export function createRng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * 2D simplex noise (Gustavson's construction, integer gradients, hashed lookup).
 * Output is clamped to [-1, 1]. `x` and `y` are in noise units (cells times frequency).
 */
export function simplex2(seed: number, x: number, y: number): number {
  const s = (x + y) * F2;
  const i = Math.floor(x + s);
  const j = Math.floor(y + s);
  const t = (i + j) * G2;
  const x0 = x - (i - t);
  const y0 = y - (j - t);
  const i1 = x0 > y0 ? 1 : 0;
  const j1 = 1 - i1;
  const x1 = x0 - i1 + G2;
  const y1 = y0 - j1 + G2;
  const x2 = x0 - 1 + 2 * G2;
  const y2 = y0 - 1 + 2 * G2;
  const n =
    simplexCorner(seed, i, j, x0, y0) +
    simplexCorner(seed, i + i1, j + j1, x1, y1) +
    simplexCorner(seed, i + 1, j + 1, x2, y2);
  const v = 70 * n;
  return v > 1 ? 1 : v < -1 ? -1 : v;
}

function simplexCorner(seed: number, i: number, j: number, x: number, y: number): number {
  const t = 0.5 - x * x - y * y;
  if (t < 0) return 0;
  const k = hashCell(seed, i, j) % GRAD_X.length;
  const dot = (GRAD_X[k] ?? 0) * x + (GRAD_Y[k] ?? 0) * y;
  const t2 = t * t;
  return t2 * t2 * dot;
}

export interface FbmOptions {
  /** Number of octaves, an integer >= 1. */
  readonly octaves: number;
  /** Frequency multiplier per octave. Default 2. */
  readonly lacunarity?: number;
  /** Amplitude multiplier per octave. Default 0.5. */
  readonly gain?: number;
}

/**
 * Fractal Brownian motion over simplex noise. Output is normalised by the
 * total amplitude, so it stays in [-1, 1] whatever the octave count.
 */
export function fbm2(seed: number, x: number, y: number, options: FbmOptions): number {
  const octaves = Math.floor(options.octaves);
  if (octaves < 1) return 0;
  const lacunarity = options.lacunarity ?? 2;
  const gain = options.gain ?? 0.5;
  let sum = 0;
  let norm = 0;
  let amp = 1;
  let freq = 1;
  for (let o = 0; o < octaves; o++) {
    sum += amp * simplex2(hashCell(seed, o, 0x5eed), x * freq, y * freq);
    norm += amp;
    amp *= gain;
    freq *= lacunarity;
  }
  return sum / norm;
}
