/**
 * One atomic unit of work over a personal world and its account data (ADR-053, P17.20). Postgres
 * runs it in one transaction: the world row is locked first (so every action in one world waits for
 * the one before), then the rows the rule reads are locked. The memory store runs transactions one
 * at a time on a draft copy and publishes the draft on commit, so a refusal or a throw writes
 * nothing. Both implement the same contract (worldStore.test.ts).
 */
import type { PoolClient } from 'pg';
import {
  WORLD_DELTA_CELL_CAP,
  deltaCells,
  type ActionChanges,
  type ChunkDelta,
  type Contract,
  type FriendRecord,
  type Inventory,
  type Listing,
  type RestState,
  type Skill,
  type WorldSimState,
} from '@agora/shared';
import type { ChunkSave, StoredChunk, StoredWorld } from './worldStore';

/** One ledger row: the approved change of one action (or a grant), keyed by the action's key. */
export interface LedgerRow {
  readonly key: string;
  readonly actor: string;
  readonly worldId: string | null;
  readonly kind: string;
  readonly delta: ActionChanges;
  /** ms since the epoch */
  readonly at: number;
}

export interface AccountRow {
  readonly inventory: Inventory;
  /** 0 when the account has no inventory row yet */
  readonly rev: number;
}

export interface ProgressRow {
  /** total xp per skill */
  readonly skills: Readonly<Record<string, number>>;
  readonly energy: number;
  /** the game day the energy was last settled on (P17.23) */
  readonly day: number;
  /** the rest a bed set, until the rollover; null when the person is up */
  readonly rest: RestState | null;
}

export interface SimRow {
  readonly state: WorldSimState;
  readonly rev: number;
}

export interface WorldTxn {
  /** Locks the world row. False when the world does not exist. Every action in a world starts here. */
  lockWorld(worldId: string): Promise<boolean>;
  /** The ledger row of a key, if one was written. */
  ledgerOf(key: string): Promise<LedgerRow | null>;
  /** Writes a ledger row. False when the key is already in the ledger (nothing written). */
  insertLedger(row: LedgerRow): Promise<boolean>;
  accountOf(userId: string, lock: boolean): Promise<AccountRow>;
  /** Replaces the inventory when `expectedRev` is the stored revision. Returns the new revision, or null on conflict. */
  saveAccount(userId: string, inventory: Inventory, expectedRev: number): Promise<number | null>;
  progressOf(userId: string, lock: boolean): Promise<ProgressRow | null>;
  saveProgress(userId: string, progress: ProgressRow): Promise<void>;
  /** The skill a person shows on their card (P17.31), or null when none is chosen. */
  showOffOf(userId: string): Promise<Skill | null>;
  /** Chooses the skill to show, or null to show none. The progress row is not touched. */
  saveShowOff(userId: string, skill: Skill | null): Promise<void>;
  /** P17.26b: a person's friendship records by character (absent: never received a gift). */
  friendsOf(userId: string, lock: boolean): Promise<Record<string, FriendRecord>>;
  saveFriend(userId: string, npc: string, record: FriendRecord): Promise<void>;
  /** P17.28: a world's open contracts (closed ones are kept for the record but not listed). */
  contractsOf(worldId: string, lock: boolean): Promise<Contract[]>;
  contractById(id: string, lock: boolean): Promise<Contract | null>;
  saveContract(c: Contract): Promise<void>;
  /** P17.30: the open listings of the marketplace board, oldest first (at most `limit`). */
  openListings(limit: number): Promise<Listing[]>;
  listingById(id: string, lock: boolean): Promise<Listing | null>;
  saveListing(l: Listing): Promise<void>;
  /** P17.30: one person's open listings, and what they listed and bought on an office day. */
  marketCounts(userId: string, day: number): Promise<{ active: number; listedToday: number; boughtToday: number }>;
  /** P17.30: the open listings that expired by `now` (to give their items back), oldest first. */
  expiredListings(now: number, limit: number): Promise<Listing[]>;
  /** P17.30: when the person first appeared in the economy (their first ledger row), or null. */
  firstSeenOf(userId: string): Promise<number | null>;
  simOf(worldId: string, lock: boolean): Promise<SimRow | null>;
  /** Replaces the farm state when `expectedRev` matches. Returns the new revision, or null on conflict. */
  saveSim(worldId: string, state: WorldSimState, expectedRev: number): Promise<number | null>;
  chunksOf(worldId: string, keys: readonly { cx: number; cy: number }[]): Promise<StoredChunk[]>;
  saveChunk(
    worldId: string,
    cx: number,
    cy: number,
    delta: ChunkDelta,
    expectedRev: number,
    cap?: number,
  ): Promise<ChunkSave>;
  /** Ends the transaction without writing anything (a refusal, or a replay of a stored action). */
  abort(): void;
  readonly aborted: boolean;
}

/** The memory store's state. Drafts copy the maps; the entries are replaced, never mutated. */
export interface MemoryState {
  chunks: Map<string, Map<string, StoredChunk>>;
  sims: Map<string, SimRow>;
  accounts: Map<string, AccountRow>;
  progress: Map<string, ProgressRow>;
  showOff: Map<string, Skill>;
  /** P17.26b: key `user|npc` */
  friends: Map<string, FriendRecord>;
  /** P17.28: by contract id */
  contracts: Map<string, Contract>;
  /** P17.30: by listing id */
  listings: Map<string, Listing>;
  ledger: Map<string, LedgerRow>;
}

export const emptyMemoryState = (): MemoryState => ({
  chunks: new Map(),
  sims: new Map(),
  accounts: new Map(),
  progress: new Map(),
  showOff: new Map(),
  friends: new Map(),
  contracts: new Map(),
  listings: new Map(),
  ledger: new Map(),
});

export function cloneMemoryState(s: MemoryState): MemoryState {
  return {
    chunks: new Map([...s.chunks].map(([w, inner]) => [w, new Map(inner)] as const)),
    sims: new Map(s.sims),
    accounts: new Map(s.accounts),
    progress: new Map(s.progress),
    showOff: new Map(s.showOff),
    friends: new Map(s.friends),
    contracts: new Map(s.contracts),
    listings: new Map(s.listings),
    ledger: new Map(s.ledger),
  };
}

const chunkKey = (cx: number, cy: number) => `${cx},${cy}`;

/** Memory transaction over a draft of the state. The caller publishes the draft when it commits. */
export class MemoryWorldTxn implements WorldTxn {
  aborted = false;

  constructor(
    private readonly worlds: ReadonlyMap<string, StoredWorld>,
    readonly draft: MemoryState,
  ) {}

  abort(): void {
    this.aborted = true;
  }

  async lockWorld(worldId: string): Promise<boolean> {
    return this.worlds.has(worldId);
  }

  async ledgerOf(key: string): Promise<LedgerRow | null> {
    return this.draft.ledger.get(key) ?? null;
  }

  async insertLedger(row: LedgerRow): Promise<boolean> {
    if (this.draft.ledger.has(row.key)) return false;
    this.draft.ledger.set(row.key, structuredClone(row));
    return true;
  }

  async accountOf(userId: string): Promise<AccountRow> {
    const row = this.draft.accounts.get(userId);
    return row ?? { inventory: { items: {}, money: 0 }, rev: 0 };
  }

  async saveAccount(userId: string, inventory: Inventory, expectedRev: number): Promise<number | null> {
    const current = this.draft.accounts.get(userId)?.rev ?? 0;
    if (current !== expectedRev) return null;
    const rev = current + 1;
    this.draft.accounts.set(userId, { inventory: structuredClone(inventory), rev });
    return rev;
  }

  async progressOf(userId: string): Promise<ProgressRow | null> {
    return this.draft.progress.get(userId) ?? null;
  }

  async saveProgress(userId: string, progress: ProgressRow): Promise<void> {
    this.draft.progress.set(userId, structuredClone(progress));
  }

  async showOffOf(userId: string): Promise<Skill | null> {
    return this.draft.showOff.get(userId) ?? null;
  }

  async saveShowOff(userId: string, skill: Skill | null): Promise<void> {
    if (skill === null) this.draft.showOff.delete(userId);
    else this.draft.showOff.set(userId, skill);
  }

  async friendsOf(userId: string): Promise<Record<string, FriendRecord>> {
    const out: Record<string, FriendRecord> = {};
    for (const [key, record] of this.draft.friends) {
      const [user, npc] = key.split('|') as [string, string];
      if (user === userId) out[npc] = record;
    }
    return out;
  }

  async saveFriend(userId: string, npc: string, record: FriendRecord): Promise<void> {
    this.draft.friends.set(`${userId}|${npc}`, { ...record });
  }

  async contractsOf(worldId: string): Promise<Contract[]> {
    return [...this.draft.contracts.values()]
      .filter((c) => c.worldId === worldId && c.state === 'open')
      .sort((a, b) => a.createdAt - b.createdAt || a.id.localeCompare(b.id));
  }

  async contractById(id: string): Promise<Contract | null> {
    return this.draft.contracts.get(id) ?? null;
  }

  async openListings(limit: number): Promise<Listing[]> {
    return [...this.draft.listings.values()]
      .filter((l) => l.state === 'open')
      .sort((a, b) => a.createdAt - b.createdAt || a.id.localeCompare(b.id))
      .slice(0, limit);
  }

  async listingById(id: string): Promise<Listing | null> {
    return this.draft.listings.get(id) ?? null;
  }

  async saveListing(l: Listing): Promise<void> {
    this.draft.listings.set(l.id, structuredClone(l));
  }

  async marketCounts(userId: string, day: number): Promise<{ active: number; listedToday: number; boughtToday: number }> {
    let active = 0;
    let listedToday = 0;
    let boughtToday = 0;
    for (const l of this.draft.listings.values()) {
      if (l.sellerId === userId && l.state === 'open') active++;
      if (l.sellerId === userId && l.listDay === day) listedToday++;
      if (l.buyerId === userId && l.buyDay === day) boughtToday++;
    }
    return { active, listedToday, boughtToday };
  }

  async expiredListings(now: number, limit: number): Promise<Listing[]> {
    return [...this.draft.listings.values()]
      .filter((l) => l.state === 'open' && l.expiresAt <= now)
      .sort((a, b) => a.expiresAt - b.expiresAt || a.id.localeCompare(b.id))
      .slice(0, limit);
  }

  async firstSeenOf(userId: string): Promise<number | null> {
    let first: number | null = null;
    for (const row of this.draft.ledger.values()) if (row.actor === userId && (first === null || row.at < first)) first = row.at;
    return first;
  }

  async saveContract(c: Contract): Promise<void> {
    this.draft.contracts.set(c.id, structuredClone(c));
  }

  async simOf(worldId: string): Promise<SimRow | null> {
    return this.draft.sims.get(worldId) ?? null;
  }

  async saveSim(worldId: string, state: WorldSimState, expectedRev: number): Promise<number | null> {
    const current = this.draft.sims.get(worldId)?.rev ?? 0;
    if (current !== expectedRev) return null;
    const rev = current + 1;
    this.draft.sims.set(worldId, { state: structuredClone(state), rev });
    return rev;
  }

  async chunksOf(worldId: string, keys: readonly { cx: number; cy: number }[]): Promise<StoredChunk[]> {
    const chunks = this.draft.chunks.get(worldId);
    if (!chunks) return [];
    const out: StoredChunk[] = [];
    for (const { cx, cy } of keys) {
      const c = chunks.get(chunkKey(cx, cy));
      if (c) out.push(structuredClone(c));
    }
    return out;
  }

  async saveChunk(
    worldId: string,
    cx: number,
    cy: number,
    delta: ChunkDelta,
    expectedRev: number,
    cap = WORLD_DELTA_CELL_CAP,
  ): Promise<ChunkSave> {
    if (!this.worlds.has(worldId)) return { ok: false, reason: 'no_world' };
    const chunks = this.draft.chunks.get(worldId) ?? new Map<string, StoredChunk>();
    const key = chunkKey(cx, cy);
    const rev = chunks.get(key)?.rev ?? 0;
    if (rev !== expectedRev) return { ok: false, reason: 'conflict' };
    let others = 0;
    for (const [k, c] of chunks) if (k !== key) others += c.cells;
    const cells = deltaCells(delta);
    if (others + cells > cap) return { ok: false, reason: 'cap' };
    chunks.set(key, { cx, cy, delta: structuredClone(delta), cells, rev: rev + 1 });
    this.draft.chunks.set(worldId, chunks);
    return { ok: true, rev: rev + 1 };
  }
}

interface AccountDbRow {
  items: Record<string, number>;
  money: number;
  rev: number;
}

interface SimDbRow {
  state: WorldSimState;
  rev: number;
}

interface ChunkDbRow {
  cx: number;
  cy: number;
  delta: ChunkDelta;
  cells: number;
  rev: number;
}

interface LedgerDbRow {
  key: string;
  actor: string;
  world_id: string | null;
  kind: string;
  delta: ActionChanges;
  at_ms: string | number;
}

/** Postgres transaction on one client. The store begins and commits (or rolls back) around it. */
export class PgWorldTxn implements WorldTxn {
  aborted = false;

  constructor(private readonly client: PoolClient) {}

  abort(): void {
    this.aborted = true;
  }

  async lockWorld(worldId: string): Promise<boolean> {
    const r = await this.client.query('SELECT 1 FROM worlds WHERE id = $1 FOR UPDATE', [worldId]);
    return (r.rowCount ?? 0) > 0;
  }

  async ledgerOf(key: string): Promise<LedgerRow | null> {
    const r = await this.client.query<LedgerDbRow>(
      'SELECT key, actor, world_id, kind, delta, extract(epoch from at) * 1000 AS at_ms FROM ledger WHERE key = $1',
      [key],
    );
    const row = r.rows[0];
    if (!row) return null;
    return {
      key: row.key,
      actor: row.actor,
      worldId: row.world_id,
      kind: row.kind,
      delta: row.delta,
      at: Math.round(Number(row.at_ms)),
    };
  }

  async insertLedger(row: LedgerRow): Promise<boolean> {
    const r = await this.client.query(
      `INSERT INTO ledger (at, actor, world_id, kind, delta, key)
       VALUES (to_timestamp($1 / 1000.0), $2, $3, $4, $5, $6)
       ON CONFLICT (key) DO NOTHING`,
      [row.at, row.actor, row.worldId, row.kind, JSON.stringify(row.delta), row.key],
    );
    return (r.rowCount ?? 0) === 1;
  }

  async accountOf(userId: string, lock: boolean): Promise<AccountRow> {
    const r = await this.client.query<AccountDbRow>(
      `SELECT items, money, rev FROM inventories WHERE user_id = $1${lock ? ' FOR UPDATE' : ''}`,
      [userId],
    );
    const row = r.rows[0];
    if (!row) return { inventory: { items: {}, money: 0 }, rev: 0 };
    return { inventory: { items: row.items, money: Number(row.money) }, rev: row.rev };
  }

  async saveAccount(userId: string, inventory: Inventory, expectedRev: number): Promise<number | null> {
    const r = await this.client.query<{ rev: number }>(
      `INSERT INTO inventories (user_id, items, money, rev) VALUES ($1, $2, $3, 1)
       ON CONFLICT (user_id) DO UPDATE SET items = EXCLUDED.items, money = EXCLUDED.money, rev = inventories.rev + 1
       WHERE inventories.rev = $4
       RETURNING rev`,
      [userId, JSON.stringify(inventory.items), inventory.money, expectedRev],
    );
    return r.rows[0] ? Number(r.rows[0].rev) : null;
  }

  async progressOf(userId: string, lock: boolean): Promise<ProgressRow | null> {
    const r = await this.client.query<{ skills: Record<string, number>; energy: number; day: number; rest: RestState | null }>(
      `SELECT skills, energy, day, rest FROM progress WHERE user_id = $1${lock ? ' FOR UPDATE' : ''}`,
      [userId],
    );
    const row = r.rows[0];
    return row ? { skills: row.skills, energy: row.energy, day: Number(row.day), rest: row.rest } : null;
  }

  async saveProgress(userId: string, progress: ProgressRow): Promise<void> {
    await this.client.query(
      `INSERT INTO progress (user_id, skills, energy, day, rest) VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (user_id) DO UPDATE SET skills = EXCLUDED.skills, energy = EXCLUDED.energy,
         day = EXCLUDED.day, rest = EXCLUDED.rest`,
      [
        userId,
        JSON.stringify(progress.skills),
        progress.energy,
        progress.day,
        progress.rest === null ? null : JSON.stringify(progress.rest),
      ],
    );
  }

  async showOffOf(userId: string): Promise<Skill | null> {
    const r = await this.client.query<{ skill: Skill }>('SELECT skill FROM show_off WHERE user_id = $1', [userId]);
    return r.rows[0]?.skill ?? null;
  }

  async saveShowOff(userId: string, skill: Skill | null): Promise<void> {
    if (skill === null) {
      await this.client.query('DELETE FROM show_off WHERE user_id = $1', [userId]);
      return;
    }
    await this.client.query(
      `INSERT INTO show_off (user_id, skill) VALUES ($1, $2)
       ON CONFLICT (user_id) DO UPDATE SET skill = EXCLUDED.skill`,
      [userId, skill],
    );
  }

  async friendsOf(userId: string, lock: boolean): Promise<Record<string, FriendRecord>> {
    const r = await this.client.query<{ npc: string; points: number; gift_day: number; week: number; gifts_this_week: number }>(
      `SELECT npc, points, gift_day, week, gifts_this_week FROM friendships WHERE user_id = $1${lock ? ' FOR UPDATE' : ''}`,
      [userId],
    );
    const out: Record<string, FriendRecord> = {};
    for (const row of r.rows)
      out[row.npc] = { points: row.points, giftDay: row.gift_day, week: row.week, giftsThisWeek: row.gifts_this_week };
    return out;
  }

  async saveFriend(userId: string, npc: string, record: FriendRecord): Promise<void> {
    await this.client.query(
      `INSERT INTO friendships (user_id, npc, points, gift_day, week, gifts_this_week) VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (user_id, npc) DO UPDATE SET points = EXCLUDED.points, gift_day = EXCLUDED.gift_day,
         week = EXCLUDED.week, gifts_this_week = EXCLUDED.gifts_this_week`,
      [userId, npc, record.points, record.giftDay, record.week, record.giftsThisWeek],
    );
  }

  async contractsOf(worldId: string, lock: boolean): Promise<Contract[]> {
    const r = await this.client.query<ContractDbRow>(
      `SELECT ${CONTRACT_COLS} FROM world_contracts WHERE world_id = $1 AND state = 'open'
       ORDER BY created_at, id${lock ? ' FOR UPDATE' : ''}`,
      [worldId],
    );
    return r.rows.map(contractOfRow);
  }

  async contractById(id: string, lock: boolean): Promise<Contract | null> {
    const r = await this.client.query<ContractDbRow>(
      `SELECT ${CONTRACT_COLS} FROM world_contracts WHERE id = $1${lock ? ' FOR UPDATE' : ''}`,
      [id],
    );
    return r.rows[0] ? contractOfRow(r.rows[0]) : null;
  }

  async saveContract(c: Contract): Promise<void> {
    await this.client.query(
      `INSERT INTO world_contracts (id, world_id, owner_id, kind, goal, reward, progress, state, winner, created_at, closed_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
       ON CONFLICT (id) DO UPDATE SET progress = EXCLUDED.progress, state = EXCLUDED.state,
         winner = EXCLUDED.winner, closed_at = EXCLUDED.closed_at`,
      [c.id, c.worldId, c.ownerId, c.kind, c.goal, c.reward, JSON.stringify(c.progress), c.state, c.winner, c.createdAt, c.closedAt],
    );
  }

  async openListings(limit: number): Promise<Listing[]> {
    const r = await this.client.query<ListingDbRow>(
      `SELECT ${LISTING_COLS} FROM market_listings WHERE state = 'open' ORDER BY created_at, id LIMIT $1`,
      [limit],
    );
    return r.rows.map(listingOfRow);
  }

  async listingById(id: string, lock: boolean): Promise<Listing | null> {
    const r = await this.client.query<ListingDbRow>(
      `SELECT ${LISTING_COLS} FROM market_listings WHERE id = $1${lock ? ' FOR UPDATE' : ''}`,
      [id],
    );
    return r.rows[0] ? listingOfRow(r.rows[0]) : null;
  }

  async saveListing(l: Listing): Promise<void> {
    await this.client.query(
      `INSERT INTO market_listings (id, seller_id, item, qty, price, fee, state, buyer_id, created_at, expires_at, closed_at, list_day, buy_day)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
       ON CONFLICT (id) DO UPDATE SET state = EXCLUDED.state, buyer_id = EXCLUDED.buyer_id,
         closed_at = EXCLUDED.closed_at, buy_day = EXCLUDED.buy_day`,
      [l.id, l.sellerId, l.item, l.qty, l.price, l.fee, l.state, l.buyerId, l.createdAt, l.expiresAt, l.closedAt, l.listDay, l.buyDay],
    );
  }

  async marketCounts(userId: string, day: number): Promise<{ active: number; listedToday: number; boughtToday: number }> {
    const r = await this.client.query<{ active: string; listed: string; bought: string }>(
      `SELECT
         count(*) FILTER (WHERE seller_id = $1 AND state = 'open') AS active,
         count(*) FILTER (WHERE seller_id = $1 AND list_day = $2) AS listed,
         count(*) FILTER (WHERE buyer_id = $1 AND buy_day = $2) AS bought
       FROM market_listings WHERE seller_id = $1 OR buyer_id = $1`,
      [userId, day],
    );
    const row = r.rows[0];
    return { active: Number(row?.active ?? 0), listedToday: Number(row?.listed ?? 0), boughtToday: Number(row?.bought ?? 0) };
  }

  async expiredListings(now: number, limit: number): Promise<Listing[]> {
    const r = await this.client.query<ListingDbRow>(
      `SELECT ${LISTING_COLS} FROM market_listings WHERE state = 'open' AND expires_at <= $1
       ORDER BY expires_at, id LIMIT $2 FOR UPDATE SKIP LOCKED`,
      [now, limit],
    );
    return r.rows.map(listingOfRow);
  }

  async firstSeenOf(userId: string): Promise<number | null> {
    const r = await this.client.query<{ first_ms: string | null }>(
      'SELECT extract(epoch from min(at)) * 1000 AS first_ms FROM ledger WHERE actor = $1',
      [userId],
    );
    const v = r.rows[0]?.first_ms;
    return v === null || v === undefined ? null : Math.round(Number(v));
  }

  async simOf(worldId: string, lock: boolean): Promise<SimRow | null> {
    const r = await this.client.query<SimDbRow>(
      `SELECT state, rev FROM world_sim WHERE world_id = $1${lock ? ' FOR UPDATE' : ''}`,
      [worldId],
    );
    const row = r.rows[0];
    return row ? { state: row.state, rev: row.rev } : null;
  }

  async saveSim(worldId: string, state: WorldSimState, expectedRev: number): Promise<number | null> {
    const r = await this.client.query<{ rev: number }>(
      `INSERT INTO world_sim (world_id, day, state, rev) VALUES ($1, $2, $3, 1)
       ON CONFLICT (world_id) DO UPDATE SET day = EXCLUDED.day, state = EXCLUDED.state, rev = world_sim.rev + 1
       WHERE world_sim.rev = $4
       RETURNING rev`,
      [worldId, state.day, JSON.stringify(state), expectedRev],
    );
    return r.rows[0] ? Number(r.rows[0].rev) : null;
  }

  async chunksOf(worldId: string, keys: readonly { cx: number; cy: number }[]): Promise<StoredChunk[]> {
    if (keys.length === 0) return [];
    const r = await this.client.query<ChunkDbRow>(
      `SELECT c.cx, c.cy, c.delta, c.cells, c.rev FROM world_chunks c
       JOIN unnest($2::int[], $3::int[]) AS k(cx, cy) ON k.cx = c.cx AND k.cy = c.cy
       WHERE c.world_id = $1`,
      [worldId, keys.map((k) => k.cx), keys.map((k) => k.cy)],
    );
    return r.rows.map((row) => ({ cx: row.cx, cy: row.cy, delta: row.delta, cells: row.cells, rev: row.rev }));
  }

  async saveChunk(
    worldId: string,
    cx: number,
    cy: number,
    delta: ChunkDelta,
    expectedRev: number,
    cap = WORLD_DELTA_CELL_CAP,
  ): Promise<ChunkSave> {
    const current = await this.client.query<{ rev: number }>(
      'SELECT rev FROM world_chunks WHERE world_id = $1 AND cx = $2 AND cy = $3',
      [worldId, cx, cy],
    );
    const rev = current.rows[0]?.rev ?? 0;
    if (rev !== expectedRev) return { ok: false, reason: 'conflict' };
    const others = await this.client.query<{ total: string | number }>(
      'SELECT COALESCE(SUM(cells), 0) AS total FROM world_chunks WHERE world_id = $1 AND NOT (cx = $2 AND cy = $3)',
      [worldId, cx, cy],
    );
    const cells = deltaCells(delta);
    if (Number(others.rows[0]?.total ?? 0) + cells > cap) return { ok: false, reason: 'cap' };
    const saved = await this.client.query<{ rev: number }>(
      `INSERT INTO world_chunks (world_id, cx, cy, delta, cells, rev) VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (world_id, cx, cy) DO UPDATE SET delta = EXCLUDED.delta, cells = EXCLUDED.cells, rev = EXCLUDED.rev
       RETURNING rev`,
      [worldId, cx, cy, JSON.stringify(delta), cells, rev + 1],
    );
    return { ok: true, rev: Number(saved.rows[0]?.rev ?? rev + 1) };
  }
}

interface ContractDbRow {
  id: string;
  world_id: string;
  owner_id: string;
  kind: Contract['kind'];
  goal: number;
  reward: number;
  progress: Record<string, number> | null;
  state: Contract['state'];
  winner: string | null;
  created_at: string | number;
  closed_at: string | number | null;
}
const CONTRACT_COLS = 'id, world_id, owner_id, kind, goal, reward, progress, state, winner, created_at, closed_at';
const contractOfRow = (r: ContractDbRow): Contract => ({
  id: r.id,
  worldId: r.world_id,
  ownerId: r.owner_id,
  kind: r.kind,
  goal: r.goal,
  reward: r.reward,
  progress: r.progress ?? {},
  state: r.state,
  winner: r.winner,
  createdAt: Number(r.created_at),
  closedAt: r.closed_at === null ? null : Number(r.closed_at),
});

interface ListingDbRow {
  id: string;
  seller_id: string;
  item: string;
  qty: number;
  price: string | number;
  fee: string | number;
  state: Listing['state'];
  buyer_id: string | null;
  created_at: string | number;
  expires_at: string | number;
  closed_at: string | number | null;
  list_day: number;
  buy_day: number | null;
}
const LISTING_COLS = 'id, seller_id, item, qty, price, fee, state, buyer_id, created_at, expires_at, closed_at, list_day, buy_day';
const listingOfRow = (r: ListingDbRow): Listing => ({
  id: r.id,
  sellerId: r.seller_id,
  item: r.item,
  qty: r.qty,
  price: Number(r.price),
  fee: Number(r.fee),
  state: r.state,
  buyerId: r.buyer_id,
  createdAt: Number(r.created_at),
  expiresAt: Number(r.expires_at),
  closedAt: r.closed_at === null ? null : Number(r.closed_at),
  listDay: r.list_day,
  buyDay: r.buy_day,
});
