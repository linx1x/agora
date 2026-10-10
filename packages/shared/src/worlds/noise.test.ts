import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  createRng,
  fbm2,
  hash32,
  hashCell,
  hashUnit,
  simplex2,
  worldSeedFor,
} from './noise';

// Golden values were computed by this module and cross-checked with an
// independent Python port (32-bit masked integers, IEEE doubles). A change here
// means the generator changed: bump genVersion (ADR-053).
describe('integer hashing', () => {
  it('hash32 matches golden values', () => {
    expect(hash32('')).toBe(167010153);
    expect(hash32('abc')).toBe(1792905582);
    expect(worldSeedFor('u1')).toBe(3560865791);
    expect(worldSeedFor('u1')).toBe(hash32('agora-world:u1'));
  });

  it('hashCell matches golden values and is uint32', () => {
    expect(hashCell(42, 0, 0)).toBe(3118121311);
    expect(hashCell(42, -3, 7)).toBe(888059493);
    expect(hashUnit(42, 5, 9)).toBe(0.5813267389312387);
  });

  it('hashUnit stays in [0, 1) over a grid', () => {
    for (let i = -20; i <= 20; i++) {
      for (let j = -20; j <= 20; j++) {
        const v = hashUnit(7, i, j);
        expect(v).toBeGreaterThanOrEqual(0);
        expect(v).toBeLessThan(1);
      }
    }
  });
});

describe('createRng', () => {
  it('produces the golden sequence for a seed', () => {
    const rng = createRng(12345);
    expect([rng(), rng(), rng(), rng()]).toEqual([
      0.9797282677609473, 0.3067522644996643, 0.484205421525985, 0.817934412509203,
    ]);
  });

  it('is repeatable and stays in [0, 1)', () => {
    const a = createRng(99);
    const b = createRng(99);
    for (let i = 0; i < 1000; i++) {
      const v = a();
      expect(v).toBe(b());
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });
});

describe('simplex2', () => {
  it('matches golden values', () => {
    expect(simplex2(42, 0.5, 0.5)).toBe(0.3071565136272162);
    expect(simplex2(42, 1.25, -3.75)).toBe(0.4900949629586355);
    expect(simplex2(42, 100.1, 200.2)).toBe(0.3192737307379138);
    expect(simplex2(42, -17.3, 4.9)).toBe(-0.5022210186988334);
    expect(simplex2(42, 1048575, -1048576)).toBe(0.0742919237838937);
  });

  it('is deterministic for the same inputs', () => {
    expect(simplex2(5, 3.3, -8.1)).toBe(simplex2(5, 3.3, -8.1));
  });

  it('stays within [-1, 1] and is not flat', () => {
    const rng = createRng(1);
    let min = Infinity;
    let max = -Infinity;
    for (let i = 0; i < 20000; i++) {
      const v = simplex2(3, rng() * 400 - 200, rng() * 400 - 200);
      min = Math.min(min, v);
      max = Math.max(max, v);
    }
    expect(min).toBeGreaterThanOrEqual(-1);
    expect(max).toBeLessThanOrEqual(1);
    expect(max - min).toBeGreaterThan(1);
  });

  it('is continuous: a tiny step changes the value a little', () => {
    const eps = 0.001;
    let worst = 0;
    for (let i = 0; i < 2000; i++) {
      const x = i * 0.37 - 300;
      const y = i * 0.11 - 80;
      worst = Math.max(worst, Math.abs(simplex2(11, x + eps, y) - simplex2(11, x, y)));
    }
    expect(worst).toBeLessThan(0.05);
  });

  it('differs between seeds', () => {
    expect(simplex2(1, 2.5, 2.5)).not.toBe(simplex2(2, 2.5, 2.5));
  });
});

describe('fbm2', () => {
  it('matches golden values', () => {
    expect(fbm2(42, 0.5, 0.5, { octaves: 4 })).toBe(-0.3396568921660921);
    expect(fbm2(42, 1.25, -3.75, { octaves: 4 })).toBe(0.03740076244680767);
    expect(fbm2(42, 100.1, 200.2, { octaves: 4 })).toBe(0.0929462098192874);
    expect(fbm2(42, -17.3, 4.9, { octaves: 4 })).toBe(-0.20125088011418868);
    expect(fbm2(42, 1048575, -1048576, { octaves: 4 })).toBe(-0.26651321856017324);
  });

  it('stays within [-1, 1] and returns 0 without octaves', () => {
    const rng = createRng(8);
    for (let i = 0; i < 5000; i++) {
      const v = fbm2(9, rng() * 1000, rng() * 1000, { octaves: 6, lacunarity: 2.5, gain: 0.6 });
      expect(Math.abs(v)).toBeLessThanOrEqual(1);
    }
    expect(fbm2(9, 1, 1, { octaves: 0 })).toBe(0);
  });
});

describe('determinism guard', () => {
  it('noise.ts uses no transcendental Math functions (their last bits differ by platform)', () => {
    const code = readFileSync(new URL('./noise.ts', import.meta.url), 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/\/\/.*$/gm, '');
    expect(code).not.toMatch(/Math\.(sin|cos|tan|exp|log|pow|sqrt|atan2|cbrt|hypot)\b/);
  });
});
