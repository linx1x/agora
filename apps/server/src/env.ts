import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { loadEnvFile } from 'node:process';
import { fileURLToPath } from 'node:url';

/**
 * Load the repo-root `.env` (and one in the current folder) for local runs.
 * Variables already set in the shell win. Skipped for tests (NODE_ENV=test) so
 * e2e and unit runs never pick up a developer's database or builder list.
 */
export function loadDotEnv(): string[] {
  if (process.env.NODE_ENV === 'test') return [];
  const here = dirname(fileURLToPath(import.meta.url));
  const candidates = [resolve('.env'), join(here, '../../../.env')];
  const loaded: string[] = [];
  for (const p of new Set(candidates.map((c) => resolve(c))))
    if (existsSync(p)) {
      loadEnvFile(p);
      loaded.push(p);
    }
  return loaded;
}
