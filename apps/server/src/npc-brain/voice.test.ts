import { describe, expect, it } from 'vitest';
import { VoiceClient } from './voice';

const silent = { info: () => {}, warn: () => {} };
const clip = (n = 100) => new Uint8Array(n).fill(7);

function fakeFetch(handler: (url: string, init: RequestInit) => Response | Promise<Response>) {
  const calls: { url: string; init: RequestInit }[] = [];
  const f = (async (url: string, init: RequestInit) => {
    calls.push({ url: String(url), init });
    return handler(String(url), init);
  }) as unknown as typeof fetch;
  return { f, calls };
}
const ok = (n = 100, ms = 1500) =>
  new Response(clip(n), {
    status: 200,
    headers: { 'content-type': 'audio/ogg', 'x-duration-ms': String(ms) },
  });

describe('character voices (P15.6): the client for the voice service on the operator’s machine', () => {
  it('asks the service for a line, with the token, and returns the clip with its length', async () => {
    const { f, calls } = fakeFetch(() => ok(120, 2300));
    const v = new VoiceClient(
      { url: 'http://127.0.0.1:8790', token: 'tok', timeoutMs: 1000 },
      silent,
      f,
    );
    const c = await v.speak('Bonjour!', 'fr');
    expect(c).toMatchObject({ ms: 2300 });
    expect(c!.opus.length).toBe(120);
    expect(calls[0]!.url).toBe('http://127.0.0.1:8790/speak');
    expect((calls[0]!.init.headers as Record<string, string>).authorization).toBe('Bearer tok');
    expect(JSON.parse(String(calls[0]!.init.body))).toEqual({ text: 'Bonjour!', lang: 'fr' });
  });

  it('speaks a line once, however many people hear it, and separates languages', async () => {
    const { f, calls } = fakeFetch(() => ok());
    const v = new VoiceClient({ url: 'http://x', timeoutMs: 1000 }, silent, f);
    await v.speak('Hello', 'en');
    await v.speak('Hello', 'en');
    await v.speak('Hello', 'fr');
    expect(calls).toHaveLength(2);
    expect(v.stats.cached).toBe(1);
  });

  it('keeps the cache under its size, dropping the least recently used', async () => {
    const { f, calls } = fakeFetch(() => ok(100));
    const v = new VoiceClient({ url: 'http://x', timeoutMs: 1000, cacheBytes: 250 }, silent, f);
    await v.speak('a', 'fr');
    await v.speak('b', 'fr');
    await v.speak('a', 'fr'); // a is now the most recent
    await v.speak('c', 'fr'); // over the cap: b goes
    await v.speak('a', 'fr');
    expect(calls.map((c) => JSON.parse(String(c.init.body)).text)).toEqual(['a', 'b', 'c']);
    await v.speak('b', 'fr');
    expect(calls).toHaveLength(4);
  });

  it('gives no sound, and leaves the service alone for 30 s, when it fails (the text still stands)', async () => {
    let t = 1_000_000;
    let fail = true;
    const { f, calls } = fakeFetch(() => (fail ? new Response('no', { status: 500 }) : ok()));
    const v = new VoiceClient({ url: 'http://x', timeoutMs: 1000 }, silent, f, () => t);
    expect(await v.speak('un', 'fr')).toBeNull();
    fail = false;
    expect(await v.speak('deux', 'fr')).toBeNull(); // still resting
    expect(calls).toHaveLength(1);
    t += 31_000;
    expect(await v.speak('trois', 'fr')).not.toBeNull();
  });

  it('refuses empty, over-long and oversized clips, and a network error is not thrown', async () => {
    const big = fakeFetch(() => ok(300 * 1024));
    expect(
      await new VoiceClient({ url: 'http://x', timeoutMs: 1000 }, silent, big.f).speak('x', 'fr'),
    ).toBeNull();
    const none = fakeFetch(() => ok());
    const v = new VoiceClient({ url: 'http://x', timeoutMs: 1000 }, silent, none.f);
    expect(await v.speak('', 'fr')).toBeNull();
    expect(await v.speak('a'.repeat(401), 'fr')).toBeNull();
    expect(none.calls).toHaveLength(0);
    const down = fakeFetch(() => {
      throw new TypeError('fetch failed');
    });
    expect(
      await new VoiceClient({ url: 'http://x', timeoutMs: 1000 }, silent, down.f).speak('x', 'fr'),
    ).toBeNull();
  });

  it('does not pile up: speaks one line at a time and skips the newest when too many wait', async () => {
    const release: (() => void)[] = [];
    const { f, calls } = fakeFetch(() => new Promise<Response>((r) => release.push(() => r(ok()))));
    const v = new VoiceClient({ url: 'http://x', timeoutMs: 5000 }, silent, f);
    const all = ['a', 'b', 'c', 'd'].map((t) => v.speak(t, 'fr'));
    await Promise.resolve();
    await new Promise((r) => setImmediate(r));
    expect(calls).toHaveLength(1); // one at a time
    release[0]!();
    await new Promise((r) => setImmediate(r));
    release[1]?.();
    await new Promise((r) => setImmediate(r));
    release[2]?.();
    const results = await Promise.all(all);
    expect(results.filter(Boolean)).toHaveLength(3);
    expect(results[3]).toBeNull();
    expect(v.stats.skipped).toBe(1);
  });
});
