/**
 * Click-to-move / "go to" navigation (P8.1, P8.4): A* on the tile grid in the
 * current region; routes through teleporters to reach another region.
 */
import {
  cellOf,
  cellPos,
  findPath,
  nearestWalkable,
  regionAt,
  type Cell,
  type WorldMap,
} from '@agora/shared';

export interface NavGoal {
  /** target cell (feet) */
  cell: Cell;
  /** sit on arrival (chair cell) */
  sit?: boolean;
  /** called on arrival */
  onArrive?: () => void;
  /** stop this many tiles short (go to a person) */
  stopShort?: number;
}

export class Navigator {
  path: Cell[] = [];
  goal: NavGoal | null = null;
  /** waiting for a teleport we requested */
  pendingTeleport: string | null = null;
  /** teleport requested, waiting for the server to move us */
  awaiting = 0;

  constructor(
    private map: WorldMap,
    private blocked: (x: number, y: number) => boolean,
    private teleport: (to: string) => void,
  ) {}

  cancel() {
    this.path = [];
    this.goal = null;
    this.pendingTeleport = null;
    this.awaiting = 0;
  }

  get active() {
    return !!this.goal;
  }

  /** Plan to `goal` from feet position (x, y). Returns false if unreachable. */
  go(x: number, y: number, goal: NavGoal): boolean {
    this.goal = goal;
    this.pendingTeleport = null;
    return this.plan(x, y);
  }

  private plan(x: number, y: number): boolean {
    const goal = this.goal!;
    const here = regionAt(this.map, x, y)?.id;
    const target = cellPos(this.map, goal.cell);
    const there = regionAt(this.map, target.x, target.y)?.id;
    let dest = goal.cell;
    if (here && there && here !== there) {
      // route to a teleporter in this region (prefer one aimed at the target region)
      const pads = this.map.zones.filter((z) => z.kind === 'portal' && z.region === here);
      const pad = pads.find((z) => z.props.to === there) ?? pads[0];
      if (!pad) return this.fail();
      dest = cellOf(this.map, pad.x + 16, pad.y + 26);
      this.pendingTeleport = there;
    } else this.pendingTeleport = null;
    const walk =
      nearestWalkable(this.map, dest, this.pendingTeleport ? undefined : this.blocked) ?? dest;
    const path = findPath(this.map, cellOf(this.map, x, y), walk, this.blocked);
    if (!path) return this.fail();
    if (!this.pendingTeleport && goal.stopShort)
      path.splice(Math.max(0, path.length - goal.stopShort));
    this.path = path;
    return true;
  }

  private fail() {
    this.cancel();
    return false;
  }

  /** After a teleport landed: continue to the original goal. */
  afterTeleport(x: number, y: number) {
    if (!this.goal) return;
    this.pendingTeleport = null;
    this.awaiting = 0;
    this.plan(x, y);
  }

  /** Distance (px) to the current waypoint, Infinity when none. */
  remaining(x: number, y: number): number {
    const c = this.path[0];
    if (!c) return Infinity;
    const p = cellPos(this.map, c);
    return Math.hypot(p.x - x, p.y - y);
  }

  /** Input vector toward the next waypoint (or [0,0] when done). */
  steer(x: number, y: number): [number, number] {
    if (!this.goal) return [0, 0];
    if (this.awaiting) {
      if (performance.now() - this.awaiting > 3000) this.cancel();
      return [0, 0];
    }
    while (this.path.length) {
      const p = cellPos(this.map, this.path[0]!);
      const dx = p.x - x;
      const dy = p.y - y;
      if (Math.hypot(dx, dy) > 2) return [dx, dy];
      this.path.shift();
    }
    if (this.pendingTeleport) {
      const to = this.pendingTeleport;
      this.pendingTeleport = null;
      this.path = [];
      this.awaiting = performance.now();
      this.teleport(to);
      return [0, 0];
    }
    const g = this.goal;
    this.goal = null;
    g.onArrive?.();
    return [0, 0];
  }
}
