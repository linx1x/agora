/**
 * Persistence of personal worlds (ADR-053, P17.7). One row per world, one row per changed chunk
 * (its delta, never the base terrain: that is regenerated from seed and genVersion), and a cap on
 * the patched cells of one world. Postgres and memory implement the same contract; the Postgres
 * save locks the world row, so saves to one world are serial and the revision check cannot race.
 */
import type { Pool } from 'pg';
import {
  WORLD_DELTA_CELL_CAP,
  badgeFrom,
  type Badge,
  type ChunkDelta,
  type Progression,
  type Skill,
} from '@agora/shared';
import {
  MemoryWorldTxn,
  PgWorldTxn,
  cloneMemoryState,
  emptyMemoryState,
  type MemoryState,
  type WorldTxn,
} from './worldTxn';

export interface StoredWorld {
  readonly id: string;
  readonly ownerId: string;
  /** hash32("agora-world:" + userId), an unsigned 32-bit integer */
  readonly seed: number;
  readonly genVersion: number;
  readonly createdAt: number;
  /** the last game day the clock simulated (P17.19) */
  readonly lastDay: number;
  readonly settings: Record<string, unknown>;
}

export interface StoredChunk {
  readonly cx: number;
  readonly cy: number;
  readonly delta: ChunkDelta;
  /** patched cells in this chunk (what the cap counts) */
  readonly cells: number;
  /** 1 after the first save; each save adds one */
  readonly rev: number;
}

export type ChunkSave =
  | { readonly ok: true; readonly rev: number }
  | { readonly ok: false; readonly reason: 'no_world' | 'conflict' | 'cap' };

export interface WorldStore {
  /** false when the id or the owner already has a world */
  createWorld(w: StoredWorld): Promise<boolean>;
  getWorld(id: string): Promise<StoredWorld | null>;
  worldOf(ownerId: string): Promise<StoredWorld | null>;
  setLastDay(id: string, day: number): Promise<void>;
  /** the stored chunks among `keys` (chunks never edited are absent) */
  loadChunks(worldId: string, keys: readonly { cx: number; cy: number }[]): Promise<StoredChunk[]>;
  /** every stored chunk of a world: the room loads them all when it opens (P17.9) */
  loadAllChunks(worldId: string): Promise<StoredChunk[]>;
  /**
   * Replace one chunk's delta when `expectedRev` is the stored revision (0 for none). Refused when
   * the world's other chunks plus this one would exceed `cap` patched cells.
   */
  saveChunk(
    worldId: string,
    cx: number,
    cy: number,
    delta: ChunkDelta,
    expectedRev: number,
    cap?: number,
  ): Promise<ChunkSave>;
  deleteWorldOf(ownerId: string): Promise<void>;
  /**
   * One atomic unit of work over worlds, chunks, the farm, accounts, progress and the ledger
   * (P17.20). Nothing is written when `fn` throws or calls `tx.abort()`.
   */
  withTxn<T>(fn: (tx: WorldTxn) => Promise<T>): Promise<T>;
  /** The badge a person shows (P17.31): the chosen skill at the level their own xp has earned, if any. */
  badgeOf(userId: string, progression: Progression): Promise<Badge | undefined>;
  /** Chooses the skill to show (null shows none) and returns the badge it now shows. */
  setShowOff(userId: string, skill: Skill | null, progression: Progression): Promise<Badge | undefined>;
}

/** Idempotent schema, run after the main schema (the users table must exist). */
export const WORLD_SCHEMA = `
CREATE TABLE IF NOT EXISTS worlds (
  id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
  seed BIGINT NOT NULL,
  gen_version INTEGER NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_day INTEGER NOT NULL DEFAULT 0,
  settings JSONB NOT NULL DEFAULT '{}'::jsonb
);
CREATE TABLE IF NOT EXISTS world_chunks (
  world_id TEXT NOT NULL REFERENCES worlds(id) ON DELETE CASCADE,
  cx INTEGER NOT NULL,
  cy INTEGER NOT NULL,
  delta JSONB NOT NULL,
  cells INTEGER NOT NULL,
  rev INTEGER NOT NULL,
  PRIMARY KEY (world_id, cx, cy)
);
CREATE TABLE IF NOT EXISTS inventories (
  user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  items JSONB NOT NULL DEFAULT '{}'::jsonb,
  money INTEGER NOT NULL DEFAULT 0 CHECK (money >= 0),
  rev INTEGER NOT NULL DEFAULT 1
);
CREATE TABLE IF NOT EXISTS progress (
  user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  skills JSONB NOT NULL DEFAULT '{}'::jsonb,
  unlocks JSONB NOT NULL DEFAULT '{}'::jsonb,
  energy INTEGER NOT NULL DEFAULT 0
);
-- P17.23: the day the energy is settled on, and the bed's rest until the rollover (added to P17.20's table)
ALTER TABLE progress ADD COLUMN IF NOT EXISTS day INTEGER NOT NULL DEFAULT 0;
ALTER TABLE progress ADD COLUMN IF NOT EXISTS rest JSONB;
CREATE TABLE IF NOT EXISTS ledger (
  id BIGSERIAL PRIMARY KEY,
  at TIMESTAMPTZ NOT NULL DEFAULT now(),
  actor TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  world_id TEXT REFERENCES worlds(id) ON DELETE SET NULL,
  kind TEXT NOT NULL,
  delta JSONB NOT NULL,
  key TEXT NOT NULL UNIQUE
);
CREATE TABLE IF NOT EXISTS world_sim (
  world_id TEXT PRIMARY KEY REFERENCES worlds(id) ON DELETE CASCADE,
  day INTEGER NOT NULL,
  state JSONB NOT NULL,
  rev INTEGER NOT NULL
);
-- P17.31: the skill a person shows on their card (one row per person who chose one)
CREATE TABLE IF NOT EXISTS show_off (
  user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  skill TEXT NOT NULL
);
-- P17.26b: friendship with each character (one row per person and character who received a gift)
CREATE TABLE IF NOT EXISTS friendships (
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  npc TEXT NOT NULL,
  points INTEGER NOT NULL,
  gift_day INTEGER NOT NULL,
  week INTEGER NOT NULL,
  gifts_this_week INTEGER NOT NULL,
  PRIMARY KEY (user_id, npc)
);
`;

const chunkKey = (cx: number, cy: number) => `${cx},${cy}`;

/** The badge a person shows, read in one transaction: the chosen skill at the level their xp has earned. */
async function badgeIn(tx: WorldTxn, userId: string, progression: Progression): Promise<Badge | undefined> {
  const row = await tx.progressOf(userId, false);
  return badgeFrom(row?.skills ?? {}, await tx.showOffOf(userId), progression);
}

export class MemoryWorldStore implements WorldStore {
  private readonly worlds = new Map<string, StoredWorld>();
  /** committed state; a transaction works on a draft and publishes it on commit */
  private state: MemoryState = emptyMemoryState();
  /** transactions run one at a time, so a draft never races another (dev store, ADR-036) */
  private queue: Promise<unknown> = Promise.resolve();

  async createWorld(w: StoredWorld): Promise<boolean> {
    for (const existing of this.worlds.values()) {
      if (existing.id === w.id || existing.ownerId === w.ownerId) return false;
    }
    this.worlds.set(w.id, { ...w, settings: structuredClone(w.settings) });
    return true;
  }

  async getWorld(id: string): Promise<StoredWorld | null> {
    return this.worlds.get(id) ?? null;
  }

  async worldOf(ownerId: string): Promise<StoredWorld | null> {
    for (const w of this.worlds.values()) if (w.ownerId === ownerId) return w;
    return null;
  }

  async setLastDay(id: string, day: number): Promise<void> {
    const w = this.worlds.get(id);
    if (w) this.worlds.set(id, { ...w, lastDay: day });
  }

  async loadChunks(worldId: string, keys: readonly { cx: number; cy: number }[]): Promise<StoredChunk[]> {
    const chunks = this.state.chunks.get(worldId);
    if (!chunks) return [];
    const out: StoredChunk[] = [];
    for (const { cx, cy } of keys) {
      const c = chunks.get(chunkKey(cx, cy));
      if (c) out.push(c);
    }
    return out;
  }

  async loadAllChunks(worldId: string): Promise<StoredChunk[]> {
    return [...(this.state.chunks.get(worldId)?.values() ?? [])].map((c) => structuredClone(c));
  }

  async saveChunk(
    worldId: string,
    cx: number,
    cy: number,
    delta: ChunkDelta,
    expectedRev: number,
    cap = WORLD_DELTA_CELL_CAP,
  ): Promise<ChunkSave> {
    return this.withTxn((tx) => tx.saveChunk(worldId, cx, cy, delta, expectedRev, cap));
  }

  withTxn<T>(fn: (tx: WorldTxn) => Promise<T>): Promise<T> {
    return this.exclusive(async (draft) => {
      const tx = new MemoryWorldTxn(this.worlds, draft.state);
      const value = await fn(tx);
      return { value, commit: !tx.aborted };
    }).then((r) => r.value);
  }

  /** Runs `fn` on a draft of the state, one at a time; the draft is published when `fn` says commit. */
  private exclusive<T>(fn: (draft: { state: MemoryState }) => Promise<{ value: T; commit: boolean }>): Promise<{ value: T; commit: boolean }> {
    const run = this.queue.then(async () => {
      const draft = { state: cloneMemoryState(this.state) };
      const result = await fn(draft);
      if (result.commit) this.state = draft.state;
      return result;
    });
    this.queue = run.catch(() => undefined);
    return run;
  }

  async badgeOf(userId: string, progression: Progression): Promise<Badge | undefined> {
    return this.withTxn((tx) => badgeIn(tx, userId, progression));
  }

  async setShowOff(userId: string, skill: Skill | null, progression: Progression): Promise<Badge | undefined> {
    return this.withTxn(async (tx) => {
      await tx.saveShowOff(userId, skill);
      return badgeIn(tx, userId, progression);
    });
  }

  async deleteWorldOf(ownerId: string): Promise<void> {
    await this.exclusive(async (draft) => {
      for (const w of [...this.worlds.values()]) {
        if (w.ownerId !== ownerId) continue;
        this.worlds.delete(w.id);
        draft.state.chunks.delete(w.id);
        draft.state.sims.delete(w.id);
      }
      // the account's own rows, as the users cascade does in Postgres
      draft.state.accounts.delete(ownerId);
      draft.state.progress.delete(ownerId);
      draft.state.showOff.delete(ownerId);
      for (const key of [...draft.state.friends.keys()]) if (key.startsWith(`${ownerId}|`)) draft.state.friends.delete(key);
      for (const [key, row] of [...draft.state.ledger]) if (row.actor === ownerId) draft.state.ledger.delete(key);
      return { value: undefined, commit: true };
    });
  }
}

interface WorldRow {
  id: string;
  owner_id: string;
  seed: string | number;
  gen_version: number;
  created_ms: string | number;
  last_day: number;
  settings: Record<string, unknown>;
}

function worldOfRow(r: WorldRow): StoredWorld {
  return {
    id: r.id,
    ownerId: r.owner_id,
    seed: Number(r.seed),
    genVersion: r.gen_version,
    createdAt: Math.round(Number(r.created_ms)),
    lastDay: r.last_day,
    settings: r.settings ?? {},
  };
}

const WORLD_COLUMNS =
  'id, owner_id, seed, gen_version, extract(epoch from created_at) * 1000 AS created_ms, last_day, settings';

export class PgWorldStore implements WorldStore {
  constructor(private readonly pool: Pool) {}

  async createWorld(w: StoredWorld): Promise<boolean> {
    const r = await this.pool.query(
      `INSERT INTO worlds (id, owner_id, seed, gen_version, created_at, last_day, settings)
       VALUES ($1, $2, $3, $4, to_timestamp($5 / 1000.0), $6, $7)
       ON CONFLICT DO NOTHING`,
      [w.id, w.ownerId, w.seed, w.genVersion, w.createdAt, w.lastDay, JSON.stringify(w.settings)],
    );
    return (r.rowCount ?? 0) > 0;
  }

  async getWorld(id: string): Promise<StoredWorld | null> {
    const r = await this.pool.query<WorldRow>(`SELECT ${WORLD_COLUMNS} FROM worlds WHERE id = $1`, [id]);
    const row = r.rows[0];
    return row ? worldOfRow(row) : null;
  }

  async worldOf(ownerId: string): Promise<StoredWorld | null> {
    const r = await this.pool.query<WorldRow>(`SELECT ${WORLD_COLUMNS} FROM worlds WHERE owner_id = $1`, [ownerId]);
    const row = r.rows[0];
    return row ? worldOfRow(row) : null;
  }

  async setLastDay(id: string, day: number): Promise<void> {
    await this.pool.query('UPDATE worlds SET last_day = $2 WHERE id = $1', [id, day]);
  }

  async loadChunks(worldId: string, keys: readonly { cx: number; cy: number }[]): Promise<StoredChunk[]> {
    if (keys.length === 0) return [];
    const r = await this.pool.query<{ cx: number; cy: number; delta: ChunkDelta; cells: number; rev: number }>(
      `SELECT c.cx, c.cy, c.delta, c.cells, c.rev FROM world_chunks c
       JOIN unnest($2::int[], $3::int[]) AS k(cx, cy) ON k.cx = c.cx AND k.cy = c.cy
       WHERE c.world_id = $1`,
      [worldId, keys.map((k) => k.cx), keys.map((k) => k.cy)],
    );
    return r.rows.map((row) => ({ cx: row.cx, cy: row.cy, delta: row.delta, cells: row.cells, rev: row.rev }));
  }

  async loadAllChunks(worldId: string): Promise<StoredChunk[]> {
    const r = await this.pool.query<{ cx: number; cy: number; delta: ChunkDelta; cells: number; rev: number }>(
      'SELECT cx, cy, delta, cells, rev FROM world_chunks WHERE world_id = $1',
      [worldId],
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
    return this.withTxn(async (tx) => {
      // the world row is locked first, so two saves to one world are serial (contract test)
      if (!(await tx.lockWorld(worldId))) {
        tx.abort();
        return { ok: false, reason: 'no_world' } as const;
      }
      const saved = await tx.saveChunk(worldId, cx, cy, delta, expectedRev, cap);
      if (!saved.ok) tx.abort();
      return saved;
    });
  }

  async withTxn<T>(fn: (tx: WorldTxn) => Promise<T>): Promise<T> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const tx = new PgWorldTxn(client);
      const value = await fn(tx);
      await client.query(tx.aborted ? 'ROLLBACK' : 'COMMIT');
      return value;
    } catch (err) {
      await client.query('ROLLBACK').catch(() => {});
      throw err;
    } finally {
      client.release();
    }
  }

  async badgeOf(userId: string, progression: Progression): Promise<Badge | undefined> {
    return this.withTxn((tx) => badgeIn(tx, userId, progression));
  }

  async setShowOff(userId: string, skill: Skill | null, progression: Progression): Promise<Badge | undefined> {
    return this.withTxn(async (tx) => {
      await tx.saveShowOff(userId, skill);
      return badgeIn(tx, userId, progression);
    });
  }

  async deleteWorldOf(ownerId: string): Promise<void> {
    await this.pool.query('DELETE FROM worlds WHERE owner_id = $1', [ownerId]);
  }
}
