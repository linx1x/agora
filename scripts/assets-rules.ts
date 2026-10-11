/**
 * The licence and registry rules of `pnpm assets:check` (ASSETS.md, ADR-053). Pure: the CLI in
 * `assets-check.ts` reads the registry and the files, and this module decides what is an error.
 */

/** Licences that need no review (ASSETS.md, "Allowed licenses"). */
export const ALLOWED_LICENSES = [
  'CC0',
  'CC-BY 3.0',
  'CC-BY 4.0',
  'OGA-BY 3.0',
  'CC-BY-SA 3.0',
  'CC-BY-SA 4.0',
  'OFL-1.1',
  'ISC',
  'MIT',
] as const;

/**
 * Vincent's own pictures, made with an AI image generator (ADR-053). Accepted only when the row
 * says who made it, with which generator and terms, the prompt, and the style reference it
 * followed. Nothing else in the registry may use this licence name.
 */
export const OWN_WORK_LICENSE = 'Own work (AI-assisted)';

/** The style references of `art-src/worlds/style-reference.md`. */
export const STYLE_REFERENCE = /^REF-[A-F]$/;

export interface Generation {
  generator?: string;
  termsUrl?: string;
  prompt?: string;
  styleRef?: string;
}

export interface RegistryRow {
  path: string;
  license: string;
  title?: string;
  authors?: string[];
  source?: string;
  modified?: boolean;
  notes?: string;
  generation?: Generation;
}

const nonEmpty = (s: string | undefined): boolean => typeof s === 'string' && s.trim() !== '';

function isHttps(s: string | undefined): boolean {
  if (typeof s !== 'string') return false;
  try {
    return new URL(s).protocol === 'https:';
  } catch {
    return false;
  }
}

function ownWorkProblems(row: RegistryRow): string[] {
  const where = `${OWN_WORK_LICENSE} row ${row.path}`;
  const errors: string[] = [];
  if (!(row.authors ?? []).some((name) => name.trim().startsWith('Vincent')))
    errors.push(`${where} needs the author Vincent`);
  const gen = row.generation;
  if (!gen)
    return [
      ...errors,
      `${where} needs a "generation" object (generator, termsUrl, prompt, styleRef)`,
    ];
  if (!nonEmpty(gen.generator)) errors.push(`${where}: generation.generator is missing`);
  if (!isHttps(gen.termsUrl)) errors.push(`${where}: generation.termsUrl must be an https URL`);
  if (!nonEmpty(gen.prompt)) errors.push(`${where}: generation.prompt is missing`);
  if (!STYLE_REFERENCE.test(gen.styleRef ?? ''))
    errors.push(`${where}: generation.styleRef must be REF-A to REF-F`);
  return errors;
}

/** What is wrong with one registry row's licence, if anything. */
export function licenseProblems(row: RegistryRow): string[] {
  if (row.license === OWN_WORK_LICENSE) return ownWorkProblems(row);
  if (!(ALLOWED_LICENSES as readonly string[]).includes(row.license))
    return [`disallowed license "${row.license}" for ${row.path}`];
  return [];
}

/**
 * Every error of the registry: licences, and a file under `public/assets` with no row. `files` are
 * the published paths relative to `public/assets` (`registry.json` itself is never listed).
 */
export function checkRegistry(rows: readonly RegistryRow[], files: readonly string[]): string[] {
  const errors = rows.flatMap(licenseProblems);
  const paths = new Set(rows.map((row) => row.path));
  for (const rel of files)
    if (rel !== 'registry.json' && !paths.has(rel)) errors.push(`no registry entry for ${rel}`);
  return errors;
}
