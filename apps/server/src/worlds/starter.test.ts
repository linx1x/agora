import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { defaultStarter, starterPath } from './starter';

const here = dirname(fileURLToPath(import.meta.url));
const repoStarter = resolve(here, '../../../../packages/maps/worlds/starter.json');

describe('starter stamp location (P17.14: the bundled server reads it too)', () => {
  it('finds packages/maps/worlds/starter.json from src/worlds and from the bundled dist/', () => {
    expect(existsSync(repoStarter)).toBe(true);
    expect(starterPath(here)).toBe(repoStarter);
    // esbuild bundles the server into apps/server/dist/index.js: the same file, one level up
    expect(starterPath(resolve(here, '../../dist'))).toBe(repoStarter);
  });

  it('parses the starter house the office stamps into every new world', () => {
    expect(defaultStarter().flatten.radius).toBeGreaterThan(0);
    expect(defaultStarter().rows.length % 2).toBe(1);
  });
});
