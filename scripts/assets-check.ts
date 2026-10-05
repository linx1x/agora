/** Fails if a file in apps/web/public/assets lacks a registry entry or uses a disallowed license (ASSETS.md). */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const dir = join(import.meta.dirname, '..', 'apps', 'web', 'public', 'assets');
const ALLOWED = [
  'CC0',
  'CC-BY 3.0',
  'CC-BY 4.0',
  'OGA-BY 3.0',
  'CC-BY-SA 3.0',
  'CC-BY-SA 4.0',
  'OFL-1.1',
  'ISC',
  'MIT',
];
const reg = JSON.parse(readFileSync(join(dir, 'registry.json'), 'utf8')) as {
  assets: { path: string; license: string }[];
};
const errors: string[] = [];
for (const a of reg.assets)
  if (!ALLOWED.includes(a.license)) errors.push(`disallowed license "${a.license}" for ${a.path}`);
const paths = new Set(reg.assets.map((a) => a.path));
const walk = (d: string): string[] =>
  readdirSync(d).flatMap((f) =>
    statSync(join(d, f)).isDirectory() ? walk(join(d, f)) : [join(d, f)],
  );
for (const f of walk(dir)) {
  const rel = relative(dir, f).replaceAll('\\', '/');
  if (rel === 'registry.json') continue;
  if (!paths.has(rel)) errors.push(`no registry entry for ${rel}`);
}
if (errors.length) {
  console.error(errors.join('\n'));
  process.exit(1);
}
console.log(`assets ok: ${reg.assets.length} registry entries`);
