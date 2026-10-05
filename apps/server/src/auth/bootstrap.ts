import { chmodSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { RECOVERY_HOURS, SETUP_MINUTES } from '@agora/shared';
import type { Config } from '../config';
import type { Store } from '../db/store';
import { issueTicket } from './tickets';

/**
 * Owner bootstrap and recovery (PLAN P2.13, docs/AUTH.md "Recovery").
 *
 * Nothing in the web app can create or promote an owner. While there is no owner, the
 * server prints a one-time setup link to its own console (valid 30 minutes, replaced on
 * every restart). `pnpm owner:recover` prints a link that adds a passkey to the owner's
 * account. Both need access to the server, which is the point.
 */

export const linkBase = (cfg: Config) => cfg.publicOrigins[0] ?? `http://localhost:${cfg.port}`;

/**
 * Where the link can be opened. Outside production, also the local addresses: with
 * `pnpm dev` the page is served by Vite on :5173, and passkeys work on localhost.
 */
export function linkVariants(
  cfg: Config,
  url: string,
  staleBuild?: Date,
): { label: string; url: string }[] {
  const u = new URL(url);
  const tail = `${u.pathname}${u.hash}`;
  if (cfg.env === 'production') return [{ label: '', url }];
  const out = [{ label: 'pnpm dev (Vite):', url: `http://localhost:5173${tail}` }];
  // an old `pnpm build` on :PORT has no setup page and shows the old sign-in instead
  if (!staleBuild) out.push({ label: 'this server:', url: `http://localhost:${cfg.port}${tail}` });
  if (!u.hostname.startsWith('localhost'))
    out.push({ label: 'public address (if it points to this PC):', url });
  return out;
}

/** Show a link loudly on the console (and in SETUP_LINK_FILE when set). */
export function announce(
  cfg: Config,
  title: string,
  url: string,
  minutes: number,
  staleBuild?: Date,
) {
  const links = linkVariants(cfg, url, staleBuild);
  const pad = Math.max(...links.map((l) => l.label.length));
  const lines = [
    title,
    '',
    ...links.map((l) => (l.label ? `${l.label.padEnd(pad)}  ${l.url}` : l.url)),
    '',
    `Single use, valid ${minutes} min. Open it in the browser you will use Agora with.`,
  ];
  const w = Math.max(...lines.map((l) => l.length)) + 4;
  const bar = '─'.repeat(w);
  console.log(`\n┌${bar}┐\n${lines.map((l) => `│  ${l.padEnd(w - 2)}│`).join('\n')}\n└${bar}┘\n`);
  if (cfg.setupLinkFile) {
    mkdirSync(dirname(cfg.setupLinkFile), { recursive: true });
    writeFileSync(cfg.setupLinkFile, `${url}\n`, { mode: 0o600 });
    chmodSync(cfg.setupLinkFile, 0o600);
  }
}

/**
 * No owner yet: revoke older setup links and make a new one. Returns its URL, or null
 * when an owner exists (then nothing is created).
 */
export async function ensureSetupLink(
  cfg: Config,
  store: Store,
  now = Date.now(),
): Promise<string | null> {
  if (await store.ownerUid()) return null;
  await store.revokeTickets('setup', undefined, now);
  const { path } = await issueTicket(
    store,
    cfg.sessionSecret,
    {
      kind: 'setup',
      name: '',
      role: 'owner',
      expiresAt: now + SETUP_MINUTES * 60_000,
      createdBy: null,
      withPin: false,
    },
    now,
  );
  return `${linkBase(cfg)}${path}`;
}

/**
 * `pnpm owner:recover`: a link that adds a passkey to the owner's account (and, when
 * there is no owner yet, the setup link instead).
 */
export async function ownerRecoveryLink(
  cfg: Config,
  store: Store,
  now = Date.now(),
): Promise<{ kind: 'setup' | 'recovery'; url: string; minutes: number }> {
  const owner = await store.ownerUid();
  if (!owner) {
    const url = (await ensureSetupLink(cfg, store, now))!;
    return { kind: 'setup', url, minutes: SETUP_MINUTES };
  }
  const account = await store.getAccount(owner);
  await store.revokeTickets('recovery', owner, now);
  const minutes = Math.min(SETUP_MINUTES, RECOVERY_HOURS * 60);
  const { path } = await issueTicket(
    store,
    cfg.sessionSecret,
    {
      kind: 'recovery',
      name: account?.name ?? '',
      role: null,
      targetUid: owner,
      expiresAt: now + minutes * 60_000,
      createdBy: null,
      withPin: false,
    },
    now,
  );
  return { kind: 'recovery', url: `${linkBase(cfg)}${path}`, minutes };
}
