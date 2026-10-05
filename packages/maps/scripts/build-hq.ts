/**
 * Generates packages/maps/hq.tmj (Tiled JSON): a central Atrium (hub) plus four
 * biome wings (Jungle, Boreal, Oasis, Zen), each with 8 claimable L-desk pods,
 * one meeting room, a lounge and a teleporter pad (ADR-016).
 * Re-run with `pnpm map:build`. Output opens in Tiled with the exported tileset PNG.
 */
import { writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  TILE,
  TILE_DEFS,
  TILESET_COLUMNS,
  TILESET_NAME,
  gid,
  tileDef,
  type Biome,
  type Tmj,
  type TmjObject,
  type TmjProperty,
} from '../../shared/src/index';

const W = 102;
const H = 54;
type Layer = number[];
const floor: Layer = new Array(W * H).fill(0);
const walls: Layer = new Array(W * H).fill(0);
const furniture: Layer = new Array(W * H).fill(0);
const above: Layer = new Array(W * H).fill(0);
const propLayer: Layer = new Array(W * H).fill(0); // P9.11: items resting on desks and tables

const zones: TmjObject[] = [];
const spawns: TmjObject[] = [];
const regions: TmjObject[] = [];
const labels: TmjObject[] = [];
const lights: TmjObject[] = [];
let oid = 1;

const props = (o: Record<string, string | number | boolean>): TmjProperty[] =>
  Object.entries(o).map(([name, value]) => ({
    name,
    type: typeof value === 'number' ? 'float' : typeof value === 'boolean' ? 'bool' : 'string',
    value,
  }));

/** Deterministic PRNG so the map is stable between builds. */
let seed = 1337;
const rand = () => {
  seed = (seed * 1664525 + 1013904223) >>> 0;
  return seed / 2 ** 32;
};
const pick = <T>(xs: readonly T[]) => xs[Math.floor(rand() * xs.length)]!;

/** Builder for one region with local coordinates. */
class R {
  constructor(
    readonly id: string,
    readonly biome: Biome,
    readonly ox: number,
    readonly oy: number,
    readonly w: number,
    readonly h: number,
  ) {}
  t(base: string) {
    return base.includes('.') || !TILE_DEFS.some((d) => d.name === `${this.biome}.${base}`)
      ? base
      : `${this.biome}.${base}`;
  }
  set(layer: Layer, x: number, y: number, base: string) {
    const gx = this.ox + x;
    const gy = this.oy + y;
    if (gx >= 0 && gy >= 0 && gx < W && gy < H) layer[gy * W + gx] = gid(this.t(base));
  }
  clear(layer: Layer, x: number, y: number, w = 1, h = 1) {
    for (let j = y; j < y + h; j++)
      for (let i = x; i < x + w; i++) layer[(this.oy + j) * W + this.ox + i] = 0;
  }
  fill(layer: Layer, x: number, y: number, w: number, h: number, base: string) {
    for (let j = y; j < y + h; j++) for (let i = x; i < x + w; i++) this.set(layer, i, j, base);
  }
  get(layer: Layer, x: number, y: number) {
    return layer[(this.oy + y) * W + this.ox + x] ?? 0;
  }
  px(x: number) {
    return (this.ox + x) * TILE;
  }
  py(y: number) {
    return (this.oy + y) * TILE;
  }
  cell(x: number, y: number) {
    return `${this.ox + x},${this.oy + y}`;
  }
  zone(
    zoneId: string,
    kind: string,
    nameFr: string,
    nameEn: string,
    x: number,
    y: number,
    w: number,
    h: number,
    extra: Record<string, string | number | boolean> = {},
  ) {
    zones.push({
      id: oid++,
      name: zoneId,
      type: 'zone',
      x: this.px(x),
      y: this.py(y),
      width: w * TILE,
      height: h * TILE,
      properties: props({ kind, zoneId, nameFr, nameEn, region: this.id, ...extra }),
    });
  }
  spawn(name: string, x: number, y: number, isDefault = false) {
    spawns.push({
      id: oid++,
      name,
      type: 'spawn',
      x: this.px(x) + TILE / 2,
      y: this.py(y) + TILE - 6,
      properties: props({ region: this.id, default: isDefault }),
    });
  }
  label(fr: string, en: string, x: number, y: number) {
    labels.push({
      id: oid++,
      name: en,
      type: 'label',
      x: this.px(x),
      y: this.py(y),
      properties: props({ fr, en }),
    });
  }
  light(
    x: number,
    y: number,
    kind: 'ceiling' | 'sky',
    radius: number,
    color: string,
    intensity: number,
  ) {
    lights.push({
      id: oid++,
      name: kind,
      type: 'light',
      x: this.px(x),
      y: this.py(y),
      properties: props({ kind, radius, color, intensity }),
    });
  }
  ring() {
    this.fill(walls, 0, 0, this.w, 1, 'wallTop');
    this.fill(walls, 0, this.h - 1, this.w, 1, 'wallTop');
    this.fill(walls, 0, 0, 1, this.h, 'wallTop');
    this.fill(walls, this.w - 1, 0, 1, this.h, 'wallTop');
  }
  region(nameFr: string, nameEn: string) {
    regions.push({
      id: oid++,
      name: this.id,
      type: 'region',
      x: this.px(0),
      y: this.py(0),
      width: this.w * TILE,
      height: this.h * TILE,
      properties: props({ nameFr, nameEn, biome: this.biome }),
    });
  }
  /** Is a local cell free of solid tiles? */
  walkable(x: number, y: number) {
    if (x < 0 || y < 0 || x >= this.w || y >= this.h) return false;
    for (const l of [walls, furniture]) {
      const g = this.get(l, x, y);
      if (g && tileDef(g)?.collides) return false;
    }
    return true;
  }
}

/** Cells (local) that must stay reachable, and cells that must stay clear of decor. */
const required = new Map<R, [number, number][]>();
const keepClear = new Map<R, Set<string>>();
const req = (r: R, x: number, y: number) =>
  (required.get(r) ?? required.set(r, []).get(r)!).push([x, y]);
const clearZone = (r: R, x: number, y: number, w = 1, h = 1) => {
  const s = keepClear.get(r) ?? keepClear.set(r, new Set()).get(r)!;
  for (let j = y; j < y + h; j++) for (let i = x; i < x + w; i++) s.add(`${i},${j}`);
};

/** Required cells (local) that cannot be reached from `start` through walkable cells. */
function unreachable(r: R, start: [number, number]): [number, number][] {
  const seen = new Set<string>([start.join(',')]);
  const q = [start];
  while (q.length) {
    const [x, y] = q.shift()!;
    for (const [dx, dy] of [
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1],
    ] as const) {
      const k = `${x + dx},${y + dy}`;
      if (!seen.has(k) && r.walkable(x + dx, y + dy)) {
        seen.add(k);
        q.push([x + dx, y + dy]);
      }
    }
  }
  return (required.get(r) ?? []).filter(([x, y]) => !seen.has(`${x},${y}`));
}

function reachableAll(r: R, start: [number, number]): boolean {
  const bad = unreachable(r, start);
  if (bad.length) console.error(`${r.id}: unreachable required cells`, JSON.stringify(bad));
  return bad.length === 0;
}

// ─────────────────────────────────────────────────────────────── desk pods
const deskCount: Record<string, number> = {};
const ABBR: Record<string, string> = { jungle: 'J', boreal: 'B', oasis: 'O', zen: 'Z' };

/**
 * 8×7 pod footprint; `top` = entrance at the bottom (desk along the back).
 * Open on every side (no planter border): the outer ring is plain floor, the
 * 6×5 desk zone is alt floor and the client draws its outline (ADR-021).
 */
function pod(r: R, px: number, py: number, top: boolean) {
  const n = (deskCount[r.id] = (deskCount[r.id] ?? 0) + 1);
  const id = `${r.id}-${n}`;
  r.fill(floor, px + 1, py + 1, 6, 5, 'floorAlt');
  const ix = (i: number) => px + 1 + i;
  const iy = (j: number) => py + 1 + (top ? j : 4 - j);
  // front edge row (nameplate sits here)
  const fy = top ? py + 6 : py;
  // L-shaped desk: back segment (corner + 2 monitors + lamp end) and side segment
  // Redesigned wings (jungle ADR-023, oasis ADR-024, boreal ADR-025, zen ADR-026): bottom pods have their L-arm going up, so
  // they use the mirrored corner art, and they keep a bare platform instead of a guest rug.
  const jungle =
    r.biome === 'jungle' || r.biome === 'oasis' || r.biome === 'boreal' || r.biome === 'zen';
  r.set(furniture, ix(0), iy(0), jungle && !top ? 'deskCornerUp' : 'deskCorner');
  r.set(furniture, ix(1), iy(0), top ? 'deskMonitor' : 'deskMonitorBack');
  r.set(furniture, ix(2), iy(0), top ? 'deskMonitor' : 'deskMonitorBack');
  r.set(furniture, ix(3), iy(0), 'deskH');
  r.set(furniture, ix(0), iy(1), 'deskV');
  r.set(furniture, ix(0), iy(2), 'deskV');
  r.set(furniture, ix(1), iy(1), top ? 'chairUp' : 'chairDown');
  // personalised slots: plant (back corner), poster easel (front corner)
  r.set(furniture, ix(5), iy(0), 'slot');
  r.set(furniture, ix(0), iy(4), 'slot');
  r.set(furniture, ix(5), iy(4), pick(['plantA', 'plantB', 'plantC']));
  // guest rug (the jungle keeps its bare wooden platform instead)
  if (!jungle)
    for (let i = 2; i <= 4; i++) for (let j = 2; j <= 3; j++) r.set(floor, ix(i), iy(j), 'rug');
  const ey = top ? py + 7 : py - 1;
  req(r, ix(3), ey);
  req(r, ix(3), iy(3));
  req(r, ix(1), iy(1));
  clearZone(r, ix(2), ey, 4, 1);
  clearZone(r, ix(2), fy, 4, 1);
  r.zone(id, 'desk', `Poste ${ABBR[r.id]}-${n}`, `Desk ${ABBR[r.id]}-${n}`, px + 1, py + 1, 6, 5, {
    chair: r.cell(ix(1), iy(1)),
    face: top ? 'up' : 'down',
    lamp: r.cell(ix(3), iy(0)),
    plant: r.cell(ix(5), iy(0)),
    poster: r.cell(ix(0), iy(4)),
    plate: r.cell(ix(2), fy),
    entrance: r.cell(ix(3), ey),
    guest: r.cell(ix(3), iy(3)),
  });
}

function meetingTable(r: R, x: number, y: number, w: number) {
  r.fill(furniture, x, y, w, 2, 'table');
  for (let i = x; i < x + w; i++) {
    r.set(furniture, i, y - 1, 'chairDown');
    r.set(furniture, i, y + 2, 'chairUp');
    req(r, i, y - 1);
  }
  r.set(furniture, x - 1, y, 'chairRight');
  r.set(furniture, x - 1, y + 1, 'chairRight');
  r.set(furniture, x + w, y, 'chairLeft');
  r.set(furniture, x + w, y + 1, 'chairLeft');
}

function tree(r: R, x: number, y: number) {
  r.set(furniture, x, y, 'treeBase');
  if (y > 0) r.set(above, x, y - 1, 'treeTop');
}

function portalPad(r: R, x: number, y: number, to: string, fr: string, en: string) {
  r.fill(floor, x - 1, y - 1, 4, 4, 'mat');
  r.fill(furniture, x, y, 2, 2, 'portal');
  r.zone(`portal-${r.id}-${to}`, 'portal', fr, en, x, y, 2, 2, { to });
  clearZone(r, x - 1, y - 1, 4, 4);
  req(r, x, y);
}

// ─────────────────────────────────────────────────────────────── biomes
const BIOME_INFO: Record<string, { fr: string; en: string; room: [string, string] }> = {
  jungle: { fr: 'Jungle', en: 'Jungle', room: ['Salle Canopée', 'Canopy room'] },
  boreal: { fr: 'Forêt boréale', en: 'Boreal forest', room: ['Salle Chalet', 'Chalet room'] },
  oasis: { fr: 'Oasis', en: 'Oasis', room: ['Salle Mirage', 'Mirage room'] },
  zen: { fr: 'Jardin zen', en: 'Zen garden', room: ['Salle Bambou', 'Bamboo room'] },
};

// ─────────────────────────────────────────────────────────────── jungle (ADR-023)
/** Own PRNG so the jungle never shifts the random picks of the other wings. */
function mulberry(a: number) {
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const lattice = (x: number, y: number, k: number) => {
  let h = (Math.imul(x, 374761393) + Math.imul(y, 668265263) + Math.imul(k, 2246822519)) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
};
/** Smooth value noise in 0..1 (blobs of roughly `scale` cells). */
const vnoise = (x: number, y: number, scale: number, k: number) => {
  const fx = x / scale;
  const fy = y / scale;
  const x0 = Math.floor(fx);
  const y0 = Math.floor(fy);
  const sx = (fx - x0) ** 2 * (3 - 2 * (fx - x0));
  const sy = (fy - y0) ** 2 * (3 - 2 * (fy - y0));
  const a = lattice(x0, y0, k) * (1 - sx) + lattice(x0 + 1, y0, k) * sx;
  const b = lattice(x0, y0 + 1, k) * (1 - sx) + lattice(x0 + 1, y0 + 1, k) * sx;
  return a * (1 - sy) + b * sy;
};

type Pt = [number, number];
/** Cells of an orthogonal polyline through the given waypoints (horizontal first). */
function trail(pts: Pt[]): Pt[] {
  const out: Pt[] = [];
  for (let i = 0; i < pts.length - 1; i++) {
    let [x, y] = pts[i]!;
    const [tx, ty] = pts[i + 1]!;
    out.push([x, y]);
    while (x !== tx) {
      x += Math.sign(tx - x);
      out.push([x, y]);
    }
    while (y !== ty) {
      y += Math.sign(ty - y);
      out.push([x, y]);
    }
  }
  return out;
}

/** The Jungle wing's working area: staggered pods, waterfall and pond, dirt trails (ADR-023). */
function jungleWork(r: R) {
  const rnd = mulberry(2026);
  const inside = (x: number, y: number) => x >= 1 && y >= 1 && x < r.w - 1 && y < r.h - 1;
  const key = (x: number, y: number) => `${x},${y}`;
  const platform = new Set<string>(); // 6×5 desk platforms (floorAlt)
  const taken = new Set<string>(); // cells with solid furniture or water
  const ring = new Set<string>(); // the open 1-cell ring around every desk zone (ADR-021)

  // 1. Ground: calm base with soft patches of the two greens, and a few dirt blotches.
  for (let y = 1; y < r.h - 1; y++)
    for (let x = 1; x < r.w - 1; x++) {
      const n = vnoise(x, y, 4.5, 1) * 0.65 + vnoise(x, y, 2.2, 2) * 0.35;
      r.set(floor, x, y, n < 0.36 ? 'floorC' : n > 0.64 ? 'floorB' : 'floor');
    }
  for (let i = 0; i < 16; i++) {
    const x = 1 + Math.floor(rnd() * (r.w - 3));
    const y = 1 + Math.floor(rnd() * 18);
    r.set(floor, x, y, rnd() < 0.5 ? 'dirt' : 'dirtB');
    if (rnd() < 0.4 && inside(x + 1, y)) r.set(floor, x + 1, y, 'dirtB');
  }

  // 2. Eight claimable pods, staggered and facing different ways (zone x, zone y, desk at back?).
  const pods: [number, number, boolean][] = [
    [2, 2, true], // north-west
    [9, 5, false], // west, faces the north wall lane
    [24, 2, true], // north-east
    [1, 12, true],
    [8, 13, false],
    [15, 11, true],
    [22, 13, false],
    [29, 12, true],
  ];
  for (const [zx, zy, top] of pods) {
    pod(r, zx - 1, zy - 1, top);
    for (let j = 0; j < 5; j++) for (let i = 0; i < 6; i++) platform.add(key(zx + i, zy + j));
    for (let j = -1; j <= 5; j++) for (let i = -1; i <= 6; i++) ring.add(key(zx + i, zy + j));
  }

  // 3. Waterfall on the north wall, feeding a pond (autotiled with the neighbours' mask).
  r.set(walls, 19, 0, 'wallTop'); // no window above the cliff
  for (let j = 0; j < 4; j++)
    for (let i = 0; i < 3; i++) {
      r.set(furniture, 17 + i, 1 + j, `fall${j}${i}`);
      taken.add(key(17 + i, 1 + j));
    }
  const pond = new Set<string>();
  const rows: [number, number, number][] = [
    [5, 17, 22],
    [6, 16, 22],
    [7, 16, 21],
    [8, 18, 20],
  ];
  for (const [y, a, b] of rows) for (let x = a; x <= b; x++) pond.add(key(x, y));
  const isWater = (x: number, y: number) => pond.has(key(x, y)) || (y === 4 && x >= 17 && x <= 19);
  for (const k of pond) {
    const [x, y] = k.split(',').map(Number) as Pt;
    const m =
      (isWater(x, y - 1) ? 1 : 0) |
      (isWater(x + 1, y) ? 2 : 0) |
      (isWater(x, y + 1) ? 4 : 0) |
      (isWater(x - 1, y) ? 8 : 0);
    r.set(furniture, x, y, `pond${m}`);
    taken.add(k);
  }
  r.light(18, 6, 'sky', 6, '#bfe8ff', 0.35);

  // 4. Winding dirt trails joining every door, the pond, the lounge and the teleporter.
  const trails: Pt[][] = [
    // south street: teleporter west to the meeting door, then up the gap between the west pods
    [
      [18, 19],
      [14, 19],
      [14, 18],
      [9, 18],
      [7, 18],
      [7, 12],
      [8, 11],
      [8, 3],
      [12, 3],
    ],
    [
      [7, 18],
      [4, 18],
    ], // desk 4 door
    [
      [8, 11],
      [11, 11],
    ], // desk 5 door
    [
      [5, 8],
      [5, 10],
      [8, 10],
    ], // desk 1 door
    // pond shore, east to the second row of doors
    [
      [8, 10],
      [13, 10],
      [14, 9],
      [23, 9],
      [24, 10],
      [30, 10],
    ],
    [
      [27, 8],
      [27, 10],
    ], // desk 3 door
    [
      [25, 10],
      [25, 11],
    ], // desk 7 door
    [
      [18, 19],
      [18, 17],
    ], // desk 6 door
    // to the lounge and the east desk door
    [
      [18, 19],
      [24, 19],
      [24, 20],
    ],
    [
      [24, 19],
      [32, 19],
      [32, 18],
    ],
    [
      [30, 10],
      [30, 8],
      [31, 8],
    ], // to the bench and the nooks
  ];
  const pathCells = new Set<string>();
  for (const t of trails)
    for (const [x, y] of trail(t))
      if (inside(x, y) && !platform.has(key(x, y)) && !taken.has(key(x, y)))
        pathCells.add(key(x, y));
  const isPath = (x: number, y: number) => pathCells.has(key(x, y));
  for (const k of pathCells) {
    const [x, y] = k.split(',').map(Number) as Pt;
    const m =
      (isPath(x, y - 1) ? 1 : 0) |
      (isPath(x + 1, y) ? 2 : 0) |
      (isPath(x, y + 1) ? 4 : 0) |
      (isPath(x - 1, y) ? 8 : 0);
    r.set(floor, x, y, `path${m}`);
  }

  // 5. Raised wooden platforms: uneven edges around the desk zones.
  for (const k of [...platform]) {
    const [x, y] = k.split(',').map(Number) as Pt;
    for (const [dx, dy] of [
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1],
    ] as const) {
      const nx = x + dx;
      const ny = y + dy;
      if (!inside(nx, ny) || platform.has(key(nx, ny)) || isPath(nx, ny) || taken.has(key(nx, ny)))
        continue;
      if (rnd() < 0.22) r.set(floor, nx, ny, 'floorAlt');
    }
  }

  // 6. Long shared bench along the north-east wall and two solo nooks beside it.
  for (let y = 2; y <= 7; y++) {
    r.set(furniture, 33, y, 'table');
    r.set(furniture, 32, y, 'chairRight');
    r.set(furniture, 34, y, 'chairLeft');
    req(r, 32, y);
    req(r, 34, y);
  }
  r.set(furniture, 33, 9, 'plantA');
  r.set(furniture, 33, 10, 'table');
  r.set(furniture, 34, 10, 'chairLeft');
  req(r, 34, 10);
  r.set(furniture, 31, 10, 'table');
  r.set(furniture, 30, 10, 'chairRight');
  r.set(furniture, 31, 9, 'plantB');
  r.set(furniture, 32, 9, 'lamp');
  req(r, 30, 10);
  clearZone(r, 30, 8, 1, 3);

  return { rnd, platform, ring, isPath, pathCells, taken };
}

/** Plants, trees, lamps and vines that tie the Jungle layout together. */
function jungleDress(r: R, ctx: ReturnType<typeof jungleWork>) {
  const { rnd, platform, ring, isPath } = ctx;
  const key = (x: number, y: number) => `${x},${y}`;
  const free = (x: number, y: number) =>
    x >= 1 &&
    y >= 1 &&
    x < r.w - 1 &&
    y < r.h - 1 &&
    !r.get(furniture, x, y) &&
    !r.get(walls, x, y) &&
    !platform.has(key(x, y)) &&
    !ring.has(key(x, y)) &&
    !isPath(x, y) &&
    !keepClear.get(r)?.has(key(x, y));
  const put = (base: string, x: number, y: number) => {
    if (!free(x, y)) return false;
    r.set(furniture, x, y, base);
    return true;
  };
  const plant = () => (['plantA', 'plantB', 'plantC'] as const)[Math.floor(rnd() * 3)]!;

  // Canopy: trees in corners and by the bench hide the room's hard edges.
  for (const [x, y] of [
    [1, 1],
    [9, 1],
    [15, 2],
    [22, 1],
    [30, 1],
    [1, 10],
    [1, 19],
    [13, 19],
    [34, 19],
    [34, 13],
    [24, 25],
    [34, 25],
  ] as Pt[])
    if (free(x, y)) tree(r, x, y);

  // Hedges (flowering borders) edge the platforms and the pond.
  for (const [x, y] of [
    [14, 5],
    [14, 6],
    [15, 5],
    [23, 5],
    [24, 7],
    [2, 9],
    [3, 9],
    [11, 9],
    [10, 12],
    [20, 18],
    [21, 17],
    [28, 18],
    [29, 18],
  ] as Pt[])
    put('borderPlant', x, y);

  // Planters at pod corners and beside doors: odd counts, never mirrored.
  for (const [x, y] of [
    [8, 2],
    [8, 6],
    [9, 11],
    [14, 12],
    [21, 12],
    [28, 14],
    [7, 17],
    [28, 5],
    [30, 6],
    [30, 15],
    [14, 17],
    [22, 10],
    [9, 19],
    [11, 18],
    [3, 7],
    [1, 17],
  ] as Pt[])
    put(plant(), x, y);

  // Bushes where a trail bends, lamps along the trails (jungle at dusk).
  const cells = [...ctx.pathCells].map((k) => k.split(',').map(Number) as Pt);
  let n = 0;
  for (const [x, y] of cells) {
    const h = isPath(x - 1, y) || isPath(x + 1, y);
    const v = isPath(x, y - 1) || isPath(x, y + 1);
    if (h && v && rnd() < 0.5) {
      const [dx, dy]: Pt = [isPath(x - 1, y) ? 1 : -1, isPath(x, y - 1) ? 1 : -1];
      put(rnd() < 0.5 ? 'decorA' : 'decorB', x + dx, y + dy);
    }
    if (++n % 9 === 0) {
      for (const [dx, dy] of [
        [0, 1],
        [1, 0],
        [0, -1],
        [-1, 0],
      ] as Pt[])
        if (put('lamp', x + dx, y + dy)) break;
    }
  }

  // Hanging vines along the north wall, between the windows.
  for (const x of [2, 5, 6, 10, 13, 21, 24, 26, 29, 33]) r.set(above, x, 1, 'hanging');
}

/** Lounge in the south-east corner: sofa, hammock, arcades, board game, VR (ADR-023). */
function jungleLounge(r: R) {
  r.fill(floor, 25, 21, 9, 4, 'rug');
  r.set(furniture, 26, 21, 'sofaL');
  r.set(furniture, 27, 21, 'sofaM');
  r.set(furniture, 28, 21, 'sofaM');
  r.set(furniture, 29, 21, 'sofaR');
  r.fill(furniture, 27, 23, 2, 1, 'table');
  r.set(furniture, 30, 23, 'boardGame');
  r.set(furniture, 31, 21, 'vr');
  r.set(furniture, 31, 24, 'hammockL');
  r.set(furniture, 32, 24, 'hammockR');
  for (const [x, a] of [
    [33, 'arcadeA'],
    [34, 'arcadeB'],
  ] as const) {
    r.set(furniture, x, 21, `${a}Top`);
    r.set(furniture, x, 22, `${a}Bot`);
  }
  r.set(furniture, 24, 22, 'lamp');
  tree(r, 34, 25);
  tree(r, 24, 25);
  r.light(28, 23, 'ceiling', 6, '#ffd9a8', 0.45);
}

// ─────────────────────────────────────────────────────────────── oasis (ADR-024)
/** The Oasis wing's working area: pods around a fountain pool, sandstone paths, cabanas. */
function oasisWork(r: R) {
  const rnd = mulberry(4077);
  const inside = (x: number, y: number) => x >= 1 && y >= 1 && x < r.w - 1 && y < r.h - 1;
  const key = (x: number, y: number) => `${x},${y}`;
  const platform = new Set<string>();
  const taken = new Set<string>();
  const ring = new Set<string>();

  // 1. Ground: sand with soft drifts of the two warmer/cooler tones and a few packed-earth blotches.
  for (let y = 1; y < r.h - 1; y++)
    for (let x = 1; x < r.w - 1; x++) {
      const n = vnoise(x, y, 4.5, 11) * 0.65 + vnoise(x, y, 2.2, 12) * 0.35;
      r.set(floor, x, y, n < 0.36 ? 'floorC' : n > 0.64 ? 'floorB' : 'floor');
    }
  for (let i = 0; i < 14; i++) {
    const x = 1 + Math.floor(rnd() * (r.w - 3));
    const y = 1 + Math.floor(rnd() * 18);
    r.set(floor, x, y, rnd() < 0.5 ? 'dirt' : 'dirtB');
    if (rnd() < 0.4 && inside(x + 1, y)) r.set(floor, x + 1, y, 'dirtB');
  }

  // 2. Eight claimable pods: three along the north, five in the south, staggered.
  const pods: [number, number, boolean][] = [
    [11, 2, true],
    [18, 4, false],
    [25, 2, true],
    [1, 13, false],
    [8, 12, true],
    [15, 13, false],
    [22, 12, true],
    [29, 13, false],
  ];
  for (const [zx, zy, top] of pods) {
    pod(r, zx - 1, zy - 1, top);
    for (let j = 0; j < 5; j++) for (let i = 0; i < 6; i++) platform.add(key(zx + i, zy + j));
    for (let j = -1; j <= 5; j++) for (let i = -1; i <= 6; i++) ring.add(key(zx + i, zy + j));
  }

  // 3. Fountain on the north wall feeding a pool (autotiled with the neighbours' mask).
  for (let j = 0; j < 3; j++)
    for (let i = 0; i < 3; i++) {
      r.set(furniture, 3 + i, 1 + j, `fall${j}${i}`);
      taken.add(key(3 + i, 1 + j));
    }
  const pool = new Set<string>();
  const rows: [number, number, number][] = [
    [4, 2, 7],
    [5, 1, 8],
    [6, 1, 8],
    [7, 2, 8],
    [8, 3, 7],
  ];
  for (const [y, a, b] of rows) for (let x = a; x <= b; x++) pool.add(key(x, y));
  const isWater = (x: number, y: number) => pool.has(key(x, y)) || (y === 3 && x >= 3 && x <= 5);
  for (const k of pool) {
    const [x, y] = k.split(',').map(Number) as Pt;
    const m =
      (isWater(x, y - 1) ? 1 : 0) |
      (isWater(x + 1, y) ? 2 : 0) |
      (isWater(x, y + 1) ? 4 : 0) |
      (isWater(x - 1, y) ? 8 : 0);
    r.set(furniture, x, y, `pond${m}`);
    taken.add(k);
  }
  r.light(4, 5, 'sky', 6, '#bfe8ff', 0.35);

  // 4. Cabanas on the east side, each with a little table in front.
  for (const cy of [2, 8])
    for (let j = 0; j < 2; j++)
      for (let i = 0; i < 3; i++) {
        r.set(furniture, 32 + i, cy + j, `cabana${j}${i}`);
        taken.add(key(32 + i, cy + j));
      }
  r.set(furniture, 33, 5, 'table');
  r.set(furniture, 32, 5, 'chairRight');
  r.set(furniture, 34, 5, 'chairLeft');
  req(r, 32, 5);
  req(r, 34, 5);
  r.set(furniture, 31, 8, 'plantB');
  clearZone(r, 31, 4, 4, 1);

  // 5. Sandstone paths joining every door, the pool, the cabanas, the lounge and the teleporter.
  const trails: Pt[][] = [
    // main road between the two rows of pods
    [
      [2, 10],
      [10, 10],
      [10, 9],
      [14, 9],
      [14, 10],
      [24, 10],
      [24, 9],
      [30, 9],
      [30, 10],
      [34, 10],
    ],
    [
      [4, 10],
      [4, 11],
    ], // desk 4 door
    [
      [18, 10],
      [18, 11],
    ], // desk 6 door
    [
      [32, 10],
      [32, 11],
    ], // desk 8 door
    [
      [14, 10],
      [14, 8],
    ], // desk 1 door
    [
      [28, 10],
      [28, 8],
    ], // desk 3 door
    [
      [24, 10],
      [24, 2],
      [21, 2],
    ], // desk 2 door
    // pool shore up to the fountain
    [
      [9, 10],
      [9, 3],
      [6, 3],
    ],
    // south street: meeting room door, teleporter, lounge
    [
      [7, 19],
      [8, 19],
      [8, 18],
      [11, 18],
      [11, 19],
      [18, 19],
      [18, 20],
    ],
    [
      [18, 19],
      [25, 19],
      [25, 18],
    ], // desk 7 door
    [
      [25, 19],
      [30, 19],
      [30, 20],
      [34, 20],
    ],
    // two avenues down from the main road
    [
      [14, 10],
      [14, 19],
    ],
    [
      [28, 10],
      [28, 19],
    ],
  ];
  const pathCells = new Set<string>();
  for (const t of trails)
    for (const [x, y] of trail(t))
      if (inside(x, y) && !platform.has(key(x, y)) && !taken.has(key(x, y)))
        pathCells.add(key(x, y));
  const isPath = (x: number, y: number) => pathCells.has(key(x, y));
  for (const k of pathCells) {
    const [x, y] = k.split(',').map(Number) as Pt;
    const m =
      (isPath(x, y - 1) ? 1 : 0) |
      (isPath(x + 1, y) ? 2 : 0) |
      (isPath(x, y + 1) ? 4 : 0) |
      (isPath(x - 1, y) ? 8 : 0);
    r.set(floor, x, y, `path${m}`);
  }

  // 6. Platforms: uneven edges around the desk zones.
  for (const k of [...platform]) {
    const [x, y] = k.split(',').map(Number) as Pt;
    for (const [dx, dy] of [
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1],
    ] as const) {
      const nx = x + dx;
      const ny = y + dy;
      if (!inside(nx, ny) || platform.has(key(nx, ny)) || isPath(nx, ny) || taken.has(key(nx, ny)))
        continue;
      if (rnd() < 0.22) r.set(floor, nx, ny, 'floorAlt');
    }
  }
  return { rnd, platform, ring, isPath, pathCells, taken };
}

/** Palms, planters, hedges, lamps and hanging flowers for the Oasis. */
function oasisDress(r: R, ctx: ReturnType<typeof oasisWork>) {
  const { rnd, platform, ring, isPath } = ctx;
  const key = (x: number, y: number) => `${x},${y}`;
  const free = (x: number, y: number) =>
    x >= 1 &&
    y >= 1 &&
    x < r.w - 1 &&
    y < r.h - 1 &&
    !r.get(furniture, x, y) &&
    !r.get(walls, x, y) &&
    !platform.has(key(x, y)) &&
    !ring.has(key(x, y)) &&
    !isPath(x, y) &&
    !keepClear.get(r)?.has(key(x, y));
  const put = (base: string, x: number, y: number) => {
    if (!free(x, y)) return false;
    r.set(furniture, x, y, base);
    return true;
  };
  const plant = () => (['plantA', 'plantB', 'plantC'] as const)[Math.floor(rnd() * 3)]!;

  // Palms in corners and by the cabanas.
  for (const [x, y] of [
    [1, 1],
    [8, 1],
    [19, 1],
    [34, 1],
    [34, 7],
    [1, 10],
    [1, 19],
    [10, 19],
    [13, 20],
    [34, 12],
    [16, 25],
    [21, 25],
    [24, 25],
    [34, 25],
  ] as Pt[])
    if (free(x, y)) tree(r, x, y);

  // Flowering hedges along the pool and the platforms.
  for (const [x, y] of [
    [1, 4],
    [2, 9],
    [3, 9],
    [8, 8],
    [8, 9],
    [10, 8],
    [16, 9],
    [17, 3],
    [24, 11],
    [26, 8],
    [35, 8],
    [21, 17],
    [22, 18],
    [29, 18],
    [3, 18],
    [12, 11],
  ] as Pt[])
    put('borderPlant', x, y);

  // Planters at pod corners and beside doors.
  for (const [x, y] of [
    [10, 2],
    [17, 6],
    [24, 7],
    [31, 3],
    [1, 12],
    [7, 11],
    [14, 12],
    [21, 12],
    [28, 12],
    [7, 17],
    [14, 18],
    [21, 18],
    [28, 18],
    [34, 14],
    [9, 1],
    [22, 8],
    [1, 8],
  ] as Pt[])
    put(plant(), x, y);

  // Bushes where a path bends, lamps along the paths.
  const cells = [...ctx.pathCells].map((k) => k.split(',').map(Number) as Pt);
  let n = 0;
  for (const [x, y] of cells) {
    const h = isPath(x - 1, y) || isPath(x + 1, y);
    const v = isPath(x, y - 1) || isPath(x, y + 1);
    if (h && v && rnd() < 0.4) {
      const [dx, dy]: Pt = [isPath(x - 1, y) ? 1 : -1, isPath(x, y - 1) ? 1 : -1];
      put(rnd() < 0.5 ? 'decorA' : 'decorB', x + dx, y + dy);
    }
    if (++n % 11 === 0) {
      for (const [dx, dy] of [
        [0, 1],
        [1, 0],
        [0, -1],
        [-1, 0],
      ] as Pt[])
        if (put('lamp', x + dx, y + dy)) break;
    }
  }

  // Hanging flowers along the north wall, clear of the fountain.
  for (const x of [2, 7, 9, 13, 16, 21, 23, 26, 29, 31]) r.set(above, x, 1, 'hanging');
}

/** Lounge in the south-east corner: sofas, pool table, ping-pong, board game, VR (ADR-024). */
function oasisLounge(r: R) {
  r.fill(floor, 25, 21, 10, 4, 'rug');
  r.set(furniture, 26, 21, 'sofaL');
  r.set(furniture, 27, 21, 'sofaM');
  r.set(furniture, 28, 21, 'sofaM');
  r.set(furniture, 29, 21, 'sofaR');
  r.fill(furniture, 27, 23, 2, 1, 'table');
  r.set(furniture, 30, 23, 'boardGame');
  r.set(furniture, 34, 21, 'vr');
  r.set(furniture, 31, 22, 'poolTableL');
  r.set(furniture, 32, 22, 'poolTableR');
  r.set(furniture, 32, 24, 'pingPongL');
  r.set(furniture, 33, 24, 'pingPongR');
  r.set(furniture, 24, 22, 'lamp');
  tree(r, 34, 25);
  tree(r, 24, 25);
  req(r, 31, 23);
  req(r, 33, 22);
  r.light(29, 23, 'ceiling', 6, '#ffd9a8', 0.45);
}

// ─────────────────────────────────────────────────────────────── boreal (ADR-025)
/** The Boreal wing's working area: pods around a central fire pit, frozen pond, slate trails. */
function borealWork(r: R) {
  const rnd = mulberry(9151);
  const inside = (x: number, y: number) => x >= 1 && y >= 1 && x < r.w - 1 && y < r.h - 1;
  const key = (x: number, y: number) => `${x},${y}`;
  const platform = new Set<string>();
  const taken = new Set<string>();
  const ring = new Set<string>();

  // 1. Ground: dark slate with soft patches of needle drifts and frost, and a few slab blotches.
  for (let y = 1; y < r.h - 1; y++)
    for (let x = 1; x < r.w - 1; x++) {
      const n = vnoise(x, y, 4.5, 21) * 0.65 + vnoise(x, y, 2.2, 22) * 0.35;
      r.set(floor, x, y, n < 0.36 ? 'floorC' : n > 0.64 ? 'floorB' : 'floor');
    }
  for (let i = 0; i < 12; i++) {
    const x = 1 + Math.floor(rnd() * (r.w - 3));
    const y = 1 + Math.floor(rnd() * 18);
    r.set(floor, x, y, rnd() < 0.5 ? 'dirt' : 'dirtB');
    if (rnd() < 0.4 && inside(x + 1, y)) r.set(floor, x + 1, y, 'dirtB');
  }

  // 2. Eight claimable pods in two staggered rows: 4 north (two each side of the fire pit), 4 south.
  const pods: [number, number, boolean][] = [
    [1, 2, true],
    [8, 4, false],
    [22, 2, true],
    [29, 4, false],
    [3, 12, true],
    [11, 13, false],
    [19, 12, true],
    [27, 13, false],
  ];
  for (const [zx, zy, top] of pods) {
    pod(r, zx - 1, zy - 1, top);
    for (let j = 0; j < 5; j++) for (let i = 0; i < 6; i++) platform.add(key(zx + i, zy + j));
    for (let j = -1; j <= 5; j++) for (let i = -1; i <= 6; i++) ring.add(key(zx + i, zy + j));
  }

  // 3. Fire pit (4x4) with log seats around it, and a small frozen pond below.
  for (let j = 0; j < 4; j++)
    for (let i = 0; i < 4; i++) {
      r.set(furniture, 16 + i, 2 + j, `firepit${j}${i}`);
      taken.add(key(16 + i, 2 + j));
    }
  for (const [x, y, c] of [
    [15, 3, 'chairRight'],
    [15, 4, 'chairRight'],
    [15, 5, 'chairRight'],
    [20, 3, 'chairLeft'],
    [20, 4, 'chairLeft'],
    [20, 5, 'chairLeft'],
    [17, 6, 'chairUp'],
    [18, 6, 'chairUp'],
  ] as const) {
    r.set(furniture, x, y, c);
    req(r, x, y);
    taken.add(key(x, y));
  }
  r.light(18, 4, 'ceiling', 7, '#ffb060', 0.6);
  const pond = new Set<string>();
  for (let x = 16; x <= 19; x++) pond.add(key(x, 8));
  const isWater = (x: number, y: number) => pond.has(key(x, y));
  for (const k of pond) {
    const [x, y] = k.split(',').map(Number) as Pt;
    const m =
      (isWater(x, y - 1) ? 1 : 0) |
      (isWater(x + 1, y) ? 2 : 0) |
      (isWater(x, y + 1) ? 4 : 0) |
      (isWater(x - 1, y) ? 8 : 0);
    r.set(furniture, x, y, `pond${m}`);
    taken.add(k);
  }

  // 4. Reading nook with bookshelves in the west corridor.
  for (const x of [1, 2, 3]) {
    r.set(furniture, x, 9, 'bookshelf');
    taken.add(key(x, 9));
  }

  // 5. Slate trails joining every door, the fire pit, the lounge and the teleporter.
  const trails: Pt[][] = [
    // main road between the two rows of pods, with a jog around the pond
    [
      [2, 10],
      [11, 10],
      [11, 9],
      [22, 9],
      [22, 10],
      [33, 10],
    ],
    [
      [4, 8],
      [4, 10],
    ], // desk 1 door
    [
      [11, 2],
      [14, 2],
      [14, 10],
    ], // desk 2 door, west side of the clearing
    [
      [32, 2],
      [32, 1],
      [21, 1],
      [21, 10],
    ], // desk 4 door along the north lane, east side of the clearing
    [
      [25, 8],
      [25, 9],
    ], // desk 3 door
    [
      [14, 10],
      [14, 11],
    ], // desk 6 door
    [
      [30, 10],
      [30, 11],
    ], // desk 8 door
    // two avenues down to the south street, each with a jog
    [
      [9, 10],
      [9, 15],
      [10, 15],
      [10, 19],
    ],
    [
      [25, 10],
      [25, 14],
      [26, 14],
      [26, 19],
    ],
    // south street: meeting room door, desk 5 and 7 doors, teleporter, lounge
    [
      [6, 18],
      [6, 19],
      [33, 19],
    ],
    [
      [22, 18],
      [22, 19],
    ],
    [
      [18, 19],
      [18, 20],
    ],
    [
      [7, 19],
      [7, 20],
    ],
  ];
  const pathCells = new Set<string>();
  for (const t of trails)
    for (const [x, y] of trail(t))
      if (inside(x, y) && !platform.has(key(x, y)) && !taken.has(key(x, y)))
        pathCells.add(key(x, y));
  const isPath = (x: number, y: number) => pathCells.has(key(x, y));
  for (const k of pathCells) {
    const [x, y] = k.split(',').map(Number) as Pt;
    const m =
      (isPath(x, y - 1) ? 1 : 0) |
      (isPath(x + 1, y) ? 2 : 0) |
      (isPath(x, y + 1) ? 4 : 0) |
      (isPath(x - 1, y) ? 8 : 0);
    r.set(floor, x, y, `path${m}`);
  }

  // 6. Platforms: uneven edges around the desk zones.
  for (const k of [...platform]) {
    const [x, y] = k.split(',').map(Number) as Pt;
    for (const [dx, dy] of [
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1],
    ] as const) {
      const nx = x + dx;
      const ny = y + dy;
      if (!inside(nx, ny) || platform.has(key(nx, ny)) || isPath(nx, ny) || taken.has(key(nx, ny)))
        continue;
      if (rnd() < 0.22) r.set(floor, nx, ny, 'floorAlt');
    }
  }
  return { rnd, platform, ring, isPath, pathCells, taken };
}

/** Pines, shrubs, lamps and garlands for the Boreal. */
function borealDress(r: R, ctx: ReturnType<typeof borealWork>) {
  const { rnd, platform, ring, isPath } = ctx;
  const key = (x: number, y: number) => `${x},${y}`;
  const free = (x: number, y: number) =>
    x >= 1 &&
    y >= 1 &&
    x < r.w - 1 &&
    y < r.h - 1 &&
    !r.get(furniture, x, y) &&
    !r.get(walls, x, y) &&
    !platform.has(key(x, y)) &&
    !ring.has(key(x, y)) &&
    !isPath(x, y) &&
    !ctx.taken.has(key(x, y)) &&
    !keepClear.get(r)?.has(key(x, y));
  const put = (base: string, x: number, y: number) => {
    if (!free(x, y)) return false;
    r.set(furniture, x, y, base);
    return true;
  };
  const plant = () => (['plantA', 'plantB', 'plantC'] as const)[Math.floor(rnd() * 3)]!;

  // Pines in corners and framing the clearing.
  for (const [x, y] of [
    [9, 1],
    [13, 1],
    [16, 1],
    [19, 1],
    [34, 1],
    [1, 9],
    [34, 9],
    [34, 12],
    [1, 11],
    [1, 19],
    [10, 20],
    [13, 22],
    [16, 25],
    [21, 25],
    [24, 25],
    [34, 25],
    [12, 9],
    [20, 9],
  ] as Pt[])
    if (free(x, y)) tree(r, x, y);

  // Snowy stone planters along the pond and the platforms.
  for (const [x, y] of [
    [15, 8],
    [20, 8],
    [15, 9],
    [20, 9],
    [8, 10],
    [13, 11],
    [23, 11],
    [31, 9],
    [3, 18],
    [17, 18],
    [23, 18],
  ] as Pt[])
    put('borderPlant', x, y);

  // Firewood and cairns at path bends, plants beside doors.
  for (const [x, y] of [
    [10, 2],
    [10, 9],
    [31, 3],
    [33, 3],
    [2, 8],
    [8, 11],
    [18, 11],
    [24, 11],
    [18, 18],
    [31, 18],
    [34, 11],
    [5, 19],
    [28, 20],
    [23, 20],
  ] as Pt[])
    put(plant(), x, y);
  const cells = [...ctx.pathCells].map((k) => k.split(',').map(Number) as Pt);
  let n = 0;
  for (const [x, y] of cells) {
    const h = isPath(x - 1, y) || isPath(x + 1, y);
    const v = isPath(x, y - 1) || isPath(x, y + 1);
    if (h && v && rnd() < 0.45) {
      const [dx, dy]: Pt = [isPath(x - 1, y) ? 1 : -1, isPath(x, y - 1) ? 1 : -1];
      put(rnd() < 0.5 ? 'decorA' : 'decorB', x + dx, y + dy);
    }
    if (++n % 10 === 0) {
      for (const [dx, dy] of [
        [0, 1],
        [1, 0],
        [0, -1],
        [-1, 0],
      ] as Pt[])
        if (put('lamp', x + dx, y + dy)) break;
    }
  }

  // Pine garlands with lights along the north wall, clear of the fire pit.
  for (const x of [3, 7, 12, 14, 21, 24, 26, 30, 33]) r.set(above, x, 1, 'hanging');
}

/** Lounge in the south-east corner: hearth, sofas, TV and console, chess, VR (ADR-025). */
function borealLounge(r: R) {
  r.fill(floor, 25, 21, 10, 4, 'rug');
  r.set(furniture, 27, 25, 'fireplace');
  r.set(furniture, 26, 23, 'sofaL');
  r.set(furniture, 27, 23, 'sofaM');
  r.set(furniture, 28, 23, 'sofaR');
  r.set(furniture, 30, 21, 'tvL');
  r.set(furniture, 31, 21, 'tvR');
  r.set(furniture, 30, 23, 'chairUp');
  r.set(furniture, 31, 23, 'chairUp');
  r.set(furniture, 33, 22, 'boardGame');
  r.set(furniture, 34, 24, 'vr');
  r.set(furniture, 24, 22, 'lamp');
  tree(r, 34, 25);
  tree(r, 24, 25);
  req(r, 30, 23);
  req(r, 31, 23);
  req(r, 27, 24);
  req(r, 33, 23);
  r.light(29, 23, 'ceiling', 6, '#ffb878', 0.5);
}

// ─────────────────────────────────────────────────────────────── zen (ADR-026)
/** The Zen wing's working area: staggered pods, a koi pond in a gravel garden, flagstone trails. */
function zenWork(r: R) {
  const rnd = mulberry(5309);
  const inside = (x: number, y: number) => x >= 1 && y >= 1 && x < r.w - 1 && y < r.h - 1;
  const key = (x: number, y: number) => `${x},${y}`;
  const platform = new Set<string>();
  const taken = new Set<string>();
  const ring = new Set<string>();

  // 1. Ground: calm tatami with soft patches of the two variants; raked gravel fills the garden.
  for (let y = 1; y < r.h - 1; y++)
    for (let x = 1; x < r.w - 1; x++) {
      const n = vnoise(x, y, 5, 31) * 0.65 + vnoise(x, y, 2.5, 32) * 0.35;
      r.set(floor, x, y, n < 0.3 ? 'floorC' : n > 0.7 ? 'floorB' : 'floor');
    }
  for (let y = 1; y <= 8; y++)
    for (let x = 24; x <= 34; x++) r.set(floor, x, y, rnd() < 0.12 ? 'dirtB' : 'dirt');

  // 2. Eight claimable pods: three along the north, five in the south, staggered.
  const pods: [number, number, boolean][] = [
    [1, 2, true],
    [9, 3, false],
    [17, 2, true],
    [1, 12, true],
    [8, 13, false],
    [15, 12, true],
    [22, 13, false],
    [29, 12, true],
  ];
  for (const [zx, zy, top] of pods) {
    pod(r, zx - 1, zy - 1, top);
    for (let j = 0; j < 5; j++) for (let i = 0; i < 6; i++) platform.add(key(zx + i, zy + j));
    for (let j = -1; j <= 5; j++) for (let i = -1; i <= 6; i++) ring.add(key(zx + i, zy + j));
  }

  // 3. Koi pond in the north-east garden (autotiled with the neighbours' mask).
  const pond = new Set<string>();
  const rows: [number, number, number][] = [
    [3, 27, 32],
    [4, 26, 33],
    [5, 26, 33],
    [6, 27, 32],
  ];
  for (const [y, a, b] of rows) for (let x = a; x <= b; x++) pond.add(key(x, y));
  const isWater = (x: number, y: number) => pond.has(key(x, y));
  for (const k of pond) {
    const [x, y] = k.split(',').map(Number) as Pt;
    const m =
      (isWater(x, y - 1) ? 1 : 0) |
      (isWater(x + 1, y) ? 2 : 0) |
      (isWater(x, y + 1) ? 4 : 0) |
      (isWater(x - 1, y) ? 8 : 0);
    r.set(furniture, x, y, `pond${m}`);
    taken.add(k);
  }
  r.light(30, 5, 'sky', 6, '#dff3ea', 0.35);

  // 4. Flagstone trails joining every door, the garden loop, the lounge and the teleporter.
  const trails: Pt[][] = [
    // main road between the two rows of pods
    [
      [2, 10],
      [10, 10],
      [10, 9],
      [20, 9],
      [20, 10],
      [33, 10],
    ],
    [
      [4, 8],
      [4, 10],
    ], // desk 1 door
    [
      [12, 2],
      [15, 2],
      [15, 10],
    ], // desk 2 door
    [
      [20, 8],
      [20, 9],
    ], // desk 3 door
    // loop around the koi pond
    [
      [24, 10],
      [24, 7],
      [34, 7],
      [34, 2],
    ],
    [
      [24, 7],
      [24, 3],
      [25, 3],
    ],
    // south row doors
    [
      [11, 10],
      [11, 11],
    ], // desk 5 door
    [
      [25, 10],
      [25, 11],
    ], // desk 7 door
    [
      [4, 18],
      [4, 19],
      [33, 19],
    ],
    [
      [18, 18],
      [18, 20],
    ], // desk 6 door and teleporter
    [
      [32, 18],
      [32, 19],
    ], // desk 8 door
    // two avenues down the one-tile gaps between the south pods
    [
      [7, 10],
      [7, 20],
    ],
    [
      [21, 10],
      [21, 19],
    ],
  ];
  const pathCells = new Set<string>();
  for (const t of trails)
    for (const [x, y] of trail(t))
      if (inside(x, y) && !platform.has(key(x, y)) && !taken.has(key(x, y)))
        pathCells.add(key(x, y));
  const isPath = (x: number, y: number) => pathCells.has(key(x, y));
  for (const k of pathCells) {
    const [x, y] = k.split(',').map(Number) as Pt;
    const m =
      (isPath(x, y - 1) ? 1 : 0) |
      (isPath(x + 1, y) ? 2 : 0) |
      (isPath(x, y + 1) ? 4 : 0) |
      (isPath(x - 1, y) ? 8 : 0);
    r.set(floor, x, y, `path${m}`);
  }

  // 5. Platforms: uneven edges around the desk zones.
  for (const k of [...platform]) {
    const [x, y] = k.split(',').map(Number) as Pt;
    for (const [dx, dy] of [
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1],
    ] as const) {
      const nx = x + dx;
      const ny = y + dy;
      if (!inside(nx, ny) || platform.has(key(nx, ny)) || isPath(nx, ny) || taken.has(key(nx, ny)))
        continue;
      if (rnd() < 0.2) r.set(floor, nx, ny, 'floorAlt');
    }
  }

  // 6. Shoji windows along the north wall.
  for (let x = 3; x < r.w - 2; x += 4) r.set(walls, x, 0, 'window');
  return { rnd, platform, ring, isPath, pathCells, taken };
}

/** Maples, bamboo fences, lanterns, bonsai and stones for the Zen wing. */
function zenDress(r: R, ctx: ReturnType<typeof zenWork>) {
  const { rnd, platform, ring, isPath } = ctx;
  const key = (x: number, y: number) => `${x},${y}`;
  const free = (x: number, y: number) =>
    x >= 1 &&
    y >= 1 &&
    x < r.w - 1 &&
    y < r.h - 1 &&
    !r.get(furniture, x, y) &&
    !r.get(walls, x, y) &&
    !platform.has(key(x, y)) &&
    !ring.has(key(x, y)) &&
    !isPath(x, y) &&
    !ctx.taken.has(key(x, y)) &&
    !keepClear.get(r)?.has(key(x, y));
  const put = (base: string, x: number, y: number) => {
    if (!free(x, y)) return false;
    r.set(furniture, x, y, base);
    return true;
  };
  const plant = () => (['plantA', 'plantB', 'plantC'] as const)[Math.floor(rnd() * 3)]!;

  // Maples in corners and by the garden.
  for (const [x, y] of [
    [9, 1],
    [14, 1],
    [24, 1],
    [34, 1],
    [34, 9],
    [1, 9],
    [34, 11],
    [1, 19],
    [10, 20],
    [13, 22],
    [16, 25],
    [21, 25],
    [24, 25],
    [34, 25],
    [28, 8],
    [13, 9],
  ] as Pt[])
    if (free(x, y)) tree(r, x, y);

  // Bamboo fences frame the garden and the lanes.
  for (const [x, y] of [
    [25, 8],
    [26, 8],
    [27, 8],
    [31, 8],
    [32, 8],
    [25, 1],
    [26, 1],
    [32, 1],
    [33, 1],
    [8, 9],
    [9, 11],
    [3, 11],
    [5, 11],
    [16, 11],
    [23, 11],
    [28, 18],
    [29, 18],
    [10, 18],
    [22, 18],
  ] as Pt[])
    put(rnd() < 0.5 ? 'border' : 'borderPlant', x, y);

  // Bonsai beside the doors.
  for (const [x, y] of [
    [10, 2],
    [14, 8],
    [23, 8],
    [5, 8],
    [12, 11],
    [26, 11],
    [3, 18],
    [19, 18],
    [31, 18],
    [8, 18],
    [22, 9],
    [35, 4],
    [28, 20],
    [23, 20],
  ] as Pt[])
    put(plant(), x, y);

  // Stones and tea trays where a path bends, lanterns along the paths.
  const cells = [...ctx.pathCells].map((k) => k.split(',').map(Number) as Pt);
  let n = 0;
  for (const [x, y] of cells) {
    const h = isPath(x - 1, y) || isPath(x + 1, y);
    const v = isPath(x, y - 1) || isPath(x, y + 1);
    if (h && v && rnd() < 0.4) {
      const [dx, dy]: Pt = [isPath(x - 1, y) ? 1 : -1, isPath(x, y - 1) ? 1 : -1];
      put(rnd() < 0.7 ? 'decorA' : 'decorB', x + dx, y + dy);
    }
    if (++n % 11 === 0) {
      for (const [dx, dy] of [
        [0, 1],
        [1, 0],
        [0, -1],
        [-1, 0],
      ] as Pt[])
        if (put('lamp', x + dx, y + dy)) break;
    }
  }

  // Wisteria along the north wall, between the windows.
  for (const x of [2, 5, 8, 11, 13, 16, 19, 22, 25, 28, 31, 33]) r.set(above, x, 1, 'hanging');
}

/** Lounge in the south-east corner: low sofas, tea, go, puzzle, meditation corner (ADR-026). */
function zenLounge(r: R) {
  r.fill(floor, 25, 21, 10, 4, 'rug');
  r.set(furniture, 26, 21, 'sofaL');
  r.set(furniture, 27, 21, 'sofaM');
  r.set(furniture, 28, 21, 'sofaR');
  r.fill(furniture, 27, 23, 2, 1, 'table');
  r.set(furniture, 30, 23, 'boardGame');
  r.set(furniture, 31, 21, 'puzzle');
  r.set(furniture, 33, 21, 'screen');
  r.set(furniture, 34, 21, 'screen');
  r.set(floor, 33, 23, 'zabuton');
  r.set(floor, 34, 23, 'zabuton');
  r.set(floor, 33, 24, 'zabuton');
  r.set(furniture, 32, 24, 'tsukubai');
  r.set(furniture, 24, 22, 'lamp');
  tree(r, 34, 25);
  tree(r, 24, 25);
  req(r, 33, 23);
  req(r, 34, 23);
  req(r, 33, 24);
  req(r, 29, 22);
  r.light(29, 23, 'ceiling', 6, '#fff0d0', 0.45);
}

function biome(id: Biome, ox: number, oy: number) {
  const r = new R(id, id, ox, oy, 36, 27);
  const info = BIOME_INFO[id]!;
  r.region(info.fr, info.en);
  r.fill(floor, 0, 0, r.w, r.h, 'floor');
  r.ring();
  if (oy === 0) for (let x = 3; x < r.w - 2; x += 4) r.set(walls, x, 0, 'window');
  else for (let x = 4; x < r.w - 2; x += 6) r.light(x, 4, 'sky', 6, '#dcecff', 0.5);

  const jg = id === 'jungle';
  const os = id === 'oasis';
  const bo = id === 'boreal';
  const zn = id === 'zen';
  let zctx: ReturnType<typeof zenWork> | undefined;
  let bctx: ReturnType<typeof borealWork> | undefined;
  let jctx: ReturnType<typeof jungleWork> | undefined;
  let octx: ReturnType<typeof oasisWork> | undefined;
  if (zn) {
    clearZone(r, 1, 9, 34, 2);
    clearZone(r, 1, 18, 34, 2);
    clearZone(r, 15, 1, 1, 9);
    clearZone(r, 7, 10, 1, 10);
    clearZone(r, 21, 10, 1, 10);
    clearZone(r, 24, 1, 1, 9);
    zctx = zenWork(r);
  } else if (bo) {
    clearZone(r, 1, 9, 34, 2);
    clearZone(r, 1, 18, 34, 2);
    clearZone(r, 14, 1, 1, 10);
    clearZone(r, 21, 1, 1, 10);
    clearZone(r, 9, 10, 2, 10);
    bctx = borealWork(r);
  } else if (os) {
    // keep the main road, the south street and the lanes in front of every door free of decor
    clearZone(r, 1, 9, 34, 2);
    clearZone(r, 1, 18, 34, 2);
    clearZone(r, 9, 3, 1, 8);
    octx = oasisWork(r);
  } else if (jg) {
    // keep the lanes in front of every door and the south street free of decor
    clearZone(r, 1, 17, 34, 3);
    clearZone(r, 5, 8, 1, 3);
    clearZone(r, 8, 1, 1, 10);
    clearZone(r, 9, 3, 4, 1);
    jctx = jungleWork(r);
  } else {
    // 8 pods: 4 along the back wall (entrance down), 4 facing them (entrance up)
    for (let k = 0; k < 4; k++) pod(r, 2 + 8 * k, 1, true);
    for (let k = 0; k < 4; k++) pod(r, 2 + 8 * k, 12, false);
    r.fill(floor, 1, 8, 34, 4, 'floorAlt');
    clearZone(r, 1, 9, 34, 2);
    clearZone(r, 1, 19, 34, 1);
  }

  // meeting room (private), bottom-left
  r.fill(walls, 0, 20, 14, 1, 'wallTop');
  r.fill(walls, 13, 20, 1, 7, 'wallTop');
  r.clear(walls, 6, 20, 2, 1);
  r.fill(floor, 1, 21, 12, 5, 'floorAlt');
  r.set(furniture, 2, 21, 'decorA');
  meetingTable(r, 4, 22, 6);
  r.set(furniture, 11, 21, 'lamp');
  r.set(furniture, 1, 25, 'plantA');
  r.set(furniture, 12, 25, 'plantB');
  r.set(furniture, 1, 21, 'plantC');
  r.zone(`${id}-salle`, 'private', info.room[0], info.room[1], 1, 21, 12, 5);
  clearZone(r, 5, 19, 4, 3);
  req(r, 6, 21);
  r.light(7, 23, 'ceiling', 6, '#fff1d6', 0.55);

  // teleporter plaza
  portalPad(r, 18, 22, 'hub', `Téléporteur : ${info.fr}`, `Teleporter: ${info.en}`);
  r.spawn(`arrive-${id}`, 18, 20);
  req(r, 18, 20);
  clearZone(r, 16, 19, 6, 2);
  r.label('Téléporteur', 'Teleporter', 19, 21.4);
  r.set(furniture, 15, 21, 'lamp');
  r.set(furniture, 22, 21, 'lamp');

  // lounge (bottom-right)
  if (zn) {
    zenLounge(r);
    clearZone(r, 24, 19, 11, 2);
    r.zone(`${id}-aire`, 'area', info.fr, info.en, 1, 1, 34, 25);
    zenDress(r, zctx!);
    if (!reachableAll(r, [18, 20])) throw new Error(`${id}: required cells unreachable`);
    return;
  }
  if (bo) {
    borealLounge(r);
    clearZone(r, 24, 19, 11, 2);
    r.zone(`${id}-aire`, 'area', info.fr, info.en, 1, 1, 34, 25);
    borealDress(r, bctx!);
    if (!reachableAll(r, [18, 20])) throw new Error(`${id}: required cells unreachable`);
    return;
  }
  if (os) {
    oasisLounge(r);
    clearZone(r, 24, 19, 11, 2);
    r.zone(`${id}-aire`, 'area', info.fr, info.en, 1, 1, 34, 25);
    oasisDress(r, octx!);
    if (!reachableAll(r, [18, 20])) throw new Error(`${id}: required cells unreachable`);
    return;
  }
  if (jg) {
    jungleLounge(r);
    clearZone(r, 24, 19, 11, 2);
    r.zone(`${id}-aire`, 'area', info.fr, info.en, 1, 1, 34, 25);
    jungleDress(r, jctx!);
    const startJ: [number, number] = [18, 20];
    if (!reachableAll(r, startJ)) throw new Error(`${id}: required cells unreachable`);
    return;
  }
  r.fill(floor, 25, 21, 8, 4, 'rug');
  r.fill(furniture, 26, 21, 5, 1, 'sofa');
  r.fill(furniture, 27, 23, 3, 1, 'table');
  r.set(furniture, 24, 22, 'lamp');
  if (id === 'boreal') r.set(furniture, 28, 25, 'fireplace');
  tree(r, 34, 25);
  tree(r, 24, 25);
  clearZone(r, 25, 22, 7, 3);
  r.light(28, 23, 'ceiling', 6, '#ffd9a8', 0.45);
  // corridor ceiling lights
  for (const x of [6, 14, 22, 30]) r.light(x, 10, 'ceiling', 5, '#ffe2b8', 0.4);
  r.zone(`${id}-aire`, 'area', info.fr, info.en, 1, 1, 34, 25);

  // corridor lamps and trees at the ends
  r.set(furniture, 2, 9, 'lamp');
  r.set(furniture, 33, 10, 'lamp');
  clearZone(r, 1, 8, 1, 12);
  clearZone(r, 34, 8, 1, 12);

  // No scattered decor: builders decorate in build mode (ADR-021).
  const start: [number, number] = [18, 20];
  if (!reachableAll(r, start)) throw new Error(`${id}: required cells unreachable`);
}

// ─────────────────────────────────────────────────────────────── hub (Atrium)
function hub() {
  const r = new R('hub', 'hub', 36, 0, 30, 54);
  r.region('Atrium', 'Atrium');
  r.fill(floor, 0, 0, r.w, r.h, 'floor');
  r.ring();
  for (let x = 3; x < r.w - 2; x += 4) r.set(walls, x, 0, 'window');

  // Quiet library (top); doors on both side lanes
  r.fill(walls, 0, 9, r.w, 1, 'wallTop');
  r.clear(walls, 1, 9, 2, 1);
  r.clear(walls, 27, 9, 2, 1);
  r.fill(floor, 1, 1, 28, 8, 'floorAlt');
  r.fill(furniture, 3, 1, 24, 1, 'bookshelf');
  for (const x of [4, 9, 17, 22]) {
    r.fill(furniture, x, 4, 3, 1, 'table');
    r.fill(furniture, x, 5, 3, 1, 'stool');
  }
  r.set(furniture, 6, 8, 'sofa');
  r.set(furniture, 23, 8, 'sofa');
  for (const x of [3, 26]) r.set(furniture, x, 3, 'lamp');
  r.set(furniture, 14, 3, 'lamp');
  for (const [x, y] of [
    [13, 7],
    [16, 7],
    [10, 8],
    [19, 8],
  ] as const)
    r.set(furniture, x, y, pick(['plantA', 'plantB', 'plantC']));
  tree(r, 14, 8);
  r.zone('bibliotheque', 'quiet', 'Bibliothèque (zone calme)', 'Library (quiet zone)', 1, 1, 28, 8);
  clearZone(r, 1, 1, 2, 20);
  clearZone(r, 27, 1, 2, 20);
  req(r, 1, 5);
  req(r, 28, 5);

  // Three meeting rooms between the side lanes; doors open onto the lounge
  const rooms = [
    { id: 'salle-a', fr: 'Salle Laurentides', en: 'Laurentides room', x: 4, w: 6, door: 6 },
    { id: 'salle-b', fr: 'Salle Gaspésie', en: 'Gaspésie room', x: 11, w: 7, door: 14 },
    { id: 'salle-c', fr: 'Salle Charlevoix', en: 'Charlevoix room', x: 19, w: 7, door: 22 },
  ];
  r.fill(walls, 3, 19, 24, 1, 'wallTop');
  for (const x of [3, 10, 18, 26]) r.fill(walls, x, 10, 1, 9, 'wallTop');
  for (const m of rooms) {
    r.clear(walls, m.door, 19, 2, 1);
    r.fill(floor, m.x, 10, m.w, 9, 'rug');
    r.fill(floor, m.door, 19, 2, 1, 'floorAlt');
    r.set(furniture, m.x + 1, 10, 'whiteboard');
    r.set(furniture, m.x + 2, 10, 'whiteboard');
    meetingTable(r, m.x + 1, 13, m.w - 2);
    r.set(furniture, m.x, 18, 'plantA');
    r.set(furniture, m.x + m.w - 1, 18, 'plantB');
    r.set(furniture, m.x + m.w - 1, 10, 'lamp');
    r.zone(m.id, 'private', m.fr, m.en, m.x, 10, m.w, 9);
    r.light(m.x + m.w / 2, 14, 'ceiling', 6, '#fff1d6', 0.55);
    clearZone(r, m.door - 1, 17, 4, 4);
    req(r, m.door, 18);
  }

  // Lounge and kitchen
  r.fill(floor, 3, 22, 12, 7, 'rug');
  r.fill(furniture, 4, 23, 5, 1, 'sofa');
  r.fill(furniture, 5, 25, 3, 1, 'coffeeTable');
  r.fill(furniture, 4, 27, 5, 1, 'sofa');
  r.set(furniture, 11, 23, 'sofa');
  r.set(furniture, 11, 27, 'sofa');
  r.set(furniture, 3, 25, 'lamp');
  r.set(furniture, 13, 25, 'fireplace');
  r.fill(furniture, 28, 21, 1, 6, 'counter');
  r.set(furniture, 28, 27, 'fridge');
  r.set(furniture, 28, 28, 'waterCooler');
  r.fill(furniture, 21, 23, 4, 2, 'table');
  for (let x = 21; x < 25; x++) {
    r.set(furniture, x, 22, 'chairDown');
    r.set(furniture, x, 25, 'chairUp');
  }
  r.set(furniture, 18, 21, 'lamp');
  r.zone('salon', 'area', 'Salon et cuisine', 'Lounge and kitchen', 1, 20, 28, 12);
  r.light(8, 25, 'ceiling', 7, '#ffd9a8', 0.5);
  r.light(23, 24, 'ceiling', 6, '#fff1d6', 0.5);
  clearZone(r, 1, 20, 28, 1);
  clearZone(r, 15, 21, 4, 11);

  // Teleporter plaza
  r.fill(floor, 1, 32, 28, 10, 'floorAlt');
  r.fill(furniture, 12, 35, 6, 3, 'water');
  for (const [x, y] of [
    [11, 34],
    [18, 34],
    [11, 38],
    [18, 38],
  ] as const)
    tree(r, x, y);
  portalPad(r, 3, 34, 'jungle', 'Téléporteur : Jungle', 'Teleporter: Jungle');
  portalPad(r, 3, 39, 'oasis', 'Téléporteur : Oasis', 'Teleporter: Oasis');
  portalPad(r, 25, 34, 'boreal', 'Téléporteur : Forêt boréale', 'Teleporter: Boreal forest');
  portalPad(r, 25, 39, 'zen', 'Téléporteur : Jardin zen', 'Teleporter: Zen garden');
  r.label('Jungle', 'Jungle', 4, 33.3);
  r.label('Oasis', 'Oasis', 4, 38.3);
  r.label('Forêt boréale', 'Boreal forest', 26, 33.3);
  r.label('Jardin zen', 'Zen garden', 26, 38.3);
  r.spawn('arrive-hub', 14.5, 40);
  req(r, 14, 40);
  r.zone('place', 'area', 'Place des téléporteurs', 'Teleporter plaza', 1, 32, 28, 10);
  clearZone(r, 1, 32, 28, 1);
  clearZone(r, 7, 33, 3, 9);
  clearZone(r, 20, 33, 3, 9);
  clearZone(r, 12, 39, 6, 3);

  // Reception (spawn)
  r.fill(walls, 0, 42, 11, 1, 'wallTop');
  r.fill(walls, 19, 42, 11, 1, 'wallTop');
  r.fill(floor, 1, 43, 28, 10, 'floor');
  r.fill(floor, 13, 49, 4, 4, 'mat');
  r.fill(furniture, 11, 46, 8, 1, 'reception');
  r.fill(furniture, 3, 49, 3, 1, 'sofa');
  r.fill(furniture, 24, 49, 3, 1, 'sofa');
  r.set(furniture, 2, 46, 'lamp');
  r.set(furniture, 27, 46, 'lamp');
  r.fill(walls, 14, 53, 2, 1, 'glassDoor');
  r.spawn('reception', 14.5, 51, true);
  req(r, 14, 51);
  r.zone('accueil', 'area', 'Accueil', 'Reception', 1, 43, 28, 10);
  r.light(15, 47, 'ceiling', 7, '#fff1d6', 0.5);
  clearZone(r, 11, 42, 8, 4);
  clearZone(r, 12, 47, 6, 6);

  if (!reachableAll(r, [14, 51])) throw new Error('hub: required cells unreachable');
}

hub();
biome('jungle', 0, 0);
biome('oasis', 0, 27);
biome('boreal', 66, 0);
biome('zen', 66, 27);

// Required cells go into the map so build mode can refuse edits that wall them off.
for (const [r, cells] of required) {
  const o = regions.find((q) => q.name === r.id)!;
  o.properties!.push({
    name: 'reach',
    type: 'string',
    value: cells.map(([x, y]) => r.cell(x, y)).join(';'),
  });
}

// Wall fronts: a wall whose cell below is not a wall shows its front face.
for (let y = 0; y < H - 1; y++)
  for (let x = 0; x < W; x++) {
    const g = walls[y * W + x]!;
    const def = tileDef(g);
    if (def?.base === 'wallTop' && !walls[(y + 1) * W + x])
      walls[y * W + x] = gid(`${def.biome}.wallFront`);
  }

const tilesetRows = Math.ceil(TILE_DEFS.length / TILESET_COLUMNS);
const tl = (id: number, name: string, data: number[]) => ({
  id,
  name,
  type: 'tilelayer' as const,
  width: W,
  height: H,
  data,
  visible: true,
  opacity: 1,
  x: 0,
  y: 0,
});
const ol = (id: number, name: string, objects: TmjObject[]) => ({
  id,
  name,
  type: 'objectgroup' as const,
  objects,
  visible: true,
  opacity: 1,
  x: 0,
  y: 0,
});
const tmj: Tmj = {
  type: 'map',
  version: '1.10',
  tiledversion: '1.11.0',
  orientation: 'orthogonal',
  renderorder: 'right-down',
  infinite: false,
  width: W,
  height: H,
  tilewidth: TILE,
  tileheight: TILE,
  nextlayerid: 13,
  nextobjectid: oid + 1,
  properties: props({ nameFr: 'Siège Agora', nameEn: 'Agora HQ' }),
  layers: [
    tl(1, 'floor', floor),
    tl(2, 'walls', walls),
    tl(3, 'furniture', furniture),
    tl(11, 'props', propLayer),
    tl(4, 'above', above),
    ol(5, 'zones', zones),
    ol(6, 'spawns', spawns),
    ol(7, 'interactables', []),
    ol(8, 'regions', regions),
    ol(9, 'labels', labels),
    ol(10, 'lights', lights),
  ],
  tilesets: [
    {
      firstgid: 1,
      name: TILESET_NAME,
      tilewidth: TILE,
      tileheight: TILE,
      tilecount: TILE_DEFS.length,
      columns: TILESET_COLUMNS,
      image: `../../apps/web/public/assets/tiles/${TILESET_NAME}.png`,
      imagewidth: TILESET_COLUMNS * TILE,
      imageheight: tilesetRows * TILE,
      margin: 0,
      spacing: 0,
      tiles: TILE_DEFS.map((t, id) => ({
        id,
        properties: [
          { name: 'name', type: 'string', value: t.name },
          { name: 'collides', type: 'bool', value: t.collides },
        ],
      })),
    },
  ],
};

const out = join(dirname(fileURLToPath(import.meta.url)), '..', 'hq.tmj');
writeFileSync(out, JSON.stringify(tmj));
console.log(
  `wrote ${out}: ${zones.filter((z) => z.properties?.some((p) => p.value === 'desk')).length} desks, ${zones.length} zones`,
);
