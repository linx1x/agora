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

/** First existing path among the candidates (works from src/ with tsx and from dist/, like hq.tmj). */
function starterPath(): string {
  const found = [
    join(here, '../../../../packages/maps/worlds/starter.json'),
    join(here, '../../maps/worlds/starter.json'),
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
