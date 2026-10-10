/** Small helpers for the spike's reports. */

export function percentile(values: number[], q: number): number {
  if (values.length === 0) return NaN;
  const s = [...values].sort((a, b) => a - b);
  const i = Math.min(s.length - 1, Math.max(0, Math.ceil(q * s.length) - 1));
  return s[i]!;
}

export const mean = (v: number[]) => (v.length ? v.reduce((a, b) => a + b, 0) / v.length : NaN);
export const pct = (n: number, d: number) => (d && Number.isFinite(n) ? `${((100 * n) / d).toFixed(1)} %` : 'n/a');
export const ms = (v: number) => (Number.isFinite(v) ? `${Math.round(v)} ms` : 'n/a');
export const usd = (v: number) => `US$${v.toFixed(v < 0.01 ? 6 : 4)}`;

const FR = /\b(je|tu|il|on|nous|vous|le|la|les|des|une|est|pas|c'est|ça|et|à|pour|avec|dans|mais|oui|non|merci|bonjour|salut)\b/gi;
const EN = /\b(i|you|he|we|the|a|is|are|not|it's|and|to|for|with|in|but|yes|no|thanks|hello|hi|what|that|this)\b/gi;
const ACCENT = /[éèêàùçôîûâë]/;

/**
 * Rough language guess for a short message: 'fr', 'en' or '?' when unclear. Accented letters
 * count as French only in lowercase words, so a name like "Zoé" or "Félix" in an English
 * message does not tip it to French (spike finding: "Hi Zoé! First day here" read as French).
 */
export function guessLang(text: string): 'fr' | 'en' | '?' {
  const accented = (text.match(/[\p{L}']+/gu) ?? []).filter((w) => w[0] === w[0]!.toLowerCase() && ACCENT.test(w)).length;
  const fr = (text.match(FR)?.length ?? 0) + accented;
  const en = text.match(EN)?.length ?? 0;
  if (fr === en) return '?';
  return fr > en ? 'fr' : 'en';
}

export function stamp(d = new Date()): string {
  return d.toISOString().slice(0, 16).replace(/[-:]/g, '').replace('T', '-');
}
