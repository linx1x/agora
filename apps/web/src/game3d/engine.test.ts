import { afterEach, describe, expect, it, vi } from 'vitest';
import { chooseEngine, rememberViewFromUrl, VIEW_KEY, type WorldEngine } from './engine';

const ON = { world25d: true };
const OFF = { world25d: false };
const SEARCHES = ['', '?view=2.5d', '?view=2d', '?view=bogus', '?x=1&view=2.5d'];
const STORED = [null, '', '2.5d', '2d', 'nope'];

describe('chooseEngine (ADR-052)', () => {
  it('is 2D whenever the server flag is off, whatever the device asks for', () => {
    for (const s of SEARCHES)
      for (const st of STORED)
        for (const b of [false, true]) expect(chooseEngine(OFF, s, st, b)).toBe<WorldEngine>('2d');
    expect(chooseEngine(undefined, '?view=2.5d', '2.5d', false)).toBe('2d');
  });

  it('is 2D while build mode is on, even when 2.5D is asked for', () => {
    for (const s of SEARCHES)
      for (const st of STORED) expect(chooseEngine(ON, s, st, true)).toBe<WorldEngine>('2d');
  });

  it('uses ?view= first, then the stored choice, then 2D', () => {
    expect(chooseEngine(ON, '?view=2.5d', null, false)).toBe('2.5d');
    expect(chooseEngine(ON, '?view=2.5d', '2d', false)).toBe('2.5d');
    expect(chooseEngine(ON, '?view=2d', '2.5d', false)).toBe('2d');
    expect(chooseEngine(ON, '', '2.5d', false)).toBe('2.5d');
    expect(chooseEngine(ON, '', '2d', false)).toBe('2d');
    expect(chooseEngine(ON, '', null, false)).toBe('2d');
    expect(chooseEngine(ON, '', '', false)).toBe('2d');
  });

  it('ignores an unknown ?view= and falls back to the stored choice', () => {
    expect(chooseEngine(ON, '?view=bogus', '2.5d', false)).toBe('2.5d');
    expect(chooseEngine(ON, '?view=bogus', null, false)).toBe('2d');
  });

  it('covers every combination of flag, URL, stored choice and building', () => {
    // the rule, written out independently of the code under test
    const oracle = (
      flag: boolean,
      s: string,
      st: string | null,
      building: boolean,
    ): WorldEngine => {
      if (!flag || building) return '2d';
      const u = new URLSearchParams(s).get('view');
      const valid = (v: string | null | undefined) => v === '2.5d' || v === '2d';
      const asked = valid(u) ? u : valid(st) ? st : null;
      return asked === '2.5d' ? '2.5d' : '2d';
    };
    let n = 0;
    for (const f of [false, true])
      for (const s of SEARCHES)
        for (const st of STORED)
          for (const b of [false, true]) {
            expect(chooseEngine({ world25d: f }, s, st, b)).toBe(oracle(f, s, st, b));
            n++;
          }
    expect(n).toBe(2 * SEARCHES.length * STORED.length * 2);
  });
});

describe('rememberViewFromUrl', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('saves a valid ?view= and leaves storage alone otherwise', () => {
    const mem = new Map<string, string>();
    vi.stubGlobal('localStorage', {
      getItem: (k: string) => mem.get(k) ?? null,
      setItem: (k: string, v: string) => void mem.set(k, v),
    });
    rememberViewFromUrl('?view=2.5d');
    expect(mem.get(VIEW_KEY)).toBe('2.5d');
    rememberViewFromUrl('?view=2d');
    expect(mem.get(VIEW_KEY)).toBe('2d');
    rememberViewFromUrl('?view=bogus');
    rememberViewFromUrl('');
    expect(mem.get(VIEW_KEY)).toBe('2d');
  });

  it('does not throw when storage is blocked', () => {
    vi.stubGlobal('localStorage', {
      getItem: () => {
        throw new Error('blocked');
      },
      setItem: () => {
        throw new Error('blocked');
      },
    });
    expect(() => rememberViewFromUrl('?view=2.5d')).not.toThrow();
  });
});
