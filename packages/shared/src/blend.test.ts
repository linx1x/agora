import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  ARM_W,
  BLEND_RADIUS,
  armSpan,
  blendNeighbourhood,
  furnitureKey,
  groundKey,
  isMerged,
  joinMask,
  mapReader,
  propRestX,
  propRestY,
  snapSpots,
  surfaceTop,
} from './blend';
import { applyChanges, ensureEditLayers, type CellChange } from './edit';
import { parseMap, type Tmj, type WorldMap } from './map';
import { writePropsLayer } from './props';
import { TILE_DEFS } from './tileset';

const raw = readFileSync(new URL('../../maps/hq.tmj', import.meta.url), 'utf8');
const fresh = () => parseMap(JSON.parse(raw) as Tmj);

/**
 * A clean 9×9 patch of plain jungle grass in the middle of the jungle wing (no walls,
 * furniture or props), so each test controls its own neighbourhood.
 */
function openJungleCell(map: WorldMap): { x: number; y: number } {
  const r = map.regions.find((q) => q.biome === 'jungle')!;
  const x = Math.floor((r.x + r.w / 2) / map.tile);
  const y = Math.floor((r.y + r.h / 2) / map.tile);
  const clear: CellChange[] = [];
  for (let dy = -4; dy <= 4; dy++)
    for (let dx = -4; dx <= 4; dx++) {
      clear.push({ l: 'floor', x: x + dx, y: y + dy, t: 'jungle.floor' });
      for (const l of ['walls', 'furniture', 'above'] as const)
        clear.push({ l, x: x + dx, y: y + dy, t: null });
    }
  applyChanges(map, clear);
  map.props = [];
  return { x, y };
}

const keys = (map: WorldMap) => {
  const r = mapReader(map);
  const out: (string | null)[] = [];
  for (let y = 0; y < map.height; y++)
    for (let x = 0; x < map.width; x++) out.push(`${groundKey(r, x, y)}#${furnitureKey(r, x, y)}`);
  return out;
};

describe('blend metadata', () => {
  it('blends natural ground only and joins desks, tables and counters', () => {
    const d = (n: string) => TILE_DEFS.find((t) => t.name === n)!;
    expect(d('jungle.floor').terrain).toEqual({ group: 'green', tex: 'jungle.floor' });
    expect(d('jungle.path5').terrain).toEqual({ group: 'dirt', tex: 'jungle.dirt' });
    expect(d('oasis.floorB').terrain?.group).toBe('ground');
    // paved, wooden and woven floors keep crisp edges
    for (const n of ['oasis.dirt', 'jungle.floorAlt', 'jungle.rug', 'hub.floor', 'mat'])
      expect(d(n).terrain).toBeUndefined();
    expect(d('zen.deskMonitor').join).toEqual({
      group: 'surface',
      mat: 'desk',
      prop: 'prop.monitorFront',
    });
    expect(d('counter').join).toMatchObject({ mat: 'counter', eastWestOnly: true });
    expect(d('boreal.table').surface).toBeGreaterThan(0);
    expect(d('prop.lampOn').light).toBe('lamp');
    expect(d('jungle.plantA').join).toBeUndefined();
  });
});

describe('joined furniture', () => {
  it('desk pods are merged L shapes', () => {
    const map = fresh();
    const r = mapReader(map);
    const pod = map.desks.find((q) => q.region === 'jungle')!;
    // the lamp end of the back segment is joined on the west only (or west + south)
    const m = joinMask(r, pod.lamp.cx, pod.lamp.cy);
    expect(m & 8).toBe(8);
    expect(isMerged(r, pod.lamp.cx, pod.lamp.cy)).toBe(true);
    expect(furnitureKey(r, pod.lamp.cx, pod.lamp.cy)).not.toBeNull();
  });

  it('a lone desk keeps its art; a second one joins both', () => {
    const map = fresh();
    const { x, y } = openJungleCell(map);
    applyChanges(map, [{ l: 'furniture', x, y, t: 'jungle.deskH' }]);
    let r = mapReader(map);
    expect(isMerged(r, x, y)).toBe(false);
    expect(furnitureKey(r, x, y)).toBeNull();
    expect(propRestY(r, x, y)).toBe(17);
    applyChanges(map, [{ l: 'furniture', x: x + 1, y, t: 'counter' }]);
    r = mapReader(map);
    expect(joinMask(r, x, y)).toBe(2);
    expect(joinMask(r, x + 1, y)).toBe(8);
    expect(furnitureKey(r, x, y)).not.toBeNull();
    // the cast shadow reaches the cells below and to the right
    expect(furnitureKey(r, x + 2, y + 1)).not.toBeNull();
    expect(furnitureKey(r, x - 2, y)).toBeNull();
  });

  it('counters join east–west only, so a stack of them keeps its art', () => {
    const map = fresh();
    const { x, y } = openJungleCell(map);
    applyChanges(map, [
      { l: 'furniture', x, y, t: 'counter' },
      { l: 'furniture', x, y: y + 1, t: 'counter' },
      { l: 'furniture', x: x + 1, y: y + 1, t: 'jungle.deskH' },
    ]);
    const r = mapReader(map);
    expect(isMerged(r, x, y)).toBe(false);
    expect(joinMask(r, x, y + 1)).toBe(2);
  });

  it('props rest lower on a desk that continues south', () => {
    const map = fresh();
    const { x, y } = openJungleCell(map);
    applyChanges(map, [
      { l: 'furniture', x, y, t: 'jungle.deskH' },
      { l: 'furniture', x, y: y + 1, t: 'jungle.deskV' },
    ]);
    const r = mapReader(map);
    expect(propRestY(r, x, y)).toBe(28);
    expect(propRestY(r, x, y + 1)).toBe(17);
    expect(propRestY(r, x + 1, y)).toBeNull();
  });
});

describe('desk arms', () => {
  it('sit flush with the open end of an L and centred under a T', () => {
    const map = fresh();
    const { x, y } = openJungleCell(map);
    // L: corner at (x, y) running east, arm two cells down
    applyChanges(map, [
      { l: 'furniture', x, y, t: 'jungle.deskCorner' },
      { l: 'furniture', x: x + 1, y, t: 'jungle.deskH' },
      { l: 'furniture', x, y: y + 1, t: 'jungle.deskV' },
      { l: 'furniture', x, y: y + 2, t: 'jungle.deskV' },
    ]);
    let r = mapReader(map);
    expect(armSpan(r, x, y)).toEqual([0, ARM_W]);
    expect(armSpan(r, x, y + 2)).toEqual([0, ARM_W]);
    expect(armSpan(r, x + 1, y)).toBeNull();
    expect(propRestX(r, x, y + 1)).toBe(ARM_W / 2);
    expect(propRestX(r, x + 1, y)).toBe(16);
    // T: a cell west of the corner makes it a T, the arm moves to the middle
    applyChanges(map, [{ l: 'furniture', x: x - 1, y, t: 'jungle.deskH' }]);
    r = mapReader(map);
    expect(armSpan(r, x, y + 2)).toEqual([16 - ARM_W / 2, 16 + ARM_W / 2]);
  });

  it('fill the whole cell between two stacked runs (a 2-row table is one slab)', () => {
    const map = fresh();
    const { x, y } = openJungleCell(map);
    const cells: CellChange[] = [];
    for (let dx = 0; dx < 3; dx++)
      for (let dy = 0; dy < 2; dy++)
        cells.push({ l: 'furniture', x: x + dx, y: y + dy, t: 'jungle.table' });
    applyChanges(map, cells);
    const r = mapReader(map);
    for (let dx = 0; dx < 3; dx++) {
      expect(armSpan(r, x + dx, y)).toEqual([0, 32]);
      expect(armSpan(r, x + dx, y + 1)).toEqual([0, 32]);
    }
  });
});

describe('blended ground', () => {
  it('only boundary cells get a ground variant', () => {
    const map = fresh();
    const { x, y } = openJungleCell(map);
    let r = mapReader(map);
    expect(groundKey(r, x, y)).toBeNull();
    applyChanges(map, [{ l: 'floor', x, y, t: 'jungle.dirt' }]);
    r = mapReader(map);
    expect(groundKey(r, x, y)).not.toBeNull();
    expect(groundKey(r, x + 1, y + 1)).not.toBeNull();
    expect(groundKey(r, x + 2, y)).toBeNull();
  });

  it('crisp floors never get a variant and never bleed into neighbours', () => {
    const map = fresh();
    const { x, y } = openJungleCell(map);
    applyChanges(map, [{ l: 'floor', x, y, t: 'jungle.rug' }]);
    const r = mapReader(map);
    expect(groundKey(r, x, y)).toBeNull();
    expect(groundKey(r, x + 1, y)).toBeNull();
  });

  it('keys repeat with the noise period, so equal neighbourhoods share a variant', () => {
    const map = fresh();
    const { x, y } = openJungleCell(map);
    applyChanges(map, [{ l: 'floor', x, y, t: 'jungle.dirt' }]);
    const r = mapReader(map);
    expect(groundKey(r, x + 1, y)).not.toBe(groundKey(r, x - 1, y));
  });
});

describe('edits change only the blend neighbourhood', () => {
  it.each<[string, CellChange[]]>([
    ['desk next to a desk', [{ l: 'furniture', x: 0, y: 0, t: 'jungle.deskH' }]],
    ['dirt in grass', [{ l: 'floor', x: 0, y: 0, t: 'jungle.dirt' }]],
  ])('%s', (_name, rel) => {
    const map = fresh();
    const { x, y } = openJungleCell(map);
    applyChanges(map, [
      { l: 'furniture', x: x - 1, y, t: 'jungle.deskH' },
      { l: 'furniture', x: x - 1, y: y - 1, t: 'jungle.deskH' },
      { l: 'furniture', x, y, t: 'jungle.deskH' },
    ]);
    const before = keys(map);
    const edit = rel.map((c) => ({ ...c, x: c.x + x + 1, y: c.y + y }));
    applyChanges(map, edit);
    const after = keys(map);
    const near = new Set(
      blendNeighbourhood(map, edit[0]!.x, edit[0]!.y).map((c) => c.cy * map.width + c.cx),
    );
    let changed = 0;
    for (let i = 0; i < before.length; i++)
      if (before[i] !== after[i]) {
        changed++;
        expect(near.has(i), `cell ${i % map.width},${Math.floor(i / map.width)}`).toBe(true);
      }
    expect(changed).toBeGreaterThan(0);
    expect(BLEND_RADIUS).toBe(3);
  });
});

describe('props never change a blend key (ADR-039)', () => {
  it('a lamp on a merged desk leaves every variant as it was', () => {
    const map = fresh();
    const { x, y } = openJungleCell(map);
    applyChanges(map, [
      { l: 'furniture', x: x - 1, y, t: 'jungle.deskH' },
      { l: 'furniture', x, y, t: 'jungle.deskH' },
    ]);
    const before = keys(map);
    applyChanges(map, [
      {
        l: 'prop',
        id: 'lamp1',
        p: { t: 'prop.lampOn', x: x * 32 + 9, y: y * 32 + 15, z: 0, f: false },
      },
    ]);
    expect(keys(map)).toEqual(before);
  });
});

describe('top faces and snap spots (P9.16, P9.17)', () => {
  it('a lone desk holds props around its surface row, not on its front or above it', () => {
    const map = fresh();
    const { x, y } = openJungleCell(map);
    applyChanges(map, [{ l: 'furniture', x, y, t: 'jungle.deskH' }]);
    const r = mapReader(map);
    const X = x * 32;
    const Y = y * 32;
    expect(surfaceTop(r, X + 16, Y + 17)).toBe(true);
    expect(surfaceTop(r, X + 4, Y + 11)).toBe(true);
    expect(surfaceTop(r, X + 2, Y + 17)).toBe(false);
    expect(surfaceTop(r, X + 16, Y + 26)).toBe(false);
    expect(surfaceTop(r, X + 16, Y + 3)).toBe(false);
    expect(surfaceTop(r, X + 48, Y + 17)).toBe(false); // the floor next to it
    expect(snapSpots(r, x, y)).toEqual([
      { x: X + 8, y: Y + 17 },
      { x: X + 16, y: Y + 17 },
      { x: X + 24, y: Y + 17 },
    ]);
    expect(snapSpots(r, x + 1, y)).toEqual([]);
  });

  it('a merged run is one top face across the joint; an arm holds props on its width only', () => {
    const map = fresh();
    const { x, y } = openJungleCell(map);
    // an L: run x..x+1 on row y, arm going down from x
    applyChanges(map, [
      { l: 'furniture', x, y, t: 'jungle.deskH' },
      { l: 'furniture', x: x + 1, y, t: 'jungle.deskH' },
      { l: 'furniture', x, y: y + 1, t: 'jungle.deskH' },
    ]);
    const r = mapReader(map);
    const X = x * 32;
    const Y = y * 32;
    expect(surfaceTop(r, X + 31, Y + 15)).toBe(true); // across the east joint
    expect(surfaceTop(r, X + 32, Y + 15)).toBe(true);
    expect(surfaceTop(r, X + 1, Y + 15)).toBe(false); // the run's open west end keeps an inset
    const arm = armSpan(r, x, y + 1)!;
    expect(surfaceTop(r, X + arm[0] + 4, Y + 32 + 10)).toBe(true);
    expect(surfaceTop(r, X + arm[1] + 4, Y + 32 + 10)).toBe(false);
    expect(snapSpots(r, x, y + 1)).toEqual([
      { x: X + Math.round((arm[0] + arm[1]) / 2), y: Y + 32 + 17 },
    ]);
  });
});

describe('maps saved before the props layer', () => {
  it('get an empty props object layer after furniture', () => {
    const tmj = JSON.parse(raw) as Tmj;
    tmj.layers = tmj.layers.filter((l) => l.name !== 'props');
    ensureEditLayers(tmj);
    writePropsLayer(tmj, parseMap(tmj).props);
    const names = tmj.layers.map((l) => l.name);
    expect(names.indexOf('props')).toBe(names.indexOf('furniture') + 1);
    const p = tmj.layers.find((l) => l.name === 'props')!;
    expect(p.type).toBe('objectgroup');
    expect(p.objects).toEqual([]);
    // idempotent
    writePropsLayer(tmj, []);
    expect(tmj.layers.filter((l) => l.name === 'props')).toHaveLength(1);
  });
});
