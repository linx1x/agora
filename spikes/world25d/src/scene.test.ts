import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { TILE_DEFS, parseMap, type Tmj } from '@agora/shared';
import { buildScene, type Extents } from './scene';

const map = parseMap(JSON.parse(readFileSync(resolve(import.meta.dirname, '../../../packages/maps/hq.tmj'), 'utf8')) as Tmj);
const jungle = { x: 0, y: 0, w: 36, h: 27 };
// every tile treated as fully opaque: enough to check the mapping rules without a canvas
const ext: Extents[] = TILE_DEFS.map(() => ({ r0: 0, r1: 31, c0: 0, c1: 31 }));
const desc = buildScene(map, jungle, ext, { wallH: 1.5 });

describe('2.5D scene description (P16.4 draft)', () => {
  it('gives every floor cell of the region exactly one floor face', () => {
    const floors = desc.faces.filter((f) => f.kind === 'floor' && f.p[0][1] === 0);
    expect(floors.length).toBe(36 * 27);
  });
  it('stays inside the region (the camera never shows another wing)', () => {
    for (const f of desc.faces)
      for (const [x, , z] of f.p) {
        expect(x).toBeGreaterThanOrEqual(0);
        expect(x).toBeLessThanOrEqual(36);
        expect(z).toBeGreaterThanOrEqual(0);
        expect(z).toBeLessThanOrEqual(27.1);
      }
  });
  it('draws each tree canopy once, on its trunk', () => {
    const tops = TILE_DEFS.flatMap((d, i) => (d.name === 'jungle.treeTop' ? [i] : []));
    const drawn = desc.faces.filter((f) => tops.includes(f.tile)).length;
    const placed = map.layers.above!.filter((g, k) => tops.includes(g - 1) && k % map.width < 36 && Math.floor(k / map.width) < 27).length;
    expect(drawn).toBe(placed);
  });
  it('gives walls height and every desk a box', () => {
    expect(Math.max(...desc.faces.filter((f) => f.kind === 'wall').flatMap((f) => f.p.map((p) => p[1])))).toBe(1.5);
    const deskCells = map.layers.furniture!.filter((g, k) => g && /desk/.test(TILE_DEFS[g - 1]!.name) && k % map.width < 36 && Math.floor(k / map.width) < 27).length;
    expect(desc.faces.filter((f) => f.kind === 'box').length).toBe(deskCells * 4);
  });
});
