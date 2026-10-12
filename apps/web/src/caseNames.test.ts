import { readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * Windows and macOS file systems ignore case: `./ItemGlyph` there can resolve to `itemGlyph.ts`
 * instead of `ItemGlyph.tsx`, and the build breaks only on those machines. No two source modules
 * in one folder may differ only by case (a `.css` beside a component is imported with its extension).
 */
function clashes(dir: string, out: string[]): void {
  const stems = new Map<string, string>();
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) {
      clashes(path, out);
      continue;
    }
    const m = /^(.*?)(\.test)?\.(ts|tsx|js|jsx)$/.exec(name);
    if (!m || m[2]) continue;
    const key = m[1]!.toLowerCase();
    const seen = stems.get(key);
    if (seen && seen !== m[1]) out.push(`${dir}: ${seen} / ${m[1]}`);
    else stems.set(key, m[1]!);
  }
}

describe('module names (case-insensitive file systems)', () => {
  it('no two modules in a folder differ only by case', () => {
    const out: string[] = [];
    clashes(fileURLToPath(new URL('.', import.meta.url)), out);
    expect(out).toEqual([]);
  });
});
