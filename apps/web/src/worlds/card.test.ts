import { describe, expect, it } from 'vitest';
import { placeOfWorldId, worldCardText } from './card';

describe('worldCardText (FIX-1)', () => {
  it('names the world and its owner, never a desk pod or an office zone', () => {
    const c = worldCardText('world', 'Alice Tremblay');
    expect(c).toEqual({
      titleKey: 'worlds.card.title',
      titleVars: { owner: 'Alice Tremblay' },
      hintKey: 'worlds.card.hint',
    });
    // the office keys that the pod card uses must never appear inside a world
    const keys = [c.titleKey, c.hintKey];
    for (const k of keys) {
      expect(k).not.toMatch(/^zone\./);
      expect(k).not.toMatch(/^desk\./);
    }
  });

  it('gives the untitled wording while the owner name is not known', () => {
    expect(worldCardText('world', '')).toEqual({ titleKey: 'worlds.card.untitled', hintKey: 'worlds.card.hint' });
    expect(worldCardText('world', '   ')).toEqual({ titleKey: 'worlds.card.untitled', hintKey: 'worlds.card.hint' });
  });

  it('uses the cave wording for a cave', () => {
    expect(worldCardText('cave', 'Félix')).toEqual({
      titleKey: 'worlds.card.caveTitle',
      titleVars: { owner: 'Félix' },
      hintKey: 'worlds.card.caveHint',
    });
    expect(worldCardText('cave', '').titleKey).toBe('worlds.card.caveUntitled');
  });

  it('trims the owner name it shows', () => {
    expect(worldCardText('world', '  Zoé ').titleVars).toEqual({ owner: 'Zoé' });
  });
});

describe('placeOfWorldId', () => {
  it('tells a cave id from a personal world id', () => {
    expect(placeOfWorldId('8aa54458-5e1d-4ea6-952b-4e1e2cfdf7e7')).toBe('world');
    expect(placeOfWorldId('cave:8aa54458-5e1d:3')).toBe('cave');
  });
});
