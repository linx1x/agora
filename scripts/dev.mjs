#!/usr/bin/env node
// `pnpm dev`: server (tsx watch) + web (Vite) for local development.
//
// Replaces `pnpm -r --parallel ... dev`, which on Windows ran each tool through a .cmd
// shim: on Ctrl+C every shim asked "Terminate batch job (Y/N)?" at the same time, the
// processes fought over the keyboard and the terminal froze or closed, and servers from
// the old run stayed alive holding ports 3000 / 5173. Here both tools run straight on
// node, never read the keyboard, and Ctrl+C stops the whole process tree.
import { spawn, spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import net from 'node:net';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const isWin = process.platform === 'win32';
const PORT = Number(readEnvPort() ?? 3000);
const WEB_PORT = 5173;

/** PORT from the shell or the repo .env, so the checks look at the right port. */
function readEnvPort() {
  if (process.env.PORT) return process.env.PORT;
  try {
    const m = readFileSync(join(root, '.env'), 'utf8').match(/^\s*PORT\s*=\s*(\d+)/m);
    return m?.[1];
  } catch {
    return undefined;
  }
}

/** Absolute path of a package's bin script, resolved from the app that depends on it. */
function binOf(app, pkg, name) {
  const req = createRequire(join(root, app, 'package.json'));
  const pkgJson = req.resolve(`${pkg}/package.json`);
  const { bin } = JSON.parse(readFileSync(pkgJson, 'utf8'));
  return join(dirname(pkgJson), typeof bin === 'string' ? bin : bin[name]);
}

/** True when something already accepts connections on the port (IPv4 or IPv6). */
function busy(port) {
  const probe = (host) =>
    new Promise((res) => {
      const s = net.connect({ port, host });
      s.setTimeout(800);
      s.once('connect', () => (s.destroy(), res(true)));
      s.once('timeout', () => (s.destroy(), res(false)));
      s.once('error', () => res(false));
    });
  return Promise.all([probe('127.0.0.1'), probe('::1')]).then((r) => r.some(Boolean));
}

/** Windows: PIDs listening on a port (from netstat). */
function pidsOn(port) {
  if (!isWin) return [];
  const out = spawnSync('netstat', ['-ano', '-p', 'TCP'], { encoding: 'utf8' }).stdout ?? '';
  const pids = new Set();
  for (const line of out.split(/\r?\n/)) {
    const c = line.trim().split(/\s+/);
    if (c.length >= 5 && c[1].endsWith(`:${port}`) && /LISTEN/i.test(c[3])) pids.add(c[4]);
  }
  return [...pids].filter((p) => p !== '0');
}

function killTree(pid) {
  if (!pid) return;
  if (isWin) spawnSync('taskkill', ['/PID', String(pid), '/T', '/F'], { stdio: 'ignore' });
  else
    try {
      process.kill(-pid, 'SIGKILL');
    } catch {
      try {
        process.kill(pid, 'SIGKILL');
      } catch {
        /* already gone */
      }
    }
}

const log = (msg) => console.log(`\x1b[36m[dev]\x1b[0m ${msg}`);

// --- leftovers from an earlier run -------------------------------------------------
const freePorts = process.argv.includes('--free-ports');
for (const port of [PORT, WEB_PORT]) {
  if (!(await busy(port))) continue;
  const pids = pidsOn(port);
  if (freePorts && pids.length) {
    log(`port ${port} is held by PID ${pids.join(', ')} (earlier run?): stopping it`);
    pids.forEach(killTree);
    await new Promise((r) => setTimeout(r, 500));
    continue;
  }
  log(`port ${port} is already in use${pids.length ? ` by PID ${pids.join(', ')}` : ''}.`);
  log('Probably Agora from an earlier run that did not stop. Run `pnpm dev --free-ports`');
  log(
    isWin
      ? `to stop it, or by hand: taskkill /PID ${pids[0] ?? '<pid>'} /T /F`
      : `to stop it (Windows only), or: lsof -ti :${port} | xargs kill`,
  );
  process.exit(1);
}

// --- start ---------------------------------------------------------------------------
const children = [];
function run(name, app, script, args) {
  const child = spawn(process.execPath, [script, ...args], {
    cwd: join(root, app),
    // no stdin: Vite / tsx watch must not grab the keyboard (that is what broke Ctrl+C)
    stdio: ['ignore', 'inherit', 'inherit'],
    // POSIX: own process group so the whole tree can be stopped
    detached: !isWin,
    env: { ...process.env, FORCE_COLOR: process.env.FORCE_COLOR ?? '1' },
  });
  child.on('exit', (code, sig) => {
    if (!stopping) {
      log(`${name} exited (${sig ?? code}); stopping the other one`);
      stop(code ?? 1);
    }
  });
  children.push(child);
  return child;
}

log(`starting server (port ${PORT}) and web (port ${WEB_PORT}); Ctrl+C stops both`);
run('server', 'apps/server', binOf('apps/server', 'tsx', 'tsx'), [
  'watch',
  '--clear-screen=false',
  'src/index.ts',
]);
run('web', 'apps/web', binOf('apps/web', 'vite', 'vite'), []);

// Say clearly when the API answers (or that it doesn't): the browser page needs both.
const t0 = Date.now();
let ready = false;
const poll = setInterval(async () => {
  if (stopping) return clearInterval(poll);
  const ok = await busy(PORT); // a plain TCP probe: no request lines in the server log
  const s = Math.round((Date.now() - t0) / 1000);
  if (ok && !ready) {
    ready = true;
    log(`\x1b[32mready\x1b[0m: open http://localhost:${WEB_PORT} (API on :${PORT}, ${s}s)`);
  } else if (!ok && ready) {
    ready = false;
    log(`server on :${PORT} stopped answering (restarting after an edit, or crashed)`);
  } else if (!ok && s > 0 && s % 15 === 0) {
    log(`server on :${PORT} not answering yet after ${s}s; see the [agora] lines above`);
  }
}, 1000);

// --- stop ------------------------------------------------------------------------------
let stopping = false;
function stop(code = 0) {
  if (stopping) return;
  stopping = true;
  clearInterval(poll);
  // children got the same Ctrl+C from the console; give them a moment to close cleanly
  const alive = () => children.filter((c) => c.exitCode === null && c.signalCode === null);
  if (!isWin)
    for (const c of alive()) {
      try {
        process.kill(-c.pid, 'SIGINT');
      } catch {
        /* gone */
      }
    }
  const deadline = Date.now() + 4000;
  const check = setInterval(() => {
    if (alive().length && Date.now() < deadline) return;
    clearInterval(check);
    for (const c of alive()) killTree(c.pid);
    // tsx watch / vite may leave grandchildren on Windows: sweep the tree regardless
    if (isWin) for (const c of children) killTree(c.pid);
    log('stopped');
    process.exit(code);
  }, 100);
}
process.on('SIGINT', () => (stopping ? process.exit(130) : stop(0)));
process.on('SIGTERM', () => stop(0));
process.on('SIGHUP', () => stop(0));
