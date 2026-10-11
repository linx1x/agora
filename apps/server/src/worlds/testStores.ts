/**
 * The stores the world tests run on (ADR-053): the memory store, and Postgres when
 * TEST_DATABASE_URL is set. Each Postgres open gets a schema of its own, dropped on close, so
 * test files can share one database. Test-only: nothing in the server imports this module.
 */
import pg from 'pg';
import { PgStore } from '../db/store';
import { MemoryWorldStore, type WorldStore } from './worldStore';

export interface Opened {
  worlds: WorldStore;
  users(uids: string[]): Promise<void>;
  close(): Promise<void>;
}
export interface Backend {
  name: string;
  open(): Promise<Opened>;
}

export const memory: Backend = {
  name: 'memory store',
  async open() {
    return { worlds: new MemoryWorldStore(), users: async () => {}, close: async () => {} };
  },
};

export const PG_URL = process.env.TEST_DATABASE_URL;
export const postgres: Backend = {
  name: 'postgres',
  async open() {
    const schema = `actions_${process.pid}_${Math.random().toString(36).slice(2, 10)}`;
    const admin = new pg.Client({ connectionString: PG_URL });
    await admin.connect();
    await admin.query(`CREATE SCHEMA ${schema}`);
    await admin.end();
    const sep = PG_URL!.includes('?') ? '&' : '?';
    const store = new PgStore(`${PG_URL}${sep}options=${encodeURIComponent(`-c search_path=${schema}`)}`);
    await store.init();
    return {
      worlds: store.worlds,
      async users(uids) {
        for (const uid of uids) await store.upsertUser({ uid, name: uid, avatar: null });
      },
      async close() {
        await store.close();
        const drop = new pg.Client({ connectionString: PG_URL });
        await drop.connect();
        await drop.query(`DROP SCHEMA ${schema} CASCADE`);
        await drop.end();
      },
    };
  },
};

/** the stores opened by the running test, closed after it */
export const opened: Array<() => Promise<void>> = [];
