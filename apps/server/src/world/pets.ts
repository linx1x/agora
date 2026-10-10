import {
  ACTIVITY,
  PET_REST_MAX_MS,
  PET_REST_MIN_MS,
  PET_SPEED_PX,
  PET_PATH_NODES,
  PET_SPOT_KINDS,
  cellPos,
  chooseOption,
  collides,
  defaultSpawn,
  findPath,
  freshNeeds,
  nearestFree,
  petCell,
  petSpots,
  planWander,
  stepAlong,
  tickNeeds,
  weightsFor,
  zoneAt,
  type Cell,
  type PetCoat,
  type PetNeeds,
  type PetOption,
  type PetSpot,
  type PetSpotKind,
  type PetState,
  type PetWeights,
  type WorldMap,
} from '@agora/shared';

/** What a cat needs to know about the room it lives in. */
export interface PetHost {
  map(): WorldMap;
  /** Bumped by every accepted map edit; spots are searched again when it changes. */
  rev(): number;
  /**
   * May this cat stand at (x, y) as far as desk pods go? The room answers with the same
   * `podOpenAt` an avatar is held to (office cat = a guest, nothing admitted).
   */
  podOpen(x: number, y: number): boolean;
}

/** Spots weighed per kind at each decision (the nearest ones). */
const NEAREST = 3;
/** Cooldowns (ms): a spot just used, a spot nothing could reach. */
const USED_COOLDOWN_MS = 90_000;
const UNREACHABLE_COOLDOWN_MS = 30_000;
/** How long the stretch lasts after getting up (ms), and the pause after it. */
const STRETCH_MS = 1000;
/** Time before a cell visited is forgotten, for exploring (ms). */
const FORGET_MS = 10 * 60_000;

type Mode = 'idle' | 'walk' | 'hop' | 'act' | 'stretch';

/**
 * The office cat (ADR-040, ADR-041): one per space, no owner, gone when the room unloads. It lives
 * in the room's own list, never in `players`, so it cannot appear in `placed()`, links, peers,
 * zone member lists or the people list.
 *
 * Its day is a loop: it gets thirsty, tired and curious over time (shared `tickNeeds`), weighs
 * the nearest places that answer a need against wandering (`chooseOption`: need × weight /
 * (1 + distance) + a little jitter), walks there along the same paths and pods as an avatar,
 * does its thing for a while, stretches and starts again. Sofas and desk tops are climbed onto
 * ("perched"); the cat then sits inside a solid cell until it hops back down.
 */
export class OfficeCat {
  state: PetState;
  needs: PetNeeds = freshNeeds();
  readonly weights: PetWeights;
  private path: Cell[] = [];
  private mode: Mode = 'idle';
  private restUntil = 0;
  private actUntil = 0;
  private last = 0;
  private sent = '';
  /** the spot being walked to or used */
  private spot: PetSpot | null = null;
  /** where a hop is heading (onto the spot, or back to the floor) */
  private hopTo: { x: number; y: number } | null = null;
  private perchedNow = false;
  private cooldown = new Map<string, number>();
  private visited = new Map<string, number>();
  private cache: { rev: number; spots: PetSpot[] } | null = null;

  constructor(
    private host: PetHost,
    private rng: () => number = Math.random,
    coat: PetCoat = 'ginger',
    id = 'cat:office',
  ) {
    const map = host.map();
    const s = defaultSpawn(map);
    const pos = nearestFree(map, s.x, s.y);
    this.state = { id, kind: 'office', x: pos.x, y: pos.y, d: 'down', a: 'sit', coat };
    this.weights = weightsFor(Math.floor(rng() * 2 ** 32));
  }

  /** On top of a sofa or a desk (inside a solid cell), or hopping to or from it. */
  get perched() {
    return this.perchedNow;
  }

  /** Cells the cat may not step on: walls (by the avatar collision rule) and pods it may not enter. */
  private walkable = (x: number, y: number) =>
    !collides(this.host.map(), x, y) && this.host.podOpen(x, y);

  private spots(): PetSpot[] {
    const rev = this.host.rev();
    if (this.cache?.rev !== rev) this.cache = { rev, spots: petSpots(this.host.map()) };
    return this.cache.spots;
  }

  /** Advance the cat to `now` (ms). Returns true when what browsers see changed. */
  tick(now: number): boolean {
    const dt = this.last ? Math.min((now - this.last) / 1000, 0.25) : 0;
    this.last = now;
    const map = this.host.map();
    const s = this.state;

    // The room under the cat changed (a wall went up, a pod was locked, the sofa was removed).
    if (this.perchedNow) {
      const here = this.spot && this.spots().some((p) => p.key === this.spot!.key);
      if (!here || !this.host.podOpen(s.x, s.y)) this.evict();
    } else if (!this.walkable(s.x, s.y)) this.evict();

    const act = this.mode === 'act' && this.spot ? ACTIVITY[this.spot.kind].relief : {};
    this.needs = tickNeeds(this.needs, dt, this.mode === 'walk' ? 'walk' : 'rest', act);

    switch (this.mode) {
      case 'walk': {
        const r = stepAlong(map, s, this.path, dt, this.walkable);
        s.x = r.x;
        s.y = r.y;
        if (r.d) s.d = r.d;
        this.visit(now);
        if (r.stopped) {
          this.giveUp(now);
        } else if (!this.path.length) {
          if (this.spot) this.arrive(now);
          else this.rest(now);
        } else s.a = 'walk';
        break;
      }
      case 'hop':
        this.hop(dt, now);
        break;
      case 'act':
        if (now >= this.actUntil) this.finishAct(now);
        break;
      case 'stretch':
        if (now >= this.restUntil) this.rest(now, PET_REST_MIN_MS / 2, PET_REST_MIN_MS);
        break;
      default:
        if (now >= this.restUntil) this.decide(now);
    }
    return this.dirty();
  }

  /** Remember where the cat has been, to explore somewhere new next. */
  private visit(now: number) {
    const c = petCell(this.host.map(), this.state);
    this.visited.set(`${c.cx},${c.cy}`, now);
  }

  private rest(now: number, min = PET_REST_MIN_MS, max = PET_REST_MAX_MS) {
    this.mode = 'idle';
    this.spot = null;
    this.path = [];
    this.state.a = 'sit';
    this.restUntil = now + min + this.rng() * (max - min);
  }

  /** The nearest few spots of each kind that are not cooling down and that the cat may stand at. */
  private candidates(now: number): PetOption[] {
    const map = this.host.map();
    const me = petCell(map, this.state);
    const byKind = new Map<PetSpotKind, { spot: PetSpot; d: number }[]>();
    for (const sp of this.spots()) {
      if ((this.cooldown.get(sp.key) ?? 0) > now) continue;
      const f = cellPos(map, sp.from);
      if (!this.walkable(f.x, f.y) || !this.host.podOpen(sp.x, sp.y)) continue;
      const d = Math.abs(sp.from.cx - me.cx) + Math.abs(sp.from.cy - me.cy);
      const list = byKind.get(sp.kind) ?? [];
      list.push({ spot: sp, d });
      byKind.set(sp.kind, list);
    }
    const out: PetOption[] = [];
    for (const kind of PET_SPOT_KINDS) {
      const list = (byKind.get(kind) ?? []).sort((a, b) => a.d - b.d).slice(0, NEAREST);
      for (const { spot, d } of list) out.push({ kind, spot, dist: d });
    }
    return out;
  }

  private decide(now: number) {
    const map = this.host.map();
    const me = petCell(map, this.state);
    const options: PetOption[] = [
      ...this.candidates(now),
      { kind: 'wander', dist: 0 },
      { kind: 'explore', dist: 3 },
    ];
    // A few tries: a spot that cannot be reached cools down and the next best is weighed.
    for (let i = 0; i < 4; i++) {
      const pick = chooseOption(this.needs, this.weights, options, this.rng);
      if (!pick) break;
      options.splice(options.indexOf(pick), 1);
      if (!('spot' in pick)) {
        const path = planWander(
          map,
          me,
          this.rng,
          (x, y) => !this.walkable(x, y),
          pick.kind === 'explore' ? 10 : 6,
          pick.kind === 'explore'
            ? (c) => {
                const t = this.visited.get(`${c.cx},${c.cy}`);
                return t === undefined || now - t > FORGET_MS ? 0 : t;
              }
            : undefined,
        );
        if (path) return this.go(path, null);
        continue;
      }
      const sp = pick.spot;
      const here = me.cx === sp.from.cx && me.cy === sp.from.cy;
      const path = here
        ? []
        : findPath(map, me, sp.from, (x, y) => !this.walkable(x, y), PET_PATH_NODES);
      if (path) {
        this.cooldown.set(sp.key, now + USED_COOLDOWN_MS);
        return this.go(path, sp, now);
      }
      this.cooldown.set(sp.key, now + UNREACHABLE_COOLDOWN_MS);
    }
    this.rest(now);
  }

  private go(path: Cell[], spot: PetSpot | null, now = 0) {
    this.path = path;
    this.spot = spot;
    this.mode = 'walk';
    this.state.a = 'walk';
    if (!path.length && spot) this.arrive(now);
  }

  /** The walk ended (or was blocked): drop the plan. */
  private giveUp(now: number) {
    if (this.spot) this.cooldown.set(this.spot.key, now + UNREACHABLE_COOLDOWN_MS);
    this.rest(now);
  }

  /** Standing at the spot's approach cell: hop onto it (perch) or settle right there. */
  private arrive(now: number) {
    const sp = this.spot!;
    const s = this.state;
    this.path = [];
    s.d = sp.face;
    if (sp.perch || sp.x !== cellPos(this.host.map(), sp.from).x) {
      this.mode = 'hop';
      this.perchedNow = sp.perch;
      this.hopTo = { x: sp.x, y: sp.y };
      s.a = 'walk';
    } else this.begin(now);
  }

  /** Move toward the hop target at walking speed; start the activity when there. */
  private hop(dt: number, now: number) {
    const s = this.state;
    const t = this.hopTo!;
    const dx = t.x - s.x;
    const dy = t.y - s.y;
    const dist = Math.hypot(dx, dy);
    const step = PET_SPEED_PX * dt;
    if (dist <= step) {
      s.x = t.x;
      s.y = t.y;
      this.hopTo = null;
      if (this.spot && !this.actDone) this.begin(now);
      else this.afterHopDown(now);
    } else {
      s.x += (dx / dist) * step;
      s.y += (dy / dist) * step;
    }
  }

  /** True once the activity is over and the cat is hopping back to the floor. */
  private actDone = false;

  private begin(now: number) {
    const sp = this.spot!;
    const a = ACTIVITY[sp.kind];
    this.mode = 'act';
    this.actDone = false;
    this.state.a = a.anim;
    this.state.d = sp.face;
    this.actUntil = now + (a.seconds[0] + this.rng() * (a.seconds[1] - a.seconds[0])) * 1000;
  }

  private finishAct(now: number) {
    const sp = this.spot!;
    this.actDone = true;
    if (this.perchedNow) {
      this.mode = 'hop';
      this.hopTo = cellPos(this.host.map(), sp.from);
      this.state.a = 'walk';
    } else this.afterHopDown(now);
  }

  private afterHopDown(now: number) {
    this.perchedNow = false;
    this.actDone = false;
    this.spot = null;
    this.mode = 'stretch';
    this.state.a = 'stretch';
    this.restUntil = now + STRETCH_MS;
  }

  /**
   * Put the cat on the nearest place it may stand: the entrance of the pod it is in when that
   * pod closed, the floor beside the sofa or desk it was on, else the nearest free cell.
   * Done within one tick of the change.
   */
  evict() {
    const map = this.host.map();
    const s = this.state;
    const pod = zoneAt(map, s.x, s.y);
    const desk = pod?.kind === 'desk' ? map.desks.find((d) => d.id === pod.id) : undefined;
    const base = desk ? cellPos(map, desk.entrance) : this.spot ? cellPos(map, this.spot.from) : s;
    let to = nearestFree(map, base.x, base.y);
    for (let r = 1; r < 8 && !this.walkable(to.x, to.y); r++)
      to = nearestFree(map, base.x + r * 24, base.y + r * 24);
    s.x = to.x;
    s.y = to.y;
    this.perchedNow = false;
    this.hopTo = null;
    this.actDone = false;
    this.rest(this.last);
  }

  /** Did what browsers see change since the last call? */
  private dirty(): boolean {
    const s = this.state;
    const key = `${Math.round(s.x * 10)}|${Math.round(s.y * 10)}|${s.d}|${s.a}|${s.coat}|${s.name ?? ''}`;
    if (key === this.sent) return false;
    this.sent = key;
    return true;
  }

  /** The cat as a newly joined browser needs it. */
  snapshot(): PetState {
    const s = this.state;
    return { ...s, x: Math.round(s.x * 10) / 10, y: Math.round(s.y * 10) / 10 };
  }
}
