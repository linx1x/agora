/**
 * Renderer-neutral world for the spike: the Jungle region of hq.tmj, "me" (keys or click), and bots
 * walking random A* paths with the shared movement code. Positions are map px, as in the app.
 */
import {
  SPEED_PX,
  TILE,
  collides,
  findPath,
  parseMap,
  randomAvatar,
  stepMove,
  type Avatar,
  type Cell,
  type Tmj,
  type WorldMap,
} from '@agora/shared';
import tmjRaw from '../../../packages/maps/hq.tmj?raw';

export type Dir = 'down' | 'left' | 'right' | 'up';
export interface Mob {
  id: string;
  name: string;
  avatar: Avatar;
  x: number;
  y: number;
  dir: Dir;
  moving: boolean;
  /** time of the last left↔right turn (ms), for the card flip */
  flipAt: number;
  path: Cell[];
}

export const map: WorldMap = parseMap(JSON.parse(tmjRaw) as Tmj);
export const REGION = (() => {
  const r = map.regions.find((g) => g.id === 'jungle')!;
  // regions are stored in map px
  return { x: r.x / TILE, y: r.y / TILE, w: r.w / TILE, h: r.h / TILE };
})();

/** Small seeded PRNG so every run and every engine sees the same bots. */
export function rng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const NAMES = ['Zoé', 'Félix', 'Théo', 'Léa', 'Malik', 'Inès', 'Noah', 'Chloé', 'Samuel', 'Rosalie'];

function freeCells(): Cell[] {
  const out: Cell[] = [];
  for (let cy = REGION.y; cy < REGION.y + REGION.h; cy++)
    for (let cx = REGION.x; cx < REGION.x + REGION.w; cx++)
      if (!collides(map, cx * TILE + TILE / 2, cy * TILE + TILE - 6)) out.push({ cx, cy });
  return out;
}

export class Sim {
  me: Mob;
  bots: Mob[] = [];
  private free = freeCells();
  private rand: () => number;
  keys = new Set<string>();
  /** scripted route for the benchmark (cells), consumed by `me` */
  private target: Cell[] = [];

  constructor(bots: number, seed = 7) {
    this.rand = rng(seed);
    const spawn = this.free[Math.floor(this.free.length / 2)]!;
    this.me = this.mob('me', 'Vincent', spawn);
    for (let i = 0; i < bots; i++) {
      const c = this.free[Math.floor(this.rand() * this.free.length)]!;
      this.bots.push(this.mob(`b${i}`, NAMES[i % NAMES.length]! + (i >= NAMES.length ? ` ${1 + Math.floor(i / NAMES.length)}` : ''), c));
    }
  }

  private mob(id: string, name: string, c: Cell): Mob {
    return {
      id,
      name,
      avatar: randomAvatar(this.rand),
      x: c.cx * TILE + TILE / 2,
      y: c.cy * TILE + TILE - 6,
      dir: 'down',
      moving: false,
      flipAt: -1e9,
      path: [],
    };
  }

  all(): Mob[] {
    return [this.me, ...this.bots];
  }

  /** Walk `me` to a floor point (map px) with the shared A*. */
  goTo(px: number, py: number): boolean {
    const goal = { cx: Math.floor(px / TILE), cy: Math.floor(py / TILE) };
    const p = findPath(map, { cx: Math.floor(this.me.x / TILE), cy: Math.floor(this.me.y / TILE) }, goal);
    if (!p) return false;
    this.me.path = p;
    return true;
  }

  /** Benchmark route: visit these cells in order, forever. */
  setRoute(cells: Cell[]) {
    this.target = cells;
  }

  step(dtSec: number, now: number) {
    // me: keys first, then path
    let ix = 0, iy = 0;
    if (this.keys.has('ArrowLeft') || this.keys.has('a')) ix -= 1;
    if (this.keys.has('ArrowRight') || this.keys.has('d')) ix += 1;
    if (this.keys.has('ArrowUp') || this.keys.has('w')) iy -= 1;
    if (this.keys.has('ArrowDown') || this.keys.has('s')) iy += 1;
    if (ix || iy) {
      this.me.path = [];
      this.move(this.me, ix, iy, dtSec, now);
    } else {
      if (!this.me.path.length && this.target.length) {
        const next = this.target.shift()!;
        this.target.push(next);
        const p = findPath(map, { cx: Math.floor(this.me.x / TILE), cy: Math.floor(this.me.y / TILE) }, next);
        if (p) this.me.path = p;
      }
      this.follow(this.me, dtSec, now);
    }
    for (const b of this.bots) {
      if (!b.path.length) {
        if (this.rand() < 0.02) {
          const g = this.free[Math.floor(this.rand() * this.free.length)]!;
          b.path = findPath(map, { cx: Math.floor(b.x / TILE), cy: Math.floor(b.y / TILE) }, g) ?? [];
        }
        b.moving = false;
      }
      this.follow(b, dtSec, now);
    }
  }

  private follow(m: Mob, dt: number, now: number) {
    const c = m.path[0];
    if (!c) {
      m.moving = false;
      return;
    }
    const tx = c.cx * TILE + TILE / 2;
    const ty = c.cy * TILE + TILE - 6;
    const dx = tx - m.x;
    const dy = ty - m.y;
    const d = Math.hypot(dx, dy);
    if (d < SPEED_PX * dt + 0.5) {
      m.x = tx;
      m.y = ty;
      m.path.shift();
      return;
    }
    this.face(m, dx, dy, now);
    m.x += (dx / d) * SPEED_PX * Math.min(dt, 0.1);
    m.y += (dy / d) * SPEED_PX * Math.min(dt, 0.1);
    m.moving = true;
  }

  private move(m: Mob, ix: number, iy: number, dt: number, now: number) {
    const n = stepMove(map, m.x, m.y, ix, iy, dt);
    this.face(m, ix, iy, now);
    m.moving = n.x !== m.x || n.y !== m.y;
    m.x = n.x;
    m.y = n.y;
  }

  private face(m: Mob, dx: number, dy: number, now: number) {
    const d: Dir = Math.abs(dx) > Math.abs(dy) ? (dx < 0 ? 'left' : 'right') : dy < 0 ? 'up' : 'down';
    // card flip when the side changes (left ↔ right), ADR-052
    const side = (x: Dir) => (x === 'left' ? -1 : x === 'right' ? 1 : 0);
    if (side(d) && side(m.dir) && side(d) !== side(m.dir)) m.flipAt = now;
    m.dir = d;
  }
}

/** A loop through the Jungle used by every benchmark run (pods, pond, lounge). */
export const BENCH_ROUTE: Cell[] = [
  { cx: 6, cy: 10 },
  { cx: 20, cy: 9 },
  { cx: 30, cy: 11 },
  { cx: 28, cy: 21 },
  { cx: 14, cy: 23 },
  { cx: 4, cy: 20 },
];
