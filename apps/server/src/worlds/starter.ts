/**
 * The starter stamp on the server (ADR-053, P17.10): `packages/maps/worlds/starter.json`, read and
 * checked once per process by the shared `parseStarter`. A broken file stops the server at the
 * first world load rather than stamping half a house.
 */
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseStarter, type Starter } from '@agora/shared';

const here = dirname(fileURLToPath(import.meta.url));
let cached: Starter | undefined;

/**
 * First existing path among the candidates. `dir` is the folder of the running file: src/worlds
 * under tsx, or dist/ once esbuild bundles the server (one level up, like app.ts's hq.tmj); the
 * Docker image copies the file to /app/maps.
 */
export function starterPath(dir: string = here): string {
  const found = [
    join(dir, '../../../../packages/maps/worlds/starter.json'),
    join(dir, '../../../packages/maps/worlds/starter.json'),
    join(dir, '../maps/worlds/starter.json'),
    '/app/maps/worlds/starter.json',
  ]
    .map((p) => resolve(p))
    .find((p) => existsSync(p));
  if (!found) throw new Error('worlds/starter.json not found');
  return found;
}

/** The starter stamp, read once and kept for the life of the process. */
export function defaultStarter(): Starter {
  if (!cached) {
    const path = starterPath();
    cached = parseStarter(JSON.parse(readFileSync(path, 'utf8')) as unknown, path);
  }
  return cached;
}
