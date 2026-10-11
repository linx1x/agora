/**
 * Placed props in the 2.5D view (P16.14, ADR-039): each prop is an upright card standing on the
 * surface its base point names (props3d.ts maps the point to 3D). The card is as wide as the
 * prop's opaque art, centred on its base x, and its bottom row sits on the base, as the flat view
 * draws it (`placedSprite`). Pure: faces only, so the picking, the ghosts and the mesh share them.
 */
import {
  NONE,
  TILE_DEFS,
  mapReader,
  propCell,
  type PlacedProp,
  type PropRest,
  type WorldMap,
} from '@agora/shared';
import { propTo3D, surfaceHeightPx } from './props3d';
import type { Extents, Face3D, V3 } from './scene';

/** A prop's card: a face that also names the prop (picking and the moving props need it). */
export interface PropFace extends Face3D {
  prop: string;
}

const indexByName = new Map(TILE_DEFS.map((d, i) => [d.name, i]));
/** Tileset index of a prop tile (its art), or undefined for an unknown name. */
export const tileIndexOf = (name: string): number | undefined => indexByName.get(name);

/** Height (px) of the surface a prop's base point sits on; 0 when it rests on nothing. */
export function baseHeightPx(
  r: ReturnType<typeof mapReader>,
  p: PlacedProp,
  rest: PropRest,
  ext: readonly Extents[],
): number {
  if (rest.on === NONE) return 0;
  const c = propCell(p);
  return surfaceHeightPx(r, c.cx, c.cy, ext);
}

/**
 * The card of one prop: four corners as the camera sees them, and the art rect. `flip` mirrors
 * the art as `placedSprite` does (the left edge shows the art's right column).
 */
export function propCard(
  p: PlacedProp,
  rest: PropRest,
  hpx: number,
  e: Extents,
): { p: [V3, V3, V3, V3]; u0: number; v0: number; u1: number; v1: number } {
  const [x, yb, zb] = propTo3D(p, rest, hpx);
  const w = (e.c1 - e.c0 + 1) / 32;
  const h = (e.r1 - e.r0 + 1) / 32;
  const l = x - w / 2;
  const rr = x + w / 2;
  const top = yb + h;
  return {
    p: [
      [l, top, zb],
      [rr, top, zb],
      [rr, yb, zb],
      [l, yb, zb],
    ],
    // u runs along p0→p1: a flipped prop shows its art's right column on the left edge
    u0: p.f ? e.c1 + 1 : e.c0,
    u1: p.f ? e.c0 : e.c1 + 1,
    v0: e.r0,
    v1: e.r1 + 1,
  };
}

/**
 * Faces of the given props (all of `props` unless `skip` names some): one card each, lit, with
 * the cell of its base point. `rest` is `resolveProps` of the same list.
 */
export function propFaces(
  map: WorldMap,
  props: readonly PlacedProp[],
  rest: readonly PropRest[],
  ext: readonly Extents[],
  skip?: ReadonlySet<string>,
): PropFace[] {
  const r = mapReader(map);
  const out: PropFace[] = [];
  props.forEach((p, i) => {
    if (skip?.has(p.id)) return;
    const idx = indexByName.get(p.t);
    const e = idx === undefined ? undefined : ext[idx];
    if (!e || e.r1 < 0) return;
    const card = propCard(p, rest[i]!, baseHeightPx(r, p, rest[i]!, ext), e);
    const c = propCell(p);
    out.push({
      prop: p.id,
      p: card.p,
      tile: idx!,
      u0: card.u0,
      v0: card.v0,
      u1: card.u1,
      v1: card.v1,
      shade: 0,
      kind: 'card',
      cx: c.cx,
      cy: c.cy,
    });
  });
  return out;
}

/** The corners of a prop's card, for outlines (build mode). */
export function propQuad(
  map: WorldMap,
  p: PlacedProp,
  rest: PropRest,
  ext: readonly Extents[],
): [V3, V3, V3, V3] | null {
  const idx = indexByName.get(p.t);
  const e = idx === undefined ? undefined : ext[idx];
  if (!e || e.r1 < 0) return null;
  return propCard(p, rest, baseHeightPx(mapReader(map), p, rest, ext), e).p;
}
