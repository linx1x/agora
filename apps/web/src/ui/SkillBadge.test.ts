import { describe, expect, it } from 'vitest';
import { SKILLS } from '@agora/shared';
import fr from '../i18n/fr.json';
import en from '../i18n/en.json';

/**
 * The words of the skill badge, the picker and the locked refusal (P17.31) exist in both languages,
 * so no screen shows a raw key. The components themselves are checked by the e2e flows.
 */
const dictionaries = { fr, en } as const;

describe('skill words (P17.31)', () => {
  it.each(Object.keys(dictionaries) as Array<keyof typeof dictionaries>)(
    '%s names every skill and the picker',
    (lang) => {
      const dict = dictionaries[lang] as unknown as {
        skill: Record<string, unknown>;
        worlds: { refused: Record<string, string> };
      };
      for (const skill of SKILLS) expect(dict.skill[skill]).toEqual(expect.any(String));
      expect(dict.skill.badge).toEqual(expect.stringContaining('{{skill}}'));
      expect(dict.skill.badge).toEqual(expect.stringContaining('{{level}}'));
      for (const key of ['label', 'none', 'hint']) {
        expect((dict.skill.showOff as Record<string, unknown>)[key]).toEqual(expect.any(String));
      }
      expect(dict.worlds.refused.locked).toEqual(expect.any(String));
    },
  );
});
