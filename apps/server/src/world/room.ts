import { createHash, randomBytes, randomUUID } from 'node:crypto';
import {
  C2S,
  DEFAULT_DECOR,
  HISTORY_SIZE,
  ACTION_ACTIVITY,
  NPC_FORBIDDEN,
  NPC_GROUP_TILES,
  NPC_TALK_SLACK_TILES,
  NPC_TALK_TILES,
  giftNpcOf,
  applyVisitorEdit,
  awayAllows,
  awayOf,
  cleanGrants,
  visitorsOf,
  type VisitorEdit,
  type VisitorRefusal,
  type VisitorView,
  officeDayOf,
  type OfficeRefusal,
  TILE,
  TICK_HZ,
  cellOf,
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
  writePropsLayer,
  collides,
  peersOf,
  podOpenAt,
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
  type NpcPersona,
  type NpcPerson,
  type NpcRefusal,
  type Tmj,
  type WorldMap,
  type Zone,
  type Badge,
  type Skill,
  type Taste,
  loadGameData,
} from '@agora/shared';
import type { RoomStore, StoredDesk } from '../db/store';
import { Bucket } from './rate';
import { heartsOfUser, officeBuy, officeGift, officeInventory } from '../worlds/office';
import { OfficeCat } from './pets';
import type { ScoreWeights } from '@agora/shared';
import {
  RETURN_PORTAL_ID,
  checkPortal,
  deskGate,
  deskOfPortal,
  inPortal,
  isCaveId,
  portalAllows,
  type PortalRefusal,
} from '@agora/shared';
import {
  NpcDirector,
  type Npc,
  type NpcBrainLink,
  type NpcEvent,
  type NpcSay,
  type NpcSocialLink,
  type NpcTalkLink,
} from './npcs';
import { MediaGate, type GatePlayer, type SfuApi } from '../media/gate';
import {
  worldHubFor,
  type WorldHub,
  type WorldMedia,
  type WorldMember,
  type WorldRoom,
} from '../worlds/worldRoom';
import { ensureOwnerWorld } from '../worlds/ownerWorld';

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
  /** Random source for the cat's choices (tests pass a seeded one). */
  petRng?: () => number;
  /**
   * Characters of this space (ADR-042, flag `npcs`, NPC_SPACES): the cast (re-read when its files
   * change), their clock (minutes since midnight) and a random source (tests pass a seeded one).
   */
  npcs?: {
    personas: () => NpcPersona[];
    clock: (now: number) => number;
    rng?: () => number;
    /** Clef and the decision log (P15.3); absent = the characters' own scoring only */
    link?: NpcBrainLink;
    /** talking (P15.4, flag `npcTalk`); absent = the characters do not talk */
    talk?: NpcTalkLink;
    /** moods, saved days and characters chatting with each other (P15.5, flag `npcSocial`) */
    social?: NpcSocialLink & { space?: string };
    /** fitted score weights (P15.3b); absent = the hand-set ones */
    weights?: () => ScoreWeights;
  };
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
  /** sees the characters' brain view (development, or a space admin; P15.3) */
  npcDebug: boolean;
  /** when this person joined (characters greet newcomers) */
  joinedAt: number;
  /** accepted the AI notice (P15.4), or none applies */
  npcConsent: boolean;
  /** asked to hear characters' voices (P15.6) */
  npcVoice: boolean;
  /** characters with a reply on its way to this person (one at a time each) */
  talking: Set<string>;
  disconnectedAt?: number;
  peers: string;
  /** desk pods this visitor was let into (cleared when they walk out) */
  admitted: Set<string>;
  /** pending knock: desk id and expiry */
  knock?: { deskId: string; until: number };
  /**
   * inside a personal world (P17.9): out of this office's presence, media and links until back.
   * `deskId` is the desk whose world it is: the rights to enter it and its caves are read from that desk.
   */
  world?: { room: WorldRoom; member: WorldMember; deskId: string };
  lastCallover: Map<string, number>;
  buckets: {
    move: Bucket;
    chat: Bucket;
    emote: Bucket;
    rtc: Bucket;
    misc: Bucket;
    social: Bucket;
    edit: Bucket;
    talk: Bucket;
    /** world actions (P17.20): a swing every 170 ms, a burst of 12 */
    act: Bucket;
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
  /** P17.15b: people of this space inside a personal world or cave: listed as `inWorld`, never placed */
  private readonly away = new Map<string, Player>();
  links = new Set<string>();
  /** desk id → ownership (persisted) */
  private desks = new Map<string, StoredDesk>();
  private spots = new Map<string, DeskSpot>();
  /** open personal worlds, shared by every space in this process (P17.9) */
  private readonly worlds: WorldHub;
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
  /** the space's cat (ADR-040, flag `pets`); not a Player, so never placed, linked or listed */
  private officeCat?: OfficeCat;
  /**
   * the space's characters (ADR-042, flag `npcs`); like the cat they are not Players: never in
   * placed(), links, peers, the media gate or `state` positions, and never in a private room,
   * desk pod or quiet zone
   */
  private npcDirector?: NpcDirector;

  constructor(
    public map: WorldMap,
    private opts: RoomOptions,
    private store: RoomStore,
    private log: Logger,
  ) {
    this.grace = opts.reconnectGraceMs ?? 20_000;
    this.worlds = worldHubFor(store.worlds);
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
    if (opts.clientConfig.flags.pets === true)
      this.officeCat = new OfficeCat(
        {
          map: () => this.map,
          rev: () => this.mapRev,
          // an office cat is a guest: no pod it was not invited to, ever
          podOpen: (x, y) =>
            podOpenAt(
              this.map,
              x,
              y,
              (id) => this.podState(id),
              false,
              () => false,
            ),
        },
        opts.petRng,
      );
    if (opts.clientConfig.flags.npcs === true && opts.npcs)
      this.npcDirector = new NpcDirector(
        {
          map: () => this.map,
          rev: () => this.mapRev,
          takenByPeople: () => {
            const out = new Set<string>();
            for (const p of this.players.values())
              if (p.conn && p.pose === 'sit') {
                const c = cellOf(this.map, p.x, p.y);
                out.add(`seat:${c.cx},${c.cy}`);
              }
            return out;
          },
          people: () => this.npcPeople(),
        },
        opts.npcs.personas(),
        opts.npcs.clock,
        opts.npcs.rng,
        opts.npcs.link,
        opts.clientConfig.flags.npcSocial === true ? opts.npcs.social : undefined,
        opts.npcs.weights,
      );
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
    if (this.tmjCache?.rev !== this.mapRev) {
      // props live in map.props (P9.16); the tile layers share their arrays with the tmj
      writePropsLayer(this.tmj, this.map.props);
      this.tmjCache = { rev: this.mapRev, json: JSON.stringify(this.tmj) };
    }
    return this.tmjCache.json;
  }

  async init() {
    await this.npcDirector?.load(this.opts.npcs?.personas().map((p) => p.id) ?? []);
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

  /** The pod state `podAllows` judges, from the stored desk (null owner id: never sent to clients). */
  private podState(id: string): DeskState | undefined {
    const d = this.desks.get(id);
    return d && { id, ownerName: d.ownerName, ownerId: null, access: d.access, decor: d.decor };
  }

  /** May this player stand inside the pod at (x, y)? */
  private allowedAt(p: Player, x: number, y: number): boolean {
    const z = zoneAt(this.map, x, y);
    if (z?.kind === 'desk' && p.zone?.id === z.id) return true; // already inside: may move around and leave
    return podOpenAt(
      this.map,
      x,
      y,
      (id) => this.podState(id),
      !!z && this.desks.get(z.id)?.ownerUid === p.uid,
      (id) => p.admitted.has(id),
    );
  }

  // ───────────────────────────────────────────── lifecycle
  /** Join (or resume a seat within the grace window). Returns null when full. */
  async join(
    conn: Conn,
    /** `name` is shown in this space; `accountName` (default: name) is what gets saved */
    user: {
      uid: string;
      name: string;
      accountName?: string;
      builder?: boolean;
      npcDebug?: boolean;
    },
    resumeId?: string,
    avatar?: Avatar,
  ): Promise<Player | null> {
    const resumed = resumeId ? this.players.get(resumeId) : undefined;
    let p: Player;
    if (resumed && resumed.uid === user.uid && !resumed.conn) {
      p = resumed;
      p.conn = conn;
      p.builder = !!user.builder;
      p.npcDebug = !!user.npcDebug;
      p.disconnectedAt = undefined;
      p.peers = '';
      p.profile.online = true;
      this.broadcast({ t: 'profile', profile: p.profile }, p.id);
    } else {
      if (this.connectedCount >= this.opts.capacity) return null;
      const stored = await this.store.getUser(user.uid).catch(() => null);
      const badge = await this.badgeOf(user.uid);
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
        npcDebug: !!user.npcDebug,
        joinedAt: Date.now(),
        npcConsent: false,
        npcVoice: false,
        talking: new Set(),
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
          /** Talk-box messages to characters: one every 2 s, a burst of 4 */
          talk: new Bucket(0.5, 4),
          act: new Bucket(6, 12),
        },
      };
      p.profile.id = p.id;
      if (badge) p.profile.badge = badge;
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
      profiles: this.roster(),
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
    if (this.officeCat) conn.send({ t: 'pet:state', pets: [this.officeCat.snapshot()] });
    if (this.npcDirector) conn.send({ t: 'npc:state', npcs: this.npcDirector.snapshot() });
    this.sendNpcConsent(p);
    void this.sendFriendship(p);
    if (this.deskOf(p.uid)) this.broadcastDesks();
    void this.gate?.joined(this.gp(p));
    return p;
  }

  /** Socket closed: keep the seat for the grace window, then remove. */
  disconnect(p: Player) {
    this.leaveWorld(p); // a closed socket inside a world goes back to its office seat first
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
    if (p.world) {
      // leaving the space from inside a world: take the person out of it, then run the normal removal
      this.detachWorld(p);
      this.players.set(p.id, p);
    }
    if (!this.players.delete(p.id)) return;
    this.opts.npcs?.talk?.engine.end(p.uid);
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
    if (m.t === 'badge') return void this.onBadge(p, m.skill);
    if (p.world) return this.onWorldMessage(p, m);
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
      case 'gift':
        return void this.onGift(p, m);
      case 'office:buy':
        return void this.onOfficeBuy(p, m);
      case 'office:inv':
        return void this.onOfficeInv(p);
      case 'npc:talk':
        return this.onNpcTalk(p, m);
      case 'npc:consent':
        return this.onNpcConsent(p, m.accept);
      case 'npc:recall':
        return this.onNpcRecall(p, m.npcId);
      case 'npc:forget':
        return this.onNpcForget(p);
      case 'npc:voice':
        p.npcVoice = m.on;
        return;
      case 'rtc':
        return this.onRtc(p, m);
      case 'teleport':
        return this.onTeleport(p, m.to);
      case 'portal:enter':
        return this.onPortalEnter(p, m.id);
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
      case 'world:visitors':
        return void this.onVisitorsGet(p);
      case 'world:visitors:set':
        return void this.onVisitorsSet(p, m.edit);
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
    writePropsLayer(this.tmj, this.map.props);
    await this.store
      .saveMap({ id: this.opts.mapId, tmj: this.tmj, rev: this.mapRev, updatedBy: this.lastEditor })
      .catch((err) => this.log.warn({ err: String(err) }, 'saveMap failed'));
  }

  /** The badge a person shows (P17.31); none when the store cannot answer, so the office still opens. */
  private async badgeOf(uid: string): Promise<Badge | undefined> {
    try {
      return await this.store.worlds.badgeOf(uid, loadGameData().progression);
    } catch (err) {
      this.log.warn({ err }, 'badge not read');
      return undefined;
    }
  }

  /** Brings a person's badge up to date (the xp they earned in a world); the space hears it only if it changed. */
  private async refreshBadge(p: Player) {
    const badge = await this.badgeOf(p.uid);
    if (JSON.stringify(badge) !== JSON.stringify(p.profile.badge)) this.setProfile(p, { badge });
  }

  /** P17.31: the person chose the skill to show (null: none). Rate-limited like the other profile messages. */
  private async onBadge(p: Player, skill: Skill | null) {
    if (!p.buckets.misc.take()) return;
    try {
      const badge = await this.store.worlds.setShowOff(p.uid, skill, loadGameData().progression);
      this.setProfile(p, { badge });
    } catch (err) {
      this.log.warn({ err }, 'badge not saved');
    }
  }

  // ───────────────────────────────────────────── office shop and gifts (P17.26b)
  /** Office gifts and the office board need personal worlds (the account store) on. */
  private get officeOpen(): boolean {
    return this.opts.clientConfig.flags.worlds === true;
  }

  /** My hearts with each character: on join (when the characters are here) and after each gift. */
  private async sendFriendship(p: Player): Promise<void> {
    if (!this.officeOpen || !this.npcDirector) return;
    try {
      p.conn?.send({ t: 'friendship', hearts: await heartsOfUser(this.store.worlds, p.uid) });
    } catch (err) {
      this.log.warn({ err }, 'friendship not read');
    }
  }

  /** My bag and money in the office, as a world shows them (`world:inv`). */
  private async sendOfficeInv(p: Player): Promise<void> {
    const inv = await officeInventory(this.store.worlds, p.uid, loadGameData(), Date.now());
    p.conn?.send({ t: 'world:inv', ...inv });
  }

  private async onOfficeInv(p: Player): Promise<void> {
    if (!this.officeOpen || !p.buckets.misc.take()) return;
    try {
      await this.sendOfficeInv(p);
      await this.sendFriendship(p);
    } catch (err) {
      this.log.warn({ err }, 'office inventory not read');
    }
  }

  /**
   * A gift to a character (P17.26b). The talking rules decide where: the character is here, the giver is
   * on the open floor (never in a private room, desk pod or quiet zone) and within talking range. The
   * account action decides the rest (the bag, the day and week limits) in one transaction.
   */
  private async onGift(p: Player, m: Extract<C2SMsg, { t: 'gift' }>): Promise<void> {
    const reply = (ok: boolean, extra: { reason?: OfficeRefusal; taste?: Taste; hearts?: Record<string, number> }) =>
      p.conn?.send({ t: 'gift:result', key: m.key, npcId: m.npcId, ok, ...extra });
    if (!this.officeOpen || !this.npcDirector) return reply(false, { reason: 'disabled' });
    if (!p.buckets.misc.take()) return reply(false, { reason: 'rate' });
    const npc = this.npcDirector.get(m.npcId);
    const who = giftNpcOf(m.npcId);
    if (!npc || !who) return reply(false, { reason: 'gone' });
    if (NPC_FORBIDDEN.includes(this.placed(p).zoneKind ?? 'area')) return reply(false, { reason: 'zone' });
    const reach = (NPC_TALK_TILES + NPC_TALK_SLACK_TILES) * TILE;
    if (Math.hypot(npc.state.x - p.x, npc.state.y - p.y) > reach) return reply(false, { reason: 'range' });
    const now = Date.now();
    try {
      const r = await officeGift(this.store.worlds, loadGameData(), {
        userId: p.uid,
        npc: who,
        item: m.item,
        key: m.key,
        day: officeDayOf(now),
        now,
      });
      if (!r.ok) return reply(false, { reason: r.reason });
      reply(true, { taste: r.taste, hearts: r.hearts });
      p.conn?.send({ t: 'friendship', hearts: r.hearts });
      await this.sendOfficeInv(p);
    } catch (err) {
      this.log.warn({ err }, 'gift failed');
      reply(false, { reason: 'conflict' });
    }
  }

  /** A purchase at the office shop board (P17.26b): only standing in front of it (its `shop` zone). */
  private async onOfficeBuy(p: Player, m: Extract<C2SMsg, { t: 'office:buy' }>): Promise<void> {
    const reply = (ok: boolean, reason?: OfficeRefusal) =>
      p.conn?.send({ t: 'office:bought', key: m.key, item: m.item, ok, ...(reason ? { reason } : {}) });
    if (!this.officeOpen) return reply(false, 'disabled');
    if (!p.buckets.misc.take()) return reply(false, 'rate');
    if (zoneAt(this.map, p.x, p.y)?.kind !== 'shop') return reply(false, 'range');
    try {
      const r = await officeBuy(this.store.worlds, loadGameData(), { userId: p.uid, item: m.item, key: m.key, now: Date.now() });
      if (!r.ok) return reply(false, r.reason);
      reply(true);
      await this.sendOfficeInv(p);
    } catch (err) {
      this.log.warn({ err }, 'office purchase failed');
      reply(false, 'conflict');
    }
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

  /**
   * The server's verdict on a step into a desk portal: the pod's rectangle, the pod's access and
   * the visitor's own position and admission. `ownerUid` is the desk owner's (never sent).
   */
  private portalVerdict(
    p: Player,
    deskId: string,
  ): { result: 'ok'; ownerUid: string } | { result: PortalRefusal } {
    const spot = this.spots.get(deskId);
    if (!spot) return { result: 'unknown' };
    if (!inPortal(spot.zone, p.x, p.y)) return { result: 'outside' };
    const d = this.desks.get(deskId);
    if (!d) return { result: 'no_world' }; // an unclaimed pod has no owner, so no world
    const verdict = checkPortal(
      deskGate(deskId, spot.zone, d.access),
      { x: p.x, y: p.y },
      { isOwner: d.ownerUid === p.uid, admitted: p.admitted.has(deskId) },
    );
    if (verdict !== 'ok') return { result: verdict };
    return { result: 'ok', ownerUid: d.ownerUid };
  }

  /**
   * P17.8 (ADR-053): step through a portal. Only the server's position and rights count. The
   * answer goes to the person who asked and nobody else; nobody moves here (the transfer is
   * P17.9), so presence, media links, pods and chat do not change. The rights are checked again
   * after the world lookup, in case the person moved or the desk changed meanwhile.
   */
  private async onPortalEnter(p: Player, id: string) {
    if (!p.buckets.misc.take()) return;
    const refuse = (reason: PortalRefusal) => p.conn?.send({ t: 'portal:refused', id, reason });
    // ADR-053: personal worlds stay closed until the `worlds` flag is on (checkpoint O)
    if (this.opts.clientConfig.flags.worlds !== true) return refuse('disabled');
    const deskId = deskOfPortal(id);
    const first = deskId ? this.portalVerdict(p, deskId) : undefined;
    if (!deskId || !first) return refuse('unknown');
    if (first.result !== 'ok') return refuse(first.result);
    // the owner's first step through their desk creates their world (P17.14); visitors never do
    const world = await (first.ownerUid === p.uid
      ? ensureOwnerWorld(this.store.worlds, first.ownerUid, Date.now())
      : this.store.worldOf(first.ownerUid)
    ).catch(() => null);
    if (!world) return refuse('no_world');
    const room = await this.worlds.enter(world.id).catch(() => null);
    if (!room || room.disposed) return refuse('no_world');
    // the position, the rights and the desk's owner may have changed while the world loaded
    const again = this.portalVerdict(p, deskId);
    const moved = again.result !== 'ok' || again.ownerUid !== first.ownerUid;
    if (moved || p.world || !p.conn || !this.players.has(p.id)) {
      this.worlds.release(room);
      return refuse(again.result === 'ok' ? 'no_world' : again.result);
    }
    p.conn.send({ t: 'portal:go', id, worldId: world.id, spawn: room.spawn() });
    this.enterWorld(p, room, p.conn, this.desks.get(deskId)?.ownerName ?? '', deskId);
  }

  /**
   * Office → world (P17.9): the person leaves this office's presence, media and links and joins
   * the world. Nothing of the office is sent to them after this (`broadcast` and `recomputeLinks`
   * only reach people in `players`), and nothing of the world reaches the office.
   */
  private enterWorld(p: Player, room: WorldRoom, conn: Conn, owner: string, deskId: string) {
    const from = p.zone;
    this.players.delete(p.id);
    this.opts.npcs?.talk?.engine.end(p.uid);
    void this.gate?.left(p.id, p.scope);
    // P17.15b: the office keeps the person in its list as "in a world" (neutral), never where
    p.profile.inWorld = true;
    this.away.set(p.id, p);
    this.broadcast({ t: 'profile', profile: p.profile });
    this.onZoneChange(p, from, undefined);
    p.zone = undefined;
    p.peers = '';
    conn.send({ t: 'peers', peers: [] });
    this.recomputeLinks();
    p.world = {
      room,
      deskId,
      member: room.join(
        conn,
        { id: p.id, uid: p.uid, name: p.profile.name, avatar: p.profile.avatar },
        this.worldMedia(),
        owner,
      ),
    };
    this.log.info({ player: p.id, world: room.id }, 'entered world');
  }

  /**
   * The rights to be in a world at all, read again whenever it matters (P17.32): the desk's own
   * rules, for its owner and for the people the owner let in. `no_world` when the desk is unclaimed.
   */
  private worldGate(p: Player, from: NonNullable<Player['world']>, id: string): 'ok' | PortalRefusal {
    if (p.world !== from || from.room.caveMouthAt(from.member) !== id) return 'outside';
    const desk = this.desks.get(from.deskId);
    if (!desk) return 'no_world';
    if (!portalAllows(desk.access, desk.ownerUid === p.uid, p.admitted.has(from.deskId))) return 'no_permission';
    return 'ok';
  }

  /**
   * World → cave (P17.32): only the mouth under the person's own feet opens a cave, and only while
   * they may be in this world. The cave is its own room with its own chat and media: the people left
   * in the world neither hear nor see the people who go in, and the reverse holds too.
   */
  private async onCaveEnter(p: Player, id: string) {
    const refuse = (reason: PortalRefusal) => p.conn?.send({ t: 'portal:refused', id, reason });
    const from = p.world;
    if (!from || from.room.cave) return refuse('unknown');
    if (this.opts.clientConfig.flags.worlds !== true) return refuse('disabled');
    const first = this.worldGate(p, from, id);
    if (first !== 'ok') return refuse(first);
    const room = await this.worlds.enter(id).catch(() => null);
    if (!room || room.disposed) return refuse('no_world');
    // the person may have moved, left or lost the right while the cave loaded
    const again = this.worldGate(p, from, id);
    if (again !== 'ok' || !p.conn) {
      this.worlds.release(room);
      return refuse(again === 'ok' ? 'no_world' : again);
    }
    this.moveWorld(p, room, from.deskId);
  }

  /**
   * Cave → world (P17.32): the pad takes the person back to the world the cave opens from, beside its
   * mouth. Leaving needs no right: anyone inside may always step out.
   */
  private async leaveCave(p: Player) {
    const from = p.world;
    const cave = from?.room.cave;
    if (!from || !cave) return;
    const parent = await this.worlds.enter(cave.worldId).catch(() => null);
    if (!parent || parent.disposed) return p.conn?.send({ t: 'portal:refused', id: RETURN_PORTAL_ID, reason: 'no_world' });
    if (p.world !== from || !p.conn) {
      this.worlds.release(parent);
      return;
    }
    this.moveWorld(p, parent, from.deskId, parent.arrivalNextTo(cave.mouthX, cave.mouthY));
  }

  /**
   * Between two worlds of one desk (a cave in or out): the person leaves the room they are in, which
   * tells the people there, and joins the other, which welcomes them with its own terrain and people.
   */
  private moveWorld(p: Player, room: WorldRoom, deskId: string, at?: { x: number; y: number }) {
    const conn = p.conn;
    const old = p.world;
    if (!conn || !old) return;
    p.world = undefined;
    old.room.leave(old.member);
    const owner = this.desks.get(deskId)?.ownerName ?? '';
    const member = room.join(
      conn,
      { id: p.id, uid: p.uid, name: p.profile.name, avatar: p.profile.avatar },
      this.worldMedia(),
      owner,
      at,
    );
    p.world = { room, deskId, member };
    this.log.info({ player: p.id, world: room.id }, 'moved world');
  }

  /** The SFU a world's members use, when this server runs one (ADR-031). */
  private worldMedia(): WorldMedia | undefined {
    const sfu = this.opts.sfu;
    return sfu ? { api: sfu.api, url: sfu.url, prefix: sfu.prefix, log: this.log } : undefined;
  }

  /** Take the person out of their world. Nothing is sent to them here. */
  private detachWorld(p: Player) {
    const w = p.world;
    if (!w) return;
    p.world = undefined;
    this.away.delete(p.id);
    delete p.profile.inWorld;
    w.room.leave(w.member);
  }

  /** Everyone this space lists: the people on the floor and those inside a world (P17.15b). */
  private roster(): PlayerProfile[] {
    return [...this.players.values(), ...this.away.values()].map((q) => q.profile);
  }

  /**
   * World → office: back at the desk (a visitor: the hub), with the office presence, media and
   * links again. Everyone in the office hears the person arrive.
   */
  private leaveWorld(p: Player) {
    if (!p.world) return;
    this.detachWorld(p);
    const home = this.homeSpot(p.uid);
    p.x = home.x;
    p.y = home.y;
    p.pose = 'stand';
    p.dir = 'down';
    p.lastMoveAt = Date.now();
    p.zone = zoneAt(this.map, p.x, p.y);
    p.scope = mediaScope(this.placed(p));
    this.players.set(p.id, p);
    this.onZoneChange(p, undefined, p.zone);
    void this.gate?.joined(this.gp(p));
    this.broadcast({ t: 'profile', profile: p.profile }, p.id);
    this.recomputeLinks();
    p.conn?.send({ t: 'world:exit' });
    // what changed in the office while away (arrivals, departures, desks): the whole roster again
    p.conn?.send({ t: 'roster', profiles: this.roster(), desks: this.deskStates() });
    // the xp earned in the world may have opened a level: the card shows it from now on (P17.31)
    void this.refreshBadge(p);
    this.log.info({ player: p.id }, 'left world');
  }

  /** Where someone returning from a world stands: their desk's guest spot, else the hub spawn. */
  private homeSpot(uid: string): { x: number; y: number } {
    const myDesk = this.deskOf(uid);
    const spot = myDesk ? this.spots.get(myDesk.deskId) : undefined;
    if (spot) {
      const g = cellPos(this.map, spot.guest);
      return nearestFree(this.map, g.x, g.y);
    }
    const s = defaultSpawn(this.map);
    return nearestFree(this.map, s.x, s.y);
  }

  /**
   * Messages from someone inside a world: moves, leaving, ping, chat and signalling inside the
   * world (P17.11), media tokens, and the return pad (P17.10: the only portal inside a world,
   * checked against the person's position). Office-only messages do nothing there.
   */
  private onWorldMessage(p: Player, m: C2SMsg) {
    const w = p.world;
    if (!w) return;
    switch (m.t) {
      case 'move':
        if (!p.buckets.move.take()) return;
        return w.room.move(w.member, m);
      case 'world:leave':
        if (!p.buckets.misc.take()) return;
        return this.leaveWorld(p);
      case 'world:act':
        // P17.20: the server decides; a refusal says which request and why, and nothing changes
        if (this.opts.clientConfig.flags.worlds !== true)
          return p.conn?.send({ t: 'world:refused', op: m.op, reason: 'disabled' });
        if (!p.buckets.act.take()) return p.conn?.send({ t: 'world:refused', op: m.op, reason: 'rate' });
        return w.room.act(w.member, m);
      case 'chat':
        if (!p.buckets.chat.take()) return p.conn?.send({ t: 'error', code: 'rate_limited' });
        return w.room.chat(w.member, m.body);
      case 'rtc': {
        if (!p.buckets.rtc.take()) return;
        const verdict = w.room.signal(w.member, m.to, m.data);
        if (verdict !== 'ok') p.conn?.send({ t: 'error', code: verdict === 'off' ? 'rtc_off' : 'rtc_not_linked' });
        return;
      }
      case 'media:token':
        if (!p.buckets.misc.take()) return;
        return w.room.refreshMedia(w.member);
      case 'portal:enter': {
        if (!p.buckets.misc.take()) return;
        if (m.id === RETURN_PORTAL_ID) {
          if (!w.room.atReturn(w.member))
            return p.conn?.send({ t: 'portal:refused', id: m.id, reason: 'outside' });
          // the pad of a cave goes back to its world; the pad of a world goes back to the office
          if (w.room.cave) return void this.leaveCave(p);
          return this.leaveWorld(p);
        }
        if (isCaveId(m.id)) return void this.onCaveEnter(p, m.id);
        return p.conn?.send({ t: 'portal:refused', id: m.id, reason: 'unknown' });
      }
      // P17.27: the owner answers a knock and edits the visitor matrix from inside their world too
      case 'knock:answer':
        return this.onKnockAnswer(p, m.visitor, m.accept);
      case 'world:visitors':
        return void this.onVisitorsGet(p);
      case 'world:visitors:set':
        return void this.onVisitorsSet(p, m.edit);
      case 'ping':
        return p.conn?.send({ t: 'pong', at: m.at });
      case 'leave':
        return this.remove(p);
      default:
        return;
    }
  }

  // ───────────────────────────────────────────── visitor matrix (P17.27)
  /** An opaque, stable name for a person in one world's list: user ids never reach a client. */
  private visitorRef(worldId: string, uid: string): string {
    return createHash('sha256').update(`agora-visitor:${worldId}:${uid}`).digest('hex').slice(0, 16);
  }

  /** The owner's view of their world's matrix: the people they set, and the visitors here now. */
  private visitorView(worldId: string, ownerUid: string, settings: Record<string, unknown>) {
    const entries = visitorsOf(settings);
    const here = new Map<string, string>();
    for (const room of this.worlds.openRoomsOf(worldId))
      for (const person of room.people()) if (person.uid !== ownerUid) here.set(person.uid, person.name);
    const people: VisitorView[] = [];
    for (const [uid, e] of Object.entries(entries))
      people.push({
        ref: this.visitorRef(worldId, uid),
        name: e.name,
        grants: e.grants ? [...e.grants] : null,
        listed: e.listed === true,
        here: here.has(uid),
      });
    for (const [uid, name] of here)
      if (!entries[uid])
        people.push({ ref: this.visitorRef(worldId, uid), name, grants: null, listed: false, here: true });
    people.sort((a, b) => Number(b.here) - Number(a.here) || a.name.localeCompare(b.name));
    return { t: 'world:visitors' as const, away: awayOf(settings), grants: cleanGrants(settings.grants), people };
  }

  /** Every connection of a person, on the office floor or in a world. */
  private reachableOf(uid: string): Player[] {
    const out: Player[] = [];
    for (const p of [...this.players.values(), ...this.away.values()]) if (p.uid === uid && p.conn) out.push(p);
    return out;
  }

  private async onVisitorsGet(p: Player): Promise<void> {
    const refuse = (reason: VisitorRefusal) => p.conn?.send({ t: 'world:visitors:refused', reason });
    if (!this.officeOpen) return refuse('disabled');
    if (!p.buckets.misc.take()) return refuse('rate');
    const world = await this.store.worldOf(p.uid).catch(() => null);
    if (!world) return refuse('no_world');
    p.conn?.send(this.visitorView(world.id, p.uid, world.settings));
  }

  /**
   * The owner changes their matrix. Only the owner's own world is ever written (looked up from their
   * user id, never from the message); the people they name are resolved here. The change reaches the
   * open rooms at once, so the next action of every visitor is judged by it.
   */
  private async onVisitorsSet(p: Player, edit: Extract<C2SMsg, { t: 'world:visitors:set' }>['edit']): Promise<void> {
    const refuse = (reason: VisitorRefusal) => p.conn?.send({ t: 'world:visitors:refused', reason });
    if (!this.officeOpen) return refuse('disabled');
    if (!p.buckets.misc.take()) return refuse('rate');
    const world = await this.store.worldOf(p.uid).catch(() => null);
    if (!world) return refuse('no_world');
    let change: VisitorEdit;
    if (edit.op === 'defaults' || edit.op === 'away') change = edit;
    else {
      const who = this.resolveVisitor(world.id, world.settings, edit);
      if (!who) return refuse('unknown');
      if (who.uid === p.uid) return refuse('self');
      change =
        edit.op === 'forget'
          ? { op: 'forget', uid: who.uid }
          : edit.op === 'person'
            ? { op: 'person', uid: who.uid, name: who.name, grants: edit.grants }
            : { op: 'list', uid: who.uid, name: who.name, on: edit.on };
    }
    let refusal: VisitorRefusal | null = null;
    const settings = await this.store.worlds
      .updateSettings(world.id, (before) => {
        const r = applyVisitorEdit(before, change);
        if (!r.ok) {
          refusal = r.reason;
          return null;
        }
        return r.settings;
      })
      .catch((err: unknown) => {
        this.log.warn({ err }, 'visitor matrix not saved');
        return null;
      });
    if (!settings) return refuse('no_world');
    if (refusal) return refuse(refusal);
    for (const room of this.worlds.openRoomsOf(world.id)) room.setSettings(settings);
    const view = this.visitorView(world.id, p.uid, settings);
    for (const o of this.reachableOf(p.uid)) o.conn?.send(view);
  }

  /** A person named in an edit: by their ref in this world's list, or by a session id here or in a world. */
  private resolveVisitor(
    worldId: string,
    settings: Record<string, unknown>,
    edit: { ref?: string; player?: string },
  ): { uid: string; name: string } | null {
    if (edit.player) {
      const q = this.players.get(edit.player) ?? this.away.get(edit.player);
      if (q) return { uid: q.uid, name: q.profile.name };
      for (const room of this.worlds.openRoomsOf(worldId))
        for (const person of room.people()) if (person.id === edit.player) return person;
      return null;
    }
    if (!edit.ref) return null;
    for (const [uid, e] of Object.entries(visitorsOf(settings)))
      if (this.visitorRef(worldId, uid) === edit.ref) return { uid, name: e.name };
    for (const room of this.worlds.openRoomsOf(worldId))
      for (const person of room.people()) if (this.visitorRef(worldId, person.uid) === edit.ref) return person;
    return null;
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
    // P17.27: the owner hears a knock in the office or in their world; away, their away rule decides
    const owners = this.reachableOf(d.ownerUid);
    if (owners.length === 0) return void this.knockWhileAway(p, deskId, d.ownerUid, reply);
    if (owners[0]!.profile.status === 'dnd') return reply('busy');
    p.knock = { deskId, until: Date.now() + KNOCK_MS };
    for (const o of owners) o.conn?.send({ t: 'knock', from: p.id, name: p.profile.name, deskId });
    reply('pending');
  }

  /**
   * A knock while the owner is away (P17.27, ADR-053 "away rule"): with the rule `list`, a person on
   * the owner's list is let in as if the owner had said yes; anyone else hears `away`. Read from the
   * owner's world settings, so it holds in every space.
   */
  private async knockWhileAway(
    p: Player,
    deskId: string,
    ownerUid: string,
    reply: (result: 'accepted' | 'away') => void,
  ): Promise<void> {
    if (!this.officeOpen) return reply('away');
    const world = await this.store.worldOf(ownerUid).catch(() => null);
    const d = this.desks.get(deskId);
    if (!world || !d || d.ownerUid !== ownerUid || !this.players.has(p.id)) return reply('away');
    if (!awayAllows(world.settings, p.uid)) return reply('away');
    // the owner may have come back meanwhile: a live answer is theirs to give, not the rule's
    if (this.reachableOf(ownerUid).length > 0) return reply('away');
    p.admitted.add(deskId);
    p.conn?.send({ t: 'admitted', deskIds: [...p.admitted] });
    reply('accepted');
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
    // The cat sleeps while nobody is here; it is sent only when it changed.
    if (this.officeCat && this.connectedCount && this.officeCat.tick(now))
      this.broadcast({ t: 'pet:state', pets: [this.officeCat.snapshot()] });
    // Characters too: asleep while nobody is here (no ticks, no decisions), sent on change.
    if (this.npcDirector && this.connectedCount) {
      this.npcDirector.setPersonas(this.opts.npcs!.personas());
      if (this.npcDirector.tick(now))
        this.broadcast({ t: 'npc:state', npcs: this.npcDirector.snapshot() });
      for (const e of this.npcDirector.takeEvents()) this.sendNpcEmote(e);
      for (const l of this.npcDirector.takeSays()) this.sendNpcChat(l);
      this.sendNpcMinds(now);
    }
  }

  /**
   * The people characters may see (P15.3): connected, on the open floor. Anyone in a private
   * room, desk pod or quiet zone is left out, so no character approaches them and Clef never hears
   * of them. First names only; the key is the account id, which stays on the server.
   */
  private npcPeople(): NpcPerson[] {
    const open: Player[] = [];
    for (const p of this.players.values())
      if (p.conn && !NPC_FORBIDDEN.includes(this.placed(p).zoneKind ?? 'area')) open.push(p);
    const near = (a: Player, b: Player) =>
      Math.hypot(a.x - b.x, a.y - b.y) <= NPC_GROUP_TILES * TILE;
    return open.map((p) => ({
      key: p.uid,
      name: p.profile.name.trim().split(/\s+/)[0] ?? '',
      x: p.x,
      y: p.y,
      status: p.profile.status,
      sitting: p.pose === 'sit',
      joinedAt: p.joinedAt,
      group: open.filter((q) => q !== p && near(p, q)).length,
    }));
  }

  // ───────────────────────────────────────────── talking with characters (P15.4, ADR-045)
  private get talkLink(): NpcTalkLink | undefined {
    return this.npcDirector && this.opts.clientConfig.flags.npcTalk === true
      ? this.opts.npcs?.talk
      : undefined;
  }

  /** Tell a person whether Talk needs the AI notice and whether they accepted it. */
  private sendNpcConsent(p: Player) {
    const t = this.talkLink;
    if (!t) return;
    void t.consent
      .has(p.uid)
      .then((has) => {
        p.npcConsent = !t.notice.needed || has;
        p.conn?.send({ t: 'npc:consent', consent: { ...t.notice, ok: p.npcConsent } });
      })
      .catch((err) => this.log.warn({ err: String(err) }, 'npc consent lookup failed'));
  }

  private onNpcConsent(p: Player, accept: boolean) {
    const t = this.talkLink;
    if (!t || !p.buckets.misc.take()) return;
    // withdrawing the AI notice also drops what is being said and every note kept about the person
    if (!accept) {
      t.engine.end(p.uid, { keep: false });
      void t.memory?.forget(p.uid).catch(() => {});
    }
    void t.consent
      .set(p.uid, accept)
      .then(() => {
        p.npcConsent = !t.notice.needed || accept;
        p.conn?.send({ t: 'npc:consent', consent: { ...t.notice, ok: p.npcConsent } });
      })
      .catch((err) => this.log.warn({ err: String(err) }, 'npc consent save failed'));
  }

  /** What does this character remember about me? Only ever sent to the person it is about. */
  private onNpcRecall(p: Player, npcId: string) {
    const t = this.talkLink;
    if (!t?.memory || !p.buckets.misc.take()) return;
    const id = npcId.replace(/^npc:/, '');
    void t.memory
      .recall(p.uid, id)
      .then((summary) => p.conn?.send({ t: 'npc:memory', id: npcId, summary }))
      .catch((err) => this.log.warn({ err: String(err) }, 'npc recall failed'));
  }

  /** "Forget me": every note every character keeps about this person, and any chat still open. */
  private onNpcForget(p: Player) {
    const t = this.talkLink;
    if (!t || !p.buckets.misc.take()) return;
    t.engine.end(p.uid, { keep: false });
    void (t.memory?.forget(p.uid) ?? Promise.resolve())
      .then(() => p.conn?.send({ t: 'npc:forgot' }))
      .catch((err) => this.log.warn({ err: String(err) }, 'npc forget failed'));
  }

  /** Everyone a line said by `from` would reach, like a line of nearby chat. */
  private hearers(from: Placed): Player[] {
    return [...this.players.values()].filter((q) => q.conn && chatReaches(from, this.placed(q)));
  }

  /**
   * A Talk-box message (P15.4). The server decides: the flag, the character being here, the
   * speaker on the open floor (never inside a private room, desk pod or quiet zone) and within
   * talking range, the AI notice accepted, and the rate. Only then does the message reach the brain.
   */
  private onNpcTalk(p: Player, m: Extract<C2SMsg, { t: 'npc:talk' }>) {
    const refuse = (reason: NpcRefusal) => p.conn?.send({ t: 'npc:refused', id: m.npcId, reason });
    const link = this.talkLink;
    if (!link) return refuse('off');
    if (!p.buckets.talk.take() || p.talking.has(m.npcId)) return refuse('rate');
    const npc = this.npcDirector!.get(m.npcId);
    if (!npc) return refuse('gone');
    if (NPC_FORBIDDEN.includes(this.placed(p).zoneKind ?? 'area')) return refuse('zone');
    const reach = (NPC_TALK_TILES + NPC_TALK_SLACK_TILES) * TILE;
    if (Math.hypot(npc.state.x - p.x, npc.state.y - p.y) > reach) return refuse('range');
    if (link.notice.needed && !p.npcConsent) return refuse('consent');
    npc.attend(p, Date.now());
    void this.runTalk(p, npc, m.body, link);
  }

  private async runTalk(p: Player, npc: Npc, body: string, link: NpcTalkLink) {
    const id = npc.state.id;
    p.talking.add(id);
    let typing = false;
    const at = () => ({ id, x: npc.state.x, y: npc.state.y }) satisfies Placed;
    try {
      const minute = Math.floor(this.opts.npcs!.clock(Date.now()));
      const memory = await link.memory?.recall(p.uid, npc.persona.id).catch(() => null);
      const res = await link.engine.handle(
        {
          persona: npc.persona,
          memory: memory ?? undefined,
          cast: this.npcDirector!.all.map((n) => ({ id: n.persona.id, name: n.persona.name })),
          speaker: { key: p.uid, name: p.profile.name },
          body,
          place: regionAt(this.map, npc.state.x, npc.state.y)?.nameFr ?? '',
          time: `${String(Math.floor(minute / 60) % 24).padStart(2, '0')}:${String(minute % 60).padStart(2, '0')}`,
          mapNames: this.map.regions.flatMap((r) => [r.nameFr, r.nameEn]),
        },
        {
          thinking: () => {
            typing = true;
            for (const q of this.hearers(at())) q.conn!.send({ t: 'npc:typing', id, on: true });
          },
        },
      );
      if (typing)
        for (const q of this.hearers(at())) q.conn!.send({ t: 'npc:typing', id, on: false });
      // Recipients are decided now, when the line is said: exactly the people nearby chat from the
      // character would reach. Someone who walked into a private room while it was thinking gets nothing.
      if (res.say) {
        const mid = randomUUID();
        const sentAt = Date.now();
        const heard = this.hearers(at());
        for (const q of heard)
          q.conn!.send({
            t: 'npc:say',
            id,
            to: p.id,
            mid,
            body: res.say,
            at: sentAt,
            ...(res.sources?.length ? { src: res.sources } : {}),
          });
        if (link.voice && this.opts.clientConfig.flags.npcVoice === true)
          void this.sendNpcVoice(link, at, res.say, res.lang === 'en' ? 'en' : 'fr', mid, heard);
      }
      if (res.emote) npc.gesture(res.emote);
      if (res.action !== 'none') npc.errand(ACTION_ACTIVITY[res.action], Date.now());
      else npc.attend(p, Date.now());
    } catch (err) {
      this.log.warn({ npc: id, err: String(err) }, 'npc talk failed');
      if (typing)
        for (const q of this.hearers(at())) q.conn!.send({ t: 'npc:typing', id, on: false });
    } finally {
      p.talking.delete(id);
    }
  }

  /**
   * A line one character says to another reaches exactly the people a nearby-chat line from the
   * speaker would reach, decided now. The chat itself only runs while someone is in earshot.
   */
  private sendNpcChat(l: NpcSay) {
    const from: Placed = { id: l.from, x: l.x, y: l.y };
    const mid = randomUUID();
    const at = Date.now();
    for (const p of this.hearers(from))
      p.conn!.send({ t: 'npc:say', id: l.from, to: l.to, mid, body: l.body, at });
  }

  /**
   * The spoken version of a line (P15.6). Only people who asked for voices, who got the line, and who
   * are still in reach of the character (and not in a quiet zone) are sent the clip, decided when it
   * is ready: someone who walked into a private room meanwhile gets nothing.
   */
  private async sendNpcVoice(
    link: NpcTalkLink,
    at: () => Placed,
    text: string,
    lang: 'fr' | 'en',
    mid: string,
    heard: Player[],
  ) {
    if (!heard.some((q) => q.npcVoice)) return; // nobody asked for voices: nothing is even synthesised
    try {
      const clip = await link.voice!.speak(text, lang);
      if (!clip) return;
      const still = new Set(this.hearers(at()).map((q) => q.id));
      const data = clip.opus.toString('base64');
      for (const q of heard)
        if (q.npcVoice && q.conn && still.has(q.id) && this.placed(q).zoneKind !== 'quiet')
          q.conn.send({ t: 'npc:voice', id: at().id, mid, data, ms: clip.ms });
    } catch (err) {
      this.log.warn({ err: String(err) }, 'npc voice failed');
    }
  }

  /** A character's wave reaches exactly the people a nearby-chat line from it would reach. */
  private sendNpcEmote(e: NpcEvent) {
    const from: Placed = { id: e.npcId, x: e.x, y: e.y };
    for (const p of this.players.values())
      if (p.conn && chatReaches(from, this.placed(p)))
        p.conn.send({ t: 'npc:emote', id: e.npcId, emote: e.emote });
  }

  private mindsSent = { at: 0, key: '' };
  /** The brain view, about once a second when it changed, only to people allowed to see it. */
  private sendNpcMinds(now: number) {
    if (!this.npcDirector || now - this.mindsSent.at < 1000) return;
    const watchers = [...this.players.values()].filter((p) => p.conn && p.npcDebug);
    if (!watchers.length) return;
    const minds = this.npcDirector.minds();
    const brain = this.npcDirector.brainStatus;
    const key = JSON.stringify([brain, minds]);
    if (key === this.mindsSent.key) return;
    this.mindsSent = { at: now, key };
    for (const p of watchers) p.conn!.send({ t: 'npc:mind', brain, minds });
  }

  broadcast(msg: S2CMsg, exceptId?: string) {
    for (const p of this.players.values()) if (p.conn && p.id !== exceptId) p.conn.send(msg);
  }
}
