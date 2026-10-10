import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { TILE_DEFS, mapReader, parseMap, snapSpots, surfaceTop, type Tmj } from '@agora/shared';
import { propTo3D, surfaceHeightPx, surfaceTo2D } from './props3d';
import { buildScene, regionTiles, type Extents } from './scene';

const map = parseMap(
  JSON.parse(
    readFileSync(resolve(import.meta.dirname, '../../../../packages/maps/hq.tmj'), 'utf8'),
  ) as Tmj,
);
const ext: Extents[] = TILE_DEFS.map(() => ({ r0: 0, r1: 31, c0: 0, c1: 31 }));
const r = mapReader(map);
const scene = buildScene(map, regionTiles(map), ext);
/** the horizontal top face of the box at each cell */
const tops = new Map<string, { xa: number; xb: number; zb: number; zf: number; h: number }>();
for (const f of scene.faces)
  if (f.kind === 'box' && f.shade === 0 && f.p.every((p) => p[1] === f.p[0][1] && p[1] > 0)) {
    const xs = f.p.map((p) => p[0]);
    const zs = f.p.map((p) => p[2]);
    tops.set(`${f.cx},${f.cy}`, {
      xa: Math.min(...xs),
      xb: Math.max(...xs),
      zb: Math.min(...zs),
      zf: Math.max(...zs),
      h: f.p[0][1],
    });
  }

describe('props in 2.5D (P16.5)', () => {
  const spots: { cx: number; cy: number; x: number; y: number }[] = [];
  for (let cy = 0; cy < map.height; cy++)
    for (let cx = 0; cx < map.width; cx++)
      for (const s of snapSpots(r, cx, cy)) spots.push({ cx, cy, ...s });

  it('has surfaces to test on (every snap spot of HQ)', () => {
    expect(spots.length).toBeGreaterThan(100);
  });

  it('puts every snap spot on the top face of its desk, at the desk height', () => {
    for (const s of spots) {
      const top = tops.get(`${s.cx},${s.cy}`)!;
      expect(top, `${s.cx},${s.cy}`).toBeDefined();
      const hpx = surfaceHeightPx(r, s.cx, s.cy, ext);
      const [x, y, z] = propTo3D({ x: s.x, y: s.y, z: 0 }, { lift: 0 }, hpx);
      expect(y).toBeCloseTo(top.h, 9);
      expect(x).toBeGreaterThanOrEqual(top.xa);
      expect(x).toBeLessThanOrEqual(top.xb);
      expect(z).toBeGreaterThanOrEqual(top.zb - 1e-9);
      expect(z).toBeLessThanOrEqual(top.zf + 1e-9);
    }
  });

  it('round-trips: a point picked on a top face gives back the 2D base point the server checks', () => {
    for (const s of spots) {
      const hpx = surfaceHeightPx(r, s.cx, s.cy, ext);
      const [x, , z] = propTo3D({ x: s.x, y: s.y, z: 0 }, { lift: 0 }, hpx);
      const back = surfaceTo2D(x, z, hpx);
      expect(back).toEqual({ x: s.x, y: s.y });
      expect(surfaceTop(r, back.x, back.y)).toBe(true);
    }
  });

  it('raises stacked and lifted props without moving them across the desk', () => {
    const s = spots[0]!;
    const hpx = surfaceHeightPx(r, s.cx, s.cy, ext);
    const flat = propTo3D({ x: s.x, y: s.y, z: 0 }, { lift: 0 }, hpx);
    const stacked = propTo3D({ x: s.x, y: s.y, z: 3 }, { lift: 12 }, hpx);
    expect(stacked[0]).toBe(flat[0]);
    expect(stacked[2]).toBe(flat[2]);
    expect((stacked[1] - flat[1]) * 32).toBeCloseTo(15, 9);
  });

  it('leaves a prop with nothing under it on the floor', () => {
    expect(surfaceHeightPx(r, 0, 0, ext)).toBe(0);
  });
});
