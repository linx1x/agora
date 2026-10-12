import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { TILE_DEFS, parseMap, themedTile, type MapChange, type Tmj } from '@agora/shared';
import { copyMap, ghostOf } from './ghost3d';
import type { Extents } from './scene';

const map = parseMap(
  JSON.parse(
    readFileSync(resolve(import.meta.dirname, '../../../../packages/maps/hq.tmj'), 'utf8'),
  ) as Tmj,
);
const ext: Extents[] = TILE_DEFS.map(() => ({ r0: 0, r1: 31, c0: 0, c1: 31 }));
// the Atrium floor by the desk pods: open, and what the e2e specs build on
const [cx, cy] = [42, 45];
// the palette's name for the plant in the Atrium's biome (`hub.plantA`)
const plant: MapChange = { l: 'furniture', x: cx, y: cy, t: themedTile('plantA', 'hub') };

describe('build preview in 2.5D (P16.13)', () => {
  it('an accepted edit: its changed cells come with their new faces, drawn plain', () => {
    const g = ghostOf(map, [plant], ext);
    expect(g.ok).toBe(true);
    expect(g.reason).toBeUndefined();
    expect(g.cells).toContainEqual({ cx, cy });
    expect(g.faces.length).toBeGreaterThan(0);
    const cells = new Set(g.cells.map((c) => `${c.cx},${c.cy}`));
    for (const f of g.faces) {
      expect(cells.has(`${f.cx},${f.cy}`)).toBe(true);
      expect(f.blend).toBeUndefined();
    }
    expect(g.movedIds.size).toBe(0);
    expect(g.props).toEqual([]);
  });

  it('a refused edit: ok is false with the reason, and the map is not written to', () => {
    const chair = map.desks[0]!.chair;
    const i = chair.cy * map.width + chair.cx;
    const before = map.layers.furniture![i];
    const g = ghostOf(map, [{ l: 'furniture', x: chair.cx, y: chair.cy, t: null }], ext);
    expect(g.ok).toBe(false);
    expect(g.reason).toBe('locked_desk');
    expect(map.layers.furniture![i]).toBe(before);
  });

  it('an edit that changes nothing shows nothing', () => {
    const g = ghostOf(map, [{ l: 'furniture', x: cx, y: cy, t: null }], ext);
    expect(g.cells).toEqual([]);
    expect(g.faces).toEqual([]);
  });

  it('a prop edit names the prop it moves, and draws it where it would be', () => {
    const move: MapChange = {
      l: 'prop',
      id: 'g1',
      p: { t: 'prop.coffee', x: cx * 32 + 16, y: cy * 32 + 16, z: 0, f: false },
    };
    const g = ghostOf(map, [move], ext);
    expect([...g.movedIds]).toEqual(['g1']);
    expect(g.props.map((p) => p.prop)).toEqual(['g1']);
  });
});

describe('copyMap', () => {
  it('copies the layers, collision and props, so an edit on the copy leaves the map alone', () => {
    const copy = copyMap(map);
    const i = cy * map.width + cx;
    copy.layers.furniture![i] = 99;
    copy.solid[i] = 1;
    expect(map.layers.furniture![i]).not.toBe(99);
    expect(copy.props).not.toBe(map.props);
    expect(copy.layers.furniture).not.toBe(map.layers.furniture);
  });
});
