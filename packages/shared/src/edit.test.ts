import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  applyChanges,
  inverseOf,
  lockedCells,
  planEdit,
  remapTmj,
  tileNameAt,
  type CellChange,
} from './edit';
import { parseMap, type Tmj } from './map';

const raw = readFileSync(new URL('../../maps/hq.tmj', import.meta.url), 'utf8');
const fresh = () => parseMap(JSON.parse(raw) as Tmj);

describe('build mode edits', () => {
  it('places a plant on open floor and updates collision', () => {
    const map = fresh();
    // jungle corridor, open floor
    const plan = planEdit(map, [{ l: 'furniture', x: 5, y: 9, t: 'jungle.plantA' }]);
    expect(plan.ok).toBe(true);
    if (!plan.ok) return;
    applyChanges(map, plan.changes);
    expect(tileNameAt(map, 'furniture', 5, 9)).toBe('jungle.plantA');
    expect(map.solid[9 * map.width + 5]).toBe(1);
  });

  it('allows any theme anywhere', () => {
    const map = fresh();
    const plan = planEdit(map, [{ l: 'furniture', x: 5, y: 9, t: 'zen.plantB' }]);
    expect(plan.ok).toBe(true);
  });

  it('rejects a tile on the wrong layer or an unpaintable tile', () => {
    const map = fresh();
    expect(planEdit(map, [{ l: 'floor', x: 5, y: 9, t: 'jungle.plantA' }]).ok).toBe(false);
    expect(planEdit(map, [{ l: 'furniture', x: 5, y: 9, t: 'portal' }]).ok).toBe(false);
    expect(planEdit(map, [{ l: 'floor', x: 5, y: 9, t: null }]).ok).toBe(false);
  });

  it('refuses to touch desk pod furniture and teleporters', () => {
    const map = fresh();
    const d = map.desks[0]!;
    const plan = planEdit(map, [{ l: 'furniture', x: d.chair.cx, y: d.chair.cy, t: null }]);
    expect(plan).toMatchObject({ ok: false, reason: 'locked_desk' });
    const portal = map.zones.find((z) => z.kind === 'portal')!;
    const p = planEdit(map, [{ l: 'floor', x: portal.x / 32, y: portal.y / 32, t: 'mat' }]);
    expect(p).toMatchObject({ ok: false, reason: 'locked_portal' });
    expect(lockedCells(map).size).toBeGreaterThan(32 * 4);
  });

  it('refuses edits that wall off a desk entrance or chair', () => {
    const map = fresh();
    const d = map.desks[0]!;
    const e = d.entrance;
    // ring of plants around the guest cell, the entrance and the chair
    const box: CellChange[] = [];
    for (const c of [d.chair]) {
      for (const [dx, dy] of [
        [1, 0],
        [-1, 0],
        [0, 1],
        [0, -1],
      ] as const)
        box.push({ l: 'walls', x: c.cx + dx, y: c.cy + dy, t: 'jungle.wallTop' });
    }
    const plan = planEdit(
      map,
      box.filter((c) => !(c.x === e.cx && c.y === e.cy)),
    );
    expect(plan.ok).toBe(false);
    expect(plan.ok ? '' : plan.reason).toMatch(/blocks_access|locked_desk/);
  });

  it('keeps the region outer walls solid and wings sealed', () => {
    const map = fresh();
    // jungle right ring wall at x=35
    expect(planEdit(map, [{ l: 'walls', x: 35, y: 9, t: null }])).toMatchObject({
      ok: false,
      reason: 'outer_wall',
    });
    // swapping a ring wall for a window is fine
    expect(planEdit(map, [{ l: 'walls', x: 35, y: 9, t: 'jungle.window' }]).ok).toBe(true);
  });

  it('adds a tree canopy and wall faces automatically, and inverts cleanly', () => {
    const map = fresh();
    const plan = planEdit(map, [{ l: 'furniture', x: 5, y: 10, t: 'boreal.treeBase' }]);
    expect(plan.ok).toBe(true);
    if (!plan.ok) return;
    expect(plan.changes).toContainEqual({ l: 'above', x: 5, y: 9, t: 'boreal.treeTop' });
    const inv = inverseOf(map, plan.changes);
    applyChanges(map, plan.changes);
    applyChanges(map, inv);
    expect(tileNameAt(map, 'furniture', 5, 10)).toBeNull();
    expect(tileNameAt(map, 'above', 5, 9)).toBeNull();

    const w = planEdit(map, [{ l: 'walls', x: 20, y: 9, t: 'oasis.wallTop' }]);
    expect(w.ok).toBe(true);
    if (w.ok) expect(w.changes).toContainEqual({ l: 'walls', x: 20, y: 9, t: 'oasis.wallFront' });
  });

  it('remaps a saved map by tile name', () => {
    const tmj = JSON.parse(raw) as Tmj;
    const out = remapTmj(tmj, tmj.tilesets[0]!);
    expect(out.layers[0]!.data).toEqual(tmj.layers[0]!.data);
  });

  it('props (P9.11) need a surface, leave with it, and come back with undo', () => {
    const map = fresh();
    // jungle corridor, open floor (same cell as the plant test)
    expect(planEdit(map, [{ l: 'props', x: 5, y: 9, t: 'prop.coffee' }])).toMatchObject({
      ok: false,
      reason: 'no_surface',
    });
    // a desk and a lamp on it in one edit is fine
    const both = planEdit(map, [
      { l: 'furniture', x: 5, y: 9, t: 'jungle.deskH' },
      { l: 'props', x: 5, y: 9, t: 'prop.lampOn' },
    ]);
    expect(both.ok).toBe(true);
    if (!both.ok) return;
    applyChanges(map, both.changes);
    expect(tileNameAt(map, 'props', 5, 9)).toBe('prop.lampOn');
    expect(map.solid[9 * map.width + 5]).toBe(1);
    // props are not furniture: they never go on the furniture layer
    expect(planEdit(map, [{ l: 'furniture', x: 6, y: 9, t: 'prop.coffee' }])).toMatchObject({
      ok: false,
      reason: 'bad_tile',
    });
    // erasing the desk takes the lamp with it
    const erase = planEdit(map, [{ l: 'furniture', x: 5, y: 9, t: null }]);
    expect(erase.ok).toBe(true);
    if (!erase.ok) return;
    expect(erase.changes).toContainEqual({ l: 'props', x: 5, y: 9, t: null });
    const inv = inverseOf(map, erase.changes);
    applyChanges(map, erase.changes);
    expect(tileNameAt(map, 'props', 5, 9)).toBeNull();
    // undo goes through the server again: the lamp is valid because the desk returns with it
    const undo = planEdit(map, inv);
    expect(undo.ok).toBe(true);
    if (!undo.ok) return;
    applyChanges(map, undo.changes);
    expect(tileNameAt(map, 'furniture', 5, 9)).toBe('jungle.deskH');
    expect(tileNameAt(map, 'props', 5, 9)).toBe('prop.lampOn');
    // a table holds props too
    expect(
      planEdit(map, [
        { l: 'furniture', x: 7, y: 9, t: 'jungle.table' },
        { l: 'props', x: 7, y: 9, t: 'prop.matcha' },
      ]).ok,
    ).toBe(true);
  });

  it('props on claimable desk pods are locked', () => {
    const map = fresh();
    const d = map.desks[0]!;
    expect(
      planEdit(map, [{ l: 'props', x: d.lamp.cx, y: d.lamp.cy, t: 'prop.coffee' }]),
    ).toMatchObject({ ok: false, reason: 'locked_desk' });
  });
});
