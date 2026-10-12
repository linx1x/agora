/**
 * The mesh of one chunk of a personal world in the 2.5D view (P17.15): one merged geometry of
 * quads, four vertices each, so quad `f` owns vertices `4f..4f+3` (what `Occlusion` fades). Tops
 * are at their level's height, with recessed water basins and shallow planted root mounds; a cell
 * raised above its southern neighbour leaves a cliff quad. Approved decor and animals fold their
 * painted feet onto the floor; cast shadows and water surfaces use separate buffers/materials.
 * All positions are visual only. Pure: no Three.js, so it is unit-tested.
 */
import { WORLD_CELL_PX, type CellRef } from '@agora/shared';
import { TILT } from '../../game3d/camera';
import type { OccluderObject } from '../../game3d/occlusionMath';
import { SIDE_PX } from '../blockArt';
import { heightOf, southFace } from './math3d';

/** What the view draws of one cell. */
export interface CellIn {
  readonly bedAxis?: 'vertical' | 'horizontal';
  readonly level: number;
  /** the top block id */
  readonly block: string;
  /** the decor block id, or '' */
  readonly decor: string;
  /** the decor blocks movement: it is an occluder (it fades over a person behind it) */
  readonly solid: boolean;
  /** tilled soil over the ground, and whether it is watered today */
  readonly soil: boolean;
  readonly watered: boolean;
  /** the crop's sprite name (`cropFrameName`), or null */
  readonly crop: string | null;
  readonly sprinkler: boolean;
  /** the animals housed on this cell (sprite names, `animalSprite`), in the order they were bought */
  readonly animals: readonly string[];
  /** the state mark of this cell's machine or housing (sprite name, `markSprite`), or null */
  readonly mark: string | null;
}

export type CellReader = (cx: number, cy: number) => CellIn;

/** A sprite's place in the atlas: u across, `vt` on its top edge, `vb` on its bottom edge. */
export interface UvRect {
  readonly u0: number;
  readonly u1: number;
  readonly vt: number;
  readonly vb: number;
  /** Approved art proportions in tiles; omitted for legacy sprites. */
  readonly width?: number;
  readonly height?: number;
  /** Painted footprint height folded onto the ground, in tiles. */
  readonly footDepth?: number;
  /** Visible bottom row, normalized from the texture top. */
  readonly bottom?: number;
  readonly burial?: number;
}

export type SpriteUv = (name: string) => UvRect | undefined;

export interface ChunkRegion {
  readonly x0: number;
  readonly y0: number;
  readonly size: number;
}

export interface ChunkGeometry {
  readonly position: Float32Array;
  readonly uv: Float32Array;
  readonly color: Float32Array;
  /** Wind bend weight: only vegetation tips, never structures or collision geometry. */
  readonly wind: Float32Array;
  /** one per vertex; 1 is solid (the `aFade` attribute) */
  readonly fade: Float32Array;
  readonly index: Uint32Array;
  readonly quads: number;
  readonly occluders: OccluderObject[];
  /** Atlas-alpha silhouettes on the floor; separate transparent, non-depth-writing material. */
  readonly shadow: ShadowGeometry;
  /** Translucent water skin, separate from the submerged floor in the opaque geometry. */
  readonly water: WaterGeometry;
  /** Rendered animal quad -> authoritative housing cell, for exact visual click targeting. */
  readonly livestock: ReadonlyMap<number, CellRef>;
}

export interface WaterGeometry {
  readonly position: Float32Array;
  readonly uv: Float32Array;
  readonly index: Uint32Array;
}

export interface ShadowGeometry {
  readonly position: Float32Array;
  readonly uv: Float32Array;
  /** RGBA, including per-vertex contact strength. */
  readonly color: Float32Array;
  readonly index: Uint32Array;
}

/** The shades of the former flat view (WorldRoomScene STRIP_STEP and STRIP_STEEP), as factors of 1. */
const STEP: readonly [number, number, number] = [0x8f / 255, 0x8f / 255, 0x8f / 255];
const STEEP: readonly [number, number, number] = [0x55 / 255, 0x55 / 255, 0x55 / 255];
/** the watered tint of the soil (the flat view's 0x8fb4e0) */
const WATERED: readonly [number, number, number] = [0x8f / 255, 0xb4 / 255, 0xe0 / 255];
const WHITE: readonly [number, number, number] = [1, 1, 1];

/** Soil sits this far above its ground's top (tiles): enough for the depth buffer, not visible. */
export const SOIL_LIFT = 0.003;
/** Decor and crops stand this many tiles tall: one cell, as the flat view's 32 px sprites. */
const STAND = 1;
/** Animals stand on the front half of their housing cell, in rows: in front of the housing's own card. */
const ANIMAL_ROW_Z = 0.62;
const ANIMAL_ROW_STEP = 0.22;
/** A machine's mark sits on the front-right corner of its cell, clear of the decor card. */
const MARK_BOX = { x0: 0.6, x1: 0.95, z: 0.7, y0: 0.6, y1: 0.95 } as const;
/** Sprinkler and crops stand a little apart on the cell so they do not share a plane. */
const CROP_Z = 0.5;
const SPRINKLER_Z = 0.7;
/** The wall decor is a wall, not a tree: its occluder is kept apart from the rest. */
const WALL = 'wood_wall';

interface Acc {
  pos: number[];
  uv: number[];
  col: number[];
  wind: number[];
  quads: number;
  occluders: Map<string, OccluderObject>;
  index: number[];
  shadow: { pos: number[]; uv: number[]; col: number[]; index: number[] };
  water: { pos: number[]; uv: number[]; index: number[] };
  livestock: Map<number, CellRef>;
}

type P3 = readonly [number, number, number];
type UV2 = readonly [number, number];

function pushQuad(
  acc: Acc,
  p: readonly [P3, P3, P3, P3],
  uv: readonly [UV2, UV2, UV2, UV2],
  col: readonly [number, number, number],
): number {
  const base = acc.quads * 4;
  for (let i = 0; i < 4; i++) {
    acc.pos.push(p[i]![0], p[i]![1], p[i]![2]);
    acc.uv.push(uv[i]![0], uv[i]![1]);
    acc.col.push(col[0], col[1], col[2]);
    acc.wind.push(0);
  }
  acc.index.push(base, base + 1, base + 2, base, base + 2, base + 3);
  return acc.quads++;
}

/** A quad on the floor: its corners go north-west, north-east, south-east, south-west. */
function topQuad(
  acc: Acc,
  x: number,
  z: number,
  h: number,
  uv: UvRect,
  col: readonly [number, number, number],
) {
  pushQuad(
    acc,
    [
      [x, h, z],
      [x + 1, h, z],
      [x + 1, h, z + 1],
      [x, h, z + 1],
    ],
    [
      [uv.u0, uv.vt],
      [uv.u1, uv.vt],
      [uv.u1, uv.vb],
      [uv.u0, uv.vb],
    ],
    col,
  );
}

/**
 * A north-facing quad from `yBot` up to `yTop` at depth `z`, over the cell's width. The sprite's top
 * edge is its top row; `frac` is how much of the sprite's height the quad uses (a cliff uses only
 * the rows it needs).
 */
function standQuad(
  acc: Acc,
  x: number,
  z: number,
  yBot: number,
  yTop: number,
  uv: UvRect,
  frac: number,
  col: readonly [number, number, number],
): number {
  return cardQuad(acc, x, x + 1, z, yBot, yTop, uv, frac, col);
}

/** A north-facing card from `x0` to `x1` (any width), the rows of `standQuad`. */
function cardQuad(
  acc: Acc,
  x0: number,
  x1: number,
  z: number,
  yBot: number,
  yTop: number,
  uv: UvRect,
  frac: number,
  col: readonly [number, number, number],
): number {
  const vb = uv.vt + (uv.vb - uv.vt) * frac;
  return pushQuad(
    acc,
    [
      [x0, yTop, z],
      [x1, yTop, z],
      [x1, yBot, z],
      [x0, yBot, z],
    ],
    [
      [uv.u0, uv.vt],
      [uv.u1, uv.vt],
      [uv.u1, vb],
      [uv.u0, vb],
    ],
    col,
  );
}

const FLOOR_CLEARANCE = 0.004;
const FOOT_PROJECTION = 1 / Math.tan((TILT * Math.PI) / 180);

/** Coherent low-frequency patches break up broad natural surfaces without altering construction. */
function groundTint(block: string, x: number, z: number): readonly [number, number, number] {
  if (!/grass|sand|dirt|snow|podzol|mud|moss/.test(block)) return WHITE;
  const variation = Math.sin(x * 0.48 + Math.cos(z * 0.37)) * Math.cos(z * 0.41 - x * 0.17);
  const shade = 0.965 + variation * 0.035;
  return /grass|moss/.test(block)
    ? [shade, Math.min(1, shade + 0.018), shade * 0.97]
    : [shade, shade, shade];
}

/** Shared corners sample the same four cells, so basins join across chunk boundaries. */
function waterDepth(x: number, z: number, level: number, read: CellReader): number {
  let wet = 0;
  for (const dx of [-1, 0])
    for (const dz of [-1, 0]) {
      const cell = read(x + dx, z + dz);
      if (cell.block === 'water' && cell.level === level) wet++;
    }
  return 0.12 + 0.38 * (wet / 4) ** 2;
}

function waterTile(
  acc: Acc,
  x: number,
  z: number,
  h: number,
  level: number,
  read: CellReader,
  sprite: UvRect,
  bank: UvRect,
) {
  const coords: readonly [UV2, UV2, UV2, UV2] = [
    [sprite.u0, sprite.vt],
    [sprite.u1, sprite.vt],
    [sprite.u1, sprite.vb],
    [sprite.u0, sprite.vb],
  ];
  const corners: readonly [
    readonly [number, number],
    readonly [number, number],
    readonly [number, number],
    readonly [number, number],
  ] = [
    [x, z],
    [x + 1, z],
    [x + 1, z + 1],
    [x, z + 1],
  ];
  const points = corners.map(([xx, zz]) => [xx, h - waterDepth(xx, zz, level, read), zz] as P3) as [
    P3,
    P3,
    P3,
    P3,
  ];
  const q = pushQuad(acc, points, coords, WHITE);
  for (let i = 0; i < 4; i++) {
    const deep = (h - points[i]![1] - 0.12) / 0.38;
    acc.col.splice((q * 4 + i) * 3, 3, 0.72 - deep * 0.28, 0.84 - deep * 0.23, 0.82 - deep * 0.18);
  }
  const surface = acc.water,
    base = surface.pos.length / 3;
  for (let i = 0; i < 4; i++) {
    surface.pos.push(corners[i]![0], h - 0.04, corners[i]![1]);
    surface.uv.push(coords[i]![0], coords[i]![1]);
  }
  surface.index.push(base, base + 1, base + 2, base, base + 2, base + 3);
  // Exposed shore faces connect land to the basin rather than leaving a paper-thin rim.
  const neighbours = [
    [x, z - 1],
    [x + 1, z],
    [x, z + 1],
    [x - 1, z],
  ] as const;
  const bankUv: readonly [UV2, UV2, UV2, UV2] = [
    [bank.u0, bank.vt],
    [bank.u1, bank.vt],
    [bank.u1, bank.vb],
    [bank.u0, bank.vb],
  ];
  neighbours.forEach(([xx, zz], edge) => {
    const neighbour = read(xx, zz);
    if (neighbour.block === 'water' && neighbour.level === level) return;
    if (neighbour.level < level) return;
    const a = points[edge]!,
      b = points[(edge + 1) % 4]!;
    pushQuad(acc, [[a[0], h, a[2]], [b[0], h, b[2]], b, a], bankUv, [0.63, 0.68, 0.59]);
  });
}

/** Fold only the painted feet onto the floor, preserving the fixed camera's projection.
 * Each strip remains four vertices so the existing occlusion fade can address every face.
 */
function groundedSprite(acc: Acc, x: number, z: number, floor: number, sprite: UvRect): number[] {
  const width = sprite.width ?? 1;
  const height = sprite.height ?? 1;
  const bottom = sprite.bottom ?? 1;
  const foot = Math.min(sprite.footDepth ?? 0, height * bottom);
  const burial = sprite.burial ?? 0;
  const paintedTop = height * bottom;
  const x0 = x - width / 2,
    x1 = x + width / 2;
  const faces: number[] = [];
  const point = (xx: number, y: number): P3 => [
    xx,
    floor + FLOOR_CLEARANCE + Math.max(0, y - foot) - burial,
    z - Math.min(Math.max(0, y), foot) * FOOT_PROJECTION,
  ];
  const v = (y: number) => sprite.vt + (sprite.vb - sprite.vt) * (bottom - y / height);
  const strip = (low: number, high: number) => {
    const positions: readonly [P3, P3, P3, P3] = [
      point(x0, high),
      point(x1, high),
      point(x1, low),
      point(x0, low),
    ];
    const coords: readonly [UV2, UV2, UV2, UV2] = [
      [sprite.u0, v(high)],
      [sprite.u1, v(high)],
      [sprite.u1, v(low)],
      [sprite.u0, v(low)],
    ];
    const face = pushQuad(acc, positions, coords, WHITE);
    // Root shading connects the sprite to its soil without baking a circular decal.
    for (let i = 0; i < 4; i++) {
      const shade = 1 - 0.18 * Math.exp(-Math.max(0, positions[i]![1] - floor) / 0.18);
      acc.col.fill(shade, (face * 4 + i) * 3, (face * 4 + i) * 3 + 3);
    }
    faces.push(face);
    pushShadow(acc, positions, coords, floor, false);
  };
  if (foot > 0) strip(0, foot);
  if (paintedTop > foot) strip(foot, paintedTop);
  // A second short projection retains only the real base silhouette, not a generic ellipse.
  const contactTop = Math.min(paintedTop, foot + 0.12);
  pushShadow(
    acc,
    [point(x0, contactTop), point(x1, contactTop), point(x1, 0), point(x0, 0)],
    [
      [sprite.u0, v(contactTop)],
      [sprite.u1, v(contactTop)],
      [sprite.u1, v(0)],
      [sprite.u0, v(0)],
    ],
    floor,
    true,
  );
  return faces;
}

function pushShadow(
  acc: Acc,
  points: readonly [P3, P3, P3, P3],
  coords: readonly [UV2, UV2, UV2, UV2],
  floor: number,
  contact: boolean,
) {
  const shadow = acc.shadow;
  const base = shadow.pos.length / 3;
  for (let i = 0; i < 4; i++) {
    const p = points[i]!,
      uv = coords[i]!;
    const height = Math.max(0, p[1] - floor - FLOOR_CLEARANCE);
    const length = contact ? 0.35 : 1;
    shadow.pos.push(
      p[0] + height * 0.48 * length,
      floor + (contact ? 0.0025 : 0.0015),
      p[2] + height * 0.32 * length,
    );
    shadow.uv.push(uv[0], uv[1]);
    shadow.col.push(
      0.09,
      0.075,
      0.065,
      contact ? Math.exp(-height / 0.055) : 0.85 - Math.min(0.25, height * 0.08),
    );
  }
  shadow.index.push(base, base + 1, base + 2, base, base + 2, base + 3);
}

function cropStage(name: string | null): number {
  const frame = Number(name?.split(':').at(-1));
  return Number.isFinite(frame) ? Math.min(4, Math.max(0, frame)) : 0;
}

/** A shallow broken root mound grows with the plant and stays flush along plot edges. */
function plantedSoil(
  acc: Acc,
  x: number,
  z: number,
  h: number,
  sprite: UvRect,
  stage: number,
  col: readonly [number, number, number],
) {
  const subdivisions = 4;
  const point = (u: number, v: number): P3 => {
    const edge = Math.min(1, u * 10, (1 - u) * 10, v * 10, (1 - v) * 10);
    const width = 0.15 + stage * 0.027;
    const d = ((u - 0.5) / width) ** 2 + ((v - 0.59) / (width * 0.7)) ** 2;
    const rough = 0.82 + 0.12 * Math.sin(u * 39 + x * 7 + z) + 0.06 * Math.cos(v * 51 - z);
    return [x + u, h + (0.012 + stage * 0.009) * Math.exp(-d * 0.8) * rough * edge, z + v];
  };
  const tex = (u: number, v: number): UV2 => [
    sprite.u0 + (sprite.u1 - sprite.u0) * u,
    sprite.vt + (sprite.vb - sprite.vt) * v,
  ];
  for (let row = 0; row < subdivisions; row++)
    for (let colIndex = 0; colIndex < subdivisions; colIndex++) {
      const u0 = colIndex / subdivisions,
        u1 = (colIndex + 1) / subdivisions;
      const v0 = row / subdivisions,
        v1 = (row + 1) / subdivisions;
      pushQuad(
        acc,
        [point(u0, v0), point(u1, v0), point(u1, v1), point(u0, v1)],
        [tex(u0, v0), tex(u1, v0), tex(u1, v1), tex(u0, v1)],
        col,
      );
    }
}

/**
 * Where animal `i` of `n` on a housing cell stands: a card of `size` tiles from `x0` to `x1`, at depth
 * `z` on the cell. Up to four animals in two columns, more in three; each row is a step nearer.
 */
export function animalSlot(
  i: number,
  n: number,
): { x0: number; x1: number; z: number; size: number } {
  const cols = n > 4 ? 3 : n > 1 ? 2 : 1;
  const col = i % cols;
  const row = Math.floor(i / cols);
  const width = 0.8 / cols;
  const x0 = 0.1 + col * width;
  return { x0, x1: x0 + width * 0.9, z: ANIMAL_ROW_Z + row * ANIMAL_ROW_STEP, size: width };
}

/** Stable species scale and staggered pen positions; adding a herd never shrinks each animal. */
export function farmAnimalSlot(i: number, n: number): { x: number; z: number } {
  const cols = n > 4 ? 3 : n > 1 ? 2 : 1;
  const row = Math.floor(i / cols);
  return { x: 0.5 + ((i % cols) - (cols - 1) / 2) * 1.25 + (row % 2) * 0.16, z: 0.88 + row * 0.8 };
}

/**
 * The mesh of the cells of one chunk. A cliff leans on the cell to the south, so the reader is asked
 * for cells beyond the region too (shore corners, cliffs and the visual farm pen).
 */
export function buildChunk(region: ChunkRegion, read: CellReader, uv: SpriteUv): ChunkGeometry {
  const acc: Acc = {
    pos: [],
    uv: [],
    col: [],
    wind: [],
    quads: 0,
    occluders: new Map(),
    index: [],
    shadow: { pos: [], uv: [], col: [], index: [] },
    water: { pos: [], uv: [], index: [] },
    livestock: new Map(),
  };
  for (let cy = region.y0; cy < region.y0 + region.size; cy++) {
    for (let cx = region.x0; cx < region.x0 + region.size; cx++) {
      const c = read(cx, cy);
      const south = read(cx, cy + 1);
      const h = heightOf(c.level);
      const ground = uv(`top:${c.block}`);
      if (ground) {
        if (c.block === 'water')
          waterTile(acc, cx, cy, h, c.level, read, ground, uv('side:dirt') ?? ground);
        else topQuad(acc, cx, cy, h, ground, groundTint(c.block, cx, cy));
      }

      if (c.soil) {
        const stage = cropStage(c.crop);
        const planted = c.crop ? uv(`top:tilled_soil:${stage}`) : undefined;
        const soil = planted ?? uv('top:tilled_soil');
        if (soil) {
          if (planted)
            plantedSoil(acc, cx, cy, h + SOIL_LIFT, soil, stage, c.watered ? WATERED : WHITE);
          else topQuad(acc, cx, cy, h + SOIL_LIFT, soil, c.watered ? WATERED : WHITE);
        }
      }

      const face = southFace(c.level, south.level);
      const side = face ? uv(`side:${c.block}`) : undefined;
      if (face && side) {
        // the sprite is SIDE_PX rows for a whole level run; a face uses the rows of its height
        const frac = (face.high - face.low) / (SIDE_PX / WORLD_CELL_PX);
        standQuad(acc, cx, cy + 1, face.low, face.high, side, frac, face.steep ? STEEP : STEP);
      }

      if (c.decor) {
        const sprite = uv(
          `decor:${c.decor}${c.decor === 'bed' && c.bedAxis === 'horizontal' ? ':horizontal' : ''}`,
        );
        if (sprite) {
          const faces =
            sprite.width !== undefined
              ? groundedSprite(acc, cx + 0.5, cy + 0.5, h, sprite)
              : [standQuad(acc, cx, cy + 0.5, h, h + STAND, sprite, 1, WHITE)];
          if (/tree|spruce|palm|grass|bush|fern|flower/.test(c.decor)) {
            const tip = faces.at(-1)!;
            acc.wind[tip * 4] = 1;
            acc.wind[tip * 4 + 1] = 1;
          }
          if (c.solid)
            for (const q of faces) addOccluder(acc, cx, cy, h, q, c.decor !== WALL, sprite);
        }
      }

      if (c.crop) {
        const sprite = uv(c.crop);
        if (sprite) {
          const q =
            sprite.width !== undefined
              ? groundedSprite(acc, cx + 0.5, cy + CROP_Z, h + SOIL_LIFT, sprite).at(-1)!
              : standQuad(
                  acc,
                  cx,
                  cy + CROP_Z,
                  h + SOIL_LIFT,
                  h + SOIL_LIFT + STAND,
                  sprite,
                  1,
                  WHITE,
                );
          acc.wind[q * 4] = 0.6;
          acc.wind[q * 4 + 1] = 0.6;
        }
      }
      if (c.sprinkler) {
        const sprite = uv('sprinkler');
        if (sprite)
          standQuad(
            acc,
            cx,
            cy + SPRINKLER_Z,
            h + SOIL_LIFT,
            h + SOIL_LIFT + STAND,
            sprite,
            1,
            WHITE,
          );
      }
      c.animals.forEach((name, i) => {
        const sprite = uv(name);
        if (!sprite) return;
        if (sprite.width !== undefined) {
          const pen = farmAnimalSlot(i, c.animals.length);
          const at = read(Math.floor(cx + pen.x), Math.floor(cy + pen.z));
          const sameCell = Math.floor(pen.x) === 0 && Math.floor(pen.z) === 0;
          const clear = at.block !== 'water' && at.level === c.level && (!at.solid || sameCell);
          const fallback = animalSlot(i, c.animals.length);
          const x = clear ? pen.x : (fallback.x0 + fallback.x1) / 2;
          const z = clear ? pen.z : fallback.z;
          for (const face of groundedSprite(acc, cx + x, cy + z, h + SOIL_LIFT, sprite))
            acc.livestock.set(face, { x: cx, y: cy });
          return;
        }
        const at = animalSlot(i, c.animals.length);
        const face = cardQuad(
          acc,
          cx + at.x0,
          cx + at.x1,
          cy + at.z,
          h + SOIL_LIFT,
          h + SOIL_LIFT + at.size,
          sprite,
          1,
          WHITE,
        );
        acc.livestock.set(face, { x: cx, y: cy });
      });
      const mark = c.mark ? uv(c.mark) : undefined;
      if (mark)
        cardQuad(
          acc,
          cx + MARK_BOX.x0,
          cx + MARK_BOX.x1,
          cy + MARK_BOX.z,
          h + MARK_BOX.y0,
          h + MARK_BOX.y1,
          mark,
          1,
          WHITE,
        );
    }
  }
  return {
    position: Float32Array.from(acc.pos),
    uv: Float32Array.from(acc.uv),
    color: Float32Array.from(acc.col),
    wind: Float32Array.from(acc.wind),
    fade: new Float32Array(acc.quads * 4).fill(1),
    index: Uint32Array.from(acc.index),
    quads: acc.quads,
    occluders: [...acc.occluders.values()],
    shadow: {
      position: Float32Array.from(acc.shadow.pos),
      uv: Float32Array.from(acc.shadow.uv),
      color: Float32Array.from(acc.shadow.col),
      index: Uint32Array.from(acc.shadow.index),
    },
    water: {
      position: Float32Array.from(acc.water.pos),
      uv: Float32Array.from(acc.water.uv),
      index: Uint32Array.from(acc.water.index),
    },
    livestock: acc.livestock,
  };
}

function addOccluder(
  acc: Acc,
  cx: number,
  cy: number,
  h: number,
  quad: number,
  card: boolean,
  sprite: UvRect,
): void {
  const key = `${cx},${cy}`;
  const o = acc.occluders.get(key);
  if (o) {
    o.faces.push(quad);
    return;
  }
  acc.occluders.set(key, {
    key,
    faces: [quad],
    box: {
      x0: cx + 0.5 - (sprite.width ?? 0.8) / 2,
      x1: cx + 0.5 + (sprite.width ?? 0.8) / 2,
      y0: h,
      y1: h + (sprite.height ?? STAND) * (sprite.bottom ?? 1),
      z0: cy + 0.45 - (sprite.footDepth ?? 0) * FOOT_PROJECTION,
      z1: cy + 0.55,
    },
    card,
  });
}
