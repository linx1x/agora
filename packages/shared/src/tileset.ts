/**
 * Tile catalogue for the procedural placeholder tileset "agora-office" (ADR-011, ADR-016).
 * Index = local tile id (gid - 1). The web client draws each tile on a canvas in
 * this order; the map generator, collision grid and lighting read the flags.
 */
import type { Dir } from './constants';
import type { Shape3D } from './shape3d';

export const TILESET_NAME = 'agora-office';
export const TILESET_COLUMNS = 8;

export const BIOMES = ['hub', 'jungle', 'boreal', 'oasis', 'zen'] as const;
export type Biome = (typeof BIOMES)[number];

export interface TileDef {
  name: string;
  /** base drawer name (without biome prefix) */
  base: string;
  biome?: Biome;
  collides: boolean;
  /** blocks light (walls, tall plants) */
  occludes?: boolean;
  /** automatic light source */
  light?: 'lamp' | 'window' | 'portal' | 'fire';
  /** chair: direction you face when sitting */
  sit?: Dir;
  /** belongs in the `above` layer (rendered over avatars) */
  above?: boolean;
  /**
   * Blended ground (ADR-037): pixels mix with neighbouring terrains of the same biome.
   * `group` decides where a rim is drawn (grass meeting dirt), `tex` is the tile whose
   * pixels are the texture (paths use plain dirt). Tiles without it keep crisp cell edges.
   */
  terrain?: { group: string; tex: string };
  /**
   * Joined furniture (ADR-037): neighbours in the same `group` merge into one object drawn
   * from `mat`; `prop` is an item baked into this tile's art (a monitor) drawn on top.
   * A joinable tile with no joined neighbour keeps its hand-drawn art.
   */
  join?: { group: 'surface'; mat: BlendMaterial; prop?: string; eastWestOnly?: boolean };
  /** Props can rest on it (P9.11): row, from the cell top, where a prop's base sits. */
  surface?: number;
  /** A small item that rests on a surface, on the `props` layer (P9.11). */
  prop?: boolean;
  /**
   * A prop that holds other props (P9.19, ADR-039): footprint half-width `w` and depth `d`
   * (px on the plane it rests on, above its base point) and height `h` (px a rider is raised).
   */
  stack?: { w: number; d: number; h: number };
  /** How it stands in the 2.5D view (P16.4, ADR-052); derived from the name when absent. Visual only. */
  d3?: Shape3D;
}

export type BlendMaterial = 'desk' | 'table' | 'counter';

/** Tiles that exist once per biome (drawn with that biome's palette). */
const PER_BIOME: Omit<TileDef, 'name' | 'biome'>[] = [
  { base: 'floor', collides: false },
  { base: 'floorAlt', collides: false },
  { base: 'rug', collides: false },
  { base: 'wallTop', collides: true, occludes: true },
  { base: 'wallFront', collides: true, occludes: true },
  { base: 'window', collides: true, occludes: true, light: 'window' },
  { base: 'border', collides: true },
  { base: 'borderPlant', collides: true },
  { base: 'deskH', collides: true },
  { base: 'deskMonitor', collides: true },
  { base: 'deskMonitorBack', collides: true },
  { base: 'deskCorner', collides: true },
  { base: 'deskV', collides: true },
  { base: 'plantA', collides: true },
  { base: 'plantB', collides: true },
  { base: 'plantC', collides: true },
  { base: 'treeBase', collides: true, occludes: true },
  { base: 'treeTop', collides: false, above: true },
  { base: 'lamp', collides: true, light: 'lamp' },
  { base: 'decorA', collides: true },
  { base: 'decorB', collides: true },
  { base: 'table', collides: true },
  { base: 'sofa', collides: true },
  { base: 'hanging', collides: false, above: true },
];

/** Tiles shared by every biome. */
const GLOBAL: TileDef[] = [
  { name: 'empty', base: 'empty', collides: false },
  { name: 'slot', base: 'slot', collides: true },
  { name: 'chairUp', base: 'chairUp', collides: false, sit: 'up' },
  { name: 'chairDown', base: 'chairDown', collides: false, sit: 'down' },
  { name: 'chairLeft', base: 'chairLeft', collides: false, sit: 'left' },
  { name: 'chairRight', base: 'chairRight', collides: false, sit: 'right' },
  { name: 'portal', base: 'portal', collides: false, light: 'portal' },
  { name: 'mat', base: 'mat', collides: false },
  { name: 'water', base: 'water', collides: true },
  { name: 'bookshelf', base: 'bookshelf', collides: true, occludes: true },
  { name: 'counter', base: 'counter', collides: true },
  { name: 'fridge', base: 'fridge', collides: true, occludes: true },
  { name: 'whiteboard', base: 'whiteboard', collides: true, occludes: true },
  { name: 'coffeeTable', base: 'coffeeTable', collides: true },
  { name: 'reception', base: 'reception', collides: true },
  { name: 'glassDoor', base: 'glassDoor', collides: true, occludes: true },
  { name: 'waterCooler', base: 'waterCooler', collides: true },
  { name: 'stool', base: 'stool', collides: false },
  { name: 'fireplace', base: 'fireplace', collides: true, occludes: true, light: 'fire' },
  { name: 'sign', base: 'sign', collides: true },
];

/**
 * Wing-only tiles (ADR-023, ADR-024), appended after every older tile so existing gids stay put.
 * Order matters: jungle first, then oasis, boreal, zen. Floor tiles walk, solid ones block.
 */
const pad16 = (p: string) => Array.from({ length: 16 }, (_, i) => `${p}${i}`);
const grid = (p: string, rows: number, cols: number) =>
  Array.from({ length: rows }, (_, r) =>
    Array.from({ length: cols }, (_, c) => `${p}${r}${c}`),
  ).flat();
const EXTRAS: { biome: Biome; floor: string[]; solid: string[] }[] = [
  {
    biome: 'jungle',
    floor: ['floorB', 'floorC', 'dirt', 'dirtB', ...pad16('path')],
    solid: [
      ...pad16('pond'),
      ...grid('fall', 4, 3),
      'hammockL',
      'hammockR',
      'arcadeATop',
      'arcadeABot',
      'arcadeBTop',
      'arcadeBBot',
      'boardGame',
      'vr',
      'sofaL',
      'sofaM',
      'sofaR',
      'deskCornerUp',
    ],
  },
  {
    biome: 'oasis',
    floor: ['floorB', 'floorC', 'dirt', 'dirtB', ...pad16('path')],
    solid: [
      ...pad16('pond'),
      ...grid('fall', 3, 3),
      ...grid('cabana', 2, 3),
      'poolTableL',
      'poolTableR',
      'pingPongL',
      'pingPongR',
      'boardGame',
      'vr',
      'sofaL',
      'sofaM',
      'sofaR',
      'deskCornerUp',
    ],
  },
  {
    biome: 'boreal',
    floor: ['floorB', 'floorC', 'dirt', 'dirtB', ...pad16('path')],
    solid: [
      ...pad16('pond'),
      ...grid('firepit', 4, 4),
      'tvL',
      'tvR',
      'boardGame',
      'vr',
      'sofaL',
      'sofaM',
      'sofaR',
      'deskCornerUp',
    ],
  },
  {
    biome: 'zen',
    floor: ['floorB', 'floorC', 'dirt', 'dirtB', 'zabuton', ...pad16('path')],
    solid: [
      ...pad16('pond'),
      'tsukubai',
      'screen',
      'boardGame',
      'puzzle',
      'sofaL',
      'sofaM',
      'sofaR',
      'deskCornerUp',
    ],
  },
];
/** Layer a wing-only tile belongs to, by tile name (e.g. `jungle.path3`). */
export const EXTRA_LAYER: Record<string, 'floor' | 'furniture'> = {};
const EXTRA_DEFS: TileDef[] = [];
for (const e of EXTRAS) {
  for (const base of e.floor) {
    EXTRA_LAYER[`${e.biome}.${base}`] = 'floor';
    EXTRA_DEFS.push({ name: `${e.biome}.${base}`, base, biome: e.biome, collides: false });
  }
  for (const base of e.solid) {
    EXTRA_LAYER[`${e.biome}.${base}`] = 'furniture';
    EXTRA_DEFS.push({ name: `${e.biome}.${base}`, base, biome: e.biome, collides: true });
  }
}

/**
 * Props (P9.11, ADR-038): small items that rest on desks and tables, on their own layer.
 * Names equal the sprite names in `assets/agora/common.png`. Appended last so gids stay put.
 */
export const PROP_TILES = [
  'prop.lampOn',
  'prop.laptopOpen',
  'prop.monitorFront',
  'prop.monitorBack',
  'prop.keyboard',
  'prop.notebook',
  'prop.headset',
  'prop.coffee',
  'prop.icedCoffee',
  'prop.matcha',
  'prop.herbalTea',
  'prop.juice',
  // P9.19 (ADR-039): items that hold others
  'prop.laptopClosed',
  'prop.books',
] as const;
/**
 * Stackable props (P9.19): footprint and height measured on their art in common.png, so a
 * rider's base lands on the drawn top (books: top cover rows 12–15 above a base row of 27).
 */
const STACKS: Record<string, NonNullable<TileDef['stack']>> = {
  'prop.books': { w: 5, d: 3, h: 12 },
  'prop.laptopClosed': { w: 10, d: 8, h: 5 },
  'prop.notebook': { w: 4, d: 11, h: 4 },
};
const PROP_DEFS: TileDef[] = PROP_TILES.map((name) => ({
  name,
  base: name,
  collides: false,
  prop: true,
  ...(name === 'prop.lampOn' ? { light: 'lamp' as const } : {}),
  ...(STACKS[name] ? { stack: STACKS[name] } : {}),
}));

export const TILE_DEFS: TileDef[] = [
  ...GLOBAL,
  ...BIOMES.flatMap((b) =>
    PER_BIOME.map((t) => ({ ...t, name: `${b}.${t.base}`, biome: b }) as TileDef),
  ),
  ...EXTRA_DEFS,
  ...PROP_DEFS,
  // P14.4 (ADR-041): a bowl the office cat drinks from. Appended last so gids stay put.
  { name: 'waterBowl', base: 'waterBowl', collides: false },
];

// ── Blending metadata (ADR-037). Natural ground blends; paved, wooden and woven floors stay crisp.
for (const d of TILE_DEFS) {
  const b = d.biome;
  if (b && b !== 'hub') {
    if (['floor', 'floorB', 'floorC'].includes(d.base))
      d.terrain = { group: b === 'jungle' ? 'green' : 'ground', tex: d.name };
    else if (b === 'jungle' && ['dirt', 'dirtB'].includes(d.base))
      d.terrain = { group: 'dirt', tex: d.name };
    else if (b === 'jungle' && /^path\d+$/.test(d.base))
      d.terrain = { group: 'dirt', tex: 'jungle.dirt' };
  }
  if (d.base.startsWith('desk')) {
    const prop =
      d.base === 'deskMonitor'
        ? 'prop.monitorFront'
        : d.base === 'deskMonitorBack'
          ? 'prop.monitorBack'
          : undefined;
    d.join = { group: 'surface', mat: 'desk', ...(prop ? { prop } : {}) };
    d.surface = 17;
  } else if (d.base === 'table' || d.base === 'coffeeTable') {
    d.join = { group: 'surface', mat: 'table' };
    d.surface = d.base === 'table' ? 15 : 17;
  } else if (d.base === 'counter') {
    // counters run along a wall; a stack of them keeps its hand-drawn appliances
    d.join = { group: 'surface', mat: 'counter', eastWestOnly: true };
    d.surface = 15;
  }
}

const byName = new Map(TILE_DEFS.map((t, i) => [t.name, i]));

/** Tiled gid for a tile name (firstgid = 1, local id = index). */
export function gid(name: string): number {
  const i = byName.get(name);
  if (i === undefined) throw new Error(`unknown tile ${name}`);
  return i + 1;
}

export function tileDef(g: number): TileDef | undefined {
  return g > 0 ? TILE_DEFS[(g & 0x1fffffff) - 1] : undefined;
}
