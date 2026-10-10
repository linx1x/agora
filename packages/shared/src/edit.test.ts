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
  type MapChange,
} from './edit';
import { parseMap, type Tmj } from './map';
import { MAX_PROPS_PER_CELL, writePropsLayer, type PropChange } from './props';
import { gid } from './tileset';

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

  // P9.16 (ADR-039): props are placed objects with a base point in world px
  const T = 32;
  const lamp = (id: string, x: number, y: number, extra: Partial<PropChange> = {}): PropChange => ({
    l: 'prop',
    id,
    p: { t: 'prop.lampOn', x, y, z: 0, f: false },
    ...extra,
  });
  const ok = (map: ReturnType<typeof fresh>, cs: MapChange[]) => {
    const plan = planEdit(map, cs);
    expect(plan).toMatchObject({ ok: true });
    if (!plan.ok) throw new Error(plan.reason);
    applyChanges(map, plan.changes);
    return plan.changes;
  };

  it('props need a surface, leave with it, and come back with undo', () => {
    const map = fresh();
    // jungle corridor, open floor (same cell as the plant test)
    expect(planEdit(map, [lamp('aaaa', 5 * T + 16, 9 * T + 17)])).toMatchObject({
      ok: false,
      reason: 'no_surface',
    });
    // a desk and a lamp on it in one edit is fine
    ok(map, [
      { l: 'furniture', x: 5, y: 9, t: 'jungle.deskH' },
      lamp('aaaa', 5 * T + 16, 9 * T + 17),
    ]);
    expect(map.props).toEqual([
      { id: 'aaaa', t: 'prop.lampOn', x: 5 * T + 16, y: 9 * T + 17, z: 0, f: false },
    ]);
    expect(map.solid[9 * map.width + 5]).toBe(1);
    // props are not furniture: they never go on the furniture layer
    expect(planEdit(map, [{ l: 'furniture', x: 6, y: 9, t: 'prop.coffee' }])).toMatchObject({
      ok: false,
      reason: 'bad_tile',
    });
    // and furniture is not a prop
    expect(
      planEdit(map, [
        {
          l: 'prop',
          id: 'bbbb',
          p: { t: 'jungle.deskH', x: 5 * T + 8, y: 9 * T + 17, z: 0, f: false },
        },
      ]),
    ).toMatchObject({ ok: false, reason: 'bad_tile' });
    // erasing the desk takes the lamp with it
    const erase = planEdit(map, [{ l: 'furniture', x: 5, y: 9, t: null }]);
    expect(erase.ok).toBe(true);
    if (!erase.ok) return;
    expect(erase.changes).toContainEqual({ l: 'prop', id: 'aaaa', p: null });
    const inv = inverseOf(map, erase.changes);
    applyChanges(map, erase.changes);
    expect(map.props).toEqual([]);
    // undo goes through the server again: the lamp is valid because the desk returns with it
    ok(map, inv);
    expect(tileNameAt(map, 'furniture', 5, 9)).toBe('jungle.deskH');
    expect(map.props.map((p) => p.id)).toEqual(['aaaa']);
    // a table holds props too
    ok(map, [
      { l: 'furniture', x: 7, y: 9, t: 'jungle.table' },
      {
        l: 'prop',
        id: 'cccc',
        p: { t: 'prop.matcha', x: 7 * T + 16, y: 9 * T + 15, z: 0, f: false },
      },
    ]);
  });

  it('several props share a desk cell, placed to the pixel on its top face only', () => {
    const map = fresh();
    ok(map, [{ l: 'furniture', x: 5, y: 9, t: 'jungle.deskH' }]);
    const X = 5 * T;
    const Y = 9 * T;
    ok(map, [
      lamp('aaaa', X + 6, Y + 13),
      lamp('bbbb', X + 17, Y + 18),
      lamp('cccc', X + 25, Y + 12),
    ]);
    expect(map.props).toHaveLength(3);
    // the front of the desk (below its top face) and the air above it hold nothing
    expect(planEdit(map, [lamp('dddd', X + 16, Y + 27)])).toMatchObject({ reason: 'no_surface' });
    expect(planEdit(map, [lamp('dddd', X + 16, Y + 2)])).toMatchObject({ reason: 'no_surface' });
    // moving one keeps its place in the list; a no-op move is dropped
    const mv = ok(map, [lamp('bbbb', X + 20, Y + 18)]);
    expect(mv).toHaveLength(1);
    expect(map.props.map((p) => p.id)).toEqual(['aaaa', 'bbbb', 'cccc']);
    expect(planEdit(map, [lamp('bbbb', X + 20, Y + 18)])).toEqual({ ok: true, changes: [] });
    // at most MAX_PROPS_PER_CELL in one cell
    const more: PropChange[] = [];
    for (let i = 0; i < MAX_PROPS_PER_CELL - 2; i++)
      more.push(lamp(`m${i}xx`, X + 4 + i * 3, Y + 15));
    expect(planEdit(map, more)).toMatchObject({ reason: 'too_many' });
    expect(planEdit(map, more.slice(1)).ok).toBe(true);
    // bad ids and out-of-range raises are refused
    expect(planEdit(map, [lamp('a b', X + 6, Y + 13)])).toMatchObject({ ok: false });
  });

  it('undo puts removed props back in their place in the list', () => {
    const map = fresh();
    ok(map, [
      { l: 'furniture', x: 5, y: 9, t: 'jungle.deskH' },
      { l: 'furniture', x: 7, y: 9, t: 'jungle.deskH' },
    ]);
    ok(map, [
      lamp('aaaa', 5 * T + 8, 9 * T + 17),
      lamp('bbbb', 7 * T + 8, 9 * T + 17),
      lamp('cccc', 5 * T + 24, 9 * T + 17),
      lamp('dddd', 7 * T + 24, 9 * T + 17),
    ]);
    const before = map.props.map((p) => p.id);
    // the two on desk 7 fall with it; a move to the top of the list (i) is undone too
    const plan = planEdit(map, [
      { l: 'furniture', x: 7, y: 9, t: null },
      lamp('aaaa', 5 * T + 10, 9 * T + 17, { i: 99 }),
    ]);
    expect(plan.ok).toBe(true);
    if (!plan.ok) return;
    const inv = inverseOf(map, plan.changes);
    applyChanges(map, plan.changes);
    expect(map.props.map((p) => p.id)).toEqual(['cccc', 'aaaa']);
    ok(map, inv);
    expect(map.props.map((p) => p.id)).toEqual(before);
    expect(map.props[0]!.x).toBe(5 * T + 8);
  });

  it('props on claimable desk pods are locked', () => {
    const map = fresh();
    const d = map.desks[0]!;
    expect(planEdit(map, [lamp('aaaa', d.lamp.cx * T + 16, d.lamp.cy * T + 17)])).toMatchObject({
      ok: false,
      reason: 'locked_desk',
    });
  });

  it('reads P9.11 tile-layer props and writes them back as an object layer', () => {
    const tmj = JSON.parse(raw) as Tmj;
    const map0 = parseMap(tmj);
    // put a desk and a one-per-cell prop the P9.11 way
    const W = tmj.width;
    tmj.layers.find((l) => l.name === 'furniture')!.data![9 * W + 5] = gid('jungle.deskH');
    const legacy = new Array(W * tmj.height).fill(0);
    legacy[9 * W + 5] = gid('prop.coffee');
    tmj.layers = tmj.layers.filter((l) => l.name !== 'props');
    tmj.layers.splice(3, 0, {
      name: 'props',
      type: 'tilelayer',
      width: W,
      height: tmj.height,
      data: legacy,
    });
    const map = parseMap(tmj);
    expect(map0.props).toEqual([]);
    expect(map.props).toEqual([
      { id: 'p5x9', t: 'prop.coffee', x: 5 * T + 16, y: 9 * T + 17, z: 0, f: false },
    ]);
    expect(map.layers.props).toBeUndefined();
    writePropsLayer(tmj, map.props);
    const layer = tmj.layers.find((l) => l.name === 'props')!;
    expect(layer.type).toBe('objectgroup');
    expect(tmj.layers.findIndex((l) => l.name === 'props')).toBe(
      tmj.layers.findIndex((l) => l.name === 'furniture') + 1,
    );
    expect(parseMap(tmj).props).toEqual(map.props);
    // object ids stay unique across the map
    const ids = tmj.layers.flatMap((l) => (l.objects ?? []).map((o) => o.id));
    expect(new Set(ids).size).toBe(ids.length);
  });
});
