import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { WEIGHT_PARTS, type FitSample, type WeightPart } from '@agora/shared';
import type { DecisionRecord } from './log';

const DAY_FILE = /^(\d{4}-\d{2}-\d{2})\.jsonl$/;

/**
 * The decisions worth learning from, per day in date order: "what next" choices Clef made when it
 * was sure, with the scoring's raw parts for each option it was offered. Unsure answers and
 * decisions made by the scoring alone teach nothing about Clef, and approach decisions carry no
 * parts, so they are left out. Bad lines are skipped.
 */
export async function samplesFromLog(
  dir: string,
): Promise<{ days: string[]; byDay: FitSample[][] }> {
  const files = (await readdir(dir).catch(() => [])).filter((f) => DAY_FILE.test(f)).sort();
  const days: string[] = [];
  const byDay: FitSample[][] = [];
  for (const f of files) {
    const out: FitSample[] = [];
    for (const line of (await readFile(join(dir, f), 'utf8')).split('\n')) {
      if (!line.trim()) continue;
      let rec: DecisionRecord;
      try {
        rec = JSON.parse(line) as DecisionRecord;
      } catch {
        continue;
      }
      const chosen = rec.chosen?.next;
      if (rec.kind !== 'next' || rec.via !== 'clef' || !chosen) continue;
      if (!rec.options?.length || !rec.options.every((o) => o.parts)) continue;
      out.push({
        chosen,
        options: rec.options.map((o) => ({
          id: o.id,
          jitter: o.parts!.jitter ?? 0,
          parts: Object.fromEntries(
            WEIGHT_PARTS.filter((k) => o.parts![k] !== undefined).map((k) => [k, o.parts![k]!]),
          ) as Partial<Record<WeightPart, number>>,
        })),
      });
    }
    if (out.length) {
      days.push(f.slice(0, 10));
      byDay.push(out);
    }
  }
  return { days, byDay };
}
