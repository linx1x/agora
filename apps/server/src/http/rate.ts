/**
 * Fixed-window rate limit per key (IP, ticket…), in memory. Used on every public auth
 * route (docs/AUTH.md "Abuse protection"). One process, so in memory is enough.
 */
export class RateLimit {
  private hits = new Map<string, { n: number; at: number }>();

  constructor(
    private max: number,
    private windowMs: number,
    private now: () => number = Date.now,
  ) {}

  /** true = allowed; counts the hit */
  take(key: string): boolean {
    const now = this.now();
    if (this.hits.size > 10_000)
      for (const [k, v] of this.hits) if (now - v.at > this.windowMs) this.hits.delete(k);
    const h = this.hits.get(key);
    if (!h || now - h.at > this.windowMs) {
      this.hits.set(key, { n: 1, at: now });
      return true;
    }
    return ++h.n <= this.max;
  }
}
