/**
 * Boot progress for the console. Plain stderr lines (not pino) so they show even when
 * the JSON log is hidden or buffered, and a watchdog that names the step a slow boot
 * is stuck on (Postgres, LiveKit, ...).
 */
let current = 'starting';
let done = false;

export function startupStep(step: string) {
  current = step;
  if (process.env.NODE_ENV !== 'test') console.error(`[agora] ${step}…`);
}

/** A fact worth seeing at every boot (where data is kept, ...). */
export function startupNote(note: string) {
  if (process.env.NODE_ENV !== 'test') console.error(`[agora] ${note}`);
}

export function startupDone(url: string) {
  done = true;
  if (process.env.NODE_ENV !== 'test') console.error(`[agora] ready: ${url}`);
}

/** Every `everyMs` until listening, say which step is still running. */
export function startupWatchdog(everyMs = 10_000) {
  const t0 = Date.now();
  const timer = setInterval(() => {
    if (done) return clearInterval(timer);
    const s = Math.round((Date.now() - t0) / 1000);
    console.error(`[agora] still starting after ${s}s, waiting on: ${current}`);
  }, everyMs);
  timer.unref();
}

/** Promise that rejects after `ms` so one slow dependency can't hang boot forever. */
export function withTimeout<T>(p: Promise<T>, ms: number, what: string): Promise<T> {
  let t: NodeJS.Timeout;
  return Promise.race([
    p,
    new Promise<never>((_, reject) => {
      t = setTimeout(() => reject(new Error(`${what}: no answer after ${ms / 1000}s`)), ms);
    }),
  ]).finally(() => clearTimeout(t));
}
