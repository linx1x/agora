import { describe, expect, it } from 'vitest';
import {
  TILE,
  chatReaches,
  computeLinks,
  falloff,
  mediaLinked,
  mediaScope,
  scopeKey,
  pairKey,
  parseFlags,
  peersOf,
  type Placed,
} from './index';

const p = (
  id: string,
  tx: number,
  ty: number,
  zoneKind?: Placed['zoneKind'],
  zoneId?: string,
): Placed => ({
  id,
  x: tx * TILE,
  y: ty * TILE,
  zoneKind,
  zoneId,
});

describe('proximity', () => {
  it('falloff is 1 near, 0 far, monotonic', () => {
    expect(falloff(0)).toBe(1);
    expect(falloff(1.5)).toBe(1);
    expect(falloff(5)).toBe(0);
    expect(falloff(2)).toBeGreaterThan(falloff(3));
  });
  it('hysteresis: connect at 5, keep until 6', () => {
    const a = p('a', 0, 0);
    expect(mediaLinked(a, p('b', 5.5, 0), false)).toBe(false);
    expect(mediaLinked(a, p('b', 5.5, 0), true)).toBe(true);
    expect(mediaLinked(a, p('b', 6.5, 0), true)).toBe(false);
    expect(mediaLinked(a, p('b', 4, 0), false)).toBe(true);
  });
  it('desk pods isolate like private rooms', () => {
    const a = p('a', 0, 0, 'desk', 'jungle-1');
    const b = p('b', 4, 0, 'desk', 'jungle-1');
    const c = p('c', 0.5, 0);
    expect(mediaLinked(a, b, false)).toBe(true);
    expect(mediaLinked(a, c, true)).toBe(false);
    expect(chatReaches(a, c)).toBe(false);
    expect(mediaLinked(a, p('d', 1, 0, 'desk', 'jungle-2'), true)).toBe(false);
  });
  it('private rooms isolate regardless of distance', () => {
    const a = p('a', 0, 0, 'private', 'r1');
    const b = p('b', 7, 0, 'private', 'r1');
    const c = p('c', 0.5, 0); // right outside, adjacent
    const d = p('d', 0.5, 0, 'private', 'r2');
    expect(mediaLinked(a, b, false)).toBe(true);
    expect(mediaLinked(a, c, true)).toBe(false);
    expect(mediaLinked(a, d, true)).toBe(false);
    expect(chatReaches(a, c)).toBe(false);
    expect(chatReaches(c, a)).toBe(false);
    expect(chatReaches(a, b)).toBe(true);
  });
  it('quiet zones never link media but allow nearby chat', () => {
    const a = p('a', 0, 0, 'quiet', 'lib');
    const b = p('b', 1, 0, 'quiet', 'lib');
    expect(mediaLinked(a, b, false)).toBe(false);
    expect(chatReaches(a, b)).toBe(true);
  });
  it('computeLinks + peersOf', () => {
    const links = computeLinks([p('a', 0, 0), p('b', 1, 0), p('c', 20, 0)], new Set());
    expect([...links]).toEqual([pairKey('a', 'b')]);
    expect(peersOf('a', links)).toEqual(['b']);
    expect(peersOf('c', links)).toEqual([]);
  });
  it('media scope: one SFU room per private room or pod, none in quiet zones', () => {
    expect(mediaScope(p('a', 0, 0))).toEqual({ kind: 'floor' });
    expect(mediaScope(p('a', 0, 0, 'area', 'cafe'))).toEqual({ kind: 'floor' });
    expect(mediaScope(p('a', 0, 0, 'private', 'r1'))).toEqual({ kind: 'zone', zoneId: 'r1' });
    expect(mediaScope(p('a', 0, 0, 'desk', 'jungle-1'))).toEqual({
      kind: 'zone',
      zoneId: 'jungle-1',
    });
    expect(mediaScope(p('a', 0, 0, 'quiet', 'lib'))).toEqual({ kind: 'none' });
    expect(scopeKey({ kind: 'zone', zoneId: 'r1' })).toBe('zone:r1');
  });
  it('media scope never joins people the link rules keep apart', () => {
    const kinds: (Placed['zoneKind'] | undefined)[] = [undefined, 'private', 'desk', 'quiet'];
    const people: Placed[] = [];
    let n = 0;
    for (const k of kinds)
      for (const z of ['r1', 'r2'])
        for (const x of [0, 0.5, 3, 9]) people.push(p(`p${n++}`, x, 0, k, k ? z : undefined));
    for (const a of people)
      for (const b of people) {
        if (a === b) continue;
        const linked = mediaLinked(a, b, true);
        const sa = scopeKey(mediaScope(a));
        const sb = scopeKey(mediaScope(b));
        // linked people always share a room; a zone room only ever holds people of that zone
        if (linked) expect(sa).toBe(sb);
        if (sa.startsWith('zone:') && sa === sb) expect(linked).toBe(true);
        if (sa === 'none') expect(linked).toBe(false);
      }
  });
  it('flags parse overrides', () => {
    expect(parseFlags('media=false,unknown=true').media).toBe(false);
    expect(parseFlags(undefined).chat).toBe(true);
  });
});
