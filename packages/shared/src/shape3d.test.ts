import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { parseMap, type Tmj } from './map';
import { shape3d } from './shape3d';
import { TILE_DEFS } from './tileset';

const map = parseMap(
  JSON.parse(readFileSync(resolve(import.meta.dirname, '../../maps/hq.tmj'), 'utf8')) as Tmj,
);
const used = (layer: string) =>
  new Set((map.layers[layer] ?? []).filter((g) => g > 0).map((g) => TILE_DEFS[g - 1]!));

describe('shape3d (P16.4, ADR-052)', () => {
  it('gives every tile a shape', () => {
    for (const d of TILE_DEFS) expect(shape3d(d).kind, d.name).toBeTruthy();
  });
  it('keeps every floor-layer tile of HQ flat', () => {
    for (const d of used('floor')) expect(shape3d(d).kind, d.name).toBe('flat');
  });
  it('turns the walls layer into walls (tops and faces)', () => {
    for (const d of used('walls')) expect(shape3d(d).kind, d.name).toBe('wall');
    expect(shape3d(TILE_DEFS.find((d) => d.name === 'hub.wallTop')!).wallTop).toBe(true);
  });
  it('extrudes every joinable surface (desks, tables, counters) as a box', () => {
    for (const d of TILE_DEFS.filter((t) => t.join)) {
      const s = shape3d(d);
      expect(s.kind, d.name).toBe('box');
      expect(s.split, d.name).toBeGreaterThan(8);
    }
  });
  it('stacks trees, cabinets and waterfalls; lays their pools flat', () => {
    const k = (n: string) => shape3d(TILE_DEFS.find((d) => d.name === n)!);
    expect(k('jungle.treeTop')).toEqual({ kind: 'card', column: true });
    expect(k('jungle.arcadeATop').column).toBe(true);
    expect(k('jungle.fall21').column).toBe(true);
    expect(k('jungle.fall31').kind).toBe('flat');
    expect(k('oasis.fall21').kind).toBe('flat');
    expect(k('jungle.hanging').kind).toBe('decal');
    expect(k('slot').kind).toBe('none');
  });
  it('lets a tile choose its own shape', () => {
    expect(shape3d({ name: 'custom.x', base: 'x', collides: false, d3: { kind: 'flat' } })).toEqual(
      {
        kind: 'flat',
      },
    );
  });
});
