import { randomBytes, randomUUID } from 'node:crypto';
import {
  C2S,
  DEFAULT_DECOR,
  HISTORY_SIZE,
  TICK_HZ,
  cellPos,
  chairAt,
  chatReaches,
  computeLinks,
  mediaScope,
  scopeKey,
  defaultSpawn,
  distToPod,
  nearestFree,
  pairKey,
  parseMap,
  planEdit,
  applyChanges,
  collides,
  peersOf,
  podAllows,
  randomAvatar,
  regionAt,
  regionSpawn,
  validateMove,
  zoneAt,
  type Avatar,
  type C2SMsg,
  type ChatMsg,
  type ClientConfig,
  type DeskSpot,
  type DeskState,
  type Dir,
  type MediaScope,
  type Placed,
  type PlayerPos,
  type PlayerProfile,
  type S2CMsg,
  type Tmj,
  type WorldMap,
  type Zone,
} from '@agora/shared';
import type { RoomStore, StoredDesk } from '../db/store';
import { Bucket } from './rate';
import { MediaGate, type GatePlayer, type SfuApi } from '../media/gate';

export interface Conn {
  send(msg: S2CMsg): void;
  close(code?: number, reason?: string): void;
}

export interface RoomOptions {
  /** space id; also the id of its saved map ("hq" for the default space) */
  mapId: string;
  /** space name shown in the HUD */
  name?: string;
  capacity: number;
  connectR: number;
  disconnectR: number;
  clientConfig: ClientConfig;
  reconnectGraceMs?: number;
  /** Live Tiled JSON behind `map` (needed for build mode saves and /api/maps/hq). */
  tmj?: Tmj;
  mapRev?: number;
  /** Generated map to restore on `map:reset`. */
  baseTmj?: () => Tmj;
  /** Debounce for persisting map edits (ms). */
  mapSaveMs?: number;
  /** SFU media rooms (ADR-031); absent = peer-to-peer media with signalling relay (ADR-009). */
  sfu?: { api: SfuApi; url: string; prefix: string; reconcileMs?: number };
}

interface Logger {
  info: (o: object, m?: string) => void;
  warn: (o: object, m?: string) => void;
}

export interface Player {
  id: string;
  uid: string;
  profile: PlayerProfile;
  x: number;
  y: number;
  dir: Dir;
  moving: boolean;
  pose: 'stand' | 'sit';
  lastMoveAt: number;
  zone?: Zone;
  /** SFU room the world room places this person in (ADR-031) */
  scope: MediaScope;
  conn: Conn | null;
  /** may edit the map (BUILDER_IDS / BUILDER_CODE) */
  builder: boolean;
  disconnectedAt?: number;
  peers: string;
  /** desk pods this visitor was let into (cleared when they walk out) */
  admitted: Set<string>;
  /** pending knock: desk id and expiry */
  knock?: { deskId: string; until: number };
  lastCallover: Map<string, number>;
  buckets: {
    move: Bucket;
    chat: Bucket;
    emote: Bucket;
    rtc: Bucket;
    misc: Bucket;
    social: Bucket;
    edit: Bucket;
  };
}

const newId = () => randomBytes(6).toString('base64url');
const KNOCK_MS = 30_000;
const CALLOVER_COOLDOWN_MS = 10_000;

/**
 * One authoritative world room per space (ARCHITECTURE §4–6, ADR-010, ADR-017).
 * Transport-agnostic so it can be unit-tested without sockets. The server decides
 * position validity, pod access, zone membership, chat reach, teleports, seats and
 * which pairs may exchange WebRTC signalling (and therefore media).
 */
export class SpaceRoom {
  readonly players = new Map<string, Player>();
  links = new Set<string>();
  /** desk id → ownership (persisted) */
  private desks = new Map<string, StoredDesk>();
  private spots = new Map<string, DeskSpot>();
  private timer?: NodeJS.Timeout;
  private history: ChatMsg[] = [];
  private grace: number;
  /** live map revision, bumped by every accepted edit */
  mapRev: number;
  private tmj?: Tmj;
  private tmjCache: { rev: number; json: string } | null = null;
  private saveTimer?: NodeJS.Timeout;
  private lastEditor: string | null = null;
  /** unsaved edits (only edited maps are persisted, so template updates still reach others) */
  private dirty = false;
  /** SFU access (ADR-031); undefined with the peer-to-peer backend */
  readonly gate?: MediaGate;

  constructor(
    public map: WorldMap,
    private opts: RoomOptions,
    private store: RoomStore,
    private log: Logger,
  ) {
    this.grace = opts.reconnectGraceMs ?? 20_000;
    this.tmj = opts.tmj;
    this.mapRev = opts.mapRev ?? 0;
    for (const d of map.desks) this.spots.set(d.id, d);
    if (opts.sfu)
      this.gate = new MediaGate({
        ...opts.sfu,
        spaceId: opts.mapId,
        scopeOf: (id) => this.players.get(id)?.scope,
        log,
      });
  }

  /** The gate's view of a player: always the live name and scope. */
  private gp(p: Player): GatePlayer {
    return {
      id: p.id,
      get name() {
        return p.profile.name;
      },
      get scope() {
        return p.scope;
      },
      send: (m) => p.conn?.send(m),
    };
  }

  /** Current map as Tiled JSON (cached per revision). */
  tmjJson(): string {
    if (!this.tmj) return '';
    if (this.tmjCache?.rev !== this.mapRev)
      this.tmjCache = { rev: this.mapRev, json: JSON.stringify(this.tmj) };
    return this.tmjCache.json;
  }

  async init() {
    this.history = await this.store.recentMessages(HISTORY_SIZE);
    for (const d of await this.store.loadDesks())
      if (this.spots.has(d.deskId)) this.desks.set(d.deskId, d);
  }

  start() {
    this.timer = setInterval(() => this.tick(), 1000 / TICK_HZ);
    this.gate?.start();
  }
  stop() {
    if (this.timer) clearInterval(this.timer);
    this.gate?.stop();
  }

  /** Live settings change (P2.3): limits and radii apply from the next tick. */
  applySettings(s: {
    name: string;
    capacity: number;
    connectR: number;
    disconnectR: number;
    videoCap: number;
  }) {
    const nameChanged = s.name !== this.opts.name;
    this.opts.name = s.name;
    this.opts.capacity = s.capacity;
    this.opts.connectR = s.connectR;
    this.opts.disconnectR = s.disconnectR;
    this.opts.clientConfig = {
      ...this.opts.clientConfig,
      connectR: s.connectR,
      disconnectR: s.disconnectR,
      videoCap: s.videoCap,
    };
    this.broadcast({ t: 'config', config: this.opts.clientConfig });
    if (nameChanged) this.broadcast({ t: 'space', name: s.name });
  }

  /** A person's name in this space changed (per-space display name, P2.4). */
  rename(uid: string, name: string) {
    for (const p of this.players.values()) if (p.uid === uid) this.setProfile(p, { name });
    const d = this.deskOf(uid);
    if (d && d.ownerName !== name) {
      d.ownerName = name;
      void this.store.saveDesk(d).catch(() => {});
      this.broadcastDesks();
    }
  }

  /** Nobody connected and no seat held: the room can be unloaded. */
  get idle() {
    return this.players.size === 0;
  }

  get connectedCount() {
    return [...this.players.values()].filter((p) => p.conn).length;
  }

  // ───────────────────────────────────────────── desks
  /** All connected sessions of a user (same person in several tabs). */
  private sessionsOf(uid: string): Player[] {
    return [...this.players.values()].filter((p) => p.uid === uid && p.conn);
  }

  private onlineOf(uid: string): Player | undefined {
    for (const p of this.players.values()) if (p.uid === uid && p.conn) return p;
    return undefined;
  }

  deskStates(): DeskState[] {
    return this.map.desks.map((s) => {
      const d = this.desks.get(s.id);
      return {
        id: s.id,
        ownerName: d?.ownerName ?? null,
        ownerId: d ? (this.onlineOf(d.ownerUid)?.id ?? null) : null,
        access: d?.access ?? 'open',
        decor: d?.decor ?? DEFAULT_DECOR,
      };
    });
  }

  private deskOf(uid: string): StoredDesk | undefined {
    for (const d of this.desks.values()) if (d.ownerUid === uid) return d;
    return undefined;
  }

  private broadcastDesks() {
    this.broadcast({ t: 'desks', desks: this.deskStates() });
  }

  /** May this player stand inside the pod at (x, y)? */
  private allowedAt(p: Player, x: number, y: number): boolean {
    const z = zoneAt(this.map, x, y);
    if (!z || z.kind !== 'desk') return true;
    if (p.zone?.id === z.id) return true; // already inside: may move around and leave
    const d = this.desks.get(z.id);
    if (!d) return true;
    const state: DeskState = {
      id: z.id,
      ownerName: d.ownerName,
      ownerId: null,
      access: d.access,
      decor: d.decor,
    };
    return podAllows(state, d.ownerUid === p.uid, p.admitted.has(z.id));
  }

  // ───────────────────────────────────────────── lifecycle
  /** Join (or resume a seat within the grace window). Returns null when full. */
  async join(
    conn: Conn,
    /** `name` is shown in this space; `accountName` (default: name) is what gets saved */
    user: { uid: string; name: string; accountName?: string; builder?: boolean },
    resumeId?: string,
    avatar?: Avatar,
  ): Promise<Player | null> {
    const resumed = resumeId ? this.players.get(resumeId) : undefined;
    let p: Player;
    if (resumed && resumed.uid === user.uid && !resumed.conn) {
      p = resumed;
      p.conn = conn;
      p.builder = !!user.builder;
      p.disconnectedAt = undefined;
      p.peers = '';
      p.profile.online = true;
      this.broadcast({ t: 'profile', profile: p.profile }, p.id);
    } else {
      if (this.connectedCount >= this.opts.capacity) return null;
      const stored = await this.store.getUser(user.uid).catch(() => null);
      const myDesk = this.deskOf(user.uid);
      const spot = myDesk ? this.spots.get(myDesk.deskId) : undefined;
      let pos: { x: number; y: number };
      if (spot)
        pos = nearestFree(
          this.map,
          cellPos(this.map, spot.guest).x,
          cellPos(this.map, spot.guest).y,
        );
      else {
        const spawn = defaultSpawn(this.map);
        const jitter = () => (Math.random() - 0.5) * 96;
        pos = nearestFree(this.map, spawn.x + jitter(), spawn.y + jitter() / 3);
      }
      p = {
        id: newId(),
        uid: user.uid,
        profile: {
          id: '',
          name: user.name,
          avatar: avatar ?? stored?.avatar ?? randomAvatar(),
          status: 'available',
          statusMsg: '',
          hand: false,
          mic: false,
          cam: false,
          ptt: false,
          lowBw: false,
          screen: false,
          online: true,
        },
        x: pos.x,
        y: pos.y,
        dir: 'up',
        moving: false,
        pose: 'stand',
        lastMoveAt: Date.now(),
        conn,
        scope: { kind: 'floor' },
        builder: !!user.builder,
        peers: '',
        admitted: new Set(),
        lastCallover: new Map(),
        buckets: {
          move: new Bucket(30, 45),
          chat: new Bucket(1, 5),
          emote: new Bucket(1, 3),
          rtc: new Bucket(100, 300),
          misc: new Bucket(2, 10),
          social: new Bucket(0.5, 3),
          edit: new Bucket(8, 30),
        },
      };
      p.profile.id = p.id;
      p.zone = zoneAt(this.map, p.x, p.y);
      p.scope = mediaScope(this.placed(p));
      this.players.set(p.id, p);
      void this.store
        .upsertUser({
          uid: user.uid,
          name: user.accountName ?? user.name,
          avatar: p.profile.avatar,
        })
        .catch(() => {});
      void this.store.presence(user.uid, 'join').catch(() => {});
      this.broadcast({ t: 'profile', profile: p.profile }, p.id);
      this.log.info({ player: p.id, name: user.name }, 'joined');
    }
    conn.send({
      t: 'welcome',
      you: p.id,
      profiles: [...this.players.values()].map((q) => q.profile),
      positions: [...this.players.values()].map((q) => this.pos(q)),
      history: this.history,
      config: this.opts.clientConfig,
      map: this.opts.mapId,
      spaceName: this.opts.name ?? '',
      desks: this.deskStates(),
      myDesk: this.deskOf(p.uid)?.deskId ?? null,
      mapRev: this.mapRev,
      builder: p.builder && this.opts.clientConfig.flags.builder !== false && !!this.tmj,
    });
    if (this.deskOf(p.uid)) this.broadcastDesks();
    void this.gate?.joined(this.gp(p));
    return p;
  }

  /** Socket closed: keep the seat for the grace window, then remove. */
  disconnect(p: Player) {
    if (!this.players.has(p.id)) return;
    p.conn = null;
    p.disconnectedAt = Date.now();
    p.moving = false;
    Object.assign(p.profile, { online: false, mic: false, cam: false, ptt: false, screen: false });
    this.broadcast({ t: 'profile', profile: p.profile });
    this.recomputeLinks();
    if (this.deskOf(p.uid)) this.broadcastDesks();
  }

  remove(p: Player) {
    if (!this.players.delete(p.id)) return;
    void this.gate?.left(p.id, p.scope);
    void this.store.presence(p.uid, 'leave').catch(() => {});
    this.broadcast({ t: 'leave', id: p.id });
    this.recomputeLinks();
    this.log.info({ player: p.id }, 'left');
  }

  // ───────────────────────────────────────────── messages
  handle(p: Player, raw: unknown) {
    const parsed = C2S.safeParse(raw);
    if (!parsed.success) {
      p.conn?.send({ t: 'error', code: 'bad_message' });
      return;
    }
    const m = parsed.data;
    switch (m.t) {
      case 'move':
        return this.onMove(p, m);
      case 'chat':
        return this.onChat(p, m);
      case 'emote':
        if (!p.buckets.emote.take()) return;
        if (m.emote === 'hand') return this.setProfile(p, { hand: !p.profile.hand });
        return this.broadcast({ t: 'emote', id: p.id, emote: m.emote });
      case 'hand':
        if (!p.buckets.misc.take()) return;
        return this.setProfile(p, { hand: m.up });
      case 'status':
        if (!p.buckets.misc.take()) return;
        return this.setProfile(p, { status: m.status, statusMsg: m.msg });
      case 'media':
        if (!p.buckets.misc.take()) return;
        return this.setProfile(p, {
          mic: m.mic,
          cam: m.cam,
          ptt: m.ptt,
          lowBw: m.lowBw,
          // screen sharing needs the SFU (P7.1)
          screen: m.screen && !!this.gate && this.opts.clientConfig.flags.screenShare !== false,
        });
      case 'media:token':
        if (!p.buckets.misc.take() || !this.gate) return;
        return void this.gate.refresh(this.gp(p));
      case 'profile': {
        if (!p.buckets.misc.take()) return;
        this.setProfile(p, { name: m.name, avatar: m.avatar });
        void this.store.upsertUser({ uid: p.uid, name: m.name, avatar: m.avatar }).catch(() => {});
        const d = this.deskOf(p.uid);
        if (d && d.ownerName !== m.name) {
          d.ownerName = m.name;
          void this.store.saveDesk(d).catch(() => {});
          this.broadcastDesks();
        }
        return;
      }
      case 'rtc':
        return this.onRtc(p, m);
      case 'teleport':
        return this.onTeleport(p, m.to);
      case 'desk:claim':
        return this.onClaim(p, m.deskId);
      case 'desk:release':
        return this.onRelease(p);
      case 'desk:update':
        return this.onDeskUpdate(p, m);
      case 'knock':
        return this.onKnock(p, m.deskId);
      case 'knock:answer':
        return this.onKnockAnswer(p, m.visitor, m.accept);
      case 'callover':
        return this.onCallover(p, m.to);
      case 'ping':
        return p.conn?.send({ t: 'pong', at: m.at });
      case 'leave':
        return this.remove(p);
      case 'map:edit':
        return this.onMapEdit(p, m);
      case 'map:reset':
        return this.onMapReset(p);
    }
  }

  // ───────────────────────────────────────────── build mode (ADR-021)
  private canBuild(p: Player): boolean {
    return p.builder && this.opts.clientConfig.flags.builder !== false && !!this.tmj;
  }

  private onMapEdit(p: Player, m: Extract<C2SMsg, { t: 'map:edit' }>) {
    if (!this.canBuild(p)) return p.conn?.send({ t: 'error', code: 'not_builder' });
    if (!p.buckets.edit.take()) return p.conn?.send({ t: 'error', code: 'rate_limited' });
    const plan = planEdit(this.map, m.cells);
    if (!plan.ok)
      return p.conn?.send({ t: 'map:refused', op: m.op, reason: plan.reason, cell: plan.cell });
    if (!plan.changes.length) return;
    applyChanges(this.map, plan.changes);
    this.mapRev++;
    this.lastEditor = p.uid;
    this.dirty = true;
    this.broadcast({ t: 'map:edit', rev: this.mapRev, by: p.id, op: m.op, changes: plan.changes });
    this.unstick();
    this.scheduleSave();
  }

  private onMapReset(p: Player) {
    if (!this.canBuild(p) || !this.opts.baseTmj)
      return p.conn?.send({ t: 'error', code: 'not_builder' });
    if (!p.buckets.misc.take()) return;
    this.tmj = this.opts.baseTmj();
    this.map = parseMap(this.tmj);
    this.spots.clear();
    for (const d of this.map.desks) this.spots.set(d.id, d);
    for (const id of [...this.desks.keys()]) if (!this.spots.has(id)) this.desks.delete(id);
    this.mapRev++;
    this.lastEditor = p.uid;
    for (const q of this.players.values()) q.zone = zoneAt(this.map, q.x, q.y);
    this.unstick();
    if (this.saveTimer) clearTimeout(this.saveTimer);
    this.saveTimer = undefined;
    this.dirty = false;
    void this.store.deleteMap(this.opts.mapId).catch(() => {});
    this.log.info({ player: p.id, rev: this.mapRev }, 'map reset to generated');
    this.broadcast({ t: 'map:reload', rev: this.mapRev });
    this.broadcastDesks();
  }

  /** Anyone now standing inside something solid is moved to the nearest free spot. */
  private unstick() {
    for (const q of this.players.values()) {
      if (!collides(this.map, q.x, q.y)) continue;
      const pos = nearestFree(this.map, q.x, q.y);
      q.x = pos.x;
      q.y = pos.y;
      q.pose = 'stand';
      q.zone = zoneAt(this.map, q.x, q.y);
      this.correct(q, 0, 'spawn');
    }
  }

  private scheduleSave() {
    if (this.saveTimer) return;
    this.saveTimer = setTimeout(() => {
      this.saveTimer = undefined;
      void this.flushMap();
    }, this.opts.mapSaveMs ?? 1500);
  }

  /** Persist the live map now (also called on shutdown). */
  async flushMap() {
    if (!this.tmj || !this.dirty) return;
    this.dirty = false;
    if (this.saveTimer) {
      clearTimeout(this.saveTimer);
      this.saveTimer = undefined;
    }
    await this.store
      .saveMap({ id: this.opts.mapId, tmj: this.tmj, rev: this.mapRev, updatedBy: this.lastEditor })
      .catch((err) => this.log.warn({ err: String(err) }, 'saveMap failed'));
  }

  private setProfile(p: Player, patch: Partial<PlayerProfile>) {
    Object.assign(p.profile, patch);
    this.broadcast({ t: 'profile', profile: p.profile });
  }

  private correct(p: Player, seq: number, reason: 'invalid' | 'blocked' | 'teleport' | 'spawn') {
    p.conn?.send({ t: 'correction', x: p.x, y: p.y, seq, reason });
  }

  private onMove(p: Player, m: Extract<C2SMsg, { t: 'move' }>) {
    if (!p.buckets.move.take()) return;
    const now = Date.now();
    const verdict = validateMove(this.map, p, m, now - p.lastMoveAt);
    if (!verdict.ok) return this.correct(p, m.seq, 'invalid');
    if (!this.allowedAt(p, m.x, m.y)) return this.correct(p, m.seq, 'blocked');
    const before = p.zone;
    p.x = m.x;
    p.y = m.y;
    p.dir = m.dir;
    p.moving = m.moving;
    // Sitting is only accepted on a chair; you face the way the chair faces.
    const chair = m.pose === 'sit' && !m.moving ? chairAt(this.map, m.x, m.y) : undefined;
    p.pose = chair ? 'sit' : 'stand';
    if (chair) p.dir = chair;
    p.lastMoveAt = now;
    p.zone = zoneAt(this.map, p.x, p.y);
    if (before?.id !== p.zone?.id) this.onZoneChange(p, before, p.zone);
  }

  private onZoneChange(p: Player, from: Zone | undefined, to: Zone | undefined) {
    if (from?.kind === 'desk' && p.admitted.delete(from.id))
      p.conn?.send({ t: 'admitted', deskIds: [...p.admitted] });
    if (to?.kind === 'desk') {
      const d = this.desks.get(to.id);
      if (d && d.ownerUid !== p.uid)
        for (const o of this.sessionsOf(d.ownerUid))
          o.conn?.send({ t: 'visitor', id: p.id, name: p.profile.name, deskId: to.id });
    }
  }

  private onTeleport(p: Player, to: string) {
    if (!p.buckets.misc.take()) return;
    const zone = zoneAt(this.map, p.x, p.y);
    const here = regionAt(this.map, p.x, p.y)?.id;
    const dest = regionSpawn(this.map, to);
    if (zone?.kind !== 'portal' || !dest || to === here) {
      p.conn?.send({ t: 'error', code: 'teleport_refused' });
      return;
    }
    const jitter = () => (Math.random() - 0.5) * 40;
    const pos = nearestFree(this.map, dest.x + jitter(), dest.y + jitter() / 2);
    const before = p.zone;
    p.x = pos.x;
    p.y = pos.y;
    p.pose = 'stand';
    p.dir = 'down';
    p.lastMoveAt = Date.now();
    p.zone = zoneAt(this.map, p.x, p.y);
    this.onZoneChange(p, before, p.zone);
    this.correct(p, 0, 'teleport');
    this.recomputeLinks();
  }

  private onClaim(p: Player, deskId: string) {
    if (!p.buckets.misc.take()) return;
    const spot = this.spots.get(deskId);
    const current = this.desks.get(deskId);
    if (!spot || (current && current.ownerUid !== p.uid))
      return p.conn?.send({ t: 'error', code: 'desk_taken' });
    if (p.zone?.id !== deskId || p.pose !== 'sit')
      return p.conn?.send({ t: 'error', code: 'desk_sit_first' });
    const old = this.deskOf(p.uid);
    if (old && old.deskId !== deskId) {
      this.desks.delete(old.deskId);
      void this.store.deleteDesk(old.deskId).catch(() => {});
    }
    const d: StoredDesk = current ?? {
      deskId,
      ownerUid: p.uid,
      ownerName: p.profile.name,
      access: 'open',
      decor: old?.decor ?? { ...DEFAULT_DECOR },
    };
    this.desks.set(deskId, d);
    void this.store
      .saveDesk(d)
      .catch((err) => this.log.warn({ err: String(err) }, 'saveDesk failed'));
    p.conn?.send({ t: 'myDesk', deskId });
    this.broadcastDesks();
  }

  private onRelease(p: Player) {
    if (!p.buckets.misc.take()) return;
    const d = this.deskOf(p.uid);
    if (!d) return;
    this.desks.delete(d.deskId);
    void this.store.deleteDesk(d.deskId).catch(() => {});
    p.conn?.send({ t: 'myDesk', deskId: null });
    this.broadcastDesks();
  }

  /** An account was removed (P2.16): free its desk here. */
  releaseDeskOf(uid: string) {
    const d = this.deskOf(uid);
    if (!d) return;
    this.desks.delete(d.deskId);
    void this.store.deleteDesk(d.deskId).catch(() => {});
    this.broadcastDesks();
  }

  private onDeskUpdate(p: Player, m: Extract<C2SMsg, { t: 'desk:update' }>) {
    if (!p.buckets.misc.take()) return;
    const d = this.deskOf(p.uid);
    if (!d) return p.conn?.send({ t: 'error', code: 'no_desk' });
    if (m.access) d.access = m.access;
    if (m.decor) d.decor = m.decor;
    void this.store.saveDesk(d).catch(() => {});
    this.broadcastDesks();
  }

  private onKnock(p: Player, deskId: string) {
    if (!p.buckets.social.take()) return;
    const spot = this.spots.get(deskId);
    const d = this.desks.get(deskId);
    const reply = (result: 'accepted' | 'declined' | 'away' | 'busy' | 'pending') =>
      p.conn?.send({ t: 'knock:result', deskId, result });
    if (!spot || distToPod(spot, p.x, p.y) > 2.5)
      return p.conn?.send({ t: 'error', code: 'knock_too_far' });
    if (!d || d.access === 'open') return reply('accepted');
    if (d.access === 'closed') return reply('busy');
    const owner = this.onlineOf(d.ownerUid);
    if (!owner) return reply('away');
    if (owner.profile.status === 'dnd') return reply('busy');
    p.knock = { deskId, until: Date.now() + KNOCK_MS };
    for (const o of this.sessionsOf(d.ownerUid))
      o.conn?.send({ t: 'knock', from: p.id, name: p.profile.name, deskId });
    reply('pending');
  }

  private onKnockAnswer(owner: Player, visitorId: string, accept: boolean) {
    const v = this.players.get(visitorId);
    const d = v?.knock ? this.desks.get(v.knock.deskId) : undefined;
    if (!v || !v.knock || !d || d.ownerUid !== owner.uid || v.knock.until < Date.now()) return;
    const deskId = v.knock.deskId;
    v.knock = undefined;
    if (accept) {
      v.admitted.add(deskId);
      v.conn?.send({ t: 'admitted', deskIds: [...v.admitted] });
    }
    v.conn?.send({ t: 'knock:result', deskId, result: accept ? 'accepted' : 'declined' });
  }

  private onCallover(p: Player, to: string) {
    if (!p.buckets.social.take()) return;
    const target = this.players.get(to);
    if (!target?.conn || target.id === p.id) return;
    if (target.profile.status === 'dnd') return p.conn?.send({ t: 'error', code: 'callover_dnd' });
    const last = p.lastCallover.get(to) ?? 0;
    if (Date.now() - last < CALLOVER_COOLDOWN_MS)
      return p.conn?.send({ t: 'error', code: 'rate_limited' });
    p.lastCallover.set(to, Date.now());
    target.conn.send({ t: 'callover', from: p.id, name: p.profile.name });
  }

  private placed(p: Player): Placed {
    const z =
      p.zone && (p.zone.kind === 'private' || p.zone.kind === 'quiet' || p.zone.kind === 'desk')
        ? p.zone
        : undefined;
    return { id: p.id, x: p.x, y: p.y, zoneId: z?.id, zoneKind: z?.kind };
  }

  private onChat(p: Player, m: Extract<C2SMsg, { t: 'chat' }>) {
    if (!p.buckets.chat.take()) {
      p.conn?.send({ t: 'error', code: 'rate_limited' });
      return;
    }
    const zone = this.placed(p);
    const msg: ChatMsg = {
      id: randomUUID(),
      scope: m.scope,
      from: p.id,
      name: p.profile.name,
      body: m.body,
      at: Date.now(),
      zoneId: m.scope === 'nearby' ? (zone.zoneId ?? null) : null,
    };
    if (m.scope === 'everyone') {
      this.history.push(msg);
      if (this.history.length > HISTORY_SIZE) this.history.shift();
      void this.store
        .saveMessage(msg)
        .catch((err) => this.log.warn({ err: String(err) }, 'saveMessage failed'));
      this.broadcast({ t: 'chat', msg });
      return;
    }
    // Nearby: ephemeral, recipients decided here (PRIVACY rule 2, CLAUDE hard rule on private rooms).
    for (const q of this.players.values())
      if (q.conn && (q.id === p.id || chatReaches(zone, this.placed(q))))
        q.conn.send({ t: 'chat', msg });
  }

  private onRtc(p: Player, m: Extract<C2SMsg, { t: 'rtc' }>) {
    if (!p.buckets.rtc.take()) return;
    // With the SFU nobody needs peer-to-peer signalling: nothing is relayed at all.
    if (this.gate) {
      p.conn?.send({ t: 'error', code: 'rtc_off' });
      return;
    }
    // Signalling only flows between pairs the server currently links.
    if (!this.links.has(pairKey(p.id, m.to))) {
      p.conn?.send({ t: 'error', code: 'rtc_not_linked' });
      return;
    }
    this.players.get(m.to)?.conn?.send({ t: 'rtc', from: p.id, data: m.data });
  }

  private pos(p: Player): PlayerPos {
    const out: PlayerPos = {
      id: p.id,
      x: Math.round(p.x * 10) / 10,
      y: Math.round(p.y * 10) / 10,
      d: p.dir,
      m: p.moving,
      z: p.zone?.id ?? null,
    };
    if (p.pose === 'sit') out.p = 'sit';
    return out;
  }

  /** Follow zone changes into SFU rooms (ADR-031): access is revoked before new tokens. */
  private syncScopes() {
    for (const p of this.players.values()) {
      const next = mediaScope(this.placed(p));
      if (scopeKey(next) === scopeKey(p.scope)) continue;
      const from = p.scope;
      p.scope = next;
      void this.gate?.moved(this.gp(p), from);
    }
  }

  recomputeLinks() {
    this.syncScopes();
    const active = [...this.players.values()].filter((p) => p.conn);
    this.links = computeLinks(
      active.map((p) => this.placed(p)),
      this.links,
      { connect: this.opts.connectR, disconnect: this.opts.disconnectR },
    );
    for (const p of active) {
      const peers = peersOf(p.id, this.links);
      const key = peers.join(',');
      if (key !== p.peers) {
        p.peers = key;
        p.conn?.send({ t: 'peers', peers });
      }
    }
  }

  tick(now = Date.now()) {
    for (const p of [...this.players.values()]) {
      if (!p.conn && p.disconnectedAt && now - p.disconnectedAt > this.grace) this.remove(p);
      if (p.knock && p.knock.until < now) p.knock = undefined;
    }
    this.recomputeLinks();
    const positions = [...this.players.values()].map((p) => this.pos(p));
    this.broadcast({ t: 'state', positions, at: now });
  }

  broadcast(msg: S2CMsg, exceptId?: string) {
    for (const p of this.players.values()) if (p.conn && p.id !== exceptId) p.conn.send(msg);
  }
}
