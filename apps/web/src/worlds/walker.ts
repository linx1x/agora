/**
 * My walking in a personal world (P17.14): prediction with the shared rules (`stepWorld`), routes
 * to a clicked cell (`findWorldPath`), and the server's corrections. The client only predicts; the
 * server validates every move it is sent (`validateWorldMove`) and corrects a refused one.
 */
import {
  findWorldPath,
  feetCell,
  stepWorld,
  type Dir,
  type GridCell,
} from '@agora/shared';
import { world as link } from '../net/client';
import { CELL, FEET_DY } from './view2d/math';
import type { WorldSession } from './session';

/** Within this many px of a route point, the walker takes the next one. */
const REACHED_PX = 3;
/** A walker that makes no progress this long (ms) while routing gives up the route. */
const STUCK_MS = 400;

/** The feet point of a walker standing in the middle of a cell. */
export function cellFeet(c: GridCell): { x: number; y: number } {
  return { x: c.cx * CELL + CELL / 2, y: c.cy * CELL + FEET_DY };
}

export class WorldWalker {
  x = 0;
  y = 0;
  d: Dir = 'down';
  moving = false;
  private route: GridCell[] = [];
  private serial = 0;
  private stuckMs = 0;

  constructor(private readonly session: WorldSession) {}

  /** Put me at a point (on arrival, and when the server corrects me). */
  place(x: number, y: number): void {
    this.x = x;
    this.y = y;
    this.route = [];
  }

  /** The cells of the route still to walk (for drawing). */
  get path(): readonly GridCell[] {
    return this.route;
  }

  /**
   * Route to a cell. Returns false when there is no route (a wall, a level cliff, or more cells
   * than the search allows). Standing in the cell already is a route of nothing.
   */
  goTo(cell: GridCell): boolean {
    const terrain = this.session.terrain;
    if (!terrain) return false;
    const path = findWorldPath(terrain, feetCell(this.x, this.y), cell);
    if (path === null) return false;
    this.route = path;
    return true;
  }

  cancel(): void {
    this.route = [];
  }

  /**
   * One frame: take a correction from the server, steer by the keys or along the route, move by
   * the shared step, and send the move (the throttle is in `link.sendMove`).
   */
  step(dtMs: number, keys: readonly [number, number]): void {
    const terrain = this.session.terrain;
    if (!terrain) return;
    const c = this.session.correction;
    if (c && c.serial !== this.serial) {
      this.serial = c.serial;
      this.place(c.x, c.y);
    }
    let [ix, iy] = keys;
    if (ix || iy) this.route = [];
    else if (this.route.length > 0) [ix, iy] = this.steer();

    const moving = ix !== 0 || iy !== 0;
    if (moving) {
      this.d = Math.abs(ix) > Math.abs(iy) ? (ix < 0 ? 'left' : 'right') : iy < 0 ? 'up' : 'down';
      const at = stepWorld(terrain, this.x, this.y, ix, iy, Math.min(dtMs, 100) / 1000);
      const moved = at.x !== this.x || at.y !== this.y;
      this.x = at.x;
      this.y = at.y;
      // a route that cannot be walked (a corner the feet box does not fit) is dropped
      this.stuckMs = moved ? 0 : this.stuckMs + dtMs;
      if (this.stuckMs > STUCK_MS) this.cancel();
    }
    if (moving !== this.moving) {
      this.moving = moving;
      link.sendMove(this.x, this.y, this.d, moving, true);
    } else link.sendMove(this.x, this.y, this.d, moving);
  }

  /** Steer toward the next route point; drop the points already reached. */
  private steer(): [number, number] {
    for (;;) {
      const next = this.route[0];
      if (!next) return [0, 0];
      const at = cellFeet(next);
      const dx = at.x - this.x;
      const dy = at.y - this.y;
      const dist = Math.hypot(dx, dy);
      if (dist > REACHED_PX) return [dx / dist, dy / dist];
      this.route.shift();
    }
  }
}
