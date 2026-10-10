/**
 * Web lookups (P15.8, ADR-049): a client for the operator's own SearXNG (`GET /search?format=json`).
 * Off unless `NPC_WEB=searxng`. The engine only calls it for a message Clef is confident needs the
 * public web, that carries no personal information, and that the AI notice (which says so) covers.
 *
 * What leaves the machine: the words of the question, minus the speaker's and the characters'
 * names, to the SearXNG instance, which forwards them to the search engines it is set up with.
 * What comes back is untrusted text: links are cut, injection-looking and personal snippets are
 * dropped, and only the top few are quoted, each with its site, as data in the prompt.
 *
 * Searches are cached for ten minutes by query, capped per hour for the whole server, and a
 * failing instance is left alone for a while (30 s, doubling to 5 min). Failing is never an error
 * for the person: the character answers without the web.
 */
import { WEB_RESULTS, siteAllowed, webSnippet, type TalkLang } from '@agora/shared';
import { z } from 'zod';

interface Logger {
  info(o: object, msg?: string): void;
  warn(o: object, msg?: string): void;
}

export interface WebSettings {
  /** the SearXNG instance, e.g. http://127.0.0.1:8888 */
  url: string;
  /** only these sites (and their subdomains) are quoted; empty = any */
  sites: string[];
  timeoutMs: number;
  /** searches per hour for the whole server */
  perHour: number;
}

export interface WebResult {
  /** the site, without "www." */
  host: string;
  text: string;
}

const ResponseSchema = z.object({
  results: z
    .array(
      z.object({
        url: z.string().optional(),
        content: z.string().optional(),
        title: z.string().optional(),
      }),
    )
    .default([]),
});

const MAX_BODY = 512 * 1024;
const CACHE_MS = 10 * 60_000;
const CACHE_MAX = 200;
const BACKOFF_MIN_MS = 30_000;
const BACKOFF_MAX_MS = 5 * 60_000;

export class WebClient {
  private cache = new Map<string, { at: number; results: WebResult[] }>();
  private calls: number[] = [];
  private downUntil = 0;
  private backoff = BACKOFF_MIN_MS;
  readonly stats = { searched: 0, cached: 0, failed: 0, skipped: 0 };

  constructor(
    private cfg: WebSettings,
    private log: Logger,
    private fetchFn: typeof fetch = fetch,
    private now: () => number = Date.now,
  ) {}

  /** Can a search start now (budget and health)? Cached queries do not need it. */
  get available(): boolean {
    const t = this.now();
    this.calls = this.calls.filter((x) => t - x < 3_600_000);
    return t >= this.downUntil && this.calls.length < this.cfg.perHour;
  }

  /** The few quotable results for a query, or [] (nothing found, budget spent, instance down). */
  async search(query: string, lang: TalkLang): Promise<WebResult[]> {
    const q = query.trim();
    if (!q) return [];
    const key = `${lang}|${q.toLowerCase()}`;
    const t0 = this.now();
    const hit = this.cache.get(key);
    if (hit && t0 - hit.at < CACHE_MS) {
      this.stats.cached++;
      return hit.results;
    }
    if (!this.available) {
      this.stats.skipped++;
      return [];
    }
    this.calls.push(t0);
    try {
      const u = new URL('/search', this.cfg.url);
      u.searchParams.set('q', q);
      u.searchParams.set('format', 'json');
      u.searchParams.set('language', lang);
      u.searchParams.set('safesearch', '1');
      const res = await this.fetchFn(u.toString(), {
        headers: { accept: 'application/json' },
        signal: AbortSignal.timeout(this.cfg.timeoutMs),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const body = await res.text();
      if (body.length > MAX_BODY) throw new Error('response too large');
      const parsed = ResponseSchema.parse(JSON.parse(body));
      const results = this.pick(parsed.results);
      this.stats.searched++;
      this.backoff = BACKOFF_MIN_MS;
      this.remember(key, results);
      return results;
    } catch (e) {
      this.stats.failed++;
      this.downUntil = this.now() + this.backoff;
      this.backoff = Math.min(this.backoff * 2, BACKOFF_MAX_MS);
      // never the query: it is the person's words
      this.log.warn({ err: e instanceof Error ? e.message : String(e) }, 'NPC web lookup failed');
      return [];
    }
  }

  private pick(raw: z.infer<typeof ResponseSchema>['results']): WebResult[] {
    const out: WebResult[] = [];
    const seen = new Set<string>();
    for (const r of raw) {
      if (out.length >= WEB_RESULTS) break;
      let host: string;
      try {
        const u = new URL(r.url ?? '');
        if (u.protocol !== 'https:' && u.protocol !== 'http:') continue;
        host = u.hostname.replace(/^www\./, '');
      } catch {
        continue;
      }
      if (!siteAllowed(host, this.cfg.sites) || seen.has(host)) continue;
      const text = webSnippet(r.content || r.title || '');
      if (!text) continue;
      seen.add(host);
      out.push({ host, text });
    }
    return out;
  }

  private remember(key: string, results: WebResult[]) {
    this.cache.set(key, { at: this.now(), results });
    while (this.cache.size > CACHE_MAX) this.cache.delete(this.cache.keys().next().value!);
  }
}
