/**
 * The world's logic, independent of how it is drawn (P16.3, ADR-052): my predicted movement
 * (keys, joystick, click-to-move paths), sitting and standing, server corrections and teleports,
 * the positions everyone is drawn at (`rendered`), and the ~3 Hz work behind the HUD (zones,
 * region, nearest people, the contextual prompt). A renderer (`WorldView`) draws the result and
 * turns pointer input into `clickTo(worldX, worldY)`.
 */
import {
  INTERP_MS,
  NPC_FORBIDDEN,
  NPC_TALK_SLACK_TILES,
  NPC_TALK_TILES,
  SPEED_PX,
  TILE,
  cellOf,
  cellPos,
  chairAt,
  deskPortalId,
  deskSpotAt,
  distTiles,
  distToPod,
  podAllows,
  regionAt,
  stepMove,
  zoneAt,
  type Dir,
  type S2CMsg,
} from '@agora/shared';
import i18n from '../i18n';
import { world } from '../net/client';
import { store, toast } from '../state/store';
import { inputVector, isTyping } from './input';
import { Navigator } from './nav';
import type { WorldView } from './view';

/** Latest drawn positions (map px), read by the media manager, the minimap and the HUD. */
export const rendered = new Map<string, { x: number; y: number }>();

/** Sit-down / stand-up transition (crouch frame), ADR-019. */
export const POSE_MS = 160;

export type Pose = 'stand' | 'sit';

/** Everything a renderer needs to draw one person this frame. */
export interface AvatarState {
  id: string;
  x: number;
  y: number;
  dir: Dir;
  moving: boolean;
  pose: Pose;
  /** when the pose last changed (performance.now), for the crouch transition */
  poseAt: number;
}

type NavRequest = Exclude<NonNullable<ReturnType<typeof store.get>['navRequest']>, { kind: 'act' }>;

export class WorldController {
  readonly me = {
    x: 0,
    y: 0,
    dir: 'up' as Dir,
    moving: false,
    pose: 'stand' as Pose,
    poseAt: 0,
    standUntil: 0,
    idleSince: 0,
    suppressSit: false,
    ready: false,
  };
  readonly nav: Navigator;
  private teleporting = false;
  private lastZoneId: string | null | undefined = undefined;
  private poses = new Map<string, { pose: Pose; at: number }>();
  private unsub: (() => void)[] = [];

  constructor(private view: WorldView) {
    const map = store.get().map!;
    this.nav = new Navigator(
      map,
      (x, y) => this.blocked(x, y),
      (to) => world.send({ t: 'teleport', to }),
    );
    const onKey = (e: KeyboardEvent) => {
      if (isTyping() || e.metaKey || e.ctrlKey || e.altKey || store.get().dialog) return;
      if (e.key === 'x' || e.key === 'X') this.act();
    };
    window.addEventListener('keydown', onKey);
    this.unsub.push(() => window.removeEventListener('keydown', onKey));
    this.unsub.push(world.on((m) => this.onMessage(m)));
    this.unsub.push(
      store.subscribe(() => {
        const st = store.get();
        if (st.locate) {
          const id = st.locate;
          store.set({ locate: null });
          this.locate(id);
        }
        if (st.navRequest) {
          const r = st.navRequest;
          store.set({ navRequest: null });
          if (r.kind === 'act') this.act();
          else this.handleNav(r);
        }
      }),
    );
    this.syncMe();
  }

  destroy() {
    this.unsub.forEach((u) => u());
    this.unsub = [];
  }

  // ───────────────────────────────────────────── messages
  private onMessage(m: S2CMsg) {
    if (m.t === 'welcome') {
      this.me.ready = false;
      this.syncMe();
    } else if (m.t === 'leave') {
      rendered.delete(m.id);
      this.poses.delete(m.id);
    } else if (m.t === 'knock:result' && m.result === 'accepted') toast('knock.accepted');
  }

  private syncMe() {
    const s = store.get();
    if (!s.me) return;
    const buf = world.samples.get(s.me);
    const last = buf?.[buf.length - 1];
    if (last && !this.me.ready)
      Object.assign(this.me, {
        x: last.x,
        y: last.y,
        dir: last.d,
        moving: false,
        pose: last.p,
        ready: true,
      });
  }

  // ───────────────────────────────────────────── build mode (ADR-021)
  /** Build mode takes over: stop walking and tell the server where I stand. */
  enterBuild() {
    this.nav.cancel();
    this.view.drawPath([]);
    this.me.moving = false;
    this.sendMe(true);
  }

  // ───────────────────────────────────────────── movement helpers
  /** Desk pods I may not enter (ADR-017) block my movement like walls. */
  blocked(x: number, y: number): boolean {
    const s = store.get();
    const spot = deskSpotAt(s.map!, x, y);
    if (!spot) return false;
    const mine = rendered.get(s.me ?? '');
    if (mine && deskSpotAt(s.map!, mine.x, mine.y)?.id === spot.id) return false;
    const d = s.desks.find((q) => q.id === spot.id);
    return !podAllows(d, d?.ownerId === s.me, s.admitted.includes(spot.id));
  }

  private sendMe(force = false) {
    world.sendMove(this.me.x, this.me.y, this.me.dir, this.me.moving, force, this.me.pose);
  }

  private sit() {
    const map = store.get().map!;
    const face = chairAt(map, this.me.x, this.me.y);
    if (!face) return;
    const seat = cellPos(map, cellOf(map, this.me.x, this.me.y));
    Object.assign(this.me, {
      x: seat.x,
      y: seat.y,
      dir: face,
      pose: 'sit',
      poseAt: performance.now(),
      moving: false,
    });
    this.sendMe(true);
  }

  private stand(suppress = true) {
    if (this.me.pose !== 'sit') return;
    const now = performance.now();
    Object.assign(this.me, {
      pose: 'stand',
      poseAt: now,
      standUntil: now + POSE_MS,
      suppressSit: suppress,
    });
    this.sendMe(true);
  }

  /** X key (or the touch action button): act on the current prompt. */
  act() {
    const p = store.get().prompt;
    if (!p) return;
    if (p.kind === 'sit') {
      this.me.suppressSit = false;
      this.sit();
    } else if (p.kind === 'stand' || p.kind === 'claim') this.stand();
    else if (p.kind === 'knock') world.send({ t: 'knock', deskId: p.deskId });
    else if (p.kind === 'teleport') world.send({ t: 'teleport', to: p.to });
    else if (p.kind === 'talk') store.set({ talkTo: p.npcId });
    else if (p.kind === 'world') world.send({ t: 'portal:enter', id: deskPortalId(p.deskId) });
  }

  /** Walk to a clicked world point (map px); sit when it is a chair. */
  clickTo(wx: number, wy: number) {
    const s = store.get();
    const map = s.map!;
    const cell = cellOf(map, wx, wy + 6);
    const target = cellPos(map, cell);
    const sit = !!chairAt(map, target.x, target.y);
    if (this.me.pose === 'sit') this.stand(false);
    const ok = this.nav.go(this.me.x, this.me.y, {
      cell,
      sit,
      onArrive: () => {
        this.view.drawPath([]);
        if (sit) {
          this.me.suppressSit = false;
          this.sit();
        }
      },
    });
    if (!ok) {
      // clicked a pod you may not enter: walk to its entrance instead
      const spot = deskSpotAt(map, target.x, target.y);
      if (spot && this.blocked(target.x, target.y))
        this.nav.go(this.me.x, this.me.y, { cell: spot.entrance });
    }
    this.view.drawPath(this.nav.path);
  }

  private handleNav(r: NavRequest) {
    const s = store.get();
    const map = s.map!;
    if (this.me.pose === 'sit') this.stand(false);
    if (r.kind === 'desk') {
      const spot = map.desks.find((d) => d.id === s.myDesk);
      if (!spot) return;
      this.nav.go(this.me.x, this.me.y, {
        cell: spot.chair,
        sit: true,
        onArrive: () => {
          this.view.drawPath([]);
          this.me.suppressSit = false;
          this.sit();
        },
      });
    } else if (r.kind === 'person') {
      const pos = rendered.get(r.id);
      if (!pos) return;
      const spot = deskSpotAt(map, pos.x, pos.y);
      const goal = spot && this.blocked(pos.x, pos.y) ? spot.entrance : cellOf(map, pos.x, pos.y);
      const ok = this.nav.go(this.me.x, this.me.y, {
        cell: goal,
        stopShort: spot && this.blocked(pos.x, pos.y) ? 0 : 1,
        onArrive: () => this.view.drawPath([]),
      });
      if (!ok) toast('nav.unreachable');
    } else this.clickTo(r.x, r.y);
    this.view.drawPath(this.nav.path);
  }

  private locate(id: string) {
    // a person, or a character (ADR-042)
    const v = rendered.get(id) ?? this.view.npcPosition(id);
    if (v) this.view.panTo(v.x, v.y);
  }

  private applyCorrection() {
    const corr = world.lastCorrection;
    if (!corr) return;
    world.lastCorrection = null;
    if (corr.reason === 'teleport') {
      this.teleporting = true;
      this.view.teleport(() => {
        Object.assign(this.me, { x: corr.x, y: corr.y, pose: 'stand', dir: 'down', moving: false });
        this.nav.afterTeleport(corr.x, corr.y);
        this.view.drawPath(this.nav.path);
        this.teleporting = false;
      });
      return;
    }
    this.me.x = corr.x;
    this.me.y = corr.y;
    if (corr.reason === 'blocked') this.nav.cancel();
  }

  // ───────────────────────────────────────────── frame
  /** Move me for this frame (prediction, ARCHITECTURE §4). */
  step(now: number, dtMs: number) {
    const s = store.get();
    const map = s.map;
    if (!map || !s.me) return;
    if (!this.me.ready) this.syncMe();
    if (!this.me.ready || this.teleporting) return;
    this.applyCorrection();
    if (this.view.buildActive || this.teleporting) return;
    let [ix, iy] = inputVector();
    const navDriven = !ix && !iy && this.nav.active;
    if (ix || iy) {
      if (this.nav.active) {
        this.nav.cancel();
        this.view.drawPath([]);
      }
    } else if (navDriven) [ix, iy] = this.nav.steer(this.me.x, this.me.y);
    let moving = ix !== 0 || iy !== 0;
    if (moving && this.me.pose === 'sit') this.stand(false);
    if (now < this.me.standUntil) moving = false;
    if (moving) {
      let left = Math.min(dtMs, 500) / 1000;
      while (left > 0) {
        let step = Math.min(left, 0.05);
        if (navDriven) {
          // re-steer every sub-step and never overshoot a waypoint
          [ix, iy] = this.nav.steer(this.me.x, this.me.y);
          if (!ix && !iy) break;
          step = Math.min(
            step,
            Math.max(0.004, this.nav.remaining(this.me.x, this.me.y) / SPEED_PX),
          );
        }
        const n = stepMove(map, this.me.x, this.me.y, ix, iy, step, (x, y) => this.blocked(x, y));
        this.me.x = n.x;
        this.me.y = n.y;
        left -= step;
      }
      this.me.dir =
        Math.abs(ix) > Math.abs(iy) ? (ix < 0 ? 'left' : 'right') : iy < 0 ? 'up' : 'down';
      this.me.idleSince = now;
      this.me.moving = true;
      this.sendMe();
      this.view.followMe();
    } else if (this.me.moving) {
      this.me.moving = false;
      this.me.idleSince = now;
      this.sendMe(true);
    }
    // auto-sit after a short pause on a chair
    const onChair = !!chairAt(map, this.me.x, this.me.y);
    if (!onChair) this.me.suppressSit = false;
    if (
      onChair &&
      this.me.pose === 'stand' &&
      !this.me.moving &&
      !this.nav.active &&
      s.settings.autoSit &&
      !this.me.suppressSit &&
      now - this.me.idleSince > 450
    )
      this.sit();
  }

  /**
   * Where everyone is drawn this frame: me from prediction, others from the interpolation buffer
   * (INTERP_MS behind). Updates `rendered`; people without a sample yet are left out.
   */
  avatars(now: number): AvatarState[] {
    const s = store.get();
    const out: AvatarState[] = [];
    const renderT = now - INTERP_MS;
    for (const id of Object.keys(s.profiles)) {
      let x: number, y: number, dir: Dir, moving: boolean, pose: Pose;
      if (id === s.me && this.me.ready) ({ x, y, dir, moving, pose } = this.me);
      else {
        const smp = world.sampleAt(id, renderT);
        if (!smp) continue;
        ({ x, y, d: dir, m: moving, p: pose } = smp);
      }
      let ps = this.poses.get(id);
      if (!ps) this.poses.set(id, (ps = { pose, at: 0 }));
      if (ps.pose !== pose) {
        ps.pose = pose;
        ps.at = id === s.me ? this.me.poseAt : now;
      }
      rendered.set(id, { x, y });
      out.push({ id, x, y, dir, moving, pose, poseAt: ps.at });
    }
    for (const id of [...rendered.keys()])
      if (!s.profiles[id]) {
        rendered.delete(id);
        this.poses.delete(id);
      }
    return out;
  }

  /** ~3 Hz: presence areas, nearest list, my zone and region, the contextual prompt. */
  slowTick() {
    const s = store.get();
    // inside a personal world the office prompts are not ours (P17.14): the world view owns them
    if (s.worldId !== null) return;
    const map = s.map!;
    const areas: Record<string, string | null> = {};
    for (const id of Object.keys(s.profiles)) {
      const r = rendered.get(id);
      areas[id] = r ? (zoneAt(map, r.x, r.y)?.id ?? null) : null;
    }
    const meR = rendered.get(s.me!);
    const nearest = meR
      ? Object.keys(s.profiles)
          .filter((id) => id !== s.me && rendered.has(id))
          .sort((a, b) => distTiles(meR, rendered.get(a)!) - distTiles(meR, rendered.get(b)!))
      : [];
    const myZone = meR ? (zoneAt(map, meR.x, meR.y) ?? null) : null;
    const myRegion = meR ? (regionAt(map, meR.x, meR.y)?.id ?? null) : null;

    // contextual prompt
    let prompt: ReturnType<typeof store.get>['prompt'] = null;
    if (meR) {
      const spotHere = deskSpotAt(map, meR.x, meR.y);
      const deskHere = spotHere ? s.desks.find((d) => d.id === spotHere.id) : undefined;
      if (this.me.pose === 'sit') {
        const chair = spotHere && cellOf(map, meR.x, meR.y);
        const atDeskChair =
          chair && spotHere && chair.cx === spotHere.chair.cx && chair.cy === spotHere.chair.cy;
        prompt =
          atDeskChair && !deskHere?.ownerName
            ? { kind: 'claim', deskId: spotHere!.id, moving: !!s.myDesk }
            : { kind: 'stand' };
      } else if (chairAt(map, meR.x, meR.y)) prompt = { kind: 'sit' };
      else if (
        spotHere &&
        deskHere?.ownerId &&
        s.config?.flags.worlds === true &&
        podAllows(deskHere, deskHere.ownerId === s.me, s.admitted.includes(spotHere.id))
      )
        // P17.14: the owner's world, from inside a pod I may enter (the server checks the same rule)
        prompt = {
          kind: 'world',
          deskId: spotHere.id,
          owner: deskHere.ownerId === s.me ? null : (deskHere.ownerName ?? null),
        };
      else if (myZone?.kind === 'portal') {
        const to = String(myZone.props.to ?? 'hub');
        prompt = { kind: 'teleport', region: myRegion ?? 'hub', to: to === myRegion ? 'hub' : to };
      } else
        for (const d of map.desks) {
          // 1.9 tiles: the door of a pod with its desk at the back (entrance below the zone)
          // stands about 1.7 tiles from the zone edge, so 1.6 never showed the knock prompt there.
          if (distToPod(d, meR.x, meR.y) > 1.9 || d.id === spotHere?.id) continue;
          const st = s.desks.find((q) => q.id === d.id);
          if (!st?.ownerName || st.ownerId === s.me || st.access === 'open') continue;
          if (s.admitted.includes(d.id)) continue;
          prompt =
            st.access === 'knock'
              ? { kind: 'knock', deskId: d.id, owner: st.ownerName }
              : { kind: 'closed', deskId: d.id, owner: st.ownerName };
          break;
        }
    }
    // a character within talking range, on the open floor (the server checks again)
    if (
      !prompt &&
      meR &&
      s.config?.flags.npcTalk === true &&
      !NPC_FORBIDDEN.includes(myZone?.kind as never)
    ) {
      const reach = NPC_TALK_TILES * TILE;
      let best: { id: string; name: string; d: number } | undefined;
      for (const n of s.npcs) {
        const at = this.view.npcPosition(n.id) ?? n;
        const d = Math.hypot(at.x - meR.x, at.y - meR.y);
        if (d <= reach && (!best || d < best.d)) best = { id: n.id, name: n.name, d };
      }
      if (best) prompt = { kind: 'talk', npcId: best.id, name: best.name };
    }
    // the Talk box closes when its character is gone or out of reach, or I stepped into a private area
    if (s.talkTo) {
      const n = s.npcs.find((q) => q.id === s.talkTo);
      const at = n ? (this.view.npcPosition(n.id) ?? n) : undefined;
      const far =
        !at ||
        !meR ||
        Math.hypot(at.x - meR.x, at.y - meR.y) > (NPC_TALK_TILES + NPC_TALK_SLACK_TILES) * TILE ||
        NPC_FORBIDDEN.includes(myZone?.kind as never);
      if (far) store.set({ talkTo: null });
    }
    const same = JSON.stringify(prompt) === JSON.stringify(s.prompt);
    store.set({ areas, nearest, myZone, myRegion, ...(same ? {} : { prompt }) });

    const zid = myZone?.id ?? null;
    if (this.lastZoneId !== undefined && zid !== this.lastZoneId) {
      if (myZone?.kind === 'private') toast('zone.enteredPrivate', undefined, 3000);
      else if (myZone?.kind === 'desk') toast('zone.enteredDesk', undefined, 3000);
      else if (myZone?.kind === 'quiet') toast('zone.enteredQuiet', undefined, 3000);
    }
    this.lastZoneId = zid;
  }
}

/** A zone's name for the HUD, in the UI language (a claimed desk pod shows its owner). */
export function zoneName(id: string | null | undefined): string {
  if (!id) return i18n.t('zone.floor');
  const s = store.get();
  const z = s.map?.zones.find((q) => q.id === id);
  if (!z) return i18n.t('zone.floor');
  if (z.kind === 'desk') {
    const d = s.desks.find((q) => q.id === id);
    if (d?.ownerName) return i18n.t('desk.of', { name: d.ownerName });
  }
  return i18n.language.startsWith('fr') ? z.nameFr : z.nameEn;
}
