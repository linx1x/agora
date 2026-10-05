/**
 * Build mode (ADR-021): validated tile edits on the live map, shared by the
 * server (authoritative check + apply) and the client (preview, apply, undo).
 * Edits name tiles (`jungle.plantA`), never raw gids, so saved maps survive
 * tileset reordering (see `remapTmj`).
 */
import { z } from 'zod';
import type { Cell, Region, Tmj, TmjTileset, WorldMap } from './map';
import { SIT_DIRS } from './map';
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

export const EDIT_LAYERS = ['floor', 'walls', 'furniture', 'props', 'above'] as const;
export type EditLayer = (typeof EDIT_LAYERS)[number];
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

/** Palette groups: which bases can be painted, and on which layer. */
export const PALETTE: {
  group: 'objects' | 'props' | 'floor' | 'walls' | 'overhead';
  layer: EditLayer;
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
      'sign',
    ],
  },
  // P9.11: small items that rest on desks, tables and counters
  { group: 'props', layer: 'props', bases: [...PROP_TILES] },
  { group: 'floor', layer: 'floor', bases: ['floor', 'floorAlt', 'rug', 'mat'] },
  { group: 'walls', layer: 'walls', bases: ['wallTop', 'window', 'glassDoor'] },
  { group: 'overhead', layer: 'above', bases: ['hanging'] },
];

const LAYER_OF = new Map<string, EditLayer>();
for (const g of PALETTE) for (const b of g.bases) LAYER_OF.set(b, g.layer);
/** Tiles the editor writes itself (wall faces, tree tops); accepted in undo payloads. */
const AUTO: Record<string, EditLayer> = { wallFront: 'walls', treeTop: 'above' };

/** Tile name for a base in a theme (global tiles have no theme). */
export function themedTile(base: string, biome: Biome): string {
  return TILE_DEFS.some((d) => d.name === `${biome}.${base}`) ? `${biome}.${base}` : base;
}

/** Layer a tile may be painted on, or null if it is not paintable (portal, slot…). */
export function layerOfTile(name: string): EditLayer | null {
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

/** Write changes into the map (tile layers and derived grids). Mutates `map`. */
export function applyChanges(map: WorldMap, changes: CellChange[]) {
  for (const c of changes) {
    const layer = (map.layers[c.l] ??= new Array(map.width * map.height).fill(0));
    const i = c.y * map.width + c.x;
    layer[i] = c.t ? gid(c.t) : 0;
    refreshCell(map, i);
  }
}

/** Inverse of `changes` against the current map (call before applying). */
export function inverseOf(map: WorldMap, changes: CellChange[]): CellChange[] {
  return [...changes].reverse().map((c) => ({ ...c, t: tileNameAt(map, c.l, c.x, c.y) }));
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
  | 'no_surface';

export type EditPlan =
  { ok: true; changes: CellChange[] } | { ok: false; reason: EditRefusal; cell?: Cell };

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

/**
 * Validate and expand an edit. Rules: paintable tiles on their own layer, no
 * desk-pod or teleporter furniture, region outer walls stay solid, every cell
 * that was reachable (chairs, desk entrances, portals, spawns) stays reachable,
 * and no wing gets connected to another (they are joined by teleporters only).
 */
export function planEdit(map: WorldMap, input: CellChange[]): EditPlan {
  if (input.length > MAX_EDIT_CELLS) return { ok: false, reason: 'too_big' };
  const locked = lockedCells(map);
  const out = new Map<string, CellChange>();
  const put = (c: CellChange) => out.set(`${c.l}:${c.x}:${c.y}`, c);
  const W = map.width;
  for (const raw of input) {
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
    const guarded = c.l === 'furniture' || c.l === 'walls' || c.l === 'props';
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
  // Props (P9.11) rest on a surface: they leave with the furniture under them, and a prop
  // can only be placed where the furniture (after this edit) has a surface.
  const finalDef = (l: EditLayer, x: number, y: number): TileDef | undefined => {
    const c = out.get(`${l}:${x}:${y}`);
    if (c) return c.t ? tileDef(gid(c.t)) : undefined;
    return defAt(map, l, y * W + x);
  };
  for (const c of [...out.values()])
    if (
      c.l === 'furniture' &&
      finalDef('props', c.x, c.y) &&
      finalDef('furniture', c.x, c.y)?.surface === undefined
    )
      put({ l: 'props', x: c.x, y: c.y, t: null });
  for (const c of out.values())
    if (c.l === 'props' && c.t && finalDef('furniture', c.x, c.y)?.surface === undefined)
      return { ok: false, reason: 'no_surface', cell: { cx: c.x, cy: c.y } };

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
  const changes = [...out.values()].filter((c) => tileNameAt(map, c.l, c.x, c.y) !== c.t);
  if (!changes.length) return { ok: true, changes };

  // Reachability and sealing, per affected region.
  const solidAfter = new Uint8Array(map.solid);
  const probe = { ...map, layers: { ...map.layers }, solid: solidAfter } as WorldMap;
  for (const l of EDIT_LAYERS) probe.layers[l] = [...(map.layers[l] ?? [])];
  probe.occlude = new Uint8Array(map.occlude);
  probe.sit = new Uint8Array(map.sit);
  applyChanges(probe, changes);
  const regions = new Set<Region>();
  for (const c of changes) {
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
