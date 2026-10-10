import { describe, expect, it } from 'vitest';
import { DEFAULT_NPCS } from '../world/npc-personas';
import { fakeCompleter } from './llm';
import { NpcLineBanks } from './lines';
import { PROPOSED_KINDS, proposeLines } from './propose';

const silent = { info: () => {}, warn: () => {} };
const zoe = DEFAULT_NPCS[0]!;
const bank = new NpcLineBanks(undefined, silent).get('zoe');

describe('weekly line proposals', () => {
  it('keeps new, safe lines per kind and language, up to the number asked', async () => {
    const llm = fakeCompleter(() =>
      JSON.stringify({
        fr: { greeting: ['Allô {name}, quelle belle journée!', 'Coucou!', 'Bienvenue!', 'Hé!'] },
        en: { thanks: ['Anytime, {name}!'] },
      }),
    );
    const p = await proposeLines(zoe, bank, llm, { per: 3, now: () => new Date('2026-10-07') });
    expect(p.lines.fr!.greeting).toHaveLength(3);
    expect(p.lines.en!.thanks).toEqual(['Anytime, {name}!']);
    expect(p.generatedAt).toBe('2026-10-07T00:00:00.000Z');
    expect(JSON.stringify(llm.calls)).not.toMatch(/@|u[0-9]/); // only the persona is sent
  });

  it('drops links, numbers, emails, claims to be human, unknown slots, repeats and empties (negative controls kept)', async () => {
    const existing = bank.lines.fr.greeting![0]!;
    const llm = fakeCompleter(() =>
      JSON.stringify({
        fr: {
          greeting: [
            'Va voir https://exemple.ca',
            'Appelle-moi au 418 555 0199',
            'Écris à zoe@test.example',
            'Je suis un humain, tu sais',
            'Salut {secret}!',
            existing,
            '',
            'Une bonne ligne, {name}!',
          ],
        },
        en: {},
      }),
    );
    const p = await proposeLines(zoe, bank, llm);
    expect(p.lines.fr!.greeting).toEqual(['Une bonne ligne, {name}!']);
    expect(p.dropped).toBe(7);
  });

  it('only proposes the kinds meant to vary, and tolerates nonsense from the model', async () => {
    const p = await proposeLines(
      zoe,
      bank,
      fakeCompleter(() =>
        JSON.stringify({ fr: { injection: ['nope'], greeting: 'not a list' }, en: 5 }),
      ),
    );
    expect(p.lines.fr).toEqual({});
    expect(PROPOSED_KINDS).not.toContain('injection');
    expect(PROPOSED_KINDS).not.toContain('pii');
  });
});
