/**
 * Character voices (P15.6, ADR-048): a client for the voice service in apps/ml (`POST /speak`),
 * which runs on the operator's own machine. A reply is spoken once, however many people hear it
 * (a cache by language and text), one at a time, and a service that is down is left alone for 30 s.
 * Failing to speak is never an error for the person: the text is already on screen.
 */
import { NPC_SAY_MAX, type TalkLang } from '@agora/shared';

interface Logger {
  info(o: object, msg?: string): void;
  warn(o: object, msg?: string): void;
}

export interface Clip {
  /** Ogg Opus */
  opus: Buffer;
  /** length of the speech */
  ms: number;
}

/** A clip bigger than this is not accepted (30 s of Opus at 24 kbit/s is about 90 KB). */
const MAX_CLIP_BYTES = 256 * 1024;
const BACKOFF_MS = 30_000;
/** Waiting to be spoken: more than this and the newest line is not voiced at all. */
const MAX_QUEUE = 3;

export class VoiceClient {
  private cache = new Map<string, Clip>();
  private bytes = 0;
  private chain: Promise<unknown> = Promise.resolve();
  private queued = 0;
  private downUntil = 0;
  readonly stats = { spoken: 0, cached: 0, failed: 0, skipped: 0 };

  constructor(
    private cfg: { url: string; token?: string; timeoutMs: number; cacheBytes?: number },
    private log: Logger,
    private fetchFn: typeof fetch = fetch,
    private now: () => number = Date.now,
  ) {}

  /** The clip for a line, or null (service down, too busy, refused: no sound, the text stands). */
  async speak(text: string, lang: TalkLang): Promise<Clip | null> {
    const t = text.trim();
    if (!t || t.length > NPC_SAY_MAX) return null;
    const key = `${lang}|${t}`;
    const hit = this.cache.get(key);
    if (hit) {
      this.stats.cached++;
      this.cache.delete(key); // most recently used goes last
      this.cache.set(key, hit);
      return hit;
    }
    if (this.now() < this.downUntil || this.queued >= MAX_QUEUE) {
      this.stats.skipped++;
      return null;
    }
    this.queued++;
    const run = this.chain.then(() => this.call(t, lang, key));
    this.chain = run.catch(() => undefined);
    try {
      return await run;
    } finally {
      this.queued--;
    }
  }

  private async call(text: string, lang: TalkLang, key: string): Promise<Clip | null> {
    if (this.now() < this.downUntil) return null;
    try {
      const res = await this.fetchFn(new URL('/speak', this.cfg.url).toString(), {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          ...(this.cfg.token ? { authorization: `Bearer ${this.cfg.token}` } : {}),
        },
        body: JSON.stringify({ text, lang }),
        signal: AbortSignal.timeout(this.cfg.timeoutMs),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const opus = Buffer.from(await res.arrayBuffer());
      if (!opus.length || opus.length > MAX_CLIP_BYTES) throw new Error('bad clip size');
      const clip: Clip = { opus, ms: Number(res.headers.get('x-duration-ms')) || 0 };
      this.remember(key, clip);
      this.stats.spoken++;
      return clip;
    } catch (err) {
      this.stats.failed++;
      if (this.now() >= this.downUntil)
        this.log.warn(
          { err: err instanceof Error ? err.message : String(err) },
          'NPC voice failed; pausing 30 s',
        );
      this.downUntil = this.now() + BACKOFF_MS;
      return null;
    }
  }

  private remember(key: string, clip: Clip) {
    const cap = this.cfg.cacheBytes ?? 20 * 1024 * 1024;
    this.cache.set(key, clip);
    this.bytes += clip.opus.length;
    for (const [k, c] of this.cache) {
      if (this.bytes <= cap) break;
      this.cache.delete(k);
      this.bytes -= c.opus.length;
    }
  }
}
