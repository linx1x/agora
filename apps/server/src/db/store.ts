import { mkdirSync, readFileSync, writeFileSync, renameSync } from 'node:fs';
import { dirname } from 'node:path';
import pg from 'pg';
import type {
  Avatar,
  ChatMsg,
  DeskAccess,
  DeskDecor,
  InviteRole,
  PlatformRole,
  TicketKind,
  SpaceRole,
  SpaceSettings,
  SpaceTemplate,
} from '@agora/shared';
import { HISTORY_SIZE, inviteState, isPlatformRole, ticketStatus } from '@agora/shared';
import { withTimeout } from '../startup';

export interface StoredUser {
  uid: string;
  name: string;
  avatar: Avatar | null;
}

/** A user with their platform role (ADR-032). `users` rows double as accounts. */
export interface StoredAccount extends StoredUser {
  role: PlatformRole;
  disabledAt: number | null;
  /** the name the owner put on their invite (P2.15) */
  invitedName: string | null;
  createdAt: number;
  lastSeenAt: number;
}

/** A WebAuthn credential (P2.14). `id` and `publicKey` are base64url. */
export interface StoredPasskey {
  id: string;
  uid: string;
  publicKey: string;
  counter: number;
  transports: string[];
  deviceType: string;
  backedUp: boolean;
  label: string;
  createdAt: number;
  lastUsedAt: number | null;
}

/** Setup, invite or recovery link (P2.13, P2.15). Token and PIN are stored hashed. */
export interface StoredTicket {
  id: string;
  kind: TicketKind;
  tokenHash: string;
  pinHash: string | null;
  name: string;
  note: string;
  /** role the account gets (invite: assignable role; setup: owner; recovery: null) */
  role: PlatformRole | null;
  spaces: string[];
  /** recovery: the account it adds a passkey to */
  targetUid: string | null;
  /** invite: pilot identity to claim */
  pilotUid: string | null;
  expiresAt: number;
  createdBy: string | null;
  createdAt: number;
  revokedAt: number | null;
  usedAt: number | null;
  usedBy: string | null;
  pinFailures: number;
  lockedAt: number | null;
}

/** Everything a ticket does when it is used, applied in one transaction. */
export interface Redemption {
  ticketId: string;
  now: number;
  uid: string;
  /** invite/setup: create or update the account */
  account: { name: string; role: PlatformRole; invitedName: string | null } | null;
  passkey: StoredPasskey;
  /** invite-only spaces to put them on the list of */
  spaces: string[];
}

/**
 * A server-side session (P2.12). The cookie holds a random secret; only its SHA-256 is
 * stored. `id` is a separate public id, safe to show in "my devices" lists.
 */
export interface StoredSession {
  id: string;
  tokenHash: string;
  uid: string;
  createdAt: number;
  lastUsedAt: number;
  expiresAt: number;
  /** shared computer: short, non-persistent cookie */
  shared: boolean;
  userAgent: string;
  /** coarse address (IPv4 /24, IPv6 /48) */
  ip: string;
  /** legacy unlocks (BUILDER_CODE / ADMIN_CODE) in dev and access-code modes */
  grants: { builder?: boolean; admin?: boolean };
}

export interface StoredDesk {
  deskId: string;
  ownerUid: string;
  ownerName: string;
  access: DeskAccess;
  decor: DeskDecor;
}

/** A builder-edited map (ADR-021). `tmj` is the full Tiled JSON. */
export interface StoredMap {
  id: string;
  tmj: unknown;
  rev: number;
  updatedBy: string | null;
}

/** A space (P2.3). `settings` holds the stored overrides; see `effectiveSettings`. */
export interface StoredSpace {
  id: string;
  slug: string;
  name: string;
  ownerUid: string | null;
  template: SpaceTemplate;
  settings: Partial<Omit<SpaceSettings, 'name'>>;
  createdAt: number;
  archivedAt: number | null;
}

export interface StoredMember {
  spaceId: string;
  uid: string;
  role: SpaceRole;
  /** per-space display name override (P2.4) */
  displayName: string | null;
}

export interface StoredInvite {
  id: string;
  spaceId: string;
  /** sha256 of the token; the token itself is shown once and never stored */
  tokenHash: string;
  role: InviteRole;
  label: string;
  expiresAt: number | null;
  maxUses: number | null;
  uses: number;
  createdBy: string;
  createdAt: number;
  revokedAt: number | null;
}

/** What one SpaceRoom needs: chat, desks, presence and its map, scoped to one space. */
export interface RoomStore {
  saveMessage(m: ChatMsg): Promise<void>;
  recentMessages(n?: number): Promise<ChatMsg[]>;
  upsertUser(u: StoredUser): Promise<void>;
  getUser(uid: string): Promise<StoredUser | null>;
  presence(uid: string, event: 'join' | 'leave'): Promise<void>;
  loadDesks(): Promise<StoredDesk[]>;
  saveDesk(d: StoredDesk): Promise<void>;
  deleteDesk(deskId: string): Promise<void>;
  loadMap(id: string): Promise<StoredMap | null>;
  saveMap(m: StoredMap): Promise<void>;
  deleteMap(id: string): Promise<void>;
}

export interface Store {
  kind: 'postgres' | 'memory';
  init(): Promise<void>;
  saveMessage(spaceId: string, m: ChatMsg): Promise<void>;
  recentMessages(spaceId: string, n?: number): Promise<ChatMsg[]>;
  upsertUser(u: StoredUser): Promise<void>;
  getUser(uid: string): Promise<StoredUser | null>;
  presence(spaceId: string, uid: string, event: 'join' | 'leave'): Promise<void>;
  purge(chatRetentionDays: number): Promise<void>;
  loadDesks(spaceId: string): Promise<StoredDesk[]>;
  saveDesk(spaceId: string, d: StoredDesk): Promise<void>;
  deleteDesk(spaceId: string, deskId: string): Promise<void>;
  /** map id = space id ("hq" for the default space) */
  loadMap(id: string): Promise<StoredMap | null>;
  saveMap(m: StoredMap): Promise<void>;
  deleteMap(id: string): Promise<void>;
  // spaces (P2.3)
  listSpaces(): Promise<StoredSpace[]>;
  getSpaceBySlug(slug: string): Promise<StoredSpace | null>;
  /** false when the slug is taken */
  createSpace(s: StoredSpace): Promise<boolean>;
  updateSpace(
    id: string,
    patch: { name: string; settings: StoredSpace['settings'] },
  ): Promise<void>;
  getMember(spaceId: string, uid: string): Promise<StoredMember | null>;
  membershipsOf(uid: string): Promise<StoredMember[]>;
  upsertMember(m: StoredMember): Promise<void>;
  // invites (P2.4)
  createInvite(i: StoredInvite): Promise<void>;
  listInvites(spaceId: string): Promise<StoredInvite[]>;
  getInviteByHash(tokenHash: string): Promise<StoredInvite | null>;
  revokeInvite(spaceId: string, id: string): Promise<boolean>;
  /** Atomically count one use if the invite is still valid. */
  consumeInvite(id: string, now?: number): Promise<boolean>;
  // accounts and sessions (P2.12)
  getAccount(uid: string): Promise<StoredAccount | null>;
  /** false when the user does not exist or this would make a second owner */
  setRole(uid: string, role: PlatformRole): Promise<boolean>;
  createSession(s: StoredSession): Promise<void>;
  getSessionByHash(tokenHash: string): Promise<StoredSession | null>;
  touchSession(id: string, lastUsedAt: number, expiresAt: number): Promise<void>;
  /** the deleted session, or null */
  deleteSession(id: string): Promise<StoredSession | null>;
  /** delete all of a user's sessions (but `exceptId`); returns the deleted ids */
  deleteSessionsOf(uid: string, exceptId?: string): Promise<string[]>;
  listSessions(uid: string): Promise<StoredSession[]>;
  /** drop expired sessions */
  purgeSessions(now?: number): Promise<void>;
  // people (P2.16)
  listAccounts(): Promise<StoredAccount[]>;
  ownerUid(): Promise<string | null>;
  setDisabled(uid: string, at: number | null): Promise<void>;
  rename(uid: string, name: string): Promise<void>;
  deleteMember(spaceId: string, uid: string): Promise<void>;
  /** free every desk a user holds, in all spaces */
  deleteDesksOf(uid: string): Promise<void>;
  /** delete a user row and its memberships, desks and sessions (pilot purge) */
  deleteUser(uid: string): Promise<void>;
  // characters (P15.4): the version of the AI notice this person accepted, if any
  getNpcConsent(uid: string): Promise<string | null>;
  /** null withdraws it */
  setNpcConsent(uid: string, version: string | null): Promise<void>;
  // characters (P15.5, ADR-046): what a character remembers about a person (≤ 600 characters)
  getNpcMemory(uid: string, npcId: string): Promise<string | null>;
  setNpcMemory(uid: string, npcId: string, summary: string): Promise<void>;
  /** every character's notes about this person */
  deleteNpcMemories(uid: string): Promise<void>;
  /** delete notes not refreshed since `before` (ms); returns how many */
  pruneNpcMemories(before: number): Promise<number>;
  // characters (P15.5): a character's day (mood, needs) so a restart does not reset it
  getNpcState(space: string, npcId: string): Promise<string | null>;
  setNpcState(space: string, npcId: string, json: string): Promise<void>;
  // passkeys (P2.14)
  addPasskey(p: StoredPasskey): Promise<void>;
  getPasskey(id: string): Promise<StoredPasskey | null>;
  listPasskeys(uid: string): Promise<StoredPasskey[]>;
  /** after a sign-in: new counter, last use, backup state */
  usePasskey(id: string, counter: number, at: number, backedUp: boolean): Promise<void>;
  renamePasskey(uid: string, id: string, label: string): Promise<boolean>;
  deletePasskey(uid: string, id: string): Promise<boolean>;
  deletePasskeysOf(uid: string): Promise<number>;
  // tickets (P2.13, P2.15)
  createTicket(t: StoredTicket): Promise<void>;
  getTicket(id: string): Promise<StoredTicket | null>;
  getTicketByHash(tokenHash: string): Promise<StoredTicket | null>;
  listTickets(kinds: TicketKind[]): Promise<StoredTicket[]>;
  /** false when already used or revoked */
  revokeTicket(id: string, now?: number): Promise<boolean>;
  /** revoke every pending ticket of a kind (and target) */
  revokeTickets(kind: TicketKind, targetUid?: string, now?: number): Promise<void>;
  /** count a wrong PIN; locks the ticket at `max` failures */
  failPin(id: string, max: number, now?: number): Promise<{ failures: number; locked: boolean }>;
  /** use a ticket (atomically, once) and apply its effects; false if it was not usable */
  redeemTicket(r: Redemption): Promise<boolean>;
  close(): Promise<void>;
}

/** Bind a store to one space for its room. */
export function roomStore(s: Store, spaceId: string): RoomStore {
  return {
    saveMessage: (m) => s.saveMessage(spaceId, m),
    recentMessages: (n) => s.recentMessages(spaceId, n),
    upsertUser: (u) => s.upsertUser(u),
    getUser: (uid) => s.getUser(uid),
    presence: (uid, e) => s.presence(spaceId, uid, e),
    loadDesks: () => s.loadDesks(spaceId),
    saveDesk: (d) => s.saveDesk(spaceId, d),
    deleteDesk: (id) => s.deleteDesk(spaceId, id),
    loadMap: (id) => s.loadMap(id),
    saveMap: (m) => s.saveMap(m),
    deleteMap: (id) => s.deleteMap(id),
  };
}

export class MemoryStore implements Store {
  kind = 'memory' as const;
  private msgs: (ChatMsg & { spaceId: string })[] = [];
  private users = new Map<string, StoredUser>();
  /** `${spaceId}/${deskId}` → desk */
  private desks = new Map<string, StoredDesk & { spaceId: string }>();
  private maps = new Map<string, StoredMap>();
  private spaces = new Map<string, StoredSpace>();
  private members = new Map<string, StoredMember>();
  private invites = new Map<string, StoredInvite>();
  private roles = new Map<string, { role: PlatformRole; disabledAt: number | null }>();
  private sessions = new Map<string, StoredSession>();
  private passkeys = new Map<string, StoredPasskey>();
  private tickets = new Map<string, StoredTicket>();
  /** created, last seen, invited name (columns of `users` in Postgres) */
  private meta = new Map<
    string,
    { createdAt: number; lastSeenAt: number; invitedName: string | null }
  >();
  /** Optional JSON file so builder edits survive restarts without Postgres (dev). */
  constructor(private mapFile?: string) {}
  async init() {
    if (!this.mapFile) return;
    try {
      const all = JSON.parse(readFileSync(this.mapFile, 'utf8')) as StoredMap[];
      for (const m of all) this.maps.set(m.id, m);
    } catch {
      /* no saved maps yet */
    }
  }
  async loadMap(id: string) {
    return this.maps.get(id) ?? null;
  }
  async saveMap(m: StoredMap) {
    this.maps.set(m.id, m);
    this.flushMaps();
  }
  async deleteMap(id: string) {
    this.maps.delete(id);
    this.flushMaps();
  }
  private flushMaps() {
    if (!this.mapFile) return;
    mkdirSync(dirname(this.mapFile), { recursive: true });
    const tmp = `${this.mapFile}.tmp`;
    writeFileSync(tmp, JSON.stringify([...this.maps.values()]));
    renameSync(tmp, this.mapFile);
  }
  async loadDesks(spaceId: string) {
    return [...this.desks.values()]
      .filter((d) => d.spaceId === spaceId)
      .map(({ spaceId: _s, ...d }) => structuredClone(d));
  }
  async saveDesk(spaceId: string, d: StoredDesk) {
    for (const [k, o] of this.desks)
      if (o.spaceId === spaceId && o.ownerUid === d.ownerUid && o.deskId !== d.deskId)
        this.desks.delete(k);
    this.desks.set(`${spaceId}/${d.deskId}`, { ...structuredClone(d), spaceId });
  }
  async deleteDesk(spaceId: string, id: string) {
    this.desks.delete(`${spaceId}/${id}`);
  }
  async saveMessage(spaceId: string, m: ChatMsg) {
    this.msgs.push({ ...m, spaceId });
    if (this.msgs.length > 5000) this.msgs.splice(0, this.msgs.length - 5000);
  }
  async recentMessages(spaceId: string, n = HISTORY_SIZE) {
    return this.msgs
      .filter((m) => m.spaceId === spaceId)
      .slice(-n)
      .map(({ spaceId: _s, ...m }) => m);
  }
  async upsertUser(u: StoredUser) {
    const prev = this.users.get(u.uid);
    this.users.set(u.uid, { ...u, avatar: u.avatar ?? prev?.avatar ?? null });
    const m = this.meta.get(u.uid);
    if (m) m.lastSeenAt = Date.now();
    else this.meta.set(u.uid, { createdAt: Date.now(), lastSeenAt: Date.now(), invitedName: null });
  }
  async getUser(uid: string) {
    return this.users.get(uid) ?? null;
  }
  async presence() {}
  async purge(days: number) {
    const cutoff = Date.now() - days * 86400_000;
    this.msgs = this.msgs.filter((m) => m.at >= cutoff);
  }
  async listSpaces() {
    return [...this.spaces.values()].map((s) => structuredClone(s));
  }
  async getSpaceBySlug(slug: string) {
    for (const s of this.spaces.values()) if (s.slug === slug) return structuredClone(s);
    return null;
  }
  async createSpace(s: StoredSpace) {
    if (this.spaces.has(s.id) || [...this.spaces.values()].some((o) => o.slug === s.slug))
      return false;
    this.spaces.set(s.id, structuredClone(s));
    return true;
  }
  async updateSpace(id: string, patch: { name: string; settings: StoredSpace['settings'] }) {
    const s = this.spaces.get(id);
    if (s) Object.assign(s, structuredClone(patch));
  }
  async getMember(spaceId: string, uid: string) {
    const m = this.members.get(`${spaceId}/${uid}`);
    return m ? { ...m } : null;
  }
  async membershipsOf(uid: string) {
    return [...this.members.values()].filter((m) => m.uid === uid).map((m) => ({ ...m }));
  }
  async upsertMember(m: StoredMember) {
    this.members.set(`${m.spaceId}/${m.uid}`, { ...m });
  }
  async createInvite(i: StoredInvite) {
    this.invites.set(i.id, { ...i });
  }
  async listInvites(spaceId: string) {
    return [...this.invites.values()]
      .filter((i) => i.spaceId === spaceId)
      .sort((a, b) => b.createdAt - a.createdAt)
      .map((i) => ({ ...i }));
  }
  async getInviteByHash(tokenHash: string) {
    for (const i of this.invites.values()) if (i.tokenHash === tokenHash) return { ...i };
    return null;
  }
  async revokeInvite(spaceId: string, id: string) {
    const i = this.invites.get(id);
    if (!i || i.spaceId !== spaceId || i.revokedAt) return false;
    i.revokedAt = Date.now();
    return true;
  }
  async consumeInvite(id: string, now = Date.now()) {
    const i = this.invites.get(id);
    if (!i || !inviteState(i, now).valid) return false;
    i.uses++;
    return true;
  }
  async getAccount(uid: string): Promise<StoredAccount | null> {
    const u = this.users.get(uid);
    if (!u) return null;
    const r = this.roles.get(uid);
    const m = this.meta.get(uid);
    return {
      ...u,
      role: r?.role ?? 'member',
      disabledAt: r?.disabledAt ?? null,
      invitedName: m?.invitedName ?? null,
      createdAt: m?.createdAt ?? 0,
      lastSeenAt: m?.lastSeenAt ?? 0,
    };
  }
  async setRole(uid: string, role: PlatformRole) {
    if (!this.users.has(uid)) return false;
    if (role === 'owner')
      for (const [id, r] of this.roles) if (id !== uid && r.role === 'owner') return false;
    this.roles.set(uid, { role, disabledAt: this.roles.get(uid)?.disabledAt ?? null });
    return true;
  }
  async createSession(s: StoredSession) {
    this.sessions.set(s.id, structuredClone(s));
  }
  async getSessionByHash(tokenHash: string) {
    for (const s of this.sessions.values())
      if (s.tokenHash === tokenHash) return structuredClone(s);
    return null;
  }
  async touchSession(id: string, lastUsedAt: number, expiresAt: number) {
    const s = this.sessions.get(id);
    if (s) Object.assign(s, { lastUsedAt, expiresAt });
  }
  async deleteSession(id: string) {
    const s = this.sessions.get(id);
    this.sessions.delete(id);
    return s ? structuredClone(s) : null;
  }
  async deleteSessionsOf(uid: string, exceptId?: string) {
    const ids: string[] = [];
    for (const [id, s] of this.sessions)
      if (s.uid === uid && id !== exceptId) {
        this.sessions.delete(id);
        ids.push(id);
      }
    return ids;
  }
  async listSessions(uid: string) {
    return [...this.sessions.values()]
      .filter((s) => s.uid === uid)
      .sort((a, b) => b.lastUsedAt - a.lastUsedAt)
      .map((s) => structuredClone(s));
  }
  async purgeSessions(now = Date.now()) {
    for (const [id, s] of this.sessions) if (s.expiresAt <= now) this.sessions.delete(id);
  }
  async listAccounts() {
    const out: StoredAccount[] = [];
    for (const uid of this.users.keys()) out.push((await this.getAccount(uid))!);
    return out.sort((a, b) => a.createdAt - b.createdAt);
  }
  async ownerUid() {
    for (const [id, r] of this.roles) if (r.role === 'owner' && this.users.has(id)) return id;
    return null;
  }
  async setDisabled(uid: string, at: number | null) {
    const r = this.roles.get(uid) ?? { role: 'member' as PlatformRole, disabledAt: null };
    this.roles.set(uid, { ...r, disabledAt: at });
  }
  async rename(uid: string, name: string) {
    const u = this.users.get(uid);
    if (u) u.name = name;
  }
  async deleteMember(spaceId: string, uid: string) {
    this.members.delete(`${spaceId}/${uid}`);
  }
  async deleteDesksOf(uid: string) {
    for (const [k, d] of this.desks) if (d.ownerUid === uid) this.desks.delete(k);
  }
  private npcConsent = new Map<string, string>();
  async getNpcConsent(uid: string) {
    return this.npcConsent.get(uid) ?? null;
  }
  async setNpcConsent(uid: string, version: string | null) {
    if (version === null) this.npcConsent.delete(uid);
    else this.npcConsent.set(uid, version);
  }
  private npcMemory = new Map<string, { summary: string; at: number }>();
  async getNpcMemory(uid: string, npcId: string) {
    return this.npcMemory.get(`${uid}|${npcId}`)?.summary ?? null;
  }
  async setNpcMemory(uid: string, npcId: string, summary: string) {
    this.npcMemory.set(`${uid}|${npcId}`, { summary, at: Date.now() });
  }
  async deleteNpcMemories(uid: string) {
    for (const k of [...this.npcMemory.keys()])
      if (k.startsWith(`${uid}|`)) this.npcMemory.delete(k);
  }
  async pruneNpcMemories(before: number) {
    let n = 0;
    for (const [k, v] of this.npcMemory)
      if (v.at < before) {
        this.npcMemory.delete(k);
        n++;
      }
    return n;
  }
  private npcStates = new Map<string, string>();
  async getNpcState(space: string, npcId: string) {
    return this.npcStates.get(`${space}|${npcId}`) ?? null;
  }
  async setNpcState(space: string, npcId: string, json: string) {
    this.npcStates.set(`${space}|${npcId}`, json);
  }
  async deleteUser(uid: string) {
    await this.deleteNpcMemories(uid);
    this.npcConsent.delete(uid);
    this.users.delete(uid);
    this.roles.delete(uid);
    this.meta.delete(uid);
    for (const [k, m] of this.members) if (m.uid === uid) this.members.delete(k);
    for (const [k, d] of this.desks) if (d.ownerUid === uid) this.desks.delete(k);
    await this.deleteSessionsOf(uid);
    await this.deletePasskeysOf(uid);
  }
  async addPasskey(p: StoredPasskey) {
    this.passkeys.set(p.id, structuredClone(p));
  }
  async getPasskey(id: string) {
    const p = this.passkeys.get(id);
    return p ? structuredClone(p) : null;
  }
  async listPasskeys(uid: string) {
    return [...this.passkeys.values()]
      .filter((p) => p.uid === uid)
      .sort((a, b) => a.createdAt - b.createdAt)
      .map((p) => structuredClone(p));
  }
  async usePasskey(id: string, counter: number, at: number, backedUp: boolean) {
    const p = this.passkeys.get(id);
    if (p) Object.assign(p, { counter, lastUsedAt: at, backedUp });
  }
  async renamePasskey(uid: string, id: string, label: string) {
    const p = this.passkeys.get(id);
    if (!p || p.uid !== uid) return false;
    p.label = label;
    return true;
  }
  async deletePasskey(uid: string, id: string) {
    const p = this.passkeys.get(id);
    if (!p || p.uid !== uid) return false;
    this.passkeys.delete(id);
    return true;
  }
  async deletePasskeysOf(uid: string) {
    let n = 0;
    for (const [id, p] of this.passkeys)
      if (p.uid === uid) {
        this.passkeys.delete(id);
        n++;
      }
    return n;
  }
  async createTicket(t: StoredTicket) {
    this.tickets.set(t.id, structuredClone(t));
  }
  async getTicket(id: string) {
    const t = this.tickets.get(id);
    return t ? structuredClone(t) : null;
  }
  async getTicketByHash(tokenHash: string) {
    for (const t of this.tickets.values()) if (t.tokenHash === tokenHash) return structuredClone(t);
    return null;
  }
  async listTickets(kinds: TicketKind[]) {
    return [...this.tickets.values()]
      .filter((t) => kinds.includes(t.kind))
      .sort((a, b) => b.createdAt - a.createdAt)
      .map((t) => structuredClone(t));
  }
  async revokeTicket(id: string, now = Date.now()) {
    const t = this.tickets.get(id);
    if (!t || t.usedAt || t.revokedAt) return false;
    t.revokedAt = now;
    return true;
  }
  async revokeTickets(kind: TicketKind, targetUid?: string, now = Date.now()) {
    for (const t of this.tickets.values())
      if (
        t.kind === kind &&
        (targetUid === undefined || t.targetUid === targetUid) &&
        !t.usedAt &&
        !t.revokedAt
      )
        t.revokedAt = now;
  }
  async failPin(id: string, max: number, now = Date.now()) {
    const t = this.tickets.get(id);
    if (!t) return { failures: max, locked: true };
    t.pinFailures++;
    if (t.pinFailures >= max && !t.lockedAt) t.lockedAt = now;
    return { failures: t.pinFailures, locked: !!t.lockedAt };
  }
  async redeemTicket(r: Redemption) {
    const t = this.tickets.get(r.ticketId);
    if (!t || ticketStatus(t, r.now) !== 'pending') return false;
    if (r.account?.role === 'owner') {
      const owner = await this.ownerUid();
      if (owner && owner !== r.uid) return false;
    }
    if (this.passkeys.has(r.passkey.id)) return false;
    t.usedAt = r.now;
    t.usedBy = r.uid;
    if (r.account) {
      await this.upsertUser({ uid: r.uid, name: r.account.name, avatar: null });
      const roleRow = this.roles.get(r.uid);
      this.roles.set(r.uid, { role: r.account.role, disabledAt: roleRow?.disabledAt ?? null });
      this.meta.get(r.uid)!.invitedName = r.account.invitedName;
    }
    for (const spaceId of r.spaces)
      if (!this.members.has(`${spaceId}/${r.uid}`))
        this.members.set(`${spaceId}/${r.uid}`, {
          spaceId,
          uid: r.uid,
          role: 'member',
          displayName: null,
        });
    this.passkeys.set(r.passkey.id, structuredClone(r.passkey));
    return true;
  }
  async close() {}
}

/** Schema mirrors ARCHITECTURE §8 (subset needed so far). Idempotent, runs at every boot. */
const SCHEMA = `
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  display_name TEXT NOT NULL,
  avatar_json JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_seen_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS messages (
  id TEXT PRIMARY KEY,
  channel TEXT NOT NULL DEFAULT 'everyone',
  author_id TEXT NOT NULL,
  author_name TEXT NOT NULL,
  body TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE messages ADD COLUMN IF NOT EXISTS space_id TEXT NOT NULL DEFAULT 'hq';
DROP INDEX IF EXISTS messages_created_idx;
CREATE INDEX IF NOT EXISTS messages_space_created_idx ON messages (space_id, created_at DESC);
CREATE TABLE IF NOT EXISTS space_desks (
  space_id TEXT NOT NULL,
  desk_id TEXT NOT NULL,
  owner_id TEXT NOT NULL,
  owner_name TEXT NOT NULL,
  access TEXT NOT NULL DEFAULT 'open',
  decor_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (space_id, desk_id),
  UNIQUE (space_id, owner_id)
);
DO $$ BEGIN
  IF to_regclass('desks') IS NOT NULL THEN
    INSERT INTO space_desks (space_id, desk_id, owner_id, owner_name, access, decor_json, updated_at)
      SELECT 'hq', desk_id, owner_id, owner_name, access, decor_json, updated_at FROM desks
      ON CONFLICT DO NOTHING;
    DROP TABLE desks;
  END IF;
END $$;
CREATE TABLE IF NOT EXISTS maps (
  id TEXT PRIMARY KEY,
  tmj_json JSONB NOT NULL,
  rev INTEGER NOT NULL,
  updated_by TEXT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS npc_consent (
  user_id TEXT PRIMARY KEY,
  version TEXT NOT NULL,
  accepted_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS npc_memory (
  user_id TEXT NOT NULL,
  npc_id TEXT NOT NULL,
  summary TEXT NOT NULL CHECK (char_length(summary) <= 600),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, npc_id)
);
CREATE TABLE IF NOT EXISTS npc_state (
  space_id TEXT NOT NULL,
  npc_id TEXT NOT NULL,
  state JSONB NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (space_id, npc_id)
);
CREATE TABLE IF NOT EXISTS presence_sessions (
  id BIGSERIAL PRIMARY KEY,
  user_id TEXT NOT NULL,
  joined_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  left_at TIMESTAMPTZ
);
ALTER TABLE presence_sessions ADD COLUMN IF NOT EXISTS space_id TEXT NOT NULL DEFAULT 'hq';
CREATE TABLE IF NOT EXISTS spaces (
  id TEXT PRIMARY KEY,
  slug TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  owner_id TEXT,
  template TEXT NOT NULL DEFAULT 'hq',
  settings_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  archived_at TIMESTAMPTZ
);
CREATE TABLE IF NOT EXISTS space_members (
  space_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  role TEXT NOT NULL,
  display_name TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (space_id, user_id)
);
CREATE INDEX IF NOT EXISTS space_members_user_idx ON space_members (user_id);
CREATE TABLE IF NOT EXISTS invites (
  id TEXT PRIMARY KEY,
  space_id TEXT NOT NULL,
  token_hash TEXT NOT NULL UNIQUE,
  role TEXT NOT NULL,
  label TEXT NOT NULL DEFAULT '',
  expires_at TIMESTAMPTZ,
  max_uses INTEGER,
  uses INTEGER NOT NULL DEFAULT 0,
  created_by TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  revoked_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS invites_space_idx ON invites (space_id);
ALTER TABLE users ADD COLUMN IF NOT EXISTS role TEXT NOT NULL DEFAULT 'member';
ALTER TABLE users ADD COLUMN IF NOT EXISTS disabled_at TIMESTAMPTZ;
CREATE UNIQUE INDEX IF NOT EXISTS users_single_owner ON users ((role)) WHERE role = 'owner';
CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY,
  token_hash TEXT NOT NULL UNIQUE,
  user_id TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_used_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at TIMESTAMPTZ NOT NULL,
  shared BOOLEAN NOT NULL DEFAULT false,
  user_agent TEXT NOT NULL DEFAULT '',
  ip TEXT NOT NULL DEFAULT '',
  grants_json JSONB NOT NULL DEFAULT '{}'::jsonb
);
CREATE INDEX IF NOT EXISTS sessions_user_idx ON sessions (user_id);
CREATE INDEX IF NOT EXISTS sessions_expires_idx ON sessions (expires_at);
ALTER TABLE users ADD COLUMN IF NOT EXISTS invited_name TEXT;
CREATE TABLE IF NOT EXISTS passkeys (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  public_key TEXT NOT NULL,
  counter BIGINT NOT NULL DEFAULT 0,
  transports_json JSONB NOT NULL DEFAULT '[]'::jsonb,
  device_type TEXT NOT NULL DEFAULT 'singleDevice',
  backed_up BOOLEAN NOT NULL DEFAULT false,
  label TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_used_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS passkeys_user_idx ON passkeys (user_id);
CREATE TABLE IF NOT EXISTS tickets (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL,
  token_hash TEXT NOT NULL UNIQUE,
  pin_hash TEXT,
  name TEXT NOT NULL DEFAULT '',
  note TEXT NOT NULL DEFAULT '',
  role TEXT,
  spaces_json JSONB NOT NULL DEFAULT '[]'::jsonb,
  target_uid TEXT,
  pilot_uid TEXT,
  expires_at TIMESTAMPTZ NOT NULL,
  created_by TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  revoked_at TIMESTAMPTZ,
  used_at TIMESTAMPTZ,
  used_by TEXT,
  pin_failures INTEGER NOT NULL DEFAULT 0,
  locked_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS tickets_kind_idx ON tickets (kind, created_at DESC);
`;

const ms = (v: unknown): number | null => (v == null ? null : new Date(v as string).getTime());
const ts = (v: number | null) => (v == null ? null : new Date(v).toISOString());

/* eslint-disable @typescript-eslint/no-explicit-any */
const spaceRow = (r: any): StoredSpace => ({
  id: r.id,
  slug: r.slug,
  name: r.name,
  ownerUid: r.owner_id,
  template: r.template,
  settings: r.settings_json ?? {},
  createdAt: ms(r.created_at)!,
  archivedAt: ms(r.archived_at),
});
const memberRow = (r: any): StoredMember => ({
  spaceId: r.space_id,
  uid: r.user_id,
  role: r.role,
  displayName: r.display_name,
});
const inviteRow = (r: any): StoredInvite => ({
  id: r.id,
  spaceId: r.space_id,
  tokenHash: r.token_hash,
  role: r.role,
  label: r.label,
  expiresAt: ms(r.expires_at),
  maxUses: r.max_uses,
  uses: r.uses,
  createdBy: r.created_by,
  createdAt: ms(r.created_at)!,
  revokedAt: ms(r.revoked_at),
});
const sessionRow = (r: any): StoredSession => ({
  id: r.id,
  tokenHash: r.token_hash,
  uid: r.user_id,
  createdAt: ms(r.created_at)!,
  lastUsedAt: ms(r.last_used_at)!,
  expiresAt: ms(r.expires_at)!,
  shared: r.shared,
  userAgent: r.user_agent,
  ip: r.ip,
  grants: r.grants_json ?? {},
});
const accountRow = (row: any): StoredAccount => ({
  uid: row.id,
  name: row.display_name,
  avatar: row.avatar_json,
  role: isPlatformRole(row.role) ? row.role : 'member',
  disabledAt: ms(row.disabled_at),
  invitedName: row.invited_name ?? null,
  createdAt: ms(row.created_at)!,
  lastSeenAt: ms(row.last_seen_at)!,
});
const passkeyRow = (r: any): StoredPasskey => ({
  id: r.id,
  uid: r.user_id,
  publicKey: r.public_key,
  counter: Number(r.counter),
  transports: r.transports_json ?? [],
  deviceType: r.device_type,
  backedUp: r.backed_up,
  label: r.label,
  createdAt: ms(r.created_at)!,
  lastUsedAt: ms(r.last_used_at),
});
const ticketRow = (r: any): StoredTicket => ({
  id: r.id,
  kind: r.kind,
  tokenHash: r.token_hash,
  pinHash: r.pin_hash,
  name: r.name,
  note: r.note,
  role: isPlatformRole(r.role) ? r.role : null,
  spaces: r.spaces_json ?? [],
  targetUid: r.target_uid,
  pilotUid: r.pilot_uid,
  expiresAt: ms(r.expires_at)!,
  createdBy: r.created_by,
  createdAt: ms(r.created_at)!,
  revokedAt: ms(r.revoked_at),
  usedAt: ms(r.used_at),
  usedBy: r.used_by,
  pinFailures: r.pin_failures,
  lockedAt: ms(r.locked_at),
});
/* eslint-enable @typescript-eslint/no-explicit-any */

const passkeyParams = (p: StoredPasskey) => [
  p.id,
  p.uid,
  p.publicKey,
  p.counter,
  JSON.stringify(p.transports),
  p.deviceType,
  p.backedUp,
  p.label,
  ts(p.createdAt),
  ts(p.lastUsedAt),
];

export class PgStore implements Store {
  kind = 'postgres' as const;
  private pool: pg.Pool;
  constructor(url: string) {
    this.pool = new pg.Pool({ connectionString: url, max: 5, connectionTimeoutMillis: 5000 });
  }
  async init() {
    await this.pool.query(SCHEMA);
  }
  async saveMessage(spaceId: string, m: ChatMsg) {
    await this.pool.query(
      'INSERT INTO messages (id, space_id, channel, author_id, author_name, body, created_at) VALUES ($1,$2,$3,$4,$5,$6,to_timestamp($7/1000.0))',
      [m.id, spaceId, 'everyone', m.from, m.name, m.body, m.at],
    );
  }
  async recentMessages(spaceId: string, n = HISTORY_SIZE) {
    const r = await this.pool.query(
      'SELECT id, author_id, author_name, body, extract(epoch from created_at)*1000 AS at FROM messages WHERE space_id = $1 ORDER BY created_at DESC LIMIT $2',
      [spaceId, n],
    );
    return r.rows.reverse().map((row): ChatMsg => ({
      id: row.id,
      scope: 'everyone',
      from: row.author_id,
      name: row.author_name,
      body: row.body,
      at: Math.round(Number(row.at)),
      zoneId: null,
    }));
  }
  async upsertUser(u: StoredUser) {
    await this.pool.query(
      `INSERT INTO users (id, display_name, avatar_json) VALUES ($1,$2,$3)
       ON CONFLICT (id) DO UPDATE SET display_name = EXCLUDED.display_name,
         avatar_json = COALESCE(EXCLUDED.avatar_json, users.avatar_json), last_seen_at = now()`,
      [u.uid, u.name, u.avatar ? JSON.stringify(u.avatar) : null],
    );
  }
  async getUser(uid: string) {
    const r = await this.pool.query(
      'SELECT id, display_name, avatar_json FROM users WHERE id = $1',
      [uid],
    );
    const row = r.rows[0];
    return row ? { uid: row.id, name: row.display_name, avatar: row.avatar_json } : null;
  }
  async presence(spaceId: string, uid: string, event: 'join' | 'leave') {
    if (event === 'join')
      await this.pool.query('INSERT INTO presence_sessions (space_id, user_id) VALUES ($1, $2)', [
        spaceId,
        uid,
      ]);
    else
      await this.pool.query(
        `UPDATE presence_sessions SET left_at = now() WHERE id = (
           SELECT id FROM presence_sessions WHERE space_id = $1 AND user_id = $2 AND left_at IS NULL
           ORDER BY joined_at DESC LIMIT 1)`,
        [spaceId, uid],
      );
  }
  async purge(days: number) {
    await this.pool.query(
      `DELETE FROM messages WHERE created_at < now() - ($1 || ' days')::interval`,
      [String(days)],
    );
    await this.pool.query(
      `DELETE FROM presence_sessions WHERE joined_at < now() - interval '90 days'`,
    );
  }
  async loadDesks(spaceId: string) {
    const r = await this.pool.query(
      'SELECT desk_id, owner_id, owner_name, access, decor_json FROM space_desks WHERE space_id = $1',
      [spaceId],
    );
    return r.rows.map((row): StoredDesk => ({
      deskId: row.desk_id,
      ownerUid: row.owner_id,
      ownerName: row.owner_name,
      access: row.access,
      decor: row.decor_json,
    }));
  }
  async saveDesk(spaceId: string, d: StoredDesk) {
    await this.pool.query(
      'DELETE FROM space_desks WHERE space_id = $1 AND owner_id = $2 AND desk_id <> $3',
      [spaceId, d.ownerUid, d.deskId],
    );
    await this.pool.query(
      `INSERT INTO space_desks (space_id, desk_id, owner_id, owner_name, access, decor_json)
       VALUES ($1,$2,$3,$4,$5,$6)
       ON CONFLICT (space_id, desk_id) DO UPDATE SET owner_id = EXCLUDED.owner_id,
         owner_name = EXCLUDED.owner_name, access = EXCLUDED.access,
         decor_json = EXCLUDED.decor_json, updated_at = now()`,
      [spaceId, d.deskId, d.ownerUid, d.ownerName, d.access, JSON.stringify(d.decor)],
    );
  }
  async deleteDesk(spaceId: string, id: string) {
    await this.pool.query('DELETE FROM space_desks WHERE space_id = $1 AND desk_id = $2', [
      spaceId,
      id,
    ]);
  }
  async loadMap(id: string) {
    const r = await this.pool.query(
      'SELECT id, tmj_json, rev, updated_by FROM maps WHERE id = $1',
      [id],
    );
    const row = r.rows[0];
    return row ? { id: row.id, tmj: row.tmj_json, rev: row.rev, updatedBy: row.updated_by } : null;
  }
  async saveMap(m: StoredMap) {
    await this.pool.query(
      `INSERT INTO maps (id, tmj_json, rev, updated_by) VALUES ($1,$2,$3,$4)
       ON CONFLICT (id) DO UPDATE SET tmj_json = EXCLUDED.tmj_json, rev = EXCLUDED.rev,
         updated_by = EXCLUDED.updated_by, updated_at = now()`,
      [m.id, JSON.stringify(m.tmj), m.rev, m.updatedBy],
    );
  }
  async deleteMap(id: string) {
    await this.pool.query('DELETE FROM maps WHERE id = $1', [id]);
  }
  async listSpaces() {
    const r = await this.pool.query('SELECT * FROM spaces ORDER BY created_at');
    return r.rows.map(spaceRow);
  }
  async getSpaceBySlug(slug: string) {
    const r = await this.pool.query('SELECT * FROM spaces WHERE slug = $1', [slug]);
    return r.rows[0] ? spaceRow(r.rows[0]) : null;
  }
  async createSpace(s: StoredSpace) {
    const r = await this.pool.query(
      `INSERT INTO spaces (id, slug, name, owner_id, template, settings_json, created_at, archived_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8) ON CONFLICT DO NOTHING`,
      [
        s.id,
        s.slug,
        s.name,
        s.ownerUid,
        s.template,
        JSON.stringify(s.settings),
        ts(s.createdAt),
        ts(s.archivedAt),
      ],
    );
    return r.rowCount === 1;
  }
  async updateSpace(id: string, patch: { name: string; settings: StoredSpace['settings'] }) {
    await this.pool.query('UPDATE spaces SET name = $2, settings_json = $3 WHERE id = $1', [
      id,
      patch.name,
      JSON.stringify(patch.settings),
    ]);
  }
  async getMember(spaceId: string, uid: string) {
    const r = await this.pool.query(
      'SELECT * FROM space_members WHERE space_id = $1 AND user_id = $2',
      [spaceId, uid],
    );
    return r.rows[0] ? memberRow(r.rows[0]) : null;
  }
  async membershipsOf(uid: string) {
    const r = await this.pool.query('SELECT * FROM space_members WHERE user_id = $1', [uid]);
    return r.rows.map(memberRow);
  }
  async upsertMember(m: StoredMember) {
    await this.pool.query(
      `INSERT INTO space_members (space_id, user_id, role, display_name) VALUES ($1,$2,$3,$4)
       ON CONFLICT (space_id, user_id) DO UPDATE SET role = EXCLUDED.role,
         display_name = EXCLUDED.display_name`,
      [m.spaceId, m.uid, m.role, m.displayName],
    );
  }
  async createInvite(i: StoredInvite) {
    await this.pool.query(
      `INSERT INTO invites (id, space_id, token_hash, role, label, expires_at, max_uses, uses,
         created_by, created_at, revoked_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
      [
        i.id,
        i.spaceId,
        i.tokenHash,
        i.role,
        i.label,
        ts(i.expiresAt),
        i.maxUses,
        i.uses,
        i.createdBy,
        ts(i.createdAt),
        ts(i.revokedAt),
      ],
    );
  }
  async listInvites(spaceId: string) {
    const r = await this.pool.query(
      'SELECT * FROM invites WHERE space_id = $1 ORDER BY created_at DESC',
      [spaceId],
    );
    return r.rows.map(inviteRow);
  }
  async getInviteByHash(tokenHash: string) {
    const r = await this.pool.query('SELECT * FROM invites WHERE token_hash = $1', [tokenHash]);
    return r.rows[0] ? inviteRow(r.rows[0]) : null;
  }
  async revokeInvite(spaceId: string, id: string) {
    const r = await this.pool.query(
      'UPDATE invites SET revoked_at = now() WHERE id = $1 AND space_id = $2 AND revoked_at IS NULL',
      [id, spaceId],
    );
    return r.rowCount === 1;
  }
  async consumeInvite(id: string, now = Date.now()) {
    const r = await this.pool.query(
      `UPDATE invites SET uses = uses + 1 WHERE id = $1 AND revoked_at IS NULL
         AND (expires_at IS NULL OR expires_at > $2) AND (max_uses IS NULL OR uses < max_uses)`,
      [id, ts(now)],
    );
    return r.rowCount === 1;
  }
  async getAccount(uid: string) {
    const r = await this.pool.query('SELECT * FROM users WHERE id = $1', [uid]);
    return r.rows[0] ? accountRow(r.rows[0]) : null;
  }
  async setRole(uid: string, role: PlatformRole) {
    try {
      const r = await this.pool.query('UPDATE users SET role = $2 WHERE id = $1', [uid, role]);
      return r.rowCount === 1;
    } catch (err) {
      // users_single_owner: there is already an owner
      if ((err as { code?: string }).code === '23505') return false;
      throw err;
    }
  }
  async createSession(s: StoredSession) {
    await this.pool.query(
      `INSERT INTO sessions (id, token_hash, user_id, created_at, last_used_at, expires_at, shared,
         user_agent, ip, grants_json) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
      [
        s.id,
        s.tokenHash,
        s.uid,
        ts(s.createdAt),
        ts(s.lastUsedAt),
        ts(s.expiresAt),
        s.shared,
        s.userAgent,
        s.ip,
        JSON.stringify(s.grants),
      ],
    );
  }
  async getSessionByHash(tokenHash: string) {
    const r = await this.pool.query('SELECT * FROM sessions WHERE token_hash = $1', [tokenHash]);
    return r.rows[0] ? sessionRow(r.rows[0]) : null;
  }
  async touchSession(id: string, lastUsedAt: number, expiresAt: number) {
    await this.pool.query('UPDATE sessions SET last_used_at = $2, expires_at = $3 WHERE id = $1', [
      id,
      ts(lastUsedAt),
      ts(expiresAt),
    ]);
  }
  async deleteSession(id: string) {
    const r = await this.pool.query('DELETE FROM sessions WHERE id = $1 RETURNING *', [id]);
    return r.rows[0] ? sessionRow(r.rows[0]) : null;
  }
  async deleteSessionsOf(uid: string, exceptId?: string) {
    const r = await this.pool.query(
      'DELETE FROM sessions WHERE user_id = $1 AND id <> $2 RETURNING id',
      [uid, exceptId ?? ''],
    );
    return r.rows.map((x) => x.id as string);
  }
  async listSessions(uid: string) {
    const r = await this.pool.query(
      'SELECT * FROM sessions WHERE user_id = $1 ORDER BY last_used_at DESC',
      [uid],
    );
    return r.rows.map(sessionRow);
  }
  async purgeSessions(now = Date.now()) {
    await this.pool.query('DELETE FROM sessions WHERE expires_at <= $1', [ts(now)]);
  }
  async listAccounts() {
    const r = await this.pool.query('SELECT * FROM users ORDER BY created_at');
    return r.rows.map(accountRow);
  }
  async ownerUid() {
    const r = await this.pool.query(`SELECT id FROM users WHERE role = 'owner'`);
    return (r.rows[0]?.id as string | undefined) ?? null;
  }
  async setDisabled(uid: string, at: number | null) {
    await this.pool.query('UPDATE users SET disabled_at = $2 WHERE id = $1', [uid, ts(at)]);
  }
  async rename(uid: string, name: string) {
    await this.pool.query('UPDATE users SET display_name = $2 WHERE id = $1', [uid, name]);
  }
  async deleteMember(spaceId: string, uid: string) {
    await this.pool.query('DELETE FROM space_members WHERE space_id = $1 AND user_id = $2', [
      spaceId,
      uid,
    ]);
  }
  async deleteDesksOf(uid: string) {
    await this.pool.query('DELETE FROM space_desks WHERE owner_id = $1', [uid]);
  }
  async deleteUser(uid: string) {
    const c = await this.pool.connect();
    try {
      await c.query('BEGIN');
      for (const q of [
        'DELETE FROM space_members WHERE user_id = $1',
        'DELETE FROM space_desks WHERE owner_id = $1',
        'DELETE FROM sessions WHERE user_id = $1',
        'DELETE FROM passkeys WHERE user_id = $1',
        'DELETE FROM npc_consent WHERE user_id = $1',
        'DELETE FROM npc_memory WHERE user_id = $1',
        'DELETE FROM users WHERE id = $1',
      ])
        await c.query(q, [uid]);
      await c.query('COMMIT');
    } catch (err) {
      await c.query('ROLLBACK').catch(() => {});
      throw err;
    } finally {
      c.release();
    }
  }
  async getNpcMemory(uid: string, npcId: string) {
    const r = await this.pool.query(
      'SELECT summary FROM npc_memory WHERE user_id = $1 AND npc_id = $2',
      [uid, npcId],
    );
    return (r.rows[0]?.summary as string | undefined) ?? null;
  }
  async setNpcMemory(uid: string, npcId: string, summary: string) {
    await this.pool.query(
      `INSERT INTO npc_memory (user_id, npc_id, summary) VALUES ($1, $2, $3)
       ON CONFLICT (user_id, npc_id) DO UPDATE SET summary = EXCLUDED.summary, updated_at = now()`,
      [uid, npcId, summary],
    );
  }
  async deleteNpcMemories(uid: string) {
    await this.pool.query('DELETE FROM npc_memory WHERE user_id = $1', [uid]);
  }
  async pruneNpcMemories(before: number) {
    const r = await this.pool.query('DELETE FROM npc_memory WHERE updated_at < $1', [
      new Date(before),
    ]);
    return r.rowCount ?? 0;
  }
  async getNpcState(space: string, npcId: string) {
    const r = await this.pool.query(
      'SELECT state FROM npc_state WHERE space_id = $1 AND npc_id = $2',
      [space, npcId],
    );
    return r.rows[0] ? JSON.stringify(r.rows[0].state) : null;
  }
  async setNpcState(space: string, npcId: string, json: string) {
    await this.pool.query(
      `INSERT INTO npc_state (space_id, npc_id, state) VALUES ($1, $2, $3::jsonb)
       ON CONFLICT (space_id, npc_id) DO UPDATE SET state = EXCLUDED.state, updated_at = now()`,
      [space, npcId, json],
    );
  }
  async getNpcConsent(uid: string) {
    const r = await this.pool.query('SELECT version FROM npc_consent WHERE user_id = $1', [uid]);
    return (r.rows[0]?.version as string | undefined) ?? null;
  }
  async setNpcConsent(uid: string, version: string | null) {
    if (version === null) {
      await this.pool.query('DELETE FROM npc_consent WHERE user_id = $1', [uid]);
      return;
    }
    await this.pool.query(
      `INSERT INTO npc_consent (user_id, version) VALUES ($1, $2)
       ON CONFLICT (user_id) DO UPDATE SET version = EXCLUDED.version, accepted_at = now()`,
      [uid, version],
    );
  }
  async addPasskey(p: StoredPasskey) {
    await this.pool.query(
      `INSERT INTO passkeys (id, user_id, public_key, counter, transports_json, device_type,
         backed_up, label, created_at, last_used_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
      passkeyParams(p),
    );
  }
  async getPasskey(id: string) {
    const r = await this.pool.query('SELECT * FROM passkeys WHERE id = $1', [id]);
    return r.rows[0] ? passkeyRow(r.rows[0]) : null;
  }
  async listPasskeys(uid: string) {
    const r = await this.pool.query(
      'SELECT * FROM passkeys WHERE user_id = $1 ORDER BY created_at',
      [uid],
    );
    return r.rows.map(passkeyRow);
  }
  async usePasskey(id: string, counter: number, at: number, backedUp: boolean) {
    await this.pool.query(
      'UPDATE passkeys SET counter = $2, last_used_at = $3, backed_up = $4 WHERE id = $1',
      [id, counter, ts(at), backedUp],
    );
  }
  async renamePasskey(uid: string, id: string, label: string) {
    const r = await this.pool.query(
      'UPDATE passkeys SET label = $3 WHERE id = $1 AND user_id = $2',
      [id, uid, label],
    );
    return r.rowCount === 1;
  }
  async deletePasskey(uid: string, id: string) {
    const r = await this.pool.query('DELETE FROM passkeys WHERE id = $1 AND user_id = $2', [
      id,
      uid,
    ]);
    return r.rowCount === 1;
  }
  async deletePasskeysOf(uid: string) {
    const r = await this.pool.query('DELETE FROM passkeys WHERE user_id = $1', [uid]);
    return r.rowCount ?? 0;
  }
  async createTicket(t: StoredTicket) {
    await this.pool.query(
      `INSERT INTO tickets (id, kind, token_hash, pin_hash, name, note, role, spaces_json,
         target_uid, pilot_uid, expires_at, created_by, created_at, revoked_at, used_at, used_by,
         pin_failures, locked_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18)`,
      [
        t.id,
        t.kind,
        t.tokenHash,
        t.pinHash,
        t.name,
        t.note,
        t.role,
        JSON.stringify(t.spaces),
        t.targetUid,
        t.pilotUid,
        ts(t.expiresAt),
        t.createdBy,
        ts(t.createdAt),
        ts(t.revokedAt),
        ts(t.usedAt),
        t.usedBy,
        t.pinFailures,
        ts(t.lockedAt),
      ],
    );
  }
  async getTicket(id: string) {
    const r = await this.pool.query('SELECT * FROM tickets WHERE id = $1', [id]);
    return r.rows[0] ? ticketRow(r.rows[0]) : null;
  }
  async getTicketByHash(tokenHash: string) {
    const r = await this.pool.query('SELECT * FROM tickets WHERE token_hash = $1', [tokenHash]);
    return r.rows[0] ? ticketRow(r.rows[0]) : null;
  }
  async listTickets(kinds: TicketKind[]) {
    const r = await this.pool.query(
      'SELECT * FROM tickets WHERE kind = ANY($1) ORDER BY created_at DESC LIMIT 500',
      [kinds],
    );
    return r.rows.map(ticketRow);
  }
  async revokeTicket(id: string, now = Date.now()) {
    const r = await this.pool.query(
      'UPDATE tickets SET revoked_at = $2 WHERE id = $1 AND used_at IS NULL AND revoked_at IS NULL',
      [id, ts(now)],
    );
    return r.rowCount === 1;
  }
  async revokeTickets(kind: TicketKind, targetUid?: string, now = Date.now()) {
    await this.pool.query(
      `UPDATE tickets SET revoked_at = $3 WHERE kind = $1 AND used_at IS NULL
         AND revoked_at IS NULL AND ($2::text IS NULL OR target_uid = $2)`,
      [kind, targetUid ?? null, ts(now)],
    );
  }
  async failPin(id: string, max: number, now = Date.now()) {
    const r = await this.pool.query(
      `UPDATE tickets SET pin_failures = pin_failures + 1,
         locked_at = CASE WHEN pin_failures + 1 >= $2 THEN COALESCE(locked_at, $3) ELSE locked_at END
       WHERE id = $1 RETURNING pin_failures, locked_at`,
      [id, max, ts(now)],
    );
    const row = r.rows[0];
    return row
      ? { failures: row.pin_failures as number, locked: !!row.locked_at }
      : { failures: max, locked: true };
  }
  async redeemTicket(r: Redemption) {
    const c = await this.pool.connect();
    try {
      await c.query('BEGIN');
      const used = await c.query(
        `UPDATE tickets SET used_at = $2, used_by = $3 WHERE id = $1 AND used_at IS NULL
           AND revoked_at IS NULL AND locked_at IS NULL AND expires_at > $2`,
        [r.ticketId, ts(r.now), r.uid],
      );
      if (used.rowCount !== 1) {
        await c.query('ROLLBACK');
        return false;
      }
      if (r.account) {
        await c.query(
          `INSERT INTO users (id, display_name, role, invited_name) VALUES ($1,$2,$3,$4)
           ON CONFLICT (id) DO UPDATE SET display_name = EXCLUDED.display_name,
             role = EXCLUDED.role, invited_name = EXCLUDED.invited_name, last_seen_at = now()`,
          [r.uid, r.account.name, r.account.role, r.account.invitedName],
        );
      }
      for (const spaceId of r.spaces)
        await c.query(
          `INSERT INTO space_members (space_id, user_id, role) VALUES ($1,$2,'member')
           ON CONFLICT DO NOTHING`,
          [spaceId, r.uid],
        );
      await c.query(
        `INSERT INTO passkeys (id, user_id, public_key, counter, transports_json, device_type,
           backed_up, label, created_at, last_used_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
        passkeyParams(r.passkey),
      );
      await c.query('COMMIT');
      return true;
    } catch (err) {
      await c.query('ROLLBACK').catch(() => {});
      // a second owner (users_single_owner) or a credential registered twice
      if ((err as { code?: string }).code === '23505') return false;
      throw err;
    } finally {
      c.release();
    }
  }

  async close() {
    await this.pool.end();
  }
}

/** DATABASE_URL is set but Postgres can't be used, and falling back would lose data. */
export class StoreUnavailableError extends Error {}

/** `postgres://user:pw@host:5432/db` → `host:5432/db` (no credentials in logs). */
export function describeDbUrl(url: string): string {
  try {
    const u = new URL(url);
    return `${u.hostname}${u.port ? `:${u.port}` : ''}${u.pathname}`;
  } catch {
    return 'DATABASE_URL';
  }
}

/**
 * Postgres when DATABASE_URL is reachable, otherwise in-memory (logged loudly).
 * `strict` (invite-only accounts): never fall back, because an in-memory store forgets
 * the owner and every passkey on restart and the server would ask for a new owner.
 */
export async function openStore(
  url: string | undefined,
  log: { warn: (o: object, m: string) => void },
  mapFile?: string,
  opts: { strict?: boolean } = {},
): Promise<Store> {
  if (url) {
    const s = new PgStore(url);
    try {
      // a locked table (e.g. a server from an earlier run still holding it) must not hang boot
      await withTimeout(s.init(), 15_000, 'Postgres');
      return s;
    } catch (err) {
      await s.close().catch(() => {});
      if (opts.strict)
        throw new StoreUnavailableError(
          `cannot use Postgres at ${describeDbUrl(url)} (${String(err)}). ` +
            'Refusing to start with an in-memory store: accounts and passkeys would be lost on restart.',
        );
      log.warn(
        { err: String(err) },
        'Postgres unreachable: falling back to in-memory store (no persistence)',
      );
    }
  }
  const m = new MemoryStore(mapFile);
  await m.init();
  return m;
}
