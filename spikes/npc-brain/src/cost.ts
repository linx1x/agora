import type { Usage } from './types.js';

/** US$ per 1M tokens at peak time. */
export interface Price {
  cacheHit: number;
  cacheMiss: number;
  output: number;
  /** Off-peak multiplier (DeepSeek: 0.5). */
  offPeak?: number;
}

/**
 * Known prices. DeepSeek, checked 2026-10-06 on https://api-docs.deepseek.com/quick_start/pricing:
 * deepseek-flash (DeepSeek-V4.1-Flash) 0.006 / 0.30 / 1.20 peak, half off-peak.
 * Override with NPC_LLM_PRICE="hit,miss,out" (US$ per 1M tokens, peak).
 */
export const PRICES: Record<string, Price> = {
  'deepseek-flash': { cacheHit: 0.006, cacheMiss: 0.3, output: 1.2, offPeak: 0.5 },
  'deepseek-v4-flash': { cacheHit: 0.006, cacheMiss: 0.3, output: 1.2, offPeak: 0.5 },
};

/** DeepSeek peak hours: 01:00–04:00 and 06:00–10:00 UTC, Monday to Friday. */
export function isDeepSeekPeak(at: Date): boolean {
  const day = at.getUTCDay();
  if (day === 0 || day === 6) return false;
  const h = at.getUTCHours();
  return (h >= 1 && h < 4) || (h >= 6 && h < 10);
}

export function parsePrice(spec: string | undefined): Price | undefined {
  if (!spec) return undefined;
  const parts = spec.split(',').map((s) => Number(s.trim()));
  if (parts.length !== 3 || parts.some((n) => !Number.isFinite(n) || n < 0)) return undefined;
  const [cacheHit, cacheMiss, output] = parts as [number, number, number];
  return { cacheHit, cacheMiss, output };
}

export function costUsd(usage: Usage, price: Price | undefined, at = new Date()): number {
  if (!price) return 0;
  const k = price.offPeak !== undefined && !isDeepSeekPeak(at) ? price.offPeak : 1;
  const miss = Math.max(0, usage.inputTokens - usage.cachedInputTokens);
  return (
    (k * (usage.cachedInputTokens * price.cacheHit + miss * price.cacheMiss + usage.outputTokens * price.output)) /
    1_000_000
  );
}
