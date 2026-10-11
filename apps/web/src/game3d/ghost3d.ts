/**
 * The build preview of the 2.5D view (P16.13, ADR-039): what the server would draw if the edit
 * were accepted, as 3D faces. The server's own plan (`planEdit`, so tree tops, wall faces and
 * props that leave with their desk are included) is applied to a copy of the map; the cells whose
 * look changes (their tile, or their blend key, within BLEND_RADIUS like the flat preview) are
 * rebuilt with `buildScene` and drawn with their plain tiles, from the region's atlas. Pure.
 */
import {
  BLEND_RADIUS,
  applyChanges,
  cellChanges,
  furnitureKey,
  groundKey,
  mapReader,
  planEdit,
  resolveProps,
  tileNameAt,
  type Cell,
  type MapChange,
  type WorldMap,
} from '@agora/shared';
import { propFaces, type PropFace } from './propFaces';
import { buildScene, type Extents, type Face3D } from './scene';

export interface Ghost {
  /** false: the server would refuse the edit (the ghost shows what it would have done, in red) */
  ok: boolean;
  /** the refusal reason when `ok` is false */
  reason?: string;
  /** cells the edit changes, and their neighbours whose look changes (their live faces step aside) */
  cells: Cell[];
  /** the cells' faces in the new look (plain tiles: no blend keys) */
  faces: Face3D[];
  /** props after the edit that the edit touches, drawn where they would be */
  props: PropFace[];
  /** props whose live card steps aside while the ghost shows them */
  movedIds: Set<string>;
}

/** A copy of a map that `applyChanges` can write to (the layers, collision and props are copied). */
export function copyMap(map: WorldMap): WorldMap {
  const layers: Record<string, number[]> = {};
  for (const k of Object.keys(map.layers)) layers[k] = map.layers[k]!.slice();
  return {
    ...map,
    layers,
    solid: map.solid.slice(),
    occlude: map.occlude.slice(),
    sit: map.sit.slice(),
    props: map.props.slice(),
  };
}

const LAYERS = ['floor', 'walls', 'furniture', 'above'] as const;

/** The preview of `changes` on `map` (not mutated). */
export function ghostOf(map: WorldMap, changes: MapChange[], ext: readonly Extents[]): Ghost {
  const plan = planEdit(map, changes);
  const applied = plan.ok ? plan.changes : changes;
  const hyp = copyMap(map);
  applyChanges(hyp, applied);
  const W = map.width;
  const seeds = cellChanges(applied).map((c) => c.y * W + c.x);
  const live = mapReader(map);
  const after = mapReader(hyp);
  const changed = new Set<number>(seeds);
  const seen = new Set<number>();
  for (const s of seeds) {
    const sx = s % W;
    const sy = (s - sx) / W;
    for (let dy = -BLEND_RADIUS; dy <= BLEND_RADIUS; dy++)
      for (let dx = -BLEND_RADIUS; dx <= BLEND_RADIUS; dx++) {
        const x = sx + dx;
        const y = sy + dy;
        if (x < 0 || y < 0 || x >= map.width || y >= map.height) continue;
        const i = y * W + x;
        if (seen.has(i) || changed.has(i)) continue;
        seen.add(i);
        if (
          groundKey(live, x, y) !== groundKey(after, x, y) ||
          furnitureKey(live, x, y) !== furnitureKey(after, x, y) ||
          LAYERS.some((l) => tileNameAt(map, l, x, y) !== tileNameAt(hyp, l, x, y))
        )
          changed.add(i);
      }
  }
  const cells: Cell[] = [...changed].map((i) => ({ cx: i % W, cy: (i - (i % W)) / W }));
  const faces: Face3D[] = [];
  if (cells.length) {
    // the window: the changed cells and the ring around them, so every changed cell sees its neighbours
    const x0 = Math.max(0, Math.min(...cells.map((c) => c.cx)) - 1);
    const y0 = Math.max(0, Math.min(...cells.map((c) => c.cy)) - 1);
    const x1 = Math.min(map.width - 1, Math.max(...cells.map((c) => c.cx)) + 1);
    const y1 = Math.min(map.height - 1, Math.max(...cells.map((c) => c.cy)) + 1);
    const scene = buildScene(hyp, { x: x0, y: y0, w: x1 - x0 + 1, h: y1 - y0 + 1 }, ext);
    for (const f of scene.faces) {
      if (!changed.has(f.cy * W + f.cx)) continue;
      const plain: Face3D = { ...f };
      delete plain.blend;
      faces.push(plain);
    }
  }
  // props: the ones the edit touches, where they would be after it
  const movedIds = new Set<string>();
  for (const c of applied) if (c.l === 'prop') movedIds.add(c.id);
  const rest = resolveProps(after, hyp.props);
  const props = movedIds.size
    ? propFaces(hyp, hyp.props, rest, ext).filter((f) => movedIds.has(f.prop))
    : [];
  return {
    ok: plan.ok,
    ...(plan.ok ? {} : { reason: plan.reason }),
    cells,
    faces,
    props,
    movedIds,
  };
}
