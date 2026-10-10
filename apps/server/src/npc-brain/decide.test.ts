import { describe, expect, it } from 'vitest';
import type { DecideQuestion } from '@agora/shared';
import {
  Brain,
  clefDecider,
  fakeDecider,
  optionsOf,
  probeClef,
  toAnswer,
  type FetchLike,
} from './decide';

const silent = { info: () => {}, warn: () => {} };
const Q: Record<string, DecideQuestion> = {
  next: { type: 'choice', criteria: { desk: 'Work.', coffee: 'Coffee.' } },
  busy: { type: 'noul', instructions: 'Busy?' },
};

function fakeFetch(answer: (url: string, body: unknown) => Response | Promise<Response>) {
  const calls: { url: string; headers: Record<string, string>; body: unknown }[] = [];
  const f: FetchLike = async (url, init) => {
    const body = init.body ? JSON.parse(String(init.body)) : undefined;
    calls.push({ url, headers: (init.headers ?? {}) as Record<string, string>, body });
    return answer(url, body);
  };
  return { f, calls };
}
const json = (o: unknown, status = 200) =>
  new Response(JSON.stringify(o), { status, headers: { 'content-type': 'application/json' } });

describe('decide() (ADR-042, P15.3)', () => {
  it('option ids: choice keys, yes/no, score indexes', () => {
    expect(optionsOf(Q.next!)).toEqual(['desk', 'coffee']);
    expect(optionsOf(Q.busy!)).toEqual(['yes', 'no']);
    expect(optionsOf({ type: 'score', criteria: ['low', 'mid', 'high'] })).toEqual(['0', '1', '2']);
  });

  it('renormalises over the allowed options and ignores unknown ones', () => {
    const a = toAnswer(Q.next!, { desk: 0.2, coffee: 0.6, fly: 5 });
    expect(a.top).toBe('coffee');
    expect(a.p).toBeCloseTo(0.75);
    expect(toAnswer(Q.busy!, {}).p).toBeCloseTo(0.5);
  });

  it('posts {state, questions} to apps/ml with the token, and reads the answers', async () => {
    const { f, calls } = fakeFetch(() =>
      json({
        answers: {
          next: { probs: { desk: 0.1, coffee: 0.9 } },
          busy: { probs: { yes: 0.2, no: 0.8 } },
        },
      }),
    );
    const d = clefDecider('http://ml.test:8790/', { timeoutMs: 500, token: 'tok', fetch: f });
    const r = await d.decide({ state: { a: 1 }, questions: Q });
    expect(calls[0]!.url).toBe('http://ml.test:8790/decide');
    expect(calls[0]!.headers.authorization).toBe('Bearer tok');
    expect(calls[0]!.body).toEqual({ state: { a: 1 }, questions: Q });
    expect(r.answers.next!.top).toBe('coffee');
    expect(r.answers.busy!.top).toBe('no');
  });

  it('a missing answer or an HTTP error is an error, not a guess', async () => {
    const missing = clefDecider('http://ml.test', {
      timeoutMs: 500,
      fetch: fakeFetch(() => json({ answers: {} })).f,
    });
    await expect(missing.decide({ state: {}, questions: Q })).rejects.toThrow(/no answer/);
    const down = clefDecider('http://ml.test', {
      timeoutMs: 500,
      fetch: fakeFetch(() => json({ error: 'x' }, 500)).f,
    });
    await expect(down.decide({ state: {}, questions: Q })).rejects.toThrow(/HTTP 500/);
  });

  it('the brain backs off after a failure and logs each change once', async () => {
    let t = 0;
    let fail = true;
    const warns: object[] = [];
    const infos: object[] = [];
    const d = fakeDecider(() => (fail ? 'down' : { top: 'desk', p: 0.9 }));
    const b = new Brain(
      d,
      0.7,
      { warn: (o) => warns.push(o), info: (o) => infos.push(o) },
      {
        backoffMs: 1000,
        now: () => t,
      },
    );
    expect(await b.ask({}, Q)).toBeNull();
    expect(b.status).toBe('down');
    expect(await b.ask({}, Q)).toBeNull();
    expect(d.calls).toHaveLength(1); // not asked again during the back-off
    t = 1500;
    fail = false;
    expect((await b.ask({}, Q))!.next!.top).toBe('desk');
    expect(b.status).toBe('up');
    expect(warns).toHaveLength(1);
    expect(infos).toHaveLength(1);
    expect(new Brain(null, 0.7, silent).status).toBe('off');
  });

  it('probes /health at start', async () => {
    const ok = fakeFetch(() => json({ ok: true, model: 'clef-flash', quant: '4bit' }));
    expect(await probeClef('http://ml.test', silent, { fetch: ok.f })).toBe(true);
    expect(ok.calls[0]!.url).toBe('http://ml.test/health');
    const ko = fakeFetch(() => Promise.reject(new TypeError('fetch failed')));
    expect(await probeClef('http://ml.test', silent, { fetch: ko.f })).toBe(false);
  });
});
