import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  ALLOWED_LICENSES,
  OWN_WORK_LICENSE,
  checkRegistry,
  licenseProblems,
  type RegistryRow,
} from './assets-rules';

const own = (over: Partial<RegistryRow> = {}): RegistryRow => ({
  path: 'worlds/meadow/grass.png',
  title: 'Meadow grass (AI-assisted)',
  authors: ['Vincent'],
  license: OWN_WORK_LICENSE,
  source: '',
  modified: false,
  notes: 'test row',
  generation: {
    generator: 'ExampleGen',
    termsUrl: 'https://example.com/terms',
    prompt: 'Pixel art, exactly 32×32 pixels, one grass tuft',
    styleRef: 'REF-A',
  },
  ...over,
});

describe('licences of the registry (ASSETS.md)', () => {
  it('accepts every licence on the allowed list without extra fields', () => {
    for (const license of ALLOWED_LICENSES)
      expect(licenseProblems({ path: 'x.png', license })).toEqual([]);
  });

  it('refuses a licence that is not on the list, and near misses of the own-work name', () => {
    expect(licenseProblems({ path: 'x.png', license: 'CC-BY-NC 4.0' })).toEqual([
      'disallowed license "CC-BY-NC 4.0" for x.png',
    ]);
    expect(licenseProblems({ ...own(), license: 'Own work' })).not.toEqual([]);
    expect(licenseProblems({ ...own(), license: 'own work (ai-assisted)' })).not.toEqual([]);
  });

  it('accepts own work with every required field', () => {
    expect(licenseProblems(own())).toEqual([]);
  });

  it.each([
    ['generator', (r: RegistryRow) => ({ ...r.generation, generator: '  ' })],
    ['termsUrl', (r: RegistryRow) => ({ ...r.generation, termsUrl: undefined })],
    ['prompt', (r: RegistryRow) => ({ ...r.generation, prompt: '' })],
    ['styleRef', (r: RegistryRow) => ({ ...r.generation, styleRef: undefined })],
  ])('refuses own work without generation.%s', (field, drop) => {
    const row = own();
    const problems = licenseProblems({ ...row, generation: drop(row) });
    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain(field);
  });

  it('refuses own work without a generation object at all', () => {
    const problems = licenseProblems(own({ generation: undefined }));
    expect(problems).toEqual([
      `${OWN_WORK_LICENSE} row worlds/meadow/grass.png needs a "generation" object (generator, termsUrl, prompt, styleRef)`,
    ]);
  });

  it('needs the author Vincent', () => {
    expect(licenseProblems(own({ authors: ['Someone else'] }))).toHaveLength(1);
    expect(licenseProblems(own({ authors: undefined }))).toHaveLength(1);
    expect(licenseProblems(own({ authors: ['Vincent (Agora project)', 'Claude'] }))).toEqual([]);
  });

  it('needs an https terms URL', () => {
    for (const termsUrl of ['http://example.com/terms', 'example.com/terms', 'not a url'])
      expect(licenseProblems(own({ generation: { ...own().generation, termsUrl } }))).toHaveLength(
        1,
      );
  });

  it('needs a style reference of this document (REF-A to REF-F)', () => {
    for (const styleRef of ['REF-G', 'REF-a', 'A', 'REF-AA'])
      expect(licenseProblems(own({ generation: { ...own().generation, styleRef } }))).toHaveLength(
        1,
      );
    for (const styleRef of ['REF-B', 'REF-F'])
      expect(licenseProblems(own({ generation: { ...own().generation, styleRef } }))).toEqual([]);
  });
});

describe('checkRegistry', () => {
  it('reports a file with no registry row, and never the registry itself', () => {
    expect(checkRegistry([], ['a.png', 'registry.json'])).toEqual(['no registry entry for a.png']);
  });

  it('accepts a row whose file is missing (rows may describe files in a later batch)', () => {
    expect(checkRegistry([{ path: 'b.png', license: 'CC0' }], [])).toEqual([]);
  });

  it('collects the licence errors of every row', () => {
    const errors = checkRegistry(
      [{ path: 'a.png', license: 'CC-BY-NC 4.0' }, own({ authors: [] })],
      ['a.png', 'worlds/meadow/grass.png'],
    );
    expect(errors).toHaveLength(2);
  });

  it('passes for the registry as it is shipped', () => {
    const reg = JSON.parse(
      readFileSync(new URL('../apps/web/public/assets/registry.json', import.meta.url), 'utf8'),
    ) as { assets: RegistryRow[] };
    expect(reg.assets.flatMap(licenseProblems)).toEqual([]);
  });
});
