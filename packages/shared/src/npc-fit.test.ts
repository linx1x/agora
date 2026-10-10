import { describe, expect, it } from 'vitest';
import {
  FIT_MIN_DAYS,
  FIT_MIN_SAMPLES,
  WEIGHT_MAX,
  WeightsFileSchema,
  agreement,
  fitAndCheck,
  fitWeights,
  logLoss,
  type FitSample,
} from './npc-fit';
import { WEIGHT_PARTS, scoreActivities, type MindInput, type ScoreWeights } from './npc-mind';
import type { NpcPersona } from './npcs';

/** A persona with just what the scoring reads. */
const DEFAULT_NPCS_FOR_TESTS: Pick<NpcPersona, 'traits' | 'goals' | 'schedulePull'> = {
  traits: { extrovert: 0.5, focus: 0.7 },
  goals: [],
  schedulePull: 1,
};

function rng(seed: number) {
  let s = seed >>> 0 || 1;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 2 ** 32;
  };
}

/** Decisions where the "teacher" (standing in for Clef) scores with its own weights. */
function teacherDays(
  teacher: ScoreWeights,
  days: number,
  perDay: number,
  seed: number,
  noise = 0.03,
): FitSample[][] {
  const r = rng(seed);
  const acts = ['desk', 'coffee', 'lounge', 'water', 'tour', 'wander'];
  return Array.from({ length: days }, () =>
    Array.from({ length: perDay }, () => {
      const options = acts.map((id) => ({
        id,
        parts: Object.fromEntries(
          WEIGHT_PARTS.filter(() => r() < 0.6).map((k) => [k, k === 'repeat' ? -r() * 0.4 : r()]),
        ),
        jitter: 0,
      }));
      const score = (o: (typeof options)[number]) =>
        WEIGHT_PARTS.reduce((s, k) => s + (o.parts[k] ?? 0) * (teacher[k] ?? 1), 0) +
        (r() - 0.5) * noise * 2;
      const chosen = options.reduce((a, b) => (score(b) > score(a) ? b : a)).id;
      return { options, chosen };
    }),
  );
}

describe('imitation fit of the scoring to Clef’s choices (P15.3b)', () => {
  const teacher: ScoreWeights = {
    needs: 2,
    schedule: 0.4,
    traits: 1.6,
    goals: 1,
    people: 1,
    inertia: 1,
    repeat: 1,
  };

  it('moves the weights toward what the teacher uses and raises agreement on days it never saw', () => {
    const days = teacherDays(teacher, 10, 60, 1);
    const train = days.slice(0, 7).flat();
    const test = days.slice(7).flat();
    const w = fitWeights(train);
    expect(w.needs!).toBeGreaterThan(1.3);
    expect(w.schedule!).toBeLessThan(0.8);
    expect(agreement(test, w)).toBeGreaterThan(agreement(test, {}) + 0.05);
    expect(logLoss(test, w)).toBeLessThan(logLoss(test, {}));
  });

  it('adopts the fit when held-out agreement improves, and says by how much', () => {
    const { weights, report } = fitAndCheck(teacherDays(teacher, 10, 60, 2));
    expect(weights).not.toBeNull();
    expect(report.adopted).toBe(true);
    expect(report.agreement.after).toBeGreaterThan(report.agreement.before);
    expect(report.reason).toMatch(/held-out agreement/);
    expect(report.samples.train + report.samples.test).toBe(600);
  });

  it('does not adopt it when Clef already agrees with the hand-set weights (negative control)', () => {
    const { weights, report } = fitAndCheck(teacherDays({}, 10, 60, 3, 0));
    expect(weights).toBeNull();
    expect(report.adopted).toBe(false);
    expect(report.agreement.before).toBeGreaterThan(0.97);
  });

  it('does not adopt a fit that only memorised noise: random labels', () => {
    const r = rng(9);
    const days = teacherDays({}, 10, 60, 4).map((d) =>
      d.map((s) => ({ ...s, chosen: s.options[Math.floor(r() * s.options.length)]!.id })),
    );
    expect(fitAndCheck(days).weights).toBeNull();
  });

  it('refuses to fit on too little data: too few days, too few decisions', () => {
    const few = fitAndCheck(teacherDays(teacher, FIT_MIN_DAYS - 1, 200, 5));
    expect(few.weights).toBeNull();
    expect(few.report.reason).toMatch(/days of logs/);
    const small = fitAndCheck(teacherDays(teacher, 5, Math.floor(FIT_MIN_SAMPLES / 5) - 5, 6));
    expect(small.weights).toBeNull();
    expect(small.report.reason).toMatch(/decisions/);
  });

  it('keeps every weight in range, and is deterministic', () => {
    const train = teacherDays({ needs: 50 }, 8, 60, 7).flat();
    const w = fitWeights(train);
    for (const k of WEIGHT_PARTS) {
      expect(w[k]!).toBeGreaterThanOrEqual(0);
      expect(w[k]!).toBeLessThanOrEqual(WEIGHT_MAX);
    }
    expect(fitWeights(train)).toEqual(w);
    expect(fitWeights([])).toEqual({});
  });

  it('writes a file the server accepts, and rejects out-of-range or unknown parts', () => {
    const ok = WeightsFileSchema.safeParse({
      version: 1,
      fittedAt: '2026-10-07',
      weights: { needs: 1.4 },
    });
    expect(ok.success).toBe(true);
    expect(
      WeightsFileSchema.safeParse({ version: 1, fittedAt: 'x', weights: { needs: 9 } }).success,
    ).toBe(false);
    expect(
      WeightsFileSchema.safeParse({ version: 1, fittedAt: 'x', weights: { jitter: 1 } }).success,
    ).toBe(false);
  });
});

describe('weights in the scoring itself', () => {
  const input = (): MindInput => ({
    persona: DEFAULT_NPCS_FOR_TESTS,
    needs: { energy: 80, social: 60, focus: 80, caffeine: 10 },
    minute: 620,
    scheduled: 'desk',
    current: 'desk',
    goalProgress: {},
    recent: {},
    greet: null,
    friend: null,
    crowd: 0,
    unavailable: new Set(),
  });

  it('no weights, or all ones, change nothing', () => {
    const a = scoreActivities(input(), rng(1));
    expect(scoreActivities(input(), rng(1), {})).toEqual(a);
    expect(scoreActivities(input(), rng(1), { needs: 1, schedule: 1 })).toEqual(a);
  });

  it('scale the score but never the logged parts, so a log can always be fitted again', () => {
    const base = scoreActivities(input(), rng(1));
    const heavy = scoreActivities(input(), rng(1), { needs: 3, schedule: 0 });
    const coffeeB = base.find((s) => s.activity === 'coffee')!;
    const coffeeH = heavy.find((s) => s.activity === 'coffee')!;
    expect(coffeeH.parts).toEqual(coffeeB.parts);
    expect(coffeeH.score).toBeGreaterThan(coffeeB.score);
    const deskB = base.find((s) => s.activity === 'desk')!;
    const deskH = heavy.find((s) => s.activity === 'desk')!;
    expect(deskH.parts.schedule).toBe(deskB.parts.schedule);
    expect(deskH.score).toBeLessThan(deskB.score);
    // and the jitter is never scaled
    expect(coffeeH.parts.jitter).toBe(coffeeB.parts.jitter);
  });
});
