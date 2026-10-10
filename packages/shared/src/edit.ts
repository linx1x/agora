/**
 * Build mode (ADR-021): validated tile edits on the live map, shared by the
 * server (authoritative check + apply) and the client (preview, apply, undo).
 * Edits name tiles (`jungle.plantA`), never raw gids, so saved maps survive
 * tileset reordering (see `remapTmj`).
 */
import { z } from 'zod';
import type { Cell, Region, Tmj, TmjTileset, WorldMap } from './map';
import { SIT_DIRS } from './map';
import { mapReader } from './blend';
import {
  MAX_LIFT,
  MAX_PROPS,
  MAX_PROPS_PER_CELL,
  NONE,
  PROP_ID,
  applyPropChange,
  inversePropChanges,
  propCell,
  propDef,
  resolveProps,
  type PlacedProp,
  type PropChange,
} from './props';
import {
  BIOMES,
  EXTRA_LAYER,
  PROP_TILES,
  TILE_DEFS,
  gid,
  tileDef,
  type Biome,
  type TileDef,
} from './tileset';

/** Tile layers build mode writes. Props are a list since P9.16 (ADR-039), not a tile layer. */
export const EDIT_LAYERS = ['floor', 'walls', 'furniture', 'above'] as const;
export type EditLayer = (typeof EDIT_LAYERS)[number];
/** Where a palette tile goes: a tile layer, or the props list. */
export type PaintLayer = EditLayer | 'prop';
export const MAX_EDIT_CELLS = 600;

/** One cell write: layer, global cell, tile name (null = clear). */
export interface CellChange {
  l: EditLayer;
  x: number;
  y: number;
  t: string | null;
}

export const CellChangeSchema = z.object({
  l: z.enum(EDIT_LAYERS),
  x: z.number().int().nonnegative().max(4096),
  y: z.number().int().nonnegative().max(4096),
  t: z.string().min(1).max(40).nullable(),
});

export const PropChangeSchema = z.object({
  l: z.literal('prop'),
  id: z.string().regex(PROP_ID),
  p: z
    .object({
      t: z.string().min(1).max(40),
      x: z
        .number()
        .int()
        .nonnegative()
        .max(4096 * 32),
      y: z
        .number()
        .int()
        .nonnegative()
        .max(4096 * 32),
      z: z.number().int().min(0).max(MAX_LIFT).default(0),
      f: z.boolean().default(false),
    })
    .nullable(),
  i: z.number().int().nonnegative().max(100_000).optional(),
});

/** Everything one `map:edit` op can carry: tile writes and prop writes (P9.16). */
export type MapChange = CellChange | PropChange;
export const MapChangeSchema = z.union([CellChangeSchema, PropChangeSchema]);
export const isPropChange = (c: MapChange): c is PropChange => c.l === 'prop';
export const cellChanges = (cs: readonly MapChange[]): CellChange[] =>
  cs.filter((c): c is CellChange => c.l !== 'prop');

/** Palette groups: which bases can be painted, and on which layer. */
export const PALETTE: {
  group: 'objects' | 'props' | 'floor' | 'walls' | 'overhead';
  layer: PaintLayer;
  bases: string[];
}[] = [
  {
    group: 'objects',
    layer: 'furniture',
    bases: [
      'plantA',
      'plantB',
      'plantC',
      'treeBase',
      'decorA',
      'decorB',
      'borderPlant',
      'border',
      'lamp',
      'sofa',
      'table',
      'coffeeTable',
      'chairUp',
      'chairDown',
      'chairLeft',
      'chairRight',
      'stool',
      'deskH',
      'deskMonitor',
      'deskMonitorBack',
      'deskCorner',
      'deskV',
      'bookshelf',
      'whiteboard',
      'counter',
      'fridge',
      'waterCooler',
      'reception',
      'fireplace',
      'water',
      'waterBowl',
      'sign',
    ],
  },
  // P9.11: small items that rest on desks, tables and counters
  { group: 'props', layer: 'prop', bases: [...PROP_TILES] },
  { group: 'floor', layer: 'floor', bases: ['floor', 'floorAlt', 'rug', 'mat'] },
  { group: 'walls', layer: 'walls', bases: ['wallTop', 'window', 'glassDoor'] },
  { group: 'overhead', layer: 'above', bases: ['hanging'] },
];

const LAYER_OF = new Map<string, PaintLayer>();
for (const g of PALETTE) for (const b of g.bases) LAYER_OF.set(b, g.layer);
/** Tiles the editor writes itself (wall faces, tree tops); accepted in undo payloads. */
const AUTO: Record<string, EditLayer> = { wallFront: 'walls', treeTop: 'above' };

/** R in build mode (P9.20): the next orientation of art that exists in several. */
const ROTATE: Record<string, string> = {
  chairUp: 'chairRight',
  chairRight: 'chairDown',
  chairDown: 'chairLeft',
  chairLeft: 'chairUp',
  deskMonitor: 'deskMonitorBack',
  deskMonitorBack: 'deskMonitor',
  'prop.monitorFront': 'prop.monitorBack',
  'prop.monitorBack': 'prop.monitorFront',
};
export const rotatedBase = (base: string): string | null => ROTATE[base] ?? null;
/** The same tile turned once (same theme), or null when it has no other orientation. */
export function rotatedTile(name: string): string | null {
  const def = TILE_DEFS.find((d) => d.name === name);
  const next = def && ROTATE[def.base];
  if (!next) return null;
  return def.biome ? `${def.biome}.${next}` : next;
}

/** Tile name for a base in a theme (global tiles have no theme). */
export function themedTile(base: string, biome: Biome): string {
  return TILE_DEFS.some((d) => d.name === `${biome}.${base}`) ? `${biome}.${base}` : base;
}

/** Layer a tile may be painted on, or null if it is not paintable (portal, slot…). */
export function layerOfTile(name: string): PaintLayer | null {
  const def = TILE_DEFS.find((d) => d.name === name);
  if (!def) return null;
  // Wing-only art (paths, pond, fountain…) is not in the palette yet, but undo must restore it.
  return LAYER_OF.get(def.base) ?? AUTO[def.base] ?? EXTRA_LAYER[name] ?? null;
}

export function tileNameAt(map: WorldMap, l: EditLayer, x: number, y: number): string | null {
  const g = map.layers[l]?.[y * map.width + x] ?? 0;
  return tileDef(g)?.name ?? null;
}

const defAt = (map: WorldMap, l: EditLayer, i: number): TileDef | undefined =>
  tileDef(map.layers[l]?.[i] ?? 0);

/** Recompute collision, light occlusion and seats for one cell from its layers. */
function refreshCell(map: WorldMap, i: number) {
  let solid = 0;
  let occ = 0;
  let sit = 0;
  for (const l of ['walls', 'furniture'] as const) {
    const def = defAt(map, l, i);
    if (!def) continue;
    if (def.collides) solid = 1;
    if (def.occludes) occ = 1;
    if (def.sit) sit = SIT_DIRS.indexOf(def.sit) + 1;
  }
  map.solid[i] = solid;
  map.occlude[i] = occ;
  map.sit[i] = sit;
}

/** Write changes into the map (tile layers, derived grids, props). Mutates `map`. */
export function applyChanges(map: WorldMap, changes: MapChange[]) {
  for (const c of changes) {
    if (c.l === 'prop') {
      applyPropChange(map.props, c);
      continue;
    }
    const layer = (map.layers[c.l] ??= new Array(map.width * map.height).fill(0));
    const i = c.y * map.width + c.x;
    layer[i] = c.t ? gid(c.t) : 0;
    refreshCell(map, i);
  }
}

/** Inverse of `changes` against the current map (call before applying), in undo order. */
export function inverseOf(map: WorldMap, changes: MapChange[]): MapChange[] {
  const props = changes.filter(isPropChange);
  const propInv = inversePropChanges(map.props, props).reverse(); // forward order
  let k = 0;
  const forward = changes.map((c): MapChange =>
    c.l === 'prop' ? propInv[k++]! : { ...c, t: tileNameAt(map, c.l, c.x, c.y) },
  );
  return forward.reverse();
}

export type EditRefusal =
  | 'bad_tile'
  | 'out_of_bounds'
  | 'locked_desk'
  | 'locked_portal'
  | 'outer_wall'
  | 'blocks_access'
  | 'opens_region'
  | 'too_big'
  | 'no_surface'
  | 'too_many';

export type EditPlan =
  { ok: true; changes: MapChange[] } | { ok: false; reason: EditRefusal; cell?: Cell };

const key = (x: number, y: number) => y * 100000 + x;

/** Cells whose furniture belongs to a claimable desk pod or a teleporter. */
export function lockedCells(map: WorldMap): Map<number, 'locked_desk' | 'locked_portal'> {
  const out = new Map<number, 'locked_desk' | 'locked_portal'>();
  const T = map.tile;
  for (const d of map.desks) {
    for (const c of [d.chair, d.lamp, d.plant, d.poster]) out.set(key(c.cx, c.cy), 'locked_desk');
    const z = d.zone;
    for (let cy = z.y / T; cy < (z.y + z.h) / T; cy++)
      for (let cx = z.x / T; cx < (z.x + z.w) / T; cx++) {
        const def = defAt(map, 'furniture', cy * map.width + cx);
        if (def && (def.base.startsWith('desk') || def.base === 'slot'))
          out.set(key(cx, cy), 'locked_desk');
      }
  }
  for (const z of map.zones)
    if (z.kind === 'portal')
      for (let cy = z.y / T; cy < (z.y + z.h) / T; cy++)
        for (let cx = z.x / T; cx < (z.x + z.w) / T; cx++) out.set(key(cx, cy), 'locked_portal');
  return out;
}

const regionCells = (map: WorldMap, r: Region) => ({
  x0: Math.round(r.x / map.tile),
  y0: Math.round(r.y / map.tile),
  x1: Math.round((r.x + r.w) / map.tile) - 1,
  y1: Math.round((r.y + r.h) / map.tile) - 1,
});

function regionOfCell(map: WorldMap, x: number, y: number): Region | undefined {
  return map.regions.find((r) => {
    const b = regionCells(map, r);
    return x >= b.x0 && x <= b.x1 && y >= b.y0 && y <= b.y1;
  });
}

/** Cells that must stay reachable in a region: chairs, desk doors, portals, spawns, generator list. */
export function requiredCells(map: WorldMap, region: Region): Cell[] {
  const b = regionCells(map, region);
  const inside = (c: Cell) => c.cx >= b.x0 && c.cx <= b.x1 && c.cy >= b.y0 && c.cy <= b.y1;
  const out: Cell[] = [...(region.reach ?? [])];
  for (const d of map.desks) out.push(d.chair, d.entrance, d.guest);
  for (const z of map.zones)
    if (z.kind === 'portal') out.push({ cx: z.x / map.tile, cy: z.y / map.tile });
  for (const s of map.spawns)
    out.push({ cx: Math.floor(s.x / map.tile), cy: Math.floor((s.y - 1) / map.tile) });
  for (let cy = b.y0; cy <= b.y1; cy++)
    for (let cx = b.x0; cx <= b.x1; cx++) if (map.sit[cy * map.width + cx]) out.push({ cx, cy });
  return out.filter(inside);
}

/** Flood fill over walkable cells from a start; stops at map edges. */
function flood(map: WorldMap, solid: Uint8Array, start: Cell): Set<number> {
  const seen = new Set<number>();
  const W = map.width;
  if (solid[start.cy * W + start.cx]) return seen;
  const q: number[] = [start.cy * W + start.cx];
  seen.add(q[0]!);
  while (q.length) {
    const i = q.pop()!;
    const x = i % W;
    const y = (i - x) / W;
    for (const [dx, dy] of [
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1],
    ] as const) {
      const nx = x + dx;
      const ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= W || ny >= map.height) continue;
      const j = ny * W + nx;
      if (!seen.has(j) && !solid[j]) {
        seen.add(j);
        q.push(j);
      }
    }
  }
  return seen;
}

function regionStart(map: WorldMap, r: Region): Cell | undefined {
  const s = map.spawns.find((q) => q.region === r.id);
  return s ? { cx: Math.floor(s.x / map.tile), cy: Math.floor((s.y - 1) / map.tile) } : undefined;
}

/** A prop change with defaults filled in, or null when it names no prop tile. */
function normProp(c: PropChange): PropChange | null {
  if (!PROP_ID.test(c.id)) return null;
  if (!c.p) return { l: 'prop', id: c.id, p: null, ...(c.i !== undefined ? { i: c.i } : {}) };
  if (!propDef(c.p.t)) return null;
  const z = Math.max(0, Math.min(MAX_LIFT, Math.round(c.p.z ?? 0)));
  const p = { t: c.p.t, x: Math.round(c.p.x), y: Math.round(c.p.y), z, f: !!c.p.f };
  return { l: 'prop', id: c.id, p, ...(c.i !== undefined ? { i: c.i } : {}) };
}

const samePlace = (a: PlacedProp, b: PlacedProp) =>
  a.t === b.t && a.x === b.x && a.y === b.y && a.z === b.z && a.f === b.f;

/**
 * Props after an edit (P9.16, ADR-039): apply the prop writes, then check every item against
 * the furniture after the edit. An item placed or moved by this edit must rest on something
 * (`no_surface`); an item left with nothing under it by this edit is removed with its surface.
 */
function planProps(
  map: WorldMap,
  cells: Map<string, CellChange>,
  input: PropChange[],
): { ok: true; changes: PropChange[] } | { ok: false; reason: EditRefusal; cell?: Cell } {
  const furnitureTouched = [...cells.values()].some((c) => c.l === 'furniture');
  if (!input.length && !furnitureTouched) return { ok: true, changes: [] };
  const final = map.props.slice();
  for (const c of input) applyPropChange(final, c);
  const over = new Map<string, string | null>();
  for (const c of cells.values()) over.set(`${c.l}:${c.x}:${c.y}`, c.t);
  const placed = new Set(input.filter((c) => c.p).map((c) => c.id));
  // one pass in list order: an item resting on nothing holds nothing up (resolveProps), so
  // what rested on it falls onto the desk below, or falls too
  const rest = resolveProps(mapReader(map, over), final);
  const fallen: string[] = [];
  for (let i = 0; i < final.length; i++) {
    if (rest[i]!.on !== NONE) continue;
    const p = final[i]!;
    if (placed.has(p.id)) return { ok: false, reason: 'no_surface', cell: propCell(p, map.tile) };
    fallen.push(p.id);
  }
  const after = final.filter((p) => !fallen.includes(p.id));
  if (after.length > MAX_PROPS && after.length > map.props.length)
    return { ok: false, reason: 'too_many' };
  const perCell = new Map<number, number>();
  for (const p of after) {
    const c = propCell(p, map.tile);
    perCell.set(key(c.cx, c.cy), (perCell.get(key(c.cx, c.cy)) ?? 0) + 1);
  }
  for (const id of placed) {
    const p = after.find((q) => q.id === id);
    if (!p) continue;
    const c = propCell(p, map.tile);
    if ((perCell.get(key(c.cx, c.cy)) ?? 0) > MAX_PROPS_PER_CELL)
      return { ok: false, reason: 'too_many', cell: c };
  }
  // drop writes that change nothing (same place, same order)
  const sim = map.props.slice();
  const changes: PropChange[] = [];
  for (const c of input) {
    const k = sim.findIndex((q) => q.id === c.id);
    const before = k >= 0 ? { ...sim[k]! } : null;
    applyPropChange(sim, c);
    const k2 = sim.findIndex((q) => q.id === c.id);
    const now = k2 >= 0 ? sim[k2]! : null;
    if (!before && !now) continue;
    if (before && now && k === k2 && samePlace(before, now)) continue;
    changes.push(c);
  }
  for (const id of fallen) changes.push({ l: 'prop', id, p: null });
  return { ok: true, changes };
}

/**
 * Validate and expand an edit. Rules: paintable tiles on their own layer, no
 * desk-pod or teleporter furniture, region outer walls stay solid, every cell
 * that was reachable (chairs, desk entrances, portals, spawns) stays reachable,
 * and no wing gets connected to another (they are joined by teleporters only).
 */
export function planEdit(map: WorldMap, input: MapChange[]): EditPlan {
  if (input.length > MAX_EDIT_CELLS) return { ok: false, reason: 'too_big' };
  const locked = lockedCells(map);
  const out = new Map<string, CellChange>();
  const put = (c: CellChange) => out.set(`${c.l}:${c.x}:${c.y}`, c);
  const W = map.width;
  const propIn: PropChange[] = [];
  for (const raw of input) {
    if (raw.l === 'prop') {
      const c = normProp(raw);
      if (!c) return { ok: false, reason: 'bad_tile' };
      const cur = map.props.find((q) => q.id === c.id);
      // a prop on a desk pod's furniture is locked with it (placing, moving or removing)
      for (const at of [cur, c.p]) {
        if (!at) continue;
        const cell = propCell(at, map.tile);
        if (cell.cx >= W || cell.cy >= map.height) return { ok: false, reason: 'out_of_bounds' };
        const lock = locked.get(key(cell.cx, cell.cy));
        if (lock) return { ok: false, reason: lock, cell };
      }
      propIn.push(c);
      continue;
    }
    const c = { ...raw };
    if (c.x >= W || c.y >= map.height) return { ok: false, reason: 'out_of_bounds' };
    const cell = { cx: c.x, cy: c.y };
    if (c.t !== null) {
      const layer = layerOfTile(c.t);
      if (layer !== c.l) return { ok: false, reason: 'bad_tile', cell };
      if (c.t.endsWith('.wallFront')) c.t = c.t.replace('.wallFront', '.wallTop');
    } else if (c.l === 'floor') return { ok: false, reason: 'bad_tile', cell };
    if (c.l === 'above' && c.t?.endsWith('.treeTop')) continue; // follows its tree base
    const lock = locked.get(key(c.x, c.y));
    const guarded = c.l === 'furniture' || c.l === 'walls';
    if (lock && (guarded || lock === 'locked_portal')) return { ok: false, reason: lock, cell };
    const r = regionOfCell(map, c.x, c.y);
    if (c.l === 'walls' && r) {
      const b = regionCells(map, r);
      const edge = c.x === b.x0 || c.x === b.x1 || c.y === b.y0 || c.y === b.y1;
      if (edge && !(c.t && tileDef(gid(c.t))?.collides))
        return { ok: false, reason: 'outer_wall', cell };
    }
    put(c);
    // Trees carry their canopy on the `above` layer one cell up.
    if (c.l === 'furniture' && c.y > 0) {
      const wasTree = defAt(map, 'furniture', c.y * W + c.x)?.base === 'treeBase';
      const top = defAt(map, 'above', (c.y - 1) * W + c.x);
      const isTree = c.t ? tileDef(gid(c.t))?.base === 'treeBase' : false;
      if (isTree && (!top || top.base === 'treeTop'))
        put({ l: 'above', x: c.x, y: c.y - 1, t: c.t!.replace('treeBase', 'treeTop') });
      else if (wasTree && !isTree && top?.base === 'treeTop')
        put({ l: 'above', x: c.x, y: c.y - 1, t: null });
    }
  }
  const props = planProps(map, out, propIn);
  if (!props.ok) return props;

  // Wall faces: a wall with no wall below shows its front.
  const touched = [...out.values()].filter((c) => c.l === 'walls');
  const wallAt = (x: number, y: number): TileDef | undefined => {
    const c = out.get(`walls:${x}:${y}`);
    if (c) return c.t ? tileDef(gid(c.t)) : undefined;
    return defAt(map, 'walls', y * W + x);
  };
  const faces = new Set<string>();
  for (const c of touched) {
    faces.add(`${c.x}:${c.y}`);
    if (c.y > 0) faces.add(`${c.x}:${c.y - 1}`);
  }
  for (const f of faces) {
    const [x, y] = f.split(':').map(Number) as [number, number];
    const def = wallAt(x, y);
    if (!def || (def.base !== 'wallTop' && def.base !== 'wallFront')) continue;
    const below = y + 1 < map.height ? wallAt(x, y + 1) : undefined;
    const want = `${def.biome}.${below ? 'wallTop' : 'wallFront'}`;
    const k = `walls:${x}:${y}`;
    const cur = out.has(k) ? out.get(k)!.t : tileNameAt(map, 'walls', x, y);
    if (want !== cur) put({ l: 'walls', x, y, t: want });
  }
  const cells = [...out.values()].filter((c) => tileNameAt(map, c.l, c.x, c.y) !== c.t);
  const changes: MapChange[] = [...cells, ...props.changes];
  if (!cells.length) return { ok: true, changes };

  // Reachability and sealing, per affected region.
  const solidAfter = new Uint8Array(map.solid);
  const probe = { ...map, layers: { ...map.layers }, solid: solidAfter } as WorldMap;
  for (const l of EDIT_LAYERS) probe.layers[l] = [...(map.layers[l] ?? [])];
  probe.occlude = new Uint8Array(map.occlude);
  probe.sit = new Uint8Array(map.sit);
  applyChanges(probe, cells);
  const regions = new Set<Region>();
  for (const c of cells) {
    const r = regionOfCell(map, c.x, c.y);
    if (r) regions.add(r);
  }
  for (const r of regions) {
    const start = regionStart(map, r);
    if (!start) continue;
    const b = regionCells(map, r);
    const before = flood(map, map.solid, start);
    const after = flood(map, solidAfter, start);
    const leaks = (s: Set<number>) =>
      [...s].some((i) => {
        const x = i % W;
        const y = (i - x) / W;
        return x < b.x0 || x > b.x1 || y < b.y0 || y > b.y1;
      });
    if (!leaks(before) && leaks(after)) return { ok: false, reason: 'opens_region' };
    for (const c of requiredCells(map, r)) {
      const i = c.cy * W + c.cx;
      if (before.has(i) && !after.has(i)) return { ok: false, reason: 'blocks_access', cell: c };
    }
  }
  return { ok: true, changes };
}

/** Biome of the region containing a cell (theme for erasing floors). */
export function biomeAt(map: WorldMap, x: number, y: number): Biome {
  const b = regionOfCell(map, x, y)?.biome;
  return (BIOMES as readonly string[]).includes(b ?? '') ? (b as Biome) : 'hub';
}

/**
 * Add any missing edit layer (e.g. `props`, P9.11) as an empty tile layer, right after the
 * layer it follows, so maps saved before it existed load and save it. Mutates and returns.
 */
export function ensureEditLayers(tmj: Tmj): Tmj {
  const n = tmj.width * tmj.height;
  for (let i = 0; i < EDIT_LAYERS.length; i++) {
    const name = EDIT_LAYERS[i]!;
    if (tmj.layers.some((l) => l.type === 'tilelayer' && l.name === name)) continue;
    // insert after the nearest earlier edit layer that exists (furniture before props…)
    let at = -1;
    for (const prev of EDIT_LAYERS.slice(0, i).reverse()) {
      at = tmj.layers.findIndex((l) => l.type === 'tilelayer' && l.name === prev);
      if (at >= 0) break;
    }
    const id = Math.max(0, ...tmj.layers.map((l) => l.id ?? 0)) + 1;
    const layer = {
      id,
      name,
      type: 'tilelayer' as const,
      width: tmj.width,
      height: tmj.height,
      x: 0,
      y: 0,
      opacity: 1,
      visible: true,
      data: new Array(n).fill(0),
    };
    tmj.layers.splice(at < 0 ? tmj.layers.length : at + 1, 0, layer);
    if (typeof tmj.nextlayerid === 'number') tmj.nextlayerid = Math.max(tmj.nextlayerid, id + 1);
  }
  return tmj;
}

/**
 * Re-key a saved map's gids to the current tileset by tile name, so a saved
 * map keeps working after tiles are added or reordered. Unknown tiles drop out.
 */
export function remapTmj(saved: Tmj, current: TmjTileset): Tmj {
  const ts = saved.tilesets[0];
  const names = new Map<number, string>();
  for (const t of ts?.tiles ?? []) {
    const n = t.properties?.find((p) => p.name === 'name')?.value;
    if (typeof n === 'string') names.set((ts?.firstgid ?? 1) + t.id, n);
  }
  const known = new Set(TILE_DEFS.map((d) => d.name));
  const layers = saved.layers.map((l) =>
    l.type === 'tilelayer' && l.data
      ? {
          ...l,
          data: l.data.map((g) => {
            const n = g ? names.get(g & 0x1fffffff) : undefined;
            return n && known.has(n) ? gid(n) : 0;
          }),
        }
      : l,
  );
  return ensureEditLayers({ ...saved, layers, tilesets: [current] });
}
