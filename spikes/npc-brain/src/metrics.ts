/** Scoring a sort run against hand labels (same metrics as clef/clef_bench.py). */

export interface SortRow {
  id: string;
  lang: string;
  kind: string;
  pii: boolean;
  predKind?: string;
  pKind?: number;
  predPii?: boolean;
  pPii?: number;
  ms?: number;
  error?: string;
}

export interface SortMetrics {
  n: number;
  errors: number;
  kindAccuracy: number;
  piiAccuracy: number;
  /** Share of messages with personal information that were caught. */
  piiRecall: number;
  /** Share of answers at or above the threshold, and their accuracy. */
  sweep: { minP: number; coverage: number; accuracy: number }[];
  perKind: Record<string, { n: number; recall: number; precision: number }>;
  /** confusion[label][predicted] */
  confusion: Record<string, Record<string, number>>;
}

export const SWEEP = [0.5, 0.6, 0.7, 0.8, 0.9];

export function scoreSort(rows: SortRow[]): SortMetrics {
  const ok = rows.filter((r) => !r.error && r.predKind !== undefined);
  const kinds = [...new Set(rows.map((r) => r.kind))];
  const confusion: Record<string, Record<string, number>> = {};
  for (const r of ok) {
    const row = (confusion[r.kind] ??= {});
    row[r.predKind!] = (row[r.predKind!] ?? 0) + 1;
  }
  const perKind: SortMetrics['perKind'] = {};
  for (const k of kinds) {
    const labelled = ok.filter((r) => r.kind === k);
    const predicted = ok.filter((r) => r.predKind === k);
    const hit = labelled.filter((r) => r.predKind === k).length;
    perKind[k] = {
      n: labelled.length,
      recall: labelled.length ? hit / labelled.length : NaN,
      precision: predicted.length ? hit / predicted.length : NaN,
    };
  }
  const piiRows = ok.filter((r) => r.predPii !== undefined);
  const piiPos = piiRows.filter((r) => r.pii);
  return {
    n: rows.length,
    errors: rows.length - ok.length,
    kindAccuracy: ok.length ? ok.filter((r) => r.predKind === r.kind).length / ok.length : NaN,
    piiAccuracy: piiRows.length ? piiRows.filter((r) => r.predPii === r.pii).length / piiRows.length : NaN,
    piiRecall: piiPos.length ? piiPos.filter((r) => r.predPii).length / piiPos.length : NaN,
    sweep: SWEEP.map((minP) => {
      const covered = ok.filter((r) => (r.pKind ?? 0) >= minP);
      return {
        minP,
        coverage: ok.length ? covered.length / ok.length : NaN,
        accuracy: covered.length ? covered.filter((r) => r.predKind === r.kind).length / covered.length : NaN,
      };
    }),
    perKind,
    confusion,
  };
}
