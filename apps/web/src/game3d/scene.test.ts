import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { TILE_DEFS, parseMap, shape3d, type Tmj } from '@agora/shared';
import { BLEND_GEOM } from '@agora/shared';
import { buildScene, joined, regionTiles, type Extents, type Face3D } from './scene';

const map = parseMap(
  JSON.parse(
    readFileSync(resolve(import.meta.dirname, '../../../../packages/maps/hq.tmj'), 'utf8'),
  ) as Tmj,
);
// every tile treated as fully opaque: enough to check the rules without a canvas
const ext: Extents[] = TILE_DEFS.map(() => ({ r0: 0, r1: 31, c0: 0, c1: 31 }));
const regions = map.regions.map((r) => ({ id: r.id, t: regionTiles(map, r) }));
const scenes = regions.map((r) => ({ ...r, s: buildScene(map, r.t, ext) }));
const cellsOf = (layer: string, t: { x: number; y: number; w: number; h: number }) => {
  const out: { cx: number; cy: number; i: number }[] = [];
  for (let cy = t.y; cy < t.y + t.h; cy++)
    for (let cx = t.x; cx < t.x + t.w; cx++) {
      const g = map.layers[layer]?.[cy * map.width + cx] ?? 0;
      if (g) out.push({ cx, cy, i: g - 1 });
    }
  return out;
};
const ys = (f: Face3D) => f.p.map((p) => p[1]);

describe('2.5D scene (P16.4)', () => {
  it('covers HQ: five regions, every one with faces', () => {
    expect(scenes.map((s) => s.id).sort()).toEqual(['boreal', 'hub', 'jungle', 'oasis', 'zen']);
    for (const { s } of scenes) expect(s.faces.length).toBeGreaterThan(1000);
  });

  it('gives every floor cell exactly one floor face at ground level', () => {
    for (const { t, s } of scenes) {
      const floors = s.faces.filter((f) => f.kind === 'floor' && ys(f).every((y) => y === 0));
      expect(floors.length).toBe(cellsOf('floor', t).length);
      expect(new Set(floors.map((f) => `${f.cx},${f.cy}`)).size).toBe(floors.length);
    }
  });

  it('stays inside its region, so the camera never shows another wing', () => {
    for (const { t, s } of scenes)
      for (const f of s.faces)
        for (const [x, , z] of f.p) {
          expect(x).toBeGreaterThanOrEqual(t.x);
          expect(x).toBeLessThanOrEqual(t.x + t.w);
          expect(z).toBeGreaterThanOrEqual(t.y);
          expect(z).toBeLessThanOrEqual(t.y + t.h + 0.5);
        }
  });

  it('roofs every wall cell, with no gaps', () => {
    for (const { t, s } of scenes) {
      const roofs = new Set(
        s.faces
          .filter((f) => f.kind === 'wall' && ys(f).every((y) => y === 1.5))
          .map((f) => `${f.cx},${f.cy}`),
      );
      for (const c of cellsOf('walls', t))
        expect(roofs.has(`${c.cx},${c.cy}`), `${c.cx},${c.cy}`).toBe(true);
    }
  });

  it('draws every crown and vine once', () => {
    for (const { t, s } of scenes) {
      const above = cellsOf('above', t);
      for (const c of above) {
        const drawn = s.faces.filter((f) => f.tile === c.i && f.cx === c.cx && f.cy === c.cy);
        expect(drawn.length, `${TILE_DEFS[c.i]!.name} at ${c.cx},${c.cy}`).toBe(1);
      }
    }
  });

  it('extrudes every desk, table and counter as a box; joined runs share one slab', () => {
    for (const { t, s } of scenes) {
      const boxes = new Set(s.faces.filter((f) => f.kind === 'box').map((f) => `${f.cx},${f.cy}`));
      for (const c of cellsOf('furniture', t))
        if (shape3d(TILE_DEFS[c.i]!).kind === 'box')
          expect(boxes.has(`${c.cx},${c.cy}`)).toBe(true);
    }
    // a cell joined south has no front face, and its top runs to the cell's south edge
    const g = joined(4, null);
    expect(g.front).toBe(false);
    expect(g.t1).toBe(32);
    expect(joined(0b0010, null).t0).toBe(BLEND_GEOM.top);
  });

  it('marks blended ground and joined furniture with their ADR-037 keys', () => {
    const jungle = scenes.find((q) => q.id === 'jungle')!.s;
    expect(jungle.faces.some((f) => f.kind === 'floor' && f.blend?.startsWith('g|'))).toBe(true);
    expect(jungle.faces.some((f) => f.kind === 'box' && f.blend?.startsWith('f|'))).toBe(true);
  });

  it('finds the lamps and windows to light', () => {
    for (const { s } of scenes) expect(s.lights.length).toBeGreaterThan(0);
  });
});
