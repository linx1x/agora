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

/** The Atrium (the Hub region of HQ) in 2.5D: its fixtures stand as the flat view draws them (P16.16). */
describe('the Atrium in 2.5D (P16.16, ADR-027 fixtures)', () => {
  const k = (n: string) => shape3d(TILE_DEFS.find((d) => d.name === n)!);
  const ATRIUM = { x: 36, y: 0, w: 30, h: 54 };

  it('lays the plaza, the rugs, the mats and the water basin flat on the floor', () => {
    for (const n of ['hub.floor', 'hub.floorAlt', 'hub.rug', 'mat', 'water']) {
      expect(k(n).kind, n).toBe('flat');
    }
  });
  it('stands the plants, the fixtures and the portals up as cards', () => {
    for (const n of [
      'hub.plantA',
      'hub.lamp',
      'hub.sofa',
      'stool',
      'portal',
      'fireplace',
      'fridge',
      'waterCooler',
      'whiteboard',
      'bookshelf',
    ]) {
      expect(k(n).kind, n).toBe('card');
    }
  });
  it('extrudes the tables, the reception desk and the counter as boxes', () => {
    for (const n of ['hub.table', 'coffeeTable', 'reception', 'counter']) {
      expect(k(n).kind, n).toBe('box');
    }
  });
  it('makes the walls, the windows and the glass doors walls, the wall tops flat', () => {
    for (const n of ['hub.wallFront', 'hub.window', 'glassDoor']) expect(k(n).kind, n).toBe('wall');
    expect(k('hub.wallTop')).toEqual({ kind: 'wall', wallTop: true });
  });
  it('gives every tile placed in the Atrium a drawn shape (none only for blockers)', () => {
    const seen = new Set<string>();
    for (const layer of ['floor', 'walls', 'furniture', 'above']) {
      const arr = map.layers[layer] ?? [];
      for (let cy = ATRIUM.y; cy < ATRIUM.y + ATRIUM.h; cy++)
        for (let cx = ATRIUM.x; cx < ATRIUM.x + ATRIUM.w; cx++) {
          const g = arr[cy * map.width + cx] ?? 0;
          if (g) seen.add(TILE_DEFS[g - 1]!.name);
        }
    }
    expect(seen.size).toBeGreaterThan(20);
    for (const n of seen) expect(k(n).kind, n).not.toBe('none');
  });
});

/** The Oasis, Boreal and Zen wings in 2.5D: their signature pieces stand as the flat view draws them (P16.17). */
describe('the wings in 2.5D (P16.17)', () => {
  const k = (n: string) => shape3d(TILE_DEFS.find((d) => d.name === n)!);
  const WINGS: Record<string, { x: number; y: number; w: number; h: number }> = {
    oasis: { x: 0, y: 27, w: 36, h: 27 },
    boreal: { x: 66, y: 0, w: 36, h: 27 },
    zen: { x: 66, y: 27, w: 36, h: 27 },
  };

  it('stands the Oasis waterfall columns and cabanas up, and lays its pools and rugs flat', () => {
    expect(k('oasis.fall00')).toEqual({ kind: 'card', column: true });
    expect(k('oasis.cabana11')).toEqual({ kind: 'card', column: true });
    for (const n of ['oasis.fall20', 'oasis.pond15', 'oasis.rug', 'oasis.dirt']) {
      expect(k(n).kind, n).toBe('flat');
    }
    expect(k('oasis.hanging').kind).toBe('decal');
  });
  it('extrudes the Oasis games tables as boxes and the Boreal and Zen desks as well', () => {
    for (const n of ['oasis.poolTableL', 'oasis.pingPongL', 'boreal.deskH', 'zen.deskV']) {
      expect(k(n).kind, n).toBe('box');
    }
  });
  it('lays the Boreal fire pits and ponds flat, and stands its screens and windows up', () => {
    for (const n of ['boreal.firepit00', 'boreal.firepit33', 'boreal.pond2']) {
      expect(k(n).kind, n).toBe('flat');
    }
    expect(k('boreal.tvL').kind).toBe('card');
    expect(k('boreal.window').kind).toBe('wall');
  });
  it('stands the Zen stone basin, screens and puzzle up, and lays the cushions and koi pond flat', () => {
    for (const n of ['zen.tsukubai', 'zen.puzzle', 'zen.screen']) expect(k(n).kind, n).toBe('card');
    for (const n of ['zen.zabuton', 'zen.pond15', 'zen.dirt']) expect(k(n).kind, n).toBe('flat');
    expect(k('zen.border').kind).toBe('box');
  });
  it('gives every tile placed in each wing a drawn shape (none only for blockers)', () => {
    for (const [wing, r] of Object.entries(WINGS)) {
      const seen = new Set<string>();
      for (const layer of ['floor', 'walls', 'furniture', 'above']) {
        const arr = map.layers[layer] ?? [];
        for (let cy = r.y; cy < r.y + r.h; cy++)
          for (let cx = r.x; cx < r.x + r.w; cx++) {
            const g = arr[cy * map.width + cx] ?? 0;
            if (g) seen.add(TILE_DEFS[g - 1]!.name);
          }
      }
      expect(seen.size, wing).toBeGreaterThan(40);
      for (const n of seen) if (n !== 'slot') expect(k(n).kind, `${wing}: ${n}`).not.toBe('none');
    }
  });
});
