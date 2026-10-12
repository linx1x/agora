import { describe, expect, it } from 'vitest';
import { LAMP_COLOR } from '../game/lighting';
import {
  BLOOM_MAX,
  DAY_END,
  DAY_START,
  NOON_ELEVATION,
  SUN_INTENSITY,
  ambientAt,
  bloomStrength,
  flicker,
  lampColor,
  lampLevel,
  mixHex,
  nearestN,
  sunAt,
} from './lightingMath';

/** The blue channel of a `#rrggbb` colour. */
const blue = (hex: string) => parseInt(hex.slice(5, 7), 16);

describe('sunAt (the Québec hour → the sun)', () => {
  it('is highest at midday, rising from 6 h and setting at 20 h', () => {
    expect(sunAt(13).elevation).toBeCloseTo(NOON_ELEVATION, 6);
    expect(sunAt(9).elevation).toBeLessThan(sunAt(11).elevation);
    expect(sunAt(11).elevation).toBeLessThan(sunAt(13).elevation);
    expect(sunAt(DAY_START).elevation).toBeCloseTo(0, 6);
    expect(sunAt(DAY_END).elevation).toBeCloseTo(0, 6);
  });

  it('swings from east (sunrise) through south (noon) to west (sunset)', () => {
    const dawn = sunAt(DAY_START + 0.3).dir;
    const noon = sunAt(13).dir;
    const dusk = sunAt(DAY_END - 0.3).dir;
    expect(dawn[0]).toBeGreaterThan(0.9);
    expect(Math.abs(noon[0])).toBeLessThan(1e-9);
    // at 46° the horizontal part of the sun is cos 46° ≈ 0.69 of the vector
    expect(noon[2]).toBeCloseTo(Math.cos((NOON_ELEVATION * Math.PI) / 180), 6);
    expect(dusk[0]).toBeLessThan(-0.9);
  });

  it('is a unit vector at every hour, and points up when the sun is up', () => {
    for (const h of [0, 3, 6, 8.5, 13, 17.2, 19.9, 23]) {
      const [x, y, z] = sunAt(h).dir;
      expect(Math.hypot(x, y, z)).toBeCloseTo(1, 9);
    }
    expect(sunAt(13).dir[1]).toBeGreaterThan(0.6);
    expect(sunAt(2).dir[1]).toBeLessThan(0);
  });

  it('is off at night and at full strength by day, from the 2D daylight curve', () => {
    expect(sunAt(2).intensity).toBe(0);
    expect(sunAt(23).intensity).toBe(0);
    expect(sunAt(13).intensity).toBeCloseTo(SUN_INTENSITY, 6);
    expect(sunAt(19).intensity).toBeGreaterThan(0);
    expect(sunAt(19).intensity).toBeLessThan(sunAt(13).intensity);
  });

  it('is warmer (less blue) low in the sky than at noon', () => {
    expect(blue(sunAt(7).color)).toBeLessThan(blue(sunAt(13).color));
    expect(blue(sunAt(19).color)).toBeLessThan(blue(sunAt(13).color));
  });
});

describe('ambientAt', () => {
  it('is darker at night than by day, and always a hex colour', () => {
    // the tint carries the level: the sky's blue channel is lower at night
    expect(blue(ambientAt(2).sky)).toBeLessThan(blue(ambientAt(13).sky));
    expect(ambientAt(13).intensity).toBeGreaterThan(0.9);
    expect(ambientAt(2).intensity).toBeLessThanOrEqual(1.6);
    expect(ambientAt(2).sky).toMatch(/^#[0-9a-f]{6}$/);
    expect(ambientAt(2).ground).toMatch(/^#[0-9a-f]{6}$/);
  });
});

describe('lampLevel (as the 2D view composites them)', () => {
  it('windows follow daylight and are off at night', () => {
    expect(lampLevel('window', 0)).toBe(0);
    expect(lampLevel('window', 1)).toBe(1);
  });

  it('portals are always lit', () => {
    expect(lampLevel('portal', 0)).toBe(1);
    expect(lampLevel('portal', 1)).toBe(1);
  });

  it('lamps and fires are brighter at night than by day', () => {
    expect(lampLevel('lamp', 0)).toBeGreaterThan(lampLevel('lamp', 1));
    expect(lampLevel('fire', 1)).toBeCloseTo(0.35, 9);
    expect(lampLevel('fire', 0)).toBeCloseTo(1, 9);
  });

  it('an unclaimed desk lamp is dimmed to about a third of an owned one', () => {
    expect(lampLevel('desk', 0.5, false)).toBeCloseTo(lampLevel('desk', 0.5, true) * 0.35, 9);
    expect(lampLevel('desk', 0.5)).toBe(lampLevel('desk', 0.5, true));
  });
});

describe('lampColor', () => {
  it('a lamp takes its biome colour, a window the sky, and a desk lamp its own decor colour', () => {
    expect(lampColor('lamp', 'jungle', '#123456')).toBe(LAMP_COLOR.jungle);
    expect(lampColor('lamp', 'nowhere', '#123456')).toBe(LAMP_COLOR.hub);
    expect(lampColor('window', 'hub', '#abcdef')).toBe('#abcdef');
    expect(lampColor('desk', 'hub', '#123456', '#ff8fa3')).toBe('#ff8fa3');
    expect(lampColor('fire', 'hub', '#123456')).toMatch(/^#/);
    expect(lampColor('portal', 'hub', '#123456')).toMatch(/^#/);
  });
});

describe('flicker', () => {
  it('holds at 1 under reduced motion', () => {
    expect(flicker('fire', 1.234, 2, true)).toBe(1);
  });

  it('stays within its amplitude: fires most, plain lamps least', () => {
    for (let t = 0; t < 20; t += 0.037) {
      expect(Math.abs(flicker('fire', t, 1, false) - 1)).toBeLessThanOrEqual(0.25 + 1e-9);
      expect(Math.abs(flicker('lamp', t, 1, false) - 1)).toBeLessThanOrEqual(0.05 + 1e-9);
    }
  });
});

describe('bloomStrength', () => {
  it('is off in full daylight and at its peak after dusk', () => {
    expect(bloomStrength(1)).toBe(0);
    expect(bloomStrength(0.8)).toBe(0);
    expect(bloomStrength(0)).toBe(BLOOM_MAX);
    expect(bloomStrength(0.5)).toBeGreaterThan(0);
    expect(bloomStrength(0.5)).toBeLessThan(BLOOM_MAX);
  });
});

describe('nearestN', () => {
  const items = [
    { id: 'far', x: 10, z: 10 },
    { id: 'near', x: 1, z: 1 },
    { id: 'mid', x: 4, z: 0 },
  ];

  it('takes the n lights nearest the point, nearest first', () => {
    expect(nearestN(items, { x: 0, z: 0 }, 2).map((i) => i.id)).toEqual(['near', 'mid']);
    expect(nearestN(items, { x: 9, z: 9 }, 1).map((i) => i.id)).toEqual(['far']);
  });

  it('returns every light when n is larger, and none when n is zero', () => {
    expect(nearestN(items, { x: 0, z: 0 }, 99)).toHaveLength(3);
    expect(nearestN(items, { x: 0, z: 0 }, 0)).toEqual([]);
    expect(nearestN([], { x: 0, z: 0 }, 3)).toEqual([]);
  });
});

describe('mixHex', () => {
  it('mixes channel by channel, clamped at the ends', () => {
    expect(mixHex('#000000', '#ffffff', 0.5)).toBe('#808080');
    expect(mixHex('#102030', '#405060', 0)).toBe('#102030');
    expect(mixHex('#102030', '#405060', 1)).toBe('#405060');
    expect(mixHex('#102030', '#405060', 3)).toBe('#405060');
  });
});
