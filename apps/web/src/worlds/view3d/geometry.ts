/**
 * The mesh of one chunk of a personal world in the 2.5D view (P17.15): one merged geometry of
 * quads, four vertices each, so quad `f` owns vertices `4f..4f+3` (what `Occlusion` fades). Tops
 * are flat quads at their level's height; a cell raised above its southern neighbour leaves a
 * cliff quad (the stepped column); decor, crops and the sprinkler stand as north-facing quads on
 * their cell, as the flat view's sprites do. Pure: no Three.js, so it is unit-tested.
 */
import { WORLD_CELL_PX } from '@agora/shared';
import type { OccluderObject } from '../../game3d/occlusionMath';
import { SIDE_PX } from '../view2d/art';
import { heightOf, southFace } from './math3d';

/** What the view draws of one cell. */
export interface CellIn {
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
}

export type CellReader = (cx: number, cy: number) => CellIn;

/** A sprite's place in the atlas: u across, `vt` on its top edge, `vb` on its bottom edge. */
export interface UvRect {
  readonly u0: number;
  readonly u1: number;
  readonly vt: number;
  readonly vb: number;
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
  /** one per vertex; 1 is solid (the `aFade` attribute) */
  readonly fade: Float32Array;
  readonly index: Uint32Array;
  readonly quads: number;
  readonly occluders: OccluderObject[];
}

/** The flat view's shades (WorldRoomScene STRIP_STEP and STRIP_STEEP), as factors of 1. */
const STEP: readonly [number, number, number] = [0x8f / 255, 0x8f / 255, 0x8f / 255];
const STEEP: readonly [number, number, number] = [0x55 / 255, 0x55 / 255, 0x55 / 255];
/** the watered tint of the soil (the flat view's 0x8fb4e0) */
const WATERED: readonly [number, number, number] = [0x8f / 255, 0xb4 / 255, 0xe0 / 255];
const WHITE: readonly [number, number, number] = [1, 1, 1];

/** Soil sits this far above its ground's top (tiles): enough for the depth buffer, not visible. */
export const SOIL_LIFT = 0.003;
/** Decor and crops stand this many tiles tall: one cell, as the flat view's 32 px sprites. */
const STAND = 1;
/** Sprinkler and crops stand a little apart on the cell so they do not share a plane. */
const CROP_Z = 0.5;
const SPRINKLER_Z = 0.7;
/** The wall decor is a wall, not a tree: its occluder is kept apart from the rest. */
const WALL = 'wood_wall';

interface Acc {
  pos: number[];
  uv: number[];
  col: number[];
  quads: number;
  occluders: Map<string, OccluderObject>;
  index: number[];
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
  const vb = uv.vt + (uv.vb - uv.vt) * frac;
  return pushQuad(
    acc,
    [
      [x, yTop, z],
      [x + 1, yTop, z],
      [x + 1, yBot, z],
      [x, yBot, z],
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

/**
 * The mesh of the cells of one chunk. A cliff leans on the cell to the south, so the reader is asked
 * for one cell beyond the region's southern edge too.
 */
export function buildChunk(region: ChunkRegion, read: CellReader, uv: SpriteUv): ChunkGeometry {
  const acc: Acc = { pos: [], uv: [], col: [], quads: 0, occluders: new Map(), index: [] };
  for (let cy = region.y0; cy < region.y0 + region.size; cy++) {
    for (let cx = region.x0; cx < region.x0 + region.size; cx++) {
      const c = read(cx, cy);
      const south = read(cx, cy + 1);
      const h = heightOf(c.level);
      const ground = uv(`top:${c.block}`);
      if (ground) topQuad(acc, cx, cy, h, ground, WHITE);

      if (c.soil) {
        const soil = uv('top:tilled_soil');
        if (soil) topQuad(acc, cx, cy, h + SOIL_LIFT, soil, c.watered ? WATERED : WHITE);
      }

      const face = southFace(c.level, south.level);
      const side = face ? uv(`side:${c.block}`) : undefined;
      if (face && side) {
        // the sprite is SIDE_PX rows for a whole level run; a face uses the rows of its height
        const frac = (face.high - face.low) / (SIDE_PX / WORLD_CELL_PX);
        standQuad(acc, cx, cy + 1, face.low, face.high, side, frac, face.steep ? STEEP : STEP);
      }

      if (c.decor) {
        const sprite = uv(`decor:${c.decor}`);
        if (sprite) {
          const q = standQuad(acc, cx, cy + 0.5, h, h + STAND, sprite, 1, WHITE);
          if (c.solid) addOccluder(acc, cx, cy, h, q, c.decor !== WALL);
        }
      }

      if (c.crop) {
        const sprite = uv(c.crop);
        if (sprite)
          standQuad(acc, cx, cy + CROP_Z, h + SOIL_LIFT, h + SOIL_LIFT + STAND, sprite, 1, WHITE);
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
    }
  }
  return {
    position: Float32Array.from(acc.pos),
    uv: Float32Array.from(acc.uv),
    color: Float32Array.from(acc.col),
    fade: new Float32Array(acc.quads * 4).fill(1),
    index: Uint32Array.from(acc.index),
    quads: acc.quads,
    occluders: [...acc.occluders.values()],
  };
}

function addOccluder(
  acc: Acc,
  cx: number,
  cy: number,
  h: number,
  quad: number,
  card: boolean,
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
    box: { x0: cx + 0.1, x1: cx + 0.9, y0: h, y1: h + STAND, z0: cy + 0.45, z1: cy + 0.55 },
    card,
  });
}
