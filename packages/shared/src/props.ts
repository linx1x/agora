/**
 * Props as placed objects (P9.16–P9.19, ADR-039).
 *
 * A prop is a small item (lamp, laptop, coffee…) whose base point sits on a surface: the top
 * face of a desk, table or counter, or the top of a stackable prop. Positions are world px,
 * free to the pixel; collision never depends on props. List order is stacking order: an item
 * can only rest on items before it, so supports never form a cycle.
 *
 * Everything here is pure and shared: the server validates with it, the client draws and
 * previews with it, so both agree on where every item sits.
 */
import { snapSpots, surfaceTop, type TileReader } from './blend';
import type { Tmj, TmjLayer, TmjObject, WorldMap } from './map';
import { TILE_DEFS, tileDef, type TileDef } from './tileset';

/** One placed item. `x, y`: base point (world px) on the plane it rests on. */
export interface PlacedProp {
  id: string;
  /** tile name (`prop.lampOn`) */
  t: string;
  x: number;
  y: number;
  /** manual raise in px, 0..MAX_LIFT (P9.19) */
  z: number;
  /** mirrored (P9.20) */
  f: boolean;
}
export type PropPlace = Omit<PlacedProp, 'id'>;

/** A prop write in `map:edit`: `p` null deletes; `i` puts the item at that list index. */
export interface PropChange {
  l: 'prop';
  id: string;
  p: PropPlace | null;
  i?: number;
}

export const MAX_LIFT = 8;
export const MAX_PROPS_PER_CELL = 8;
export const MAX_PROPS = 3000;
export const PROP_ID = /^[A-Za-z0-9_-]{4,24}$/;

const byName = new Map(TILE_DEFS.map((d) => [d.name, d]));
export const propDef = (t: string): TileDef | undefined => {
  const d = byName.get(t);
  return d?.prop ? d : undefined;
};

/** A short random id for a new prop (client side; the server only checks the format). */
export function newPropId(): string {
  let s = '';
  for (let i = 0; i < 10; i++)
    s += 'abcdefghijkmnpqrstuvwxyz23456789'[Math.floor(Math.random() * 32)];
  return s;
}

export const propCell = (p: { x: number; y: number }, tile = 32) => ({
  cx: Math.floor(p.x / tile),
  cy: Math.floor(p.y / tile),
});

// ───────────────────────────────────────────── support and lift

/** `on`: SURFACE (furniture), a list index (a stackable prop), or NONE (nothing under it). */
export const SURFACE = -1;
export const NONE = -2;
export interface PropRest {
  on: number;
  /** px the base is raised above its plane point (height of what it rests on) */
  lift: number;
}

/** True when (x, y) lies on the footprint of a stackable prop `s`. */
function onFootprint(s: PlacedProp, x: number, y: number): boolean {
  const st = propDef(s.t)?.stack;
  return !!st && Math.abs(x - s.x) <= st.w && y <= s.y && y >= s.y - st.d;
}

/**
 * Where every prop rests, in list order. A prop rests on the highest stackable prop before it
 * whose footprint holds its base, else on the furniture's top face, else on nothing (NONE).
 * Props resting on nothing never hold anything up.
 */
export function resolveProps(r: TileReader, props: readonly PlacedProp[]): PropRest[] {
  const out: PropRest[] = [];
  const stacks: number[] = [];
  for (let i = 0; i < props.length; i++) {
    const p = props[i]!;
    let best: PropRest | null = null;
    for (const j of stacks) {
      const s = props[j]!;
      if (!onFootprint(s, p.x, p.y)) continue;
      const top = out[j]!.lift + s.z + propDef(s.t)!.stack!.h;
      if (!best || top >= best.lift) best = { on: j, lift: top };
    }
    const rest =
      best ?? (surfaceTop(r, p.x, p.y) ? { on: SURFACE, lift: 0 } : { on: NONE, lift: 0 });
    out.push(rest);
    if (rest.on !== NONE && propDef(p.t)?.stack) stacks.push(i);
  }
  return out;
}

/** Indices of the props resting on prop `i`, directly or through others (riders, P9.19). */
export function ridersOf(rest: readonly PropRest[], i: number): number[] {
  const out: number[] = [];
  const set = new Set([i]);
  for (let k = i + 1; k < rest.length; k++)
    if (set.has(rest[k]!.on)) {
      set.add(k);
      out.push(k);
    }
  return out;
}

// ───────────────────────────────────────────── snapping (P9.17)

/**
 * Base point for a prop dropped where the pointer is (world px). The pointer aims at what it
 * sees, so a stack's drawn top (lifted) is found first and converted back to its plane.
 * `snap`: the middle of a stack, or the nearest left / middle / right spot of the cell's top
 * face; otherwise the exact point. Null when nothing there can hold a prop.
 * `skip`: ids that move with the item (itself and its riders) and cannot hold it.
 */
export function dropPoint(
  r: TileReader,
  props: readonly PlacedProp[],
  px: number,
  py: number,
  snap: boolean,
  skip: ReadonlySet<string> = new Set(),
): { x: number; y: number } | null {
  const rest = resolveProps(r, props);
  for (let i = props.length - 1; i >= 0; i--) {
    const s = props[i]!;
    const st = propDef(s.t)?.stack;
    if (!st || skip.has(s.id) || rest[i]!.on === NONE) continue;
    const top = rest[i]!.lift + s.z + st.h;
    const y = Math.round(py) + top;
    if (onFootprint(s, Math.round(px), y))
      return snap ? { x: s.x, y: s.y - Math.floor(st.d / 2) } : { x: Math.round(px), y };
  }
  const x = Math.round(px);
  const y = Math.round(py);
  const { cx, cy } = propCell({ x, y });
  if (snap) {
    const spots = snapSpots(r, cx, cy);
    if (!spots.length) return null;
    return spots.reduce((a, b) => (Math.abs(b.x - x) < Math.abs(a.x - x) ? b : a));
  }
  return surfaceTop(r, x, y) ? { x, y } : null;
}

// ───────────────────────────────────────────── list edits

export const placeOf = (p: PlacedProp): PropPlace => ({ t: p.t, x: p.x, y: p.y, z: p.z, f: p.f });

/** Apply one prop change to a list (mutates). */
export function applyPropChange(list: PlacedProp[], c: PropChange) {
  const k = list.findIndex((q) => q.id === c.id);
  if (k >= 0) list.splice(k, 1);
  if (!c.p) return;
  const at = Math.max(0, Math.min(list.length, c.i ?? (k >= 0 ? k : list.length)));
  list.splice(at, 0, { id: c.id, t: c.p.t, x: c.p.x, y: c.p.y, z: c.p.z ?? 0, f: !!c.p.f });
}

/** Inverse of a sequence of prop changes against `list` (not mutated), in undo order. */
export function inversePropChanges(
  list: readonly PlacedProp[],
  changes: PropChange[],
): PropChange[] {
  const sim = list.slice();
  const inv: PropChange[] = [];
  for (const c of changes) {
    const k = sim.findIndex((q) => q.id === c.id);
    inv.push(
      k >= 0
        ? { l: 'prop', id: c.id, p: placeOf(sim[k]!), i: k }
        : { l: 'prop', id: c.id, p: null },
    );
    applyPropChange(sim, c);
  }
  return inv.reverse();
}

// ───────────────────────────────────────────── Tiled storage

const propValue = (o: TmjObject, name: string) => o.properties?.find((p) => p.name === name)?.value;

/**
 * Props of a parsed map: the `props` object layer, or (maps saved by P9.11) the old one-per-cell
 * tile layer converted to items at their old rest point.
 */
export function readProps(tmj: Tmj, map: WorldMap, r: TileReader): PlacedProp[] {
  const layer = tmj.layers.find((l) => l.name === 'props');
  if (!layer) return [];
  const out: PlacedProp[] = [];
  const seen = new Set<string>();
  if (layer.type === 'objectgroup') {
    for (const o of layer.objects ?? []) {
      const t = String(propValue(o, 'tile') ?? '');
      const id = String(o.name ?? '');
      if (!propDef(t) || !PROP_ID.test(id) || seen.has(id)) continue;
      seen.add(id);
      const z = Number(propValue(o, 'z') ?? 0);
      out.push({
        id,
        t,
        x: Math.round(o.x),
        y: Math.round(o.y),
        z: Number.isFinite(z) ? Math.max(0, Math.min(MAX_LIFT, Math.round(z))) : 0,
        f: propValue(o, 'flip') === true,
      });
    }
    return out;
  }
  // legacy tile layer: one prop per cell at the snap point it was drawn at
  (layer.data ?? []).forEach((g, i) => {
    const def = tileDef(g);
    if (!def?.prop) return;
    const cx = i % map.width;
    const cy = (i - cx) / map.width;
    const spots = snapSpots(r, cx, cy);
    const spot = spots.find((s) => s.x === cx * 32 + 16) ?? spots[0];
    if (!spot) return;
    out.push({ id: `p${cx}x${cy}`, t: def.name, x: spot.x, y: spot.y, z: 0, f: false });
  });
  return out;
}

/**
 * Write `props` into the Tiled JSON as an object layer right after `furniture` (replacing a
 * P9.11 tile layer). Mutates and returns `tmj`.
 */
export function writePropsLayer(tmj: Tmj, props: readonly PlacedProp[]): Tmj {
  const old = tmj.layers.findIndex((l) => l.name === 'props');
  const prev = old >= 0 ? tmj.layers[old]! : undefined;
  if (old >= 0) tmj.layers.splice(old, 1);
  let next = 1;
  for (const l of tmj.layers) for (const o of l.objects ?? []) next = Math.max(next, o.id + 1);
  const objects: TmjObject[] = props.map((p) => ({
    id: next++,
    name: p.id,
    type: 'prop',
    x: p.x,
    y: p.y,
    point: true,
    properties: [
      { name: 'tile', type: 'string', value: p.t },
      { name: 'z', type: 'int', value: p.z },
      { name: 'flip', type: 'bool', value: p.f },
    ],
  }));
  const layer: TmjLayer = {
    id: prev?.id ?? Math.max(0, ...tmj.layers.map((l) => l.id ?? 0)) + 1,
    name: 'props',
    type: 'objectgroup',
    objects,
    visible: true,
    opacity: 1,
    x: 0,
    y: 0,
  };
  const furn = tmj.layers.findIndex((l) => l.name === 'furniture');
  tmj.layers.splice(old >= 0 ? old : furn >= 0 ? furn + 1 : tmj.layers.length, 0, layer);
  if (typeof tmj.nextobjectid === 'number') tmj.nextobjectid = Math.max(tmj.nextobjectid, next);
  if (typeof tmj.nextlayerid === 'number')
    tmj.nextlayerid = Math.max(tmj.nextlayerid, (layer.id ?? 0) + 1);
  return tmj;
}
