/**
 * Fitting the characters' own scoring to Clef's choices (P15.3b, ADR-044, ADR-047).
 *
 * This is imitation (supervised) learning: given the decision log, find one multiplier per score
 * part so that the weighted scores pick what Clef picked as often as possible. There is no reward
 * signal, so it is not reinforcement learning, and the goal is only to agree with Clef when Clef is
 * off. A softmax over the options gives a smooth loss; gradient descent with a pull toward 1 (the
 * hand-set weights) keeps it from running away on little data; the result is accepted only if it
 * agrees with Clef more often than the hand-set weights on days it was not fitted on.
 */
import { z } from 'zod';
import { WEIGHT_PARTS, type ScoreWeights, type WeightPart } from './npc-mind';

/** One logged decision: the raw score parts of each option and which one Clef chose. */
export interface FitSample {
  options: { id: string; parts: Partial<Record<WeightPart, number>>; jitter: number }[];
  chosen: string;
}

export const WEIGHT_MIN = 0;
export const WEIGHT_MAX = 3;

export const WeightsFileSchema = z.object({
  version: z.literal(1),
  fittedAt: z.string(),
  weights: z.partialRecord(z.enum(WEIGHT_PARTS), z.number().min(WEIGHT_MIN).max(WEIGHT_MAX)),
  /** what the fit saw, for the person who reads the file */
  report: z.record(z.string(), z.unknown()).optional(),
});
export type WeightsFile = z.infer<typeof WeightsFileSchema>;

const w = (weights: ScoreWeights, k: WeightPart) => weights[k] ?? 1;
const scoreOf = (o: FitSample['options'][number], weights: ScoreWeights) =>
  WEIGHT_PARTS.reduce((s, k) => s + (o.parts[k] ?? 0) * w(weights, k), 0);

/** Share of decisions where the best weighted option is the one Clef chose (jitter left out). */
export function agreement(samples: FitSample[], weights: ScoreWeights): number {
  if (!samples.length) return 0;
  let hit = 0;
  for (const s of samples) {
    let best = s.options[0]!;
    for (const o of s.options) if (scoreOf(o, weights) > scoreOf(best, weights)) best = o;
    if (best.id === s.chosen) hit++;
  }
  return hit / samples.length;
}

/** Mean negative log-likelihood of Clef's choices under a softmax of the weighted scores. */
export function logLoss(samples: FitSample[], weights: ScoreWeights, temperature = 0.1): number {
  if (!samples.length) return 0;
  let total = 0;
  for (const s of samples) {
    const z = s.options.map((o) => scoreOf(o, weights) / temperature);
    const max = Math.max(...z);
    const lse = max + Math.log(z.reduce((a, v) => a + Math.exp(v - max), 0));
    const i = s.options.findIndex((o) => o.id === s.chosen);
    total += lse - (z[i] ?? lse);
  }
  return total / samples.length;
}

export interface FitOptions {
  /** softmax temperature: the scoring's scores differ by about 0.1–1 */
  temperature?: number;
  /** pull toward 1 (the hand-set weights); larger = trust the data less */
  l2?: number;
  steps?: number;
  rate?: number;
}

/** Gradient descent on the softmax loss with an L2 pull toward 1. Deterministic. */
export function fitWeights(samples: FitSample[], opts: FitOptions = {}): ScoreWeights {
  const T = opts.temperature ?? 0.1;
  const l2 = opts.l2 ?? 0.01;
  const steps = opts.steps ?? 400;
  const rate = opts.rate ?? 0.02;
  const cur: Record<WeightPart, number> = Object.fromEntries(
    WEIGHT_PARTS.map((k) => [k, 1]),
  ) as Record<WeightPart, number>;
  // only the decisions where Clef chose among options the scoring offered can teach anything
  const data = samples.filter(
    (s) => s.options.length > 1 && s.options.some((o) => o.id === s.chosen),
  );
  if (!data.length) return {};
  for (let step = 0; step < steps; step++) {
    const g = Object.fromEntries(WEIGHT_PARTS.map((k) => [k, 0])) as Record<WeightPart, number>;
    for (const s of data) {
      const z = s.options.map((o) => scoreOf(o, cur) / T);
      const max = Math.max(...z);
      const e = z.map((v) => Math.exp(v - max));
      const sum = e.reduce((a, v) => a + v, 0);
      s.options.forEach((o, i) => {
        const p = e[i]! / sum;
        const y = o.id === s.chosen ? 1 : 0;
        for (const k of WEIGHT_PARTS) g[k] += ((p - y) * (o.parts[k] ?? 0)) / T;
      });
    }
    for (const k of WEIGHT_PARTS) {
      const grad = g[k] / data.length + l2 * (cur[k] - 1);
      cur[k] = Math.min(WEIGHT_MAX, Math.max(WEIGHT_MIN, cur[k] - rate * grad));
    }
  }
  return Object.fromEntries(WEIGHT_PARTS.map((k) => [k, Math.round(cur[k] * 1000) / 1000]));
}

export interface FitReport {
  samples: { train: number; test: number };
  agreement: { before: number; after: number; trainBefore: number; trainAfter: number };
  logLoss: { before: number; after: number };
  adopted: boolean;
  reason: string;
}

/** Why not enough data to even try. */
export const FIT_MIN_SAMPLES = 200;
export const FIT_MIN_DAYS = 3;
/** The fit is adopted only if it agrees with Clef at least this much more on days it did not see. */
export const FIT_MIN_GAIN = 0.01;

/**
 * Fit on the earlier days, check on the later ones. `byDay` is in date order. Adopt the fit only
 * when held-out agreement improves by `FIT_MIN_GAIN` and the held-out log loss does not get worse.
 */
export function fitAndCheck(
  byDay: FitSample[][],
  opts: FitOptions = {},
): { weights: ScoreWeights | null; report: FitReport } {
  const all = byDay.flat();
  const empty = (reason: string): { weights: null; report: FitReport } => ({
    weights: null,
    report: {
      samples: { train: all.length, test: 0 },
      agreement: { before: 0, after: 0, trainBefore: 0, trainAfter: 0 },
      logLoss: { before: 0, after: 0 },
      adopted: false,
      reason,
    },
  });
  if (byDay.length < FIT_MIN_DAYS)
    return empty(`needs at least ${FIT_MIN_DAYS} days of logs (have ${byDay.length})`);
  if (all.length < FIT_MIN_SAMPLES)
    return empty(
      `needs at least ${FIT_MIN_SAMPLES} decisions Clef was sure about (have ${all.length})`,
    );
  const cut = Math.max(1, Math.floor(byDay.length * 0.7));
  const train = byDay.slice(0, cut).flat();
  const test = byDay.slice(cut).flat();
  if (!test.length) return empty('no held-out days');
  const weights = fitWeights(train, opts);
  const T = opts.temperature ?? 0.1;
  const report: FitReport = {
    samples: { train: train.length, test: test.length },
    agreement: {
      before: agreement(test, {}),
      after: agreement(test, weights),
      trainBefore: agreement(train, {}),
      trainAfter: agreement(train, weights),
    },
    logLoss: { before: logLoss(test, {}, T), after: logLoss(test, weights, T) },
    adopted: false,
    reason: '',
  };
  const gain = report.agreement.after - report.agreement.before;
  if (gain >= FIT_MIN_GAIN && report.logLoss.after <= report.logLoss.before) {
    report.adopted = true;
    report.reason = `held-out agreement ${(report.agreement.before * 100).toFixed(1)}% → ${(report.agreement.after * 100).toFixed(1)}%`;
    return { weights, report };
  }
  report.reason =
    gain < FIT_MIN_GAIN
      ? `held-out agreement did not improve by ${FIT_MIN_GAIN * 100} points (${(gain * 100).toFixed(1)})`
      : 'held-out log loss got worse';
  return { weights: null, report };
}
