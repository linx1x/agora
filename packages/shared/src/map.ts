import { FEET_H, FEET_W, TILE, type Dir } from './constants';
import { tileDef } from './tileset';
import { mapReader } from './blend';
import { readProps, type PlacedProp } from './props';

/** Minimal Tiled JSON (.tmj) types — only what Agora reads. */
export interface TmjProperty {
  name: string;
  type?: string;
  value: unknown;
}
export interface TmjObject {
  id: number;
  name?: string;
  type?: string;
  x: number;
  y: number;
  width?: number;
  height?: number;
  polygon?: { x: number; y: number }[];
  point?: boolean;
  properties?: TmjProperty[];
}
export interface TmjLayer {
  name: string;
  type: 'tilelayer' | 'objectgroup';
  width?: number;
  height?: number;
  data?: number[];
  objects?: TmjObject[];
  visible?: boolean;
  opacity?: number;
  x?: number;
  y?: number;
  id?: number;
}
export interface TmjTileset {
  firstgid: number;
  name: string;
  tilewidth: number;
  tileheight: number;
  tilecount: number;
  columns: number;
  image: string;
  imagewidth: number;
  imageheight: number;
  margin?: number;
  spacing?: number;
  tiles?: { id: number; properties?: TmjProperty[] }[];
}
export interface Tmj {
  width: number;
  height: number;
  tilewidth: number;
  tileheight: number;
  layers: TmjLayer[];
  tilesets: TmjTileset[];
  [k: string]: unknown;
}

export const ZONE_KINDS = [
  'private',
  'quiet',
  'area',
  'spotlight',
  'broadcast',
  'desk',
  'door',
  'portal',
  /** P17.26b: in front of the office shop board; a public area (no media or chat rule) */
  'shop',
] as const;
export type ZoneKind = (typeof ZONE_KINDS)[number];

export interface Zone {
  id: string;
  kind: ZoneKind;
  nameFr: string;
  nameEn: string;
  /** Pixel rect, or polygon in absolute pixels. */
  x: number;
  y: number;
  w: number;
  h: number;
  polygon?: { x: number; y: number }[];
  /** region (hub / biome) this zone belongs to */
  region?: string;
  /** all Tiled custom properties */
  props: Record<string, unknown>;
}

export interface Cell {
  cx: number;
  cy: number;
}

/** A claimable desk pod (zone kind `desk`) and its furniture slots (tile coords). */
export interface DeskSpot {
  id: string;
  region: string;
  zone: Zone;
  chair: Cell & { face: Dir };
  lamp: Cell;
  plant: Cell;
  poster: Cell;
  plate: Cell;
  /** walkable cell just outside the entrance (where visitors knock) */
  entrance: Cell;
  /** walkable cell in the guest area (spawn at your desk) */
  guest: Cell;
}

export interface Region {
  id: string;
  nameFr: string;
  nameEn: string;
  biome: string;
  x: number;
  y: number;
  w: number;
  h: number;
  /** cells the generator requires to stay reachable (build mode keeps them so) */
  reach?: Cell[];
}

export interface WorldMap {
  width: number;
  height: number;
  tile: number;
  pxWidth: number;
  pxHeight: number;
  /** 1 = solid cell. Row-major, width * height. */
  solid: Uint8Array;
  /** 1 = blocks light (walls, tall plants). */
  occlude: Uint8Array;
  /** chair facing per cell: index into SIT_DIRS + 1, 0 = no chair */
  sit: Uint8Array;
  zones: Zone[];
  regions: Region[];
  desks: DeskSpot[];
  spawns: { x: number; y: number; isDefault: boolean; region?: string }[];
  /** raw tile gids per tile layer */
  layers: Record<string, number[]>;
  /** small items resting on surfaces, in stacking order (P9.16, ADR-039) */
  props: PlacedProp[];
}

export const SIT_DIRS: Dir[] = ['down', 'left', 'right', 'up'];

const prop = (o: { properties?: TmjProperty[] }, name: string) =>
  o.properties?.find((p) => p.name === name)?.value;

export function parseMap(tmj: Tmj): WorldMap {
  const { width, height } = tmj;
  const solid = new Uint8Array(width * height);
  const occlude = new Uint8Array(width * height);
  const sit = new Uint8Array(width * height);
  const collidesGid = new Set<number>();
  for (const ts of tmj.tilesets)
    for (const t of ts.tiles ?? [])
      if (prop(t, 'collides') === true) collidesGid.add(ts.firstgid + t.id);
  const layers: Record<string, number[]> = {};
  for (const layer of tmj.layers) {
    if (layer.type !== 'tilelayer' || !layer.data) continue;
    if (layer.name === 'props') continue; // P9.11 tile layer: converted by readProps below
    layers[layer.name] = layer.data;
    if (!['walls', 'furniture'].includes(layer.name)) continue;
    layer.data.forEach((g, i) => {
      if (!g) return;
      if (collidesGid.has(g & 0x1fffffff)) solid[i] = 1;
      const def = tileDef(g);
      if (def?.occludes) occlude[i] = 1;
      if (def?.sit) sit[i] = SIT_DIRS.indexOf(def.sit) + 1;
    });
  }
  const zones: Zone[] = [];
  for (const o of tmj.layers.find((l) => l.name === 'zones')?.objects ?? []) {
    const kind = prop(o, 'kind') as ZoneKind;
    if (!ZONE_KINDS.includes(kind)) continue;
    const polygon = o.polygon?.map((p) => ({ x: o.x + p.x, y: o.y + p.y }));
    let { x, y } = o;
    let w = o.width ?? 0;
    let h = o.height ?? 0;
    if (polygon) {
      const xs = polygon.map((p) => p.x);
      const ys = polygon.map((p) => p.y);
      x = Math.min(...xs);
      y = Math.min(...ys);
      w = Math.max(...xs) - x;
      h = Math.max(...ys) - y;
    }
    zones.push({
      id: String(prop(o, 'zoneId') ?? o.name ?? o.id),
      kind,
      nameFr: String(prop(o, 'nameFr') ?? o.name ?? ''),
      nameEn: String(prop(o, 'nameEn') ?? o.name ?? ''),
      x,
      y,
      w,
      h,
      polygon,
      region: prop(o, 'region') as string | undefined,
      props: Object.fromEntries((o.properties ?? []).map((p) => [p.name, p.value])),
    });
  }
  const regions: Region[] = (tmj.layers.find((l) => l.name === 'regions')?.objects ?? []).map(
    (o) => ({
      id: String(o.name),
      nameFr: String(prop(o, 'nameFr') ?? o.name),
      nameEn: String(prop(o, 'nameEn') ?? o.name),
      biome: String(prop(o, 'biome') ?? 'hub'),
      x: o.x,
      y: o.y,
      w: o.width ?? 0,
      h: o.height ?? 0,
      reach: String(prop(o, 'reach') ?? '')
        .split(';')
        .filter(Boolean)
        .map((c) => {
          const [cx, cy] = c.split(',').map(Number);
          return { cx: cx ?? 0, cy: cy ?? 0 };
        }),
    }),
  );
  const cell = (z: Zone, k: string): Cell => {
    const v = String(z.props[k] ?? '0,0')
      .split(',')
      .map(Number);
    return { cx: v[0] ?? 0, cy: v[1] ?? 0 };
  };
  const desks: DeskSpot[] = zones
    .filter((z) => z.kind === 'desk')
    .map((z) => ({
      id: z.id,
      region: z.region ?? 'hub',
      zone: z,
      chair: { ...cell(z, 'chair'), face: (z.props.face as Dir) ?? 'up' },
      lamp: cell(z, 'lamp'),
      plant: cell(z, 'plant'),
      poster: cell(z, 'poster'),
      plate: cell(z, 'plate'),
      entrance: cell(z, 'entrance'),
      guest: cell(z, 'guest'),
    }));
  const spawns = (tmj.layers.find((l) => l.name === 'spawns')?.objects ?? []).map((o) => ({
    x: o.x,
    y: o.y,
    isDefault: prop(o, 'default') === true,
    region: prop(o, 'region') as string | undefined,
  }));
  if (!spawns.length)
    spawns.push({
      x: (width * TILE) / 2,
      y: (height * TILE) / 2,
      isDefault: true,
      region: undefined,
    });
  const map: WorldMap = {
    width,
    height,
    tile: tmj.tilewidth,
    pxWidth: width * tmj.tilewidth,
    pxHeight: height * tmj.tileheight,
    solid,
    occlude,
    sit,
    zones,
    regions,
    desks,
    spawns,
    layers,
    props: [],
  };
  map.props = readProps(tmj, map, mapReader(map));
  return map;
}

/** Chair facing at a pixel position (avatar feet), if standing on a chair. */
export function chairAt(map: WorldMap, x: number, y: number): Dir | undefined {
  const cx = Math.floor(x / map.tile);
  const cy = Math.floor((y - 1) / map.tile);
  if (cx < 0 || cy < 0 || cx >= map.width || cy >= map.height) return undefined;
  const v = map.sit[cy * map.width + cx]!;
  return v ? SIT_DIRS[v - 1] : undefined;
}

/** Feet position at the centre of a cell (sitting, pathfinding, spawns). */
export function cellPos(map: WorldMap, c: Cell): { x: number; y: number } {
  return { x: c.cx * map.tile + map.tile / 2, y: c.cy * map.tile + map.tile - 6 };
}

export function cellOf(map: WorldMap, x: number, y: number): Cell {
  return { cx: Math.floor(x / map.tile), cy: Math.floor((y - 1) / map.tile) };
}

export function regionAt(map: WorldMap, x: number, y: number): Region | undefined {
  return map.regions.find((r) => x >= r.x && y >= r.y && x < r.x + r.w && y < r.y + r.h);
}

export function regionSpawn(map: WorldMap, region: string): { x: number; y: number } | undefined {
  return map.spawns.find((s) => s.region === region);
}

export function isSolidCell(map: WorldMap, cx: number, cy: number): boolean {
  if (cx < 0 || cy < 0 || cx >= map.width || cy >= map.height) return true;
  return map.solid[cy * map.width + cx] === 1;
}

/** True if the feet hitbox at (x, y) overlaps a solid cell or leaves the map. */
export function collides(map: WorldMap, x: number, y: number): boolean {
  const l = x - FEET_W / 2;
  const r = x + FEET_W / 2 - 0.001;
  const t = y - FEET_H;
  const b = y - 0.001;
  if (l < 0 || t < 0 || r >= map.pxWidth || b >= map.pxHeight) return true;
  const t0 = map.tile;
  for (let cy = Math.floor(t / t0); cy <= Math.floor(b / t0); cy++)
    for (let cx = Math.floor(l / t0); cx <= Math.floor(r / t0); cx++)
      if (isSolidCell(map, cx, cy)) return true;
  return false;
}

/**
 * True if the straight segment between two feet positions never enters a solid
 * cell (checked at the hitbox centre, sampled every 4 px). Point-based so that
 * sliding along walls and round corners is not mistaken for crossing them.
 */
export function segmentClear(
  map: WorldMap,
  ax: number,
  ay: number,
  bx: number,
  by: number,
): boolean {
  const d = Math.hypot(bx - ax, by - ay);
  const steps = Math.max(1, Math.ceil(d / 4));
  for (let i = 1; i <= steps; i++) {
    const f = i / steps;
    const x = ax + (bx - ax) * f;
    const y = ay + (by - ay) * f - FEET_H / 2;
    if (isSolidCell(map, Math.floor(x / map.tile), Math.floor(y / map.tile))) return false;
  }
  return true;
}

/** True if a straight walk from a to b stays clear (sampled every 4 px). */
export function pathClear(map: WorldMap, ax: number, ay: number, bx: number, by: number): boolean {
  const d = Math.hypot(bx - ax, by - ay);
  const steps = Math.max(1, Math.ceil(d / 4));
  for (let i = 1; i <= steps; i++) {
    const f = i / steps;
    if (collides(map, ax + (bx - ax) * f, ay + (by - ay) * f)) return false;
  }
  return true;
}

function inPolygon(px: number, py: number, poly: { x: number; y: number }[]): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i]!;
    const b = poly[j]!;
    if (a.y > py !== b.y > py && px < ((b.x - a.x) * (py - a.y)) / (b.y - a.y) + a.x)
      inside = !inside;
  }
  return inside;
}

export function zoneContains(z: Zone, x: number, y: number): boolean {
  if (x < z.x || y < z.y || x >= z.x + z.w || y >= z.y + z.h) return false;
  return z.polygon ? inPolygon(x, y, z.polygon) : true;
}

/** Zones that drive media/chat rules take precedence over plain labelled areas. */
const PRIORITY: Record<ZoneKind, number> = {
  private: 0,
  desk: 1,
  quiet: 2,
  portal: 3,
  spotlight: 4,
  broadcast: 5,
  door: 6,
  shop: 7,
  area: 8,
};

/** Zone at a point (avatar feet), highest-priority first. */
export function zoneAt(map: WorldMap, x: number, y: number): Zone | undefined {
  let best: Zone | undefined;
  for (const z of map.zones)
    if (zoneContains(z, x, y) && (!best || PRIORITY[z.kind] < PRIORITY[best.kind])) best = z;
  return best;
}

export function defaultSpawn(map: WorldMap): { x: number; y: number } {
  return map.spawns.find((s) => s.isDefault) ?? map.spawns[0]!;
}

/** Nearest free position to (x, y) — used to place joiners without overlapping walls. */
export function nearestFree(map: WorldMap, x: number, y: number): { x: number; y: number } {
  if (!collides(map, x, y)) return { x, y };
  for (let r = 4; r < 400; r += 4)
    for (let a = 0; a < 16; a++) {
      const nx = x + Math.cos((a / 16) * Math.PI * 2) * r;
      const ny = y + Math.sin((a / 16) * Math.PI * 2) * r;
      if (!collides(map, nx, ny)) return { x: nx, y: ny };
    }
  return { x, y };
}
