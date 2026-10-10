/**
 * Persistence of personal worlds (ADR-053, P17.7). One row per world, one row per changed chunk
 * (its delta, never the base terrain: that is regenerated from seed and genVersion), and a cap on
 * the patched cells of one world. Postgres and memory implement the same contract; the Postgres
 * save locks the world row, so saves to one world are serial and the revision check cannot race.
 */
import type { Pool } from 'pg';
import { WORLD_DELTA_CELL_CAP, deltaCells, type ChunkDelta } from '@agora/shared';

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
`;

const chunkKey = (cx: number, cy: number) => `${cx},${cy}`;

export class MemoryWorldStore implements WorldStore {
  private readonly worlds = new Map<string, StoredWorld>();
  private readonly chunks = new Map<string, Map<string, StoredChunk>>();

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
    const chunks = this.chunks.get(worldId);
    if (!chunks) return [];
    const out: StoredChunk[] = [];
    for (const { cx, cy } of keys) {
      const c = chunks.get(chunkKey(cx, cy));
      if (c) out.push(c);
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
    const chunks = this.chunks.get(worldId) ?? new Map<string, StoredChunk>();
    const key = chunkKey(cx, cy);
    const rev = chunks.get(key)?.rev ?? 0;
    if (rev !== expectedRev) return { ok: false, reason: 'conflict' };
    let others = 0;
    for (const [k, c] of chunks) if (k !== key) others += c.cells;
    const cells = deltaCells(delta);
    if (others + cells > cap) return { ok: false, reason: 'cap' };
    chunks.set(key, { cx, cy, delta: structuredClone(delta), cells, rev: rev + 1 });
    this.chunks.set(worldId, chunks);
    return { ok: true, rev: rev + 1 };
  }

  async deleteWorldOf(ownerId: string): Promise<void> {
    for (const w of [...this.worlds.values()]) {
      if (w.ownerId !== ownerId) continue;
      this.worlds.delete(w.id);
      this.chunks.delete(w.id);
    }
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

  async saveChunk(
    worldId: string,
    cx: number,
    cy: number,
    delta: ChunkDelta,
    expectedRev: number,
    cap = WORLD_DELTA_CELL_CAP,
  ): Promise<ChunkSave> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const locked = await client.query('SELECT 1 FROM worlds WHERE id = $1 FOR UPDATE', [worldId]);
      if ((locked.rowCount ?? 0) === 0) {
        await client.query('ROLLBACK');
        return { ok: false, reason: 'no_world' };
      }
      const current = await client.query<{ rev: number }>(
        'SELECT rev FROM world_chunks WHERE world_id = $1 AND cx = $2 AND cy = $3',
        [worldId, cx, cy],
      );
      const rev = current.rows[0]?.rev ?? 0;
      if (rev !== expectedRev) {
        await client.query('ROLLBACK');
        return { ok: false, reason: 'conflict' };
      }
      const others = await client.query<{ total: string | number }>(
        'SELECT COALESCE(SUM(cells), 0) AS total FROM world_chunks WHERE world_id = $1 AND NOT (cx = $2 AND cy = $3)',
        [worldId, cx, cy],
      );
      const cells = deltaCells(delta);
      if (Number(others.rows[0]?.total ?? 0) + cells > cap) {
        await client.query('ROLLBACK');
        return { ok: false, reason: 'cap' };
      }
      const saved = await client.query<{ rev: number }>(
        `INSERT INTO world_chunks (world_id, cx, cy, delta, cells, rev) VALUES ($1, $2, $3, $4, $5, $6)
         ON CONFLICT (world_id, cx, cy) DO UPDATE SET delta = EXCLUDED.delta, cells = EXCLUDED.cells, rev = EXCLUDED.rev
         RETURNING rev`,
        [worldId, cx, cy, JSON.stringify(delta), cells, rev + 1],
      );
      await client.query('COMMIT');
      return { ok: true, rev: Number(saved.rows[0]?.rev ?? rev + 1) };
    } catch (err) {
      await client.query('ROLLBACK').catch(() => {});
      throw err;
    } finally {
      client.release();
    }
  }

  async deleteWorldOf(ownerId: string): Promise<void> {
    await this.pool.query('DELETE FROM worlds WHERE owner_id = $1', [ownerId]);
  }
}
