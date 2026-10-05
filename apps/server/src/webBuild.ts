import { existsSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

/** Newest modification time (ms) of any file under `dir`. */
function newest(dir: string): number {
  let t = 0;
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    t = Math.max(t, e.isDirectory() ? newest(p) : statSync(p).mtimeMs);
  }
  return t;
}

/**
 * In a checkout, the server serves `apps/web/dist` from the last `pnpm build`. When the
 * web sources changed since, that page is out of date (e.g. no passkey screens yet).
 * Returns when the stale build was made, or undefined when it is current or not a checkout.
 */
export function staleWebBuild(staticDir: string): Date | undefined {
  const index = join(staticDir, 'index.html');
  const src = join(staticDir, '../src');
  if (!existsSync(index) || !existsSync(src)) return undefined;
  const built = statSync(index).mtimeMs;
  return newest(src) > built + 1000 ? new Date(built) : undefined;
}
