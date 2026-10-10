/**
 * P15.1: 20 French and English conversations through complete() (DeepSeek deepseek-flash by default).
 * Measures reply time, JSON reliability, language, tokens and cost per call.
 *
 *   pnpm tsx spikes/npc-brain/deepseek-test.ts            # all 20 conversations, 60 calls
 *   pnpm tsx spikes/npc-brain/deepseek-test.ts --limit 2  # a quick check first
 *   pnpm tsx spikes/npc-brain/deepseek-test.ts --thinking on   # compare with thinking mode
 *   pnpm tsx spikes/npc-brain/deepseek-test.ts --lang en       # only the English conversations
 *
 * Reads NPC_* from the repo's .env (see spikes/npc-brain/README.md). The conversations are
 * made up; no personal information is sent.
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { configFromEnv, createGateway, loadEnv } from './src/gateway.js';
import { checkSay } from './src/llm.js';
import { detectLang, systemPrompt, type Persona } from './src/prompt.js';
import { guessLang, mean, ms, pct, percentile, stamp, usd } from './src/stats.js';
import { LlmError, type ChatMessage } from './src/types.js';

const here = import.meta.dirname;
const root = resolve(here, '../..');

interface Conversation {
  id: string;
  npc: string;
  lang: 'fr' | 'en';
  place: string;
  time: string;
  probe: string;
  anyLangTurns?: number[];
  turns: string[];
}

interface Row {
  conv: string;
  npc: string;
  probe: string;
  turn: number;
  user: string;
  ms?: number;
  attempts?: number;
  json?: 'ok' | 'not-json' | 'no-say' | 'empty-say';
  cut?: boolean;
  say?: string;
  raw?: string;
  langWanted: string;
  langGot?: string;
  inputTokens?: number;
  cachedInputTokens?: number;
  outputTokens?: number;
  costUsd?: number;
  error?: string;
}

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

const env = loadEnv(join(root, '.env'));
const thinkingArg = arg('thinking');
if (thinkingArg === 'on' || thinkingArg === 'off') env.NPC_LLM_THINKING = thinkingArg;
const cfg = configFromEnv(env);
if (!cfg.llm.apiKey && !arg('allow-no-key')) {
  console.error('NPC_LLM_API_KEY is not set (repo .env or environment). See spikes/npc-brain/README.md.');
  process.exit(1);
}
const gw = createGateway(cfg);

const personas = JSON.parse(readFileSync(join(here, 'data/personas.json'), 'utf8')) as {
  agoraFacts: string[];
  npcs: Record<string, Persona>;
};
const { conversations } = JSON.parse(readFileSync(join(here, 'data/conversations.json'), 'utf8')) as {
  conversations: Conversation[];
};
const limit = Number(arg('limit') ?? conversations.length);
const speakers = ['Vincent', 'Marie', 'Sam', 'Julie'];

console.log(
  `provider ${cfg.llm.provider} · ${cfg.llm.baseUrl} · model ${cfg.llm.model} · thinking ${cfg.llm.thinking ?? '(not sent)'} · ` +
    `timeout ${cfg.llm.timeoutMs} ms · key ${cfg.llm.apiKey ? 'set' : 'missing'} · price ${cfg.llm.price ? 'known' : 'unknown (cost shows 0)'}`,
);

const rows: Row[] = [];
const started = new Date();
const langArg = arg('lang');
const picked = conversations.filter((c) => !langArg || c.lang === langArg).slice(0, limit);
for (const [ci, c] of picked.entries()) {
  const persona = personas.npcs[c.npc];
  if (!persona) throw new Error(`unknown npc ${c.npc}`);
  const history: ChatMessage[] = [];
  let lang: 'fr' | 'en' | undefined;
  for (const [ti, user] of c.turns.entries()) {
    lang = detectLang(user, lang);
    const system = systemPrompt(persona, personas.agoraFacts, {
      time: c.time,
      place: c.place,
      speaker: speakers[ci % speakers.length]!,
      replyLang: lang,
    });
    history.push({ role: 'user', content: user });
    const row: Row = {
      conv: c.id,
      npc: c.npc,
      probe: c.probe,
      turn: ti + 1,
      user,
      langWanted: c.anyLangTurns?.includes(ti) ? 'any' : c.lang,
    };
    try {
      const r = await gw.complete({ system, messages: history, json: true, maxTokens: 200 });
      const check = checkSay(r.text);
      Object.assign(row, {
        ms: r.ms,
        attempts: r.attempts,
        json: check.ok ? 'ok' : check.reason,
        cut: check.ok ? check.cut : undefined,
        say: check.ok ? check.say : undefined,
        raw: check.ok ? undefined : r.text.slice(0, 400),
        langGot: check.ok ? guessLang(check.say) : undefined,
        inputTokens: r.usage.inputTokens,
        cachedInputTokens: r.usage.cachedInputTokens,
        outputTokens: r.usage.outputTokens,
        costUsd: r.costUsd,
      });
      history.push({ role: 'assistant', content: check.ok ? JSON.stringify({ say: check.say }) : r.text });
    } catch (e) {
      row.error = e instanceof LlmError ? `${e.kind}: ${e.message}` : String(e);
      // Carry on like the server would: a canned line, then the next turn.
      history.push({ role: 'assistant', content: '{"say":"Pardon, j\'ai la tête ailleurs…"}' });
    }
    rows.push(row);
    const tag = row.error ? `ERROR ${row.error}` : `${ms(row.ms!)} ${row.json} ${row.langGot}${row.attempts! > 1 ? ' (retry)' : ''}`;
    console.log(`${c.id} t${row.turn} ${c.npc.padEnd(5)} ${tag.padEnd(26)} ${(row.say ?? row.raw ?? '').replace(/\s+/g, ' ').slice(0, 90)}`);
  }
}

// ---- Summary ----
const done = rows.filter((r) => !r.error);
const times = done.map((r) => r.ms!);
const jsonOk = done.filter((r) => r.json === 'ok');
const langChecked = jsonOk.filter((r) => r.langWanted !== 'any');
const langOk = langChecked.filter((r) => r.langGot === r.langWanted);
const sum = (k: 'inputTokens' | 'cachedInputTokens' | 'outputTokens' | 'costUsd') => done.reduce((a, r) => a + (r[k] ?? 0), 0);
const errorsByKind: Record<string, number> = {};
for (const r of rows.filter((x) => x.error)) {
  const k = r.error!.split(':')[0]!;
  errorsByKind[k] = (errorsByKind[k] ?? 0) + 1;
}
const costPerCall = done.length ? sum('costUsd') / done.length : NaN;

const summary = {
  when: started.toISOString(),
  provider: cfg.llm.provider,
  baseUrl: cfg.llm.baseUrl,
  model: cfg.llm.model,
  thinking: cfg.llm.thinking ?? null,
  calls: rows.length,
  errors: errorsByKind,
  jsonOk: jsonOk.length,
  emptyRetries: done.filter((r) => (r.attempts ?? 1) > 1).length,
  cut: jsonOk.filter((r) => r.cut).length,
  languageMatch: `${langOk.length}/${langChecked.length}`,
  ms: { p50: percentile(times, 0.5), p90: percentile(times, 0.9), max: Math.max(...times), mean: mean(times) },
  under3s: times.filter((t) => t < 3000).length,
  tokens: {
    inputPerCall: sum('inputTokens') / (done.length || 1),
    cachedShare: sum('cachedInputTokens') / (sum('inputTokens') || 1),
    outputPerCall: sum('outputTokens') / (done.length || 1),
  },
  costUsd: { total: sum('costUsd'), perCall: costPerCall, per100CallsDay21Workdays: costPerCall * 100 * 21 },
};

const md = [
  `# DeepSeek test — ${summary.when}`,
  '',
  `Model \`${summary.model}\` at ${summary.baseUrl}, thinking ${summary.thinking ?? 'not sent'}.`,
  '',
  '| Measure | Value |',
  '| --- | --- |',
  `| Calls | ${summary.calls} (errors: ${Object.entries(errorsByKind).map(([k, v]) => `${k} ${v}`).join(', ') || 'none'}) |`,
  `| Valid \`{say}\` JSON | ${pct(jsonOk.length, done.length)} (${jsonOk.length}/${done.length}); empty-answer retries ${summary.emptyRetries}; cut at 400 chars ${summary.cut} |`,
  `| Reply in the expected language | ${pct(langOk.length, langChecked.length)} (${summary.languageMatch}) |`,
  `| Reply time p50 / p90 / max | ${ms(summary.ms.p50)} / ${ms(summary.ms.p90)} / ${ms(summary.ms.max)} |`,
  `| Under 3 s | ${pct(summary.under3s, times.length)} |`,
  `| Tokens per call: input / output | ${Math.round(summary.tokens.inputPerCall)} / ${Math.round(summary.tokens.outputPerCall)} |`,
  `| Input served from cache | ${pct(summary.tokens.cachedShare * 100, 100)} |`,
  `| Cost per call | ${usd(costPerCall)} |`,
  `| Total cost of this run | ${usd(summary.costUsd.total)} |`,
  `| At 100 calls a day, 21 workdays | ${usd(summary.costUsd.per100CallsDay21Workdays)} a month |`,
  '',
  'Probe conversations to read by hand (honesty, injection, knowledge, memory):',
  '',
  ...rows
    .filter((r) => ['honesty', 'injection', 'knowledge', 'memory'].includes(r.probe))
    .map((r) => `- **${r.conv} t${r.turn}** (${r.probe}) — ${r.user} → ${r.say ?? r.raw ?? r.error}`),
  '',
].join('\n');

const outDir = join(here, 'results');
mkdirSync(outDir, { recursive: true });
const base = join(outDir, `deepseek-${stamp(started)}${cfg.llm.thinking === 'on' ? '-thinking' : ''}`);
writeFileSync(`${base}.json`, JSON.stringify({ summary, rows }, null, 2));
writeFileSync(`${base}.md`, md);
console.log('\n' + md);
console.log(`Saved ${base}.json and .md`);
