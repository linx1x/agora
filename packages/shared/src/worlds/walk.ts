/**
 * Walking in personal worlds (ADR-053): the shared rules the server enforces and the client
 * predicts with. Level changes, solid and liquid cells, a feet-box collision like the office's
 * (FEET_W x FEET_H, anchored at the feet), move validation, and A* across chunks with a node cap.
 *
 * Only + - * / and comparisons are used for the rules, and the diagonal cost is a literal, so the
 * same inputs give the same route on the server and in the browser.
 */
import { FEET_H, FEET_W, SPEED_PX, TILE } from '../constants';
import { WORLD_COORD_LIMIT } from './constants';
import type { WorldCell, WorldTerrain } from './cells';

/** Cost of a diagonal step, sqrt(2) as a literal (ADR-053: no transcendental results in rules). */
const DIAGONAL = 1.4142135623730951;

/** A cell coordinate (not pixels). */
export interface GridCell {
  readonly cx: number;
  readonly cy: number;
}

/**
 * Whether one step between adjacent cells is allowed: the target must be walkable, and the level
 * may change by at most 1, or by 2 when either cell is a ramp (stairs). A drop of 2 or more is a
 * cliff, and water and solid decor are walls.
 */
export function canStep(from: WorldCell, to: WorldCell): boolean {
  if (!to.walkable) return false;
  const d = Math.abs(to.level - from.level);
  if (d <= 1) return true;
  return d === 2 && (from.ramp || to.ramp);
}

/** True when a point is outside the world's coordinate range (cells +-2^20, see ADR-053). */
export function outOfWorld(x: number, y: number): boolean {
  const limit = WORLD_COORD_LIMIT * TILE;
  return !(Math.abs(x) < limit && Math.abs(y) < limit);
}

/**
 * Collision of a walker whose feet are at (x, y): the feet box (FEET_W wide, FEET_H tall, bottom
 * centre at the feet) must not overlap a non-walkable cell, and must be inside the world.
 */
export function worldCollides(world: WorldTerrain, x: number, y: number): boolean {
  if (!Number.isFinite(x) || !Number.isFinite(y) || outOfWorld(x, y)) return true;
  const l = x - FEET_W / 2;
  const r = x + FEET_W / 2 - 0.001;
  const t = y - FEET_H;
  const b = y - 0.001;
  for (let cy = Math.floor(t / TILE); cy <= Math.floor(b / TILE); cy++) {
    for (let cx = Math.floor(l / TILE); cx <= Math.floor(r / TILE); cx++) {
      if (!world.cellAt(cx, cy).walkable) return true;
    }
  }
  return false;
}

/** The cell a walker standing with feet at (x, y) is on. */
export function feetCell(x: number, y: number): GridCell {
  return { cx: Math.floor(x / TILE), cy: Math.floor(y / TILE) };
}

/** Sample spacing (px) along a movement segment. Half the feet box width keeps it honest. */
const SAMPLE_PX = 4;

/**
 * True when the straight segment from one feet position to another stays clear and every change
 * of feet cell is a legal step. Sampled every SAMPLE_PX, so sliding along walls is not blocked.
 */
export function segmentWalkable(
  world: WorldTerrain,
  from: { x: number; y: number },
  to: { x: number; y: number },
): 'ok' | 'collision' | 'step' {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const n = Math.max(1, Math.ceil(Math.max(Math.abs(dx), Math.abs(dy)) / SAMPLE_PX));
  let prev = feetCell(from.x, from.y);
  let prevCell = world.cellAt(prev.cx, prev.cy);
  for (let i = 1; i <= n; i++) {
    const x = from.x + (dx * i) / n;
    const y = from.y + (dy * i) / n;
    if (worldCollides(world, x, y)) return 'collision';
    const here = feetCell(x, y);
    if (here.cx === prev.cx && here.cy === prev.cy) continue;
    if (Math.abs(here.cx - prev.cx) > 1 || Math.abs(here.cy - prev.cy) > 1) return 'step';
    const cell = world.cellAt(here.cx, here.cy);
    if (!canStep(prevCell, cell)) return 'step';
    prev = here;
    prevCell = cell;
  }
  return 'ok';
}

export type WorldMoveVerdict = { ok: true } | { ok: false; reason: 'bounds' | 'speed' | 'collision' | 'step' };

/**
 * Server-side check of a client-predicted move (the rule behind `world:move`, P17.9). Speed uses
 * the office's allowance, compared on squares so no root is needed.
 */
export function validateWorldMove(
  world: WorldTerrain,
  from: { x: number; y: number },
  to: { x: number; y: number },
  elapsedMs: number,
): WorldMoveVerdict {
  if (!Number.isFinite(to.x) || !Number.isFinite(to.y) || outOfWorld(to.x, to.y)) {
    return { ok: false, reason: 'bounds' };
  }
  const dt = Math.min(Math.max(elapsedMs, 0), 1000) / 1000;
  const allowed = SPEED_PX * dt * 1.35 + 10;
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  if (dx * dx + dy * dy > allowed * allowed) return { ok: false, reason: 'speed' };
  if (worldCollides(world, to.x, to.y)) return { ok: false, reason: 'collision' };
  const seg = segmentWalkable(world, from, to);
  if (seg !== 'ok') return { ok: false, reason: seg === 'step' ? 'step' : 'collision' };
  return { ok: true };
}

/**
 * One client-side prediction step of a walker (P17.14). The move is cut per axis like the office's
 * `stepMove`: the x part is kept when the feet stay clear and every cell change is a legal step,
 * then the y part the same way. The server re-checks every sent move with `validateWorldMove`, so
 * prediction only has to match the server's rules, never be trusted.
 */
export function stepWorld(
  world: WorldTerrain,
  x: number,
  y: number,
  ix: number,
  iy: number,
  dtSec: number,
): { x: number; y: number } {
  const len = Math.hypot(ix, iy);
  if (!len) return { x, y };
  const d = SPEED_PX * Math.min(Math.max(dtSec, 0), 0.1);
  const dx = (ix / len) * d;
  const dy = (iy / len) * d;
  const free = (ax: number, ay: number, bx: number, by: number) =>
    !worldCollides(world, bx, by) && segmentWalkable(world, { x: ax, y: ay }, { x: bx, y: by }) === 'ok';
  let nx = x;
  let ny = y;
  if (dx !== 0 && free(x, y, x + dx, y)) nx = x + dx;
  if (dy !== 0 && free(nx, y, nx, y + dy)) ny = y + dy;
  return { x: nx, y: ny };
}

/** Binary min-heap on f (ties on h, then insertion order), for the open list. */
class OpenList {
  private readonly items: { f: number; h: number; seq: number; key: number; cx: number; cy: number }[] = [];
  private seq = 0;

  get size(): number {
    return this.items.length;
  }

  push(f: number, h: number, key: number, cx: number, cy: number): void {
    this.items.push({ f, h, seq: this.seq++, key, cx, cy });
    let i = this.items.length - 1;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (!this.less(i, p)) break;
      this.swap(i, p);
      i = p;
    }
  }

  pop(): { key: number; cx: number; cy: number } | undefined {
    const top = this.items[0];
    const last = this.items.pop();
    if (!top || !last) return undefined;
    if (this.items.length > 0) {
      this.items[0] = last;
      let i = 0;
      for (;;) {
        const l = 2 * i + 1;
        const r = l + 1;
        let m = i;
        if (l < this.items.length && this.less(l, m)) m = l;
        if (r < this.items.length && this.less(r, m)) m = r;
        if (m === i) break;
        this.swap(i, m);
        i = m;
      }
    }
    return { key: top.key, cx: top.cx, cy: top.cy };
  }

  private less(a: number, b: number): boolean {
    const x = this.items[a];
    const y = this.items[b];
    if (!x || !y) return false;
    if (x.f !== y.f) return x.f < y.f;
    if (x.h !== y.h) return x.h < y.h;
    return x.seq < y.seq;
  }

  private swap(a: number, b: number): void {
    const x = this.items[a];
    const y = this.items[b];
    if (!x || !y) return;
    this.items[a] = y;
    this.items[b] = x;
  }
}

const KEY_OFFSET = 1 << 21;
const KEY_STRIDE = 1 << 22;
function keyOf(cx: number, cy: number): number {
  return (cx + KEY_OFFSET) * KEY_STRIDE + (cy + KEY_OFFSET);
}

const STEPS: readonly (readonly [number, number])[] = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
  [1, 1],
  [1, -1],
  [-1, 1],
  [-1, -1],
];

/**
 * A* over cells, 8-way, no corner cutting (a diagonal needs both orthogonal cells walkable).
 * Returns the cells from the start (exclusive) to the goal (inclusive), [] when they are the same,
 * or null when there is no route or more than `maxNodes` cells were expanded.
 */
export function findWorldPath(
  world: WorldTerrain,
  start: GridCell,
  goal: GridCell,
  maxNodes = 4000,
): GridCell[] | null {
  if (start.cx === goal.cx && start.cy === goal.cy) return [];
  if (!world.cellAt(goal.cx, goal.cy).walkable || !world.cellAt(start.cx, start.cy).walkable) return null;
  const octile = (cx: number, cy: number) => {
    const dx = Math.abs(cx - goal.cx);
    const dy = Math.abs(cy - goal.cy);
    return dx + dy + (DIAGONAL - 2) * Math.min(dx, dy);
  };
  const best = new Map<number, number>([[keyOf(start.cx, start.cy), 0]]);
  const came = new Map<number, GridCell>();
  const closed = new Set<number>();
  const open = new OpenList();
  open.push(octile(start.cx, start.cy), octile(start.cx, start.cy), keyOf(start.cx, start.cy), start.cx, start.cy);
  let expanded = 0;
  while (open.size > 0) {
    const node = open.pop();
    if (!node) break;
    if (closed.has(node.key)) continue;
    closed.add(node.key);
    if (node.cx === goal.cx && node.cy === goal.cy) return rebuild(came, start, goal);
    expanded++;
    if (expanded > maxNodes) return null;
    const here = world.cellAt(node.cx, node.cy);
    const g = best.get(node.key) ?? 0;
    for (const [dx, dy] of STEPS) {
      const nx = node.cx + dx;
      const ny = node.cy + dy;
      const nk = keyOf(nx, ny);
      if (closed.has(nk)) continue;
      const there = world.cellAt(nx, ny);
      if (!canStep(here, there)) continue;
      if (dx !== 0 && dy !== 0) {
        // stepWorld slides per axis, so the feet may stand in either cell beside the corner before the
        // target: each side must be a legal step from here and to the target
        const sideX = world.cellAt(node.cx + dx, node.cy);
        const sideY = world.cellAt(node.cx, node.cy + dy);
        if (!canStep(here, sideX) || !canStep(here, sideY)) continue;
        if (!canStep(sideX, there) || !canStep(sideY, there)) continue;
      }
      const ng = g + (dx !== 0 && dy !== 0 ? DIAGONAL : 1);
      const old = best.get(nk);
      if (old !== undefined && old <= ng) continue;
      best.set(nk, ng);
      came.set(nk, { cx: node.cx, cy: node.cy });
      const h = octile(nx, ny);
      open.push(ng + h, h, nk, nx, ny);
    }
  }
  return null;
}

function rebuild(came: Map<number, GridCell>, start: GridCell, goal: GridCell): GridCell[] {
  const path: GridCell[] = [{ cx: goal.cx, cy: goal.cy }];
  let at = came.get(keyOf(goal.cx, goal.cy));
  while (at && !(at.cx === start.cx && at.cy === start.cy)) {
    path.push(at);
    at = came.get(keyOf(at.cx, at.cy));
  }
  return path.reverse();
}
