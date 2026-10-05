/** Fails if any i18n key is missing in fr or en, or if a source t('key') has no entry. */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const root = join(import.meta.dirname, '..', 'apps', 'web', 'src');
const flat = (o: Record<string, unknown>, p = ''): string[] =>
  Object.entries(o).flatMap(([k, v]) =>
    typeof v === 'object' && v ? flat(v as Record<string, unknown>, `${p}${k}.`) : [`${p}${k}`],
  );
const fr = new Set(flat(JSON.parse(readFileSync(join(root, 'i18n', 'fr.json'), 'utf8'))));
const en = new Set(flat(JSON.parse(readFileSync(join(root, 'i18n', 'en.json'), 'utf8'))));
const errors: string[] = [];
for (const k of fr) if (!en.has(k)) errors.push(`missing in en: ${k}`);
for (const k of en) if (!fr.has(k)) errors.push(`missing in fr: ${k}`);
const base = (k: string) => k.replace(/_(one|other|zero|few|many)$/, '');
const known = new Set([...fr].map(base));
const walk = (d: string): string[] =>
  readdirSync(d).flatMap((f) =>
    statSync(join(d, f)).isDirectory() ? walk(join(d, f)) : /\.tsx?$/.test(f) ? [join(d, f)] : [],
  );
for (const file of walk(root)) {
  const src = readFileSync(file, 'utf8');
  for (const m of src.matchAll(/\bt\('([a-zA-Z0-9_.]+)'/g))
    if (!known.has(m[1]!)) errors.push(`${file}: unknown key ${m[1]}`);
}
if (errors.length) {
  console.error(errors.join('\n'));
  process.exit(1);
}
console.log(`i18n ok: ${fr.size} keys in fr and en`);
