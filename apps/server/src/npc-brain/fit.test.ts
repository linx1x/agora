import { mkdtempSync, mkdirSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { WEIGHT_PARTS, fitAndCheck } from '@agora/shared';
import { samplesFromLog } from './fit-data';
import { NpcWeights } from './weights';

const silent = { info: () => {}, warn: () => {} };

function rng(seed: number) {
  let s = seed >>> 0 || 1;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 2 ** 32;
  };
}

/** A decision log as the server writes it, with Clef weighting needs twice as much as the scoring. */
function writeLog(dir: string, days: number, perDay: number, mix: Record<string, number> = {}) {
  mkdirSync(dir, { recursive: true });
  const r = rng(11);
  const acts = ['desk', 'coffee', 'lounge', 'water'];
  for (let d = 0; d < days; d++) {
    const lines: string[] = [];
    for (let i = 0; i < perDay; i++) {
      const options = acts.map((id) => ({
        id,
        parts: Object.fromEntries(
          WEIGHT_PARTS.filter(() => r() < 0.6).map((k) => [k, k === 'repeat' ? -r() * 0.4 : r()]),
        ) as Record<string, number>,
      }));
      for (const o of options) o.parts.jitter = 0;
      const teacher = { needs: 2, schedule: 0.4, ...mix };
      const score = (o: (typeof options)[number]) =>
        Object.entries(o.parts).reduce(
          (s, [k, v]) => s + v * ((teacher as Record<string, number>)[k] ?? 1),
          0,
        );
      const chosen = options.reduce((a, b) => (score(b) > score(a) ? b : a)).id;
      lines.push(
        JSON.stringify({
          t: `2026-10-${String(d + 1).padStart(2, '0')}T10:00:00.000Z`,
          space: 'hq',
          npc: 'zoe',
          kind: 'next',
          via: 'clef',
          minute: 600,
          state: {},
          options: options.map((o) => ({ id: o.id, score: 0, parts: o.parts })),
          chosen: { next: chosen },
        }),
      );
    }
    // noise a real log has: an unsure decision, a scoring-only one, an approach, a broken line
    lines.push(
      JSON.stringify({ kind: 'next', via: 'unsure', options: [], chosen: { next: 'desk' } }),
    );
    lines.push(
      JSON.stringify({ kind: 'next', via: 'score', options: [], chosen: { next: 'desk' } }),
    );
    lines.push(
      JSON.stringify({
        kind: 'approach',
        via: 'clef',
        options: [{ id: 'wave', score: 1 }],
        chosen: { approach: 'wave' },
      }),
    );
    lines.push('{not json');
    writeFileSync(
      join(dir, `2026-10-${String(d + 1).padStart(2, '0')}.jsonl`),
      lines.join('\n') + '\n',
    );
  }
}

describe('fitting from the decision log', () => {
  it('reads only the "what next" choices Clef was sure about, per day in order, skipping bad lines', async () => {
    const dir = join(mkdtempSync(join(tmpdir(), 'agora-fit-')), 'log');
    writeLog(dir, 4, 10);
    const { days, byDay } = await samplesFromLog(dir);
    expect(days).toEqual(['2026-10-01', '2026-10-02', '2026-10-03', '2026-10-04']);
    expect(byDay.map((d) => d.length)).toEqual([10, 10, 10, 10]);
    expect(byDay[0]![0]!.options).toHaveLength(4);
    expect((await samplesFromLog(join(dir, 'missing'))).byDay).toEqual([]);
  });

  it('adopts weights from a log where Clef disagrees with the hand-set weights', async () => {
    const dir = join(mkdtempSync(join(tmpdir(), 'agora-fit-')), 'log');
    writeLog(dir, 8, 40);
    const { byDay } = await samplesFromLog(dir);
    const { weights, report } = fitAndCheck(byDay);
    expect(report.adopted).toBe(true);
    expect(weights!.needs!).toBeGreaterThan(1.2);
  });

  it('does not adopt anything from a log where Clef already agrees with the scoring (control)', async () => {
    const dir = join(mkdtempSync(join(tmpdir(), 'agora-fit-')), 'log');
    writeLog(dir, 8, 40, { needs: 1, schedule: 1 });
    const { byDay } = await samplesFromLog(dir);
    expect(fitAndCheck(byDay).weights).toBeNull();
  });

  it('does not adopt anything from a log with too few days', async () => {
    const dir = join(mkdtempSync(join(tmpdir(), 'agora-fit-')), 'log');
    writeLog(dir, 2, 200);
    expect(fitAndCheck((await samplesFromLog(dir)).byDay).weights).toBeNull();
  });
});

describe('the weights file the server reads', () => {
  const mk = () => mkdtempSync(join(tmpdir(), 'agora-w-'));
  it('is absent: the hand-set weights; present: used; replaced: picked up; broken: ignored', () => {
    const dir = mk();
    const w = new NpcWeights(dir, silent);
    expect(w.get(10_000)).toEqual({});
    const f = join(dir, 'weights.json');
    writeFileSync(f, JSON.stringify({ version: 1, fittedAt: 'x', weights: { needs: 1.5 } }));
    expect(w.get(10_001)).toEqual({}); // not checked again within 5 s
    expect(w.get(20_000)).toEqual({ needs: 1.5 });
    writeFileSync(f, JSON.stringify({ version: 1, fittedAt: 'x', weights: { needs: 9 } }));
    utimesSync(f, new Date(), new Date(Date.now() + 5000));
    expect(w.get(30_000)).toEqual({}); // out of range: ignored, not half-applied
    writeFileSync(f, '{broken');
    utimesSync(f, new Date(), new Date(Date.now() + 10_000));
    expect(w.get(40_000)).toEqual({});
  });
  it('without a directory is always the hand-set weights', () => {
    expect(new NpcWeights(undefined, silent).get()).toEqual({});
  });
});
