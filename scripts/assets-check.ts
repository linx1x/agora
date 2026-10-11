/**
 * Fails if a file in apps/web/public/assets lacks a registry entry or breaks a licence rule
 * (ASSETS.md). The rules are in assets-rules.ts, so they can be unit-tested.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { checkRegistry, type RegistryRow } from './assets-rules';

const dir = join(import.meta.dirname, '..', 'apps', 'web', 'public', 'assets');
const reg = JSON.parse(readFileSync(join(dir, 'registry.json'), 'utf8')) as {
  assets: RegistryRow[];
};
const walk = (d: string): string[] =>
  readdirSync(d).flatMap((f) =>
    statSync(join(d, f)).isDirectory() ? walk(join(d, f)) : [join(d, f)],
  );
const files = walk(dir).map((f) => relative(dir, f).replaceAll('\\', '/'));
const errors = checkRegistry(reg.assets, files);
if (errors.length) {
  console.error(errors.join('\n'));
  process.exit(1);
}
console.log(`assets ok: ${reg.assets.length} registry entries`);
