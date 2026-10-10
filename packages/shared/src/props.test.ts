import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { mapReader, snapSpots } from './blend';
import { applyChanges, inverseOf, planEdit, type MapChange } from './edit';
import { parseMap, type Tmj, type WorldMap } from './map';
import {
  SURFACE,
  dropPoint,
  newPropId,
  PROP_ID,
  resolveProps,
  ridersOf,
  type PlacedProp,
  type PropChange,
} from './props';

const raw = readFileSync(new URL('../../maps/hq.tmj', import.meta.url), 'utf8');
const T = 32;
// jungle corridor cells used by the edit tests: open floor
const X = 5 * T;
const Y = 9 * T;

function deskMap(): WorldMap {
  const map = parseMap(JSON.parse(raw) as Tmj);
  applyChanges(map, [
    { l: 'furniture', x: 5, y: 9, t: 'jungle.deskH' },
    { l: 'furniture', x: 6, y: 9, t: 'jungle.deskH' },
  ]);
  return map;
}
const put = (id: string, t: string, x: number, y: number, extra: Partial<PlacedProp> = {}) =>
  ({ l: 'prop', id, p: { t, x, y, z: 0, f: false, ...extra } }) as PropChange;
function ok(map: WorldMap, cs: MapChange[]) {
  const plan = planEdit(map, cs);
  if (!plan.ok) throw new Error(`refused: ${plan.reason}`);
  applyChanges(map, plan.changes);
  return plan.changes;
}

describe('stacking (P9.19)', () => {
  it('a lamp on books rests on their top; on the desk it rests at 0', () => {
    const map = deskMap();
    ok(map, [
      put('books1', 'prop.books', X + 16, Y + 17),
      put('lamp01', 'prop.lampOn', X + 17, Y + 16),
    ]);
    ok(map, [put('mug001', 'prop.coffee', X + 40, Y + 17)]);
    const rest = resolveProps(mapReader(map), map.props);
    expect(rest).toEqual([
      { on: SURFACE, lift: 0 },
      { on: 0, lift: 12 },
      { on: SURFACE, lift: 0 },
    ]);
    expect(ridersOf(rest, 0)).toEqual([1]);
    // raising the books raises what is on them
    ok(map, [put('books1', 'prop.books', X + 16, Y + 17, { z: 3 })]);
    expect(resolveProps(mapReader(map), map.props)[1]).toEqual({ on: 0, lift: 15 });
  });

  it('an item only rests on stacks before it in the list', () => {
    const map = deskMap();
    ok(map, [
      put('lamp01', 'prop.lampOn', X + 17, Y + 16),
      put('books1', 'prop.books', X + 16, Y + 17),
    ]);
    const rest = resolveProps(mapReader(map), map.props);
    expect(rest[0]).toEqual({ on: SURFACE, lift: 0 });
    // moved to the top of the list (as a drag does), it lands on the books
    ok(map, [{ ...put('lamp01', 'prop.lampOn', X + 17, Y + 16), i: 100_000 }]);
    expect(map.props.map((p) => p.id)).toEqual(['books1', 'lamp01']);
    expect(resolveProps(mapReader(map), map.props)[1]).toEqual({ on: 0, lift: 12 });
  });

  it('removing the books lowers the lamp onto the desk; off the desk, it falls with them', () => {
    const map = deskMap();
    ok(map, [
      put('books1', 'prop.books', X + 16, Y + 17),
      put('lamp01', 'prop.lampOn', X + 17, Y + 16),
    ]);
    ok(map, [{ l: 'prop', id: 'books1', p: null }]);
    expect(map.props.map((p) => p.id)).toEqual(['lamp01']);
    expect(resolveProps(mapReader(map), map.props)[0]).toEqual({ on: SURFACE, lift: 0 });

    // books at the desk's east end with a lamp hanging past it: only the books hold the lamp
    const m2 = deskMap();
    ok(m2, [
      put('books1', 'prop.books', X + 59, Y + 17),
      put('lamp01', 'prop.lampOn', X + 61, Y + 14),
    ]);
    expect(resolveProps(mapReader(m2), m2.props)[1]!.on).toBe(0);
    // past the desk's east edge (inset ends at X + 61): only the books hold it
    ok(m2, [put('lamp01', 'prop.lampOn', X + 64, Y + 14)]);
    expect(resolveProps(mapReader(m2), m2.props)[1]!.on).toBe(0);
    // so taking the books away takes the lamp too
    expect(planEdit(m2, [{ l: 'prop', id: 'books1', p: null }])).toEqual({
      ok: true,
      changes: [
        { l: 'prop', id: 'books1', p: null },
        { l: 'prop', id: 'lamp01', p: null },
      ],
    });
    const plan = planEdit(m2, [{ l: 'furniture', x: 6, y: 9, t: null }]);
    expect(plan.ok).toBe(true);
    if (!plan.ok) return;
    // both leave with the desk; undo brings back both, in order
    expect(plan.changes.filter((c) => c.l === 'prop')).toHaveLength(2);
    const inv = inverseOf(m2, plan.changes);
    applyChanges(m2, plan.changes);
    expect(m2.props).toEqual([]);
    ok(m2, inv);
    expect(m2.props.map((p) => p.id)).toEqual(['books1', 'lamp01']);
  });

  it('a prop in the air, or only on a stack in the air, is refused', () => {
    const map = deskMap();
    expect(planEdit(map, [put('lamp01', 'prop.lampOn', X + 17, Y + 40)])).toMatchObject({
      ok: false,
      reason: 'no_surface',
    });
  });
});

describe('drop points (P9.17)', () => {
  it('snaps to the nearest spot of the cell, or to the middle of a stack', () => {
    const map = deskMap();
    const r = mapReader(map);
    const spots = snapSpots(r, 5, 9);
    expect(dropPoint(r, map.props, X + 22, Y + 12, true)).toEqual(spots[2]);
    expect(dropPoint(r, map.props, X + 22, Y + 12, false)).toEqual({ x: X + 22, y: Y + 12 });
    // nothing to hold it: floor below the desk
    expect(dropPoint(r, map.props, X + 16, Y + 40, true)).toBeNull();
    expect(dropPoint(r, map.props, X + 16, Y + 40, false)).toBeNull();
    ok(map, [put('books1', 'prop.books', X + 16, Y + 17)]);
    // pointing at the books' drawn top (12 px up) lands on them
    const onTop = dropPoint(mapReader(map), map.props, X + 17, Y + 17 - 12 - 1, true);
    expect(onTop).toEqual({ x: X + 16, y: Y + 16 });
    const free = dropPoint(mapReader(map), map.props, X + 18, Y + 17 - 12 - 2, false);
    expect(free).toEqual({ x: X + 18, y: Y + 15 });
    // the moving books themselves are skipped
    expect(
      dropPoint(mapReader(map), map.props, X + 18, Y + 3, false, new Set(['books1'])),
    ).toBeNull();
  });

  it('new ids are valid', () => {
    for (let i = 0; i < 20; i++) expect(PROP_ID.test(newPropId())).toBe(true);
  });
});
