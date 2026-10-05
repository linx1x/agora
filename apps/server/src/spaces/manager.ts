import { randomBytes } from 'node:crypto';
import {
  DEFAULT_SPACE,
  can,
  parseMap,
  remapTmj,
  spaceCan,
  strongerRole,
  type PlatformAction,
  type PlatformRole,
  type SpaceDetail,
  type SpaceRole,
  type SpaceSettings,
  type SpaceSummary,
  type Tmj,
} from '@agora/shared';
import type { Config } from '../config';
import { roomStore, type Store, type StoredSpace } from '../db/store';
import { SpaceRoom } from '../world/room';
import type { SfuApi } from '../media/gate';

interface Logger {
  info: (o: object, m?: string) => void;
  warn: (o: object, m?: string) => void;
}

/** Who is asking: account id and effective platform role (ADR-032). */
export interface Actor {
  uid: string;
  /**
   * Platform role. In passkey mode it is the account's role. In the pilot modes (dev,
   * access-code) the env grants still apply: ADMIN_IDS/ADMIN_CODE act as owner,
   * BUILDER_IDS/BUILDER_CODE as builder.
   */
  role: PlatformRole;
}

/** What someone may do in one space. */
export type SpacePermission = 'enter' | 'settings' | 'invite' | 'build';
/** The platform permission that grants it in every space. */
const PLATFORM_GRANT: Record<SpacePermission, PlatformAction> = {
  enter: 'space.enter_any',
  settings: 'space.settings',
  invite: 'invite.manage',
  build: 'map.build',
};

const IDLE_UNLOAD_MS = 5 * 60_000;

/**
 * Spaces and their rooms (P2.3, ADR-029). One SpaceRoom per loaded space, created on
 * first entry and unloaded after a few idle minutes (the default space stays loaded).
 * Every space starts from a template map (only `hq` today) and keeps its own edited map,
 * desks and Everyone chat.
 */
export class SpaceManager {
  private rooms = new Map<string, Promise<SpaceRoom>>();
  private loaded = new Map<string, SpaceRoom>();
  private idleSince = new Map<string, number>();
  private sweeper?: NodeJS.Timeout;

  constructor(
    private cfg: Config,
    private store: Store,
    private log: Logger,
    /** template id → generated Tiled map (fresh copy each call) */
    private template: (id: string) => Tmj,
    /** SFU API shared by every space (MEDIA_BACKEND=livekit, ADR-031) */
    private sfu?: SfuApi,
  ) {}

  /** Create the default space on first boot (its data predates spaces). */
  async init() {
    if (!(await this.store.getSpaceBySlug(DEFAULT_SPACE)))
      await this.store.createSpace({
        id: DEFAULT_SPACE,
        slug: DEFAULT_SPACE,
        name: this.cfg.hqName,
        ownerUid: null,
        template: 'hq',
        settings: { access: 'open' },
        createdAt: Date.now(),
        archivedAt: null,
      });
  }

  start() {
    this.sweeper = setInterval(() => void this.sweep(), 60_000);
    this.sweeper.unref?.();
  }

  async stop() {
    if (this.sweeper) clearInterval(this.sweeper);
    for (const room of this.loaded.values()) {
      room.stop();
      await room.flushMap();
    }
  }

  get connectedCount() {
    let n = 0;
    for (const r of this.loaded.values()) n += r.connectedCount;
    return n;
  }

  /** A loaded room, if any (no loading). */
  loadedRoom(spaceId: string) {
    return this.loaded.get(spaceId);
  }

  isDefault(s: StoredSpace) {
    return s.id === DEFAULT_SPACE;
  }

  /** Settings with server defaults filled in. The default space is always open. */
  effective(s: StoredSpace): SpaceSettings {
    const o = s.settings;
    return {
      name: s.name,
      access: this.isDefault(s) ? 'open' : (o.access ?? 'invite'),
      capacity: o.capacity ?? this.cfg.capacity,
      connectR: o.connectR ?? this.cfg.connectR,
      disconnectR: o.disconnectR ?? this.cfg.disconnectR,
      videoCap: o.videoCap ?? this.cfg.videoCap,
    };
  }

  async get(slug: string): Promise<StoredSpace | null> {
    const s = await this.store.getSpaceBySlug(slug);
    return s && !s.archivedAt ? s : null;
  }

  /** The actor's role in a space (null = not a member), for display and pilot rules. */
  async roleOf(s: StoredSpace, a: Actor): Promise<SpaceRole | null> {
    const m = await this.store.getMember(s.id, a.uid);
    return this.spaceRole(s, a, m?.role ?? null);
  }

  private spaceRole(s: StoredSpace, a: Actor, member: SpaceRole | null): SpaceRole | null {
    let role: SpaceRole | null = s.ownerUid && s.ownerUid === a.uid ? 'owner' : member;
    if (can(a.role, 'map.build')) role = strongerRole(role, 'builder');
    if (can(a.role, 'space.enter_any')) role = strongerRole(role, 'admin');
    return role;
  }

  /**
   * The single permission check for spaces (P2.12). The platform role decides first
   * (docs/AUTH.md matrix). Then the space's own list: in passkey mode it only says who
   * may enter an invite-only space; in the pilot modes its roles still grant settings,
   * invites and building as in ADR-029.
   */
  async allowed(s: StoredSpace, a: Actor, what: SpacePermission): Promise<boolean> {
    const m = await this.store.getMember(s.id, a.uid);
    return this.decide(s, a, what, m?.role ?? null);
  }

  private decide(
    s: StoredSpace,
    a: Actor,
    what: SpacePermission,
    member: SpaceRole | null,
  ): boolean {
    if (!can(a.role, 'space.enter')) return false;
    const role = this.spaceRole(s, a, member);
    const entry =
      can(a.role, PLATFORM_GRANT.enter) || spaceCan(role, 'enter', this.effective(s).access);
    if (what === 'enter' || !entry) return entry;
    if (can(a.role, PLATFORM_GRANT[what])) return true;
    if (this.cfg.authMode === 'passkey') return false;
    return spaceCan(role, what === 'build' ? 'build' : 'manage');
  }

  async canEnter(s: StoredSpace, a: Actor) {
    return this.allowed(s, a, 'enter');
  }

  summary(s: StoredSpace, role: SpaceRole | null): SpaceSummary {
    return {
      id: s.id,
      slug: s.slug,
      name: s.name,
      access: this.effective(s).access,
      role,
      online: this.loaded.get(s.id)?.connectedCount ?? 0,
      isDefault: this.isDefault(s),
    };
  }

  async detail(s: StoredSpace, a: Actor): Promise<SpaceDetail> {
    const m = await this.store.getMember(s.id, a.uid);
    const member = m?.role ?? null;
    return {
      ...this.summary(s, this.spaceRole(s, a, member)),
      settings: this.effective(s),
      canManage: this.decide(s, a, 'settings', member),
      canInvite: this.decide(s, a, 'invite', member),
      displayName: m?.displayName ?? null,
    };
  }

  /** Spaces the actor may enter: open ones, their memberships, everything for admins. */
  async list(a: Actor): Promise<SpaceSummary[]> {
    const out: SpaceSummary[] = [];
    const mine = new Map((await this.store.membershipsOf(a.uid)).map((m) => [m.spaceId, m]));
    for (const s of await this.store.listSpaces()) {
      if (s.archivedAt) continue;
      const member = mine.get(s.id)?.role ?? null;
      if (!this.decide(s, a, 'enter', member)) continue;
      out.push(this.summary(s, this.spaceRole(s, a, member)));
    }
    return out.sort(
      (x, y) => Number(y.isDefault) - Number(x.isDefault) || x.name.localeCompare(y.name, 'fr'),
    );
  }

  async ownedCount(uid: string) {
    return (await this.store.listSpaces()).filter((s) => s.ownerUid === uid && !s.archivedAt)
      .length;
  }

  /** Create a space owned by `uid`; null when the slug is taken. */
  async create(
    uid: string,
    input: { name: string; slug: string; access: 'open' | 'invite'; template: 'hq' },
  ): Promise<StoredSpace | null> {
    const s: StoredSpace = {
      id: `s-${randomBytes(6).toString('base64url')}`,
      slug: input.slug,
      name: input.name,
      ownerUid: uid,
      template: input.template,
      settings: { access: input.access },
      createdAt: Date.now(),
      archivedAt: null,
    };
    if (!(await this.store.createSpace(s))) return null;
    await this.store.upsertMember({ spaceId: s.id, uid, role: 'owner', displayName: null });
    this.log.info({ space: s.slug, owner: uid }, 'space created');
    return s;
  }

  async updateSettings(s: StoredSpace, next: SpaceSettings) {
    const settings: StoredSpace['settings'] = {
      access: this.isDefault(s) ? 'open' : next.access,
      capacity: next.capacity,
      connectR: next.connectR,
      disconnectR: next.disconnectR,
      videoCap: next.videoCap,
    };
    await this.store.updateSpace(s.id, { name: next.name, settings });
    const updated = { ...s, name: next.name, settings };
    this.loaded.get(s.id)?.applySettings(this.effective(updated));
    return updated;
  }

  /** The live room for a space, loading it (saved map or template) on first use. */
  room(s: StoredSpace): Promise<SpaceRoom> {
    let p = this.rooms.get(s.id);
    if (!p) {
      p = this.load(s);
      this.rooms.set(s.id, p);
      p.catch(() => this.rooms.delete(s.id));
    }
    this.idleSince.delete(s.id);
    return p;
  }

  private async load(s: StoredSpace): Promise<SpaceRoom> {
    const base = () => this.template(s.template);
    const generated = base();
    let tmj = generated;
    let mapRev = 0;
    const saved = await this.store.loadMap(s.id).catch(() => null);
    if (saved) {
      try {
        tmj = remapTmj(saved.tmj as Tmj, generated.tilesets[0]!);
        mapRev = saved.rev;
        this.log.info({ space: s.slug, rev: saved.rev }, 'using builder-edited map');
      } catch (err) {
        this.log.warn({ space: s.slug, err: String(err) }, 'saved map unreadable; using template');
      }
    }
    const eff = this.effective(s);
    const room = new SpaceRoom(
      parseMap(tmj),
      {
        mapId: s.id,
        name: s.name,
        capacity: eff.capacity,
        connectR: eff.connectR,
        disconnectR: eff.disconnectR,
        clientConfig: {
          mediaBackend: this.sfu ? 'livekit' : 'p2p',
          iceServers: this.sfu ? [] : this.cfg.iceServers,
          connectR: eff.connectR,
          disconnectR: eff.disconnectR,
          videoCap: eff.videoCap,
          flags: this.cfg.flags,
        },
        tmj,
        mapRev,
        baseTmj: base,
        sfu:
          this.sfu && this.cfg.livekit
            ? { api: this.sfu, url: this.cfg.livekit.url, prefix: this.cfg.livekit.prefix }
            : undefined,
      },
      roomStore(this.store, s.id),
      this.log,
    );
    await room.init();
    room.start();
    this.loaded.set(s.id, room);
    return room;
  }

  /** Unload rooms nobody has used for a while (never the default space). */
  async sweep(now = Date.now()) {
    for (const [id, room] of this.loaded) {
      if (id === DEFAULT_SPACE || !room.idle) {
        this.idleSince.delete(id);
        continue;
      }
      const since = this.idleSince.get(id) ?? now;
      this.idleSince.set(id, since);
      if (now - since < IDLE_UNLOAD_MS) continue;
      room.stop();
      await room.flushMap();
      this.loaded.delete(id);
      this.rooms.delete(id);
      this.idleSince.delete(id);
      this.log.info({ space: id }, 'space unloaded');
    }
  }
}
