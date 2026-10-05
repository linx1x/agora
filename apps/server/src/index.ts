import { ConfigError, loadConfig } from './config';
import { buildApp } from './app';
import { StoreUnavailableError } from './db/store';
import { loadDotEnv } from './env';
import { announce, ensureSetupLink } from './auth/bootstrap';
import { SETUP_MINUTES } from '@agora/shared';
import { startupDone, startupStep, startupWatchdog } from './startup';

async function main() {
  startupWatchdog();
  startupStep('reading .env and config');
  const envFiles = loadDotEnv();
  let cfg;
  try {
    cfg = loadConfig();
  } catch (err) {
    if (err instanceof ConfigError) {
      console.error(`[agora] configuration error: ${err.message}`);
      process.exit(1);
    }
    throw err;
  }
  let built;
  try {
    built = await buildApp(cfg);
  } catch (err) {
    if (err instanceof StoreUnavailableError) {
      console.error(
        `[agora] ${err.message}\n` +
          '[agora] Start Postgres first (pnpm infra:up, or check Docker Desktop), make sure no Agora server from an earlier run is still running, then start again.',
      );
      process.exit(1);
    }
    throw err;
  }
  const { app, store, staleWebBuild } = built;
  if (envFiles.length) app.log.info({ envFiles }, 'loaded .env');
  if (cfg.builderIds.length || cfg.builderCode)
    app.log.info(
      { builders: cfg.builderIds, builderCode: !!cfg.builderCode },
      'build mode enabled',
    );
  else app.log.info('build mode: no builders (set BUILDER_IDS or BUILDER_CODE)');
  const purge = setInterval(
    () => void store.purge(cfg.chatRetentionDays).catch(() => {}),
    24 * 3600_000,
  );
  void store.purge(cfg.chatRetentionDays).catch(() => {});
  startupStep(`opening port ${cfg.port}`);
  try {
    await app.listen({ port: cfg.port, host: cfg.host });
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'EADDRINUSE') {
      console.error(
        `[agora] port ${cfg.port} is already in use, most likely by an Agora server from an earlier run that did not stop.\n` +
          `[agora] Windows: netstat -ano | findstr :${cfg.port}   then   taskkill /PID <pid> /T /F`,
      );
      process.exit(1);
    }
    throw err;
  }
  startupDone(`http://localhost:${cfg.port}`);

  // Invite-only accounts: while nobody owns this server, print a setup link (P2.13).
  let setupTimer: NodeJS.Timeout | undefined;
  if (cfg.authMode === 'passkey') {
    const setup = async () => {
      const url = await ensureSetupLink(cfg, store);
      if (!url) {
        clearInterval(setupTimer);
        return;
      }
      app.log.warn('no owner yet: open the setup link printed below to create the owner account');
      announce(cfg, 'Agora: create the owner account', url, SETUP_MINUTES, staleWebBuild);
    };
    await setup();
    // a fresh link before the previous one expires, until the owner exists
    setupTimer = setInterval(() => void setup().catch(() => {}), (SETUP_MINUTES - 2) * 60_000);
    setupTimer.unref();
  }

  let stopping = false;
  const shutdown = async (sig: string) => {
    // a second Ctrl+C, or a close that hangs (open sockets, Postgres), still exits
    if (stopping) process.exit(130);
    stopping = true;
    setTimeout(() => process.exit(0), 3000).unref();
    app.log.info({ sig }, 'shutting down');
    clearInterval(purge);
    clearInterval(setupTimer);
    await app.close();
    await store.close();
    process.exit(0);
  };
  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
}

main().catch((err: unknown) => {
  console.error('[agora] server failed to start:', err);
  process.exit(1);
});
