import { ConfigError, loadConfig } from './config';
import { loadDotEnv } from './env';
import { PgStore } from './db/store';
import { announce, ownerRecoveryLink } from './auth/bootstrap';

/**
 * Server-side commands (docs/AUTH.md). They talk to Postgres directly, so they need the
 * same DATABASE_URL as the server, and whoever runs them already controls the server.
 *
 *   pnpm owner:recover                          link to add a passkey to the owner (or set one up)
 *   pnpm pilot:purge --before 2026-12-01        list pilot identities nobody claimed
 *   pnpm pilot:purge --before 2026-12-01 --yes  …and delete them (desks, memberships too)
 *
 * In the container: `node dist/cli.js owner:recover`.
 */
async function main() {
  loadDotEnv();
  const [cmd, ...args] = process.argv.slice(2);
  let cfg;
  try {
    cfg = loadConfig();
  } catch (err) {
    if (err instanceof ConfigError) fail(`configuration error: ${err.message}`);
    throw err;
  }
  if (!cfg.databaseUrl) fail('DATABASE_URL is not set: these commands need the Postgres database.');
  const store = new PgStore(cfg.databaseUrl);
  try {
    await store.init();
    if (cmd === 'owner:recover') {
      const r = await ownerRecoveryLink(cfg, store);
      announce(
        cfg,
        r.kind === 'setup'
          ? 'Agora: no owner yet — create the owner account'
          : 'Agora: add a passkey to the owner account',
        r.url,
        r.minutes,
      );
    } else if (cmd === 'pilot:purge') {
      const i = args.indexOf('--before');
      const before = i >= 0 ? Date.parse(args[i + 1] ?? '') : NaN;
      if (Number.isNaN(before)) fail('usage: pilot:purge --before YYYY-MM-DD [--yes]');
      const accounts = await store.listAccounts();
      const pilots = [];
      for (const a of accounts) {
        if (a.role !== 'member' || a.disabledAt || a.lastSeenAt >= before) continue;
        if ((await store.listPasskeys(a.uid)).length) continue;
        pilots.push(a);
      }
      for (const p of pilots)
        console.log(`${p.uid}\t${p.name}\tlast seen ${new Date(p.lastSeenAt).toISOString()}`);
      if (!args.includes('--yes')) {
        console.log(`\n${pilots.length} unclaimed pilot identities. Add --yes to delete them.`);
      } else {
        for (const p of pilots) await store.deleteUser(p.uid);
        console.log(`\nDeleted ${pilots.length} pilot identities.`);
      }
    } else fail('commands: owner:recover | pilot:purge --before YYYY-MM-DD [--yes]');
  } finally {
    await store.close();
  }
}

function fail(msg: string): never {
  console.error(`[agora] ${msg}`);
  process.exit(1);
}

void main();
