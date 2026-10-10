/**
 * P15.1: sort the labelled Talk messages through decide() and score them against the hand labels.
 *
 *   pnpm tsx spikes/npc-brain/sort-test.ts --via llm            # LLM-JSON fallback (DeepSeek), ~240 calls, ~US$0.05
 *   pnpm tsx spikes/npc-brain/sort-test.ts --via clef           # Clef-flash via NPC_DECIDE_URL (clef_server.py in WSL2)
 *   options: --lang fr|en|all (default all) · --limit N
 *
 * Talks to one decider directly (no fallback), so the numbers belong to that decider.
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { clefDecider, llmDecider } from './src/decide.js';
import { configFromEnv, createGateway, loadEnv } from './src/gateway.js';
import { scoreSort, type SortMetrics, type SortRow } from './src/metrics.js';
import { mean, ms, pct, percentile, stamp, usd } from './src/stats.js';
import { LlmError, type Decider, type Question } from './src/types.js';

const here = import.meta.dirname;
const root = resolve(here, '../..');

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

const env = loadEnv(join(root, '.env'));
const cfg = configFromEnv(env);
const via = arg('via') ?? (cfg.decide.url ? 'clef' : 'llm');
const lang = arg('lang') ?? 'all';

let decider: Decider;
if (via === 'clef') {
  const url = arg('url') ?? cfg.decide.url ?? 'http://127.0.0.1:8790';
  decider = clefDecider(url, { timeoutMs: Math.max(cfg.decide.timeoutMs, 30_000) });
  console.log(`via Clef at ${url}`);
} else {
  if (!cfg.llm.apiKey) {
    console.error('NPC_LLM_API_KEY is not set (repo .env or environment). See spikes/npc-brain/README.md.');
    process.exit(1);
  }
  decider = llmDecider(createGateway(cfg).llm, { timeoutMs: cfg.llm.timeoutMs });
  console.log(`via the LLM fallback: ${cfg.llm.model} at ${cfg.llm.baseUrl}, thinking ${cfg.llm.thinking ?? 'not sent'}`);
}

const q = JSON.parse(readFileSync(join(here, 'data/questions.json'), 'utf8')) as {
  context: Record<string, unknown>;
  sort: Record<string, Question>;
};
const { messages } = JSON.parse(readFileSync(join(here, 'data/talk-messages.json'), 'utf8')) as {
  messages: { id: string; lang: string; kind: string; pii: boolean; text: string }[];
};
const picked = messages.filter((m) => lang === 'all' || m.lang === lang).slice(0, Number(arg('limit') ?? Infinity));

const rows: SortRow[] = [];
let cost = 0;
const started = new Date();
for (const m of picked) {
  const row: SortRow = { id: m.id, lang: m.lang, kind: m.kind, pii: m.pii };
  try {
    const r = await decider.decide({ state: { ...q.context, message: m.text }, questions: q.sort });
    const kind = r.answers.kind!;
    const pii = r.answers.pii!;
    Object.assign(row, { predKind: kind.top, pKind: kind.p, predPii: pii.top === 'yes', pPii: pii.p, ms: r.ms });
    cost += r.costUsd;
  } catch (e) {
    row.error = e instanceof LlmError ? `${e.kind}: ${e.message}` : String(e);
  }
  rows.push(row);
  const mark = row.error ? `ERROR ${row.error}` : `${row.predKind === m.kind ? 'ok ' : 'BAD'} ${row.predKind} ${row.pKind!.toFixed(2)}`;
  console.log(`${m.id} ${ms(row.ms ?? NaN).padStart(7)} ${m.kind.padEnd(14)} ${mark.padEnd(34)} ${m.text.slice(0, 60)}`);
}

function section(title: string, m: SortMetrics, subset: SortRow[]): string[] {
  const times = subset.filter((r) => r.ms !== undefined).map((r) => r.ms!);
  const kinds = Object.keys(m.perKind);
  return [
    `## ${title} (${m.n} messages${m.errors ? `, ${m.errors} errors` : ''})`,
    '',
    `Kind accuracy ${pct(m.kindAccuracy * 100, 100)} · personal information: accuracy ${pct(m.piiAccuracy * 100, 100)}, caught ${pct(m.piiRecall * 100, 100)} · time p50 ${ms(percentile(times, 0.5))}, p90 ${ms(percentile(times, 0.9))}, mean ${ms(mean(times))}`,
    '',
    '| Threshold | Answers used | Accuracy of those |',
    '| --- | --- | --- |',
    ...m.sweep.map((s) => `| ${s.minP} | ${pct(s.coverage * 100, 100)} | ${pct(s.accuracy * 100, 100)} |`),
    '',
    '| Kind | n | Recall | Precision |',
    '| --- | --- | --- | --- |',
    ...kinds.map((k) => `| ${k} | ${m.perKind[k]!.n} | ${pct(m.perKind[k]!.recall * 100, 100)} | ${pct(m.perKind[k]!.precision * 100, 100)} |`),
    '',
    'Confusion (rows = label, columns = predicted):',
    '',
    `| | ${kinds.join(' | ')} |`,
    `| --- | ${kinds.map(() => '---').join(' | ')} |`,
    ...kinds.map((k) => `| ${k} | ${kinds.map((p) => m.confusion[k]?.[p] ?? 0).join(' | ')} |`),
    '',
  ];
}

const langs = [...new Set(rows.map((r) => r.lang))];
const md = [
  `# Sort test via ${via} — ${started.toISOString()}`,
  '',
  `Cost ${usd(cost)} for ${rows.length} messages.`,
  '',
  ...langs.flatMap((l) => {
    const subset = rows.filter((r) => r.lang === l);
    return section(l === 'fr' ? 'French' : l === 'en' ? 'English (control)' : l, scoreSort(subset), subset);
  }),
  '## Misses',
  '',
  ...rows
    .filter((r) => !r.error && r.predKind !== r.kind)
    .map((r) => `- ${r.id} ${r.kind} → ${r.predKind} (${r.pKind!.toFixed(2)}): ${picked.find((m) => m.id === r.id)!.text}`),
  '',
].join('\n');

const outDir = join(here, 'results');
mkdirSync(outDir, { recursive: true });
const base = join(outDir, `sort-${via}-${stamp(started)}`);
writeFileSync(`${base}.json`, JSON.stringify({ via, when: started.toISOString(), costUsd: cost, rows }, null, 2));
writeFileSync(`${base}.md`, md);
console.log('\n' + md);
console.log(`Saved ${base}.json and .md`);
