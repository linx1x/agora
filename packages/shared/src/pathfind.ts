import { collides, type Cell, type WorldMap } from './map';

/**
 * A* on the tile grid (8-way, no corner cutting). A cell is walkable when an
 * avatar standing at its centre does not collide and `blocked` allows it.
 * Returns the list of cells from start (exclusive) to goal (inclusive), or null.
 */
export function findPath(
  map: WorldMap,
  start: Cell,
  goal: Cell,
  blocked?: (x: number, y: number) => boolean,
  maxNodes = 20000,
): Cell[] | null {
  const W = map.width;
  const walk = (cx: number, cy: number) => {
    if (cx < 0 || cy < 0 || cx >= W || cy >= map.height) return false;
    const x = cx * map.tile + map.tile / 2;
    const y = cy * map.tile + map.tile - 6;
    return !collides(map, x, y) && !(blocked?.(x, y) ?? false);
  };
  if (!walk(goal.cx, goal.cy)) return null;
  const key = (cx: number, cy: number) => cy * W + cx;
  const g = new Map<number, number>();
  const came = new Map<number, number>();
  const open: { k: number; f: number }[] = [];
  const h = (cx: number, cy: number) => {
    const dx = Math.abs(cx - goal.cx);
    const dy = Math.abs(cy - goal.cy);
    return dx + dy + (Math.SQRT2 - 2) * Math.min(dx, dy);
  };
  const sk = key(start.cx, start.cy);
  g.set(sk, 0);
  open.push({ k: sk, f: h(start.cx, start.cy) });
  const closed = new Set<number>();
  let visited = 0;
  while (open.length) {
    // binary-heap-free: small maps, pick min linearly from a bounded open list
    let bi = 0;
    for (let i = 1; i < open.length; i++) if (open[i]!.f < open[bi]!.f) bi = i;
    const cur = open.splice(bi, 1)[0]!;
    if (closed.has(cur.k)) continue;
    closed.add(cur.k);
    if (++visited > maxNodes) return null;
    const cx = cur.k % W;
    const cy = Math.floor(cur.k / W);
    if (cx === goal.cx && cy === goal.cy) {
      const out: Cell[] = [];
      let k: number | undefined = cur.k;
      while (k !== undefined && k !== sk) {
        out.push({ cx: k % W, cy: Math.floor(k / W) });
        k = came.get(k);
      }
      return out.reverse();
    }
    for (let dy = -1; dy <= 1; dy++)
      for (let dx = -1; dx <= 1; dx++) {
        if (!dx && !dy) continue;
        const nx = cx + dx;
        const ny = cy + dy;
        if (!walk(nx, ny)) continue;
        if (dx && dy && (!walk(cx + dx, cy) || !walk(cx, cy + dy))) continue;
        const nk = key(nx, ny);
        if (closed.has(nk)) continue;
        const ng = g.get(cur.k)! + (dx && dy ? Math.SQRT2 : 1);
        if (ng < (g.get(nk) ?? Infinity)) {
          g.set(nk, ng);
          came.set(nk, cur.k);
          open.push({ k: nk, f: ng + h(nx, ny) });
        }
      }
  }
  return null;
}

/** Nearest walkable cell to `c` (spiral search), for clicks on furniture. */
export function nearestWalkable(
  map: WorldMap,
  c: Cell,
  blocked?: (x: number, y: number) => boolean,
): Cell | null {
  for (let r = 0; r < 6; r++)
    for (let dy = -r; dy <= r; dy++)
      for (let dx = -r; dx <= r; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
        const cx = c.cx + dx;
        const cy = c.cy + dy;
        const x = cx * map.tile + map.tile / 2;
        const y = cy * map.tile + map.tile - 6;
        if (
          cx >= 0 &&
          cy >= 0 &&
          cx < map.width &&
          cy < map.height &&
          !collides(map, x, y) &&
          !(blocked?.(x, y) ?? false)
        )
          return { cx, cy };
      }
  return null;
}
