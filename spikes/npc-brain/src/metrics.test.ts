import { describe, expect, it } from 'vitest';
import { scoreSort, type SortRow } from './metrics.js';
import { guessLang, percentile } from './stats.js';

describe('scoreSort', () => {
  const rows: SortRow[] = [
    { id: '1', lang: 'fr', kind: 'greeting', pii: false, predKind: 'greeting', pKind: 0.95, predPii: false },
    { id: '2', lang: 'fr', kind: 'greeting', pii: false, predKind: 'small_talk', pKind: 0.55, predPii: false },
    { id: '3', lang: 'fr', kind: 'other', pii: true, predKind: 'other', pKind: 0.75, predPii: false },
    { id: '4', lang: 'fr', kind: 'other', pii: true, error: 'timeout' },
  ];
  const m = scoreSort(rows);

  it('counts errors apart and scores the rest', () => {
    expect(m.n).toBe(4);
    expect(m.errors).toBe(1);
    expect(m.kindAccuracy).toBeCloseTo(2 / 3);
    expect(m.piiAccuracy).toBeCloseTo(2 / 3);
    expect(m.piiRecall).toBe(0);
  });

  it('sweeps the threshold: fewer answers, more accurate', () => {
    const at07 = m.sweep.find((s) => s.minP === 0.7)!;
    expect(at07.coverage).toBeCloseTo(2 / 3);
    expect(at07.accuracy).toBe(1);
    expect(m.sweep.find((s) => s.minP === 0.5)!.accuracy).toBeCloseTo(2 / 3);
  });

  it('builds per-kind recall, precision and the confusion matrix', () => {
    expect(m.perKind.greeting).toEqual({ n: 2, recall: 0.5, precision: 1 });
    expect(m.confusion.greeting).toEqual({ greeting: 1, small_talk: 1 });
  });
});

describe('stats', () => {
  it('percentile and language guess', () => {
    expect(percentile([5, 1, 3, 2, 4], 0.5)).toBe(3);
    expect(percentile([5, 1, 3, 2, 4], 0.9)).toBe(5);
    expect(guessLang("Salut! C'est l'aile Zen, juste à côté.")).toBe('fr');
    expect(guessLang('Hi! The Zen wing is right next to the lounge.')).toBe('en');
  });
});
