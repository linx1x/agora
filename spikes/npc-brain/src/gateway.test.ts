import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { costUsd, isDeepSeekPeak, PRICES } from './cost.js';
import { optionsOf, pick, toAnswer } from './decide.js';
import { configFromEnv, createGateway, loadEnv, type Env } from './gateway.js';
import { checkSay, parseJsonObject } from './llm.js';
import { LlmError, type FetchLike, type Question } from './types.js';

interface Call {
  url: string;
  headers: Record<string, string>;
  body: Record<string, unknown>;
}

/** A fake fetch that records calls and answers from a script. */
function fakeFetch(answer: (call: Call, n: number) => unknown | Promise<unknown>) {
  const calls: Call[] = [];
  const f: FetchLike = async (url, init) => {
    const call = {
      url,
      headers: init.headers as Record<string, string>,
      body: JSON.parse(String(init.body)) as Record<string, unknown>,
    };
    calls.push(call);
    const a = await answer(call, calls.length);
    if (a instanceof Response) return a;
    return new Response(JSON.stringify(a), { status: 200, headers: { 'content-type': 'application/json' } });
  };
  return { f, calls };
}

const openAiReply = (content: string, usage = { prompt_tokens: 1000, completion_tokens: 20, prompt_cache_hit_tokens: 800 }) => ({
  model: 'deepseek-flash',
  choices: [{ message: { content }, finish_reason: 'stop' }],
  usage,
});

const ENV: Env = {
  NPC_LLM_API_KEY: 'sk-test-secret',
  NPC_LLM_BASE_URL: 'https://llm.test',
  NPC_LLM_MODEL: 'deepseek-flash',
  NPC_LLM_THINKING: 'off',
};

describe('complete(), OpenAI-compatible adapter', () => {
  it('sends the system prompt first, JSON mode, thinking off and the key as a bearer token', async () => {
    const { f, calls } = fakeFetch(() => openAiReply('{"say":"Salut!"}'));
    const gw = createGateway(configFromEnv(ENV), { fetch: f });
    const r = await gw.complete({ system: 'Tu es Théo.', messages: [{ role: 'user', content: 'Allo' }], json: true, maxTokens: 120 });
    expect(calls).toHaveLength(1);
    const c = calls[0]!;
    expect(c.url).toBe('https://llm.test/chat/completions');
    expect(c.headers.authorization).toBe('Bearer sk-test-secret');
    expect(c.body.model).toBe('deepseek-flash');
    expect(c.body.messages).toEqual([
      { role: 'system', content: 'Tu es Théo.' },
      { role: 'user', content: 'Allo' },
    ]);
    expect(c.body.response_format).toEqual({ type: 'json_object' });
    expect(c.body.thinking).toEqual({ type: 'disabled' });
    expect(c.body.max_tokens).toBe(120);
    expect(r.text).toBe('{"say":"Salut!"}');
    expect(r.attempts).toBe(1);
    expect(r.usage).toEqual({ inputTokens: 1000, cachedInputTokens: 800, outputTokens: 20 });
    expect(r.costUsd).toBeGreaterThan(0);
  });

  it('sends no thinking field when NPC_LLM_THINKING is unset (other providers may refuse it)', async () => {
    const { f, calls } = fakeFetch(() => openAiReply('hi'));
    const gw = createGateway(configFromEnv({ ...ENV, NPC_LLM_THINKING: undefined, NPC_LLM_EXTRA_BODY: '{"top_p":0.9}' }), { fetch: f });
    await gw.complete({ system: 's', messages: [{ role: 'user', content: 'u' }] });
    expect(calls[0]!.body.thinking).toBeUndefined();
    expect(calls[0]!.body.response_format).toBeUndefined();
    expect(calls[0]!.body.top_p).toBe(0.9);
  });

  it('retries once on an empty answer and adds up the usage', async () => {
    const { f, calls } = fakeFetch((_c, n) => openAiReply(n === 1 ? '' : '{"say":"ok"}'));
    const gw = createGateway(configFromEnv(ENV), { fetch: f });
    const r = await gw.complete({ system: 's', messages: [{ role: 'user', content: 'u' }], json: true });
    expect(calls).toHaveLength(2);
    expect(r.attempts).toBe(2);
    expect(r.usage.inputTokens).toBe(2000);
  });

  it('fails with kind "empty" after two empty answers', async () => {
    const { f } = fakeFetch(() => openAiReply('  '));
    const gw = createGateway(configFromEnv(ENV), { fetch: f });
    await expect(gw.complete({ system: 's', messages: [] })).rejects.toMatchObject({ kind: 'empty' });
  });

  it('reports HTTP errors without the API key', async () => {
    const { f } = fakeFetch(() => new Response('{"error":"invalid key"}', { status: 401 }));
    const gw = createGateway(configFromEnv(ENV), { fetch: f });
    const err = await gw.complete({ system: 's', messages: [] }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(LlmError);
    expect((err as LlmError).kind).toBe('http');
    expect((err as LlmError).status).toBe(401);
    expect((err as LlmError).message).not.toContain('sk-test-secret');
  });

  it('times out with kind "timeout"', async () => {
    const f: FetchLike = (_u, init) =>
      new Promise((_resolve, reject) => {
        init.signal?.addEventListener('abort', () => reject(init.signal?.reason));
      });
    const gw = createGateway(configFromEnv({ ...ENV, NPC_LLM_TIMEOUT_MS: '60' }), { fetch: f });
    await expect(gw.complete({ system: 's', messages: [] })).rejects.toMatchObject({ kind: 'timeout' });
  });
});

describe('complete(), Anthropic adapter', () => {
  it('posts to /v1/messages with x-api-key and counts cache reads as input', async () => {
    const { f, calls } = fakeFetch(() => ({
      model: 'claude-x',
      content: [{ type: 'text', text: '{"say":"Bonjour"}' }],
      usage: { input_tokens: 200, cache_read_input_tokens: 1000, output_tokens: 15 },
    }));
    const env = { NPC_LLM_PROVIDER: 'anthropic', NPC_LLM_MODEL: 'claude-x', NPC_LLM_API_KEY: 'k', NPC_LLM_BASE_URL: 'https://a.test/' };
    const gw = createGateway(configFromEnv(env), { fetch: f });
    const r = await gw.complete({ system: 'Sys', messages: [{ role: 'user', content: 'Allo' }], json: true });
    expect(calls[0]!.url).toBe('https://a.test/v1/messages');
    expect(calls[0]!.headers['x-api-key']).toBe('k');
    expect(String(calls[0]!.body.system)).toMatch(/^Sys\n\nAnswer with one JSON object/);
    expect(r.text).toBe('{"say":"Bonjour"}');
    expect(r.usage).toEqual({ inputTokens: 1200, cachedInputTokens: 1000, outputTokens: 15 });
    expect(r.costUsd).toBe(0); // no price known for this model
  });
});

describe('the {say} reply contract', () => {
  it('accepts plain and fenced JSON', () => {
    expect(checkSay('{"say":"Salut!"}')).toEqual({ ok: true, say: 'Salut!', cut: false });
    expect(checkSay('```json\n{"say": "Allo"}\n```')).toEqual({ ok: true, say: 'Allo', cut: false });
  });
  it('rejects non-JSON, a missing say and an empty say', () => {
    expect(checkSay('Salut!')).toEqual({ ok: false, reason: 'not-json' });
    expect(checkSay('{"text":"x"}')).toEqual({ ok: false, reason: 'no-say' });
    expect(checkSay('{"say":"  "}')).toEqual({ ok: false, reason: 'empty-say' });
    expect(parseJsonObject('[1,2]')).toBeUndefined();
  });
  it('cuts replies over 400 characters', () => {
    const r = checkSay(JSON.stringify({ say: 'a'.repeat(500) }));
    expect(r.ok && r.cut && r.say.length).toBe(400);
  });
});

const KIND: Question = { type: 'choice', instructions: 'Kind?', criteria: { greeting: 'Hello', question: 'A question', other: 'Else' } };
const PII: Question = { type: 'noul', instructions: 'Personal information?' };
const URGENCY: Question = { type: 'score', criteria: ['low', 'mid', 'high'] };

describe('decide()', () => {
  it('lists options per question type', () => {
    expect(optionsOf(KIND)).toEqual(['greeting', 'question', 'other']);
    expect(optionsOf(PII)).toEqual(['yes', 'no']);
    expect(optionsOf(URGENCY)).toEqual(['0', '1', '2']);
  });

  it('renormalises probabilities over the allowed options and ignores unknown ones', () => {
    const a = toAnswer(KIND, { greeting: 0.2, question: 0.6, other: 0.1, bogus: 5 });
    expect(a.top).toBe('question');
    expect(a.p).toBeCloseTo(0.6 / 0.9);
    expect(toAnswer(PII, {}).p).toBe(0.5);
  });

  it('pick() uses the safe default under the threshold', () => {
    expect(pick(toAnswer(PII, { yes: 0.9, no: 0.1 }), 0.7, 'no')).toBe('yes');
    expect(pick(toAnswer(PII, { yes: 0.6, no: 0.4 }), 0.7, 'no')).toBe('no');
    expect(pick(undefined, 0.7, 'ignore')).toBe('ignore');
  });

  it('asks Clef first when NPC_DECIDE_URL is set', async () => {
    const { f, calls } = fakeFetch((c) => {
      expect(c.url).toBe('http://clef.test/decide');
      return { answers: { kind: { probs: { greeting: 0.95, question: 0.03, other: 0.02 } }, pii: { probs: { yes: 0.01, no: 0.99 } } } };
    });
    const gw = createGateway(configFromEnv({ ...ENV, NPC_DECIDE_URL: 'http://clef.test' }), { fetch: f });
    const r = await gw.decide({ state: { message: 'Salut' }, questions: { kind: KIND, pii: PII } });
    expect(calls).toHaveLength(1);
    expect(calls[0]!.body).toEqual({ state: { message: 'Salut' }, questions: { kind: KIND, pii: PII } });
    expect(r.via).toBe('clef');
    expect(r.answers.kind!.top).toBe('greeting');
    expect(r.answers.pii!.top).toBe('no');
    expect(r.costUsd).toBe(0);
  });

  it('falls back to the LLM in JSON mode when Clef is down', async () => {
    const failed: string[] = [];
    const { f, calls } = fakeFetch((c) => {
      if (c.url.startsWith('http://clef.test')) return new Response('down', { status: 503 });
      return openAiReply('{"kind":{"answer":"question","confidence":0.8},"pii":{"answer":"oui","confidence":0.9}}');
    });
    const gw = createGateway(configFromEnv({ ...ENV, NPC_DECIDE_URL: 'http://clef.test' }), {
      fetch: f,
      onDecideFail: (name) => failed.push(name),
    });
    const r = await gw.decide({ state: { message: 'Où est la Jungle?' }, questions: { kind: KIND, pii: PII } });
    expect(failed).toEqual(['clef']);
    expect(calls).toHaveLength(2);
    expect(calls[1]!.body.response_format).toEqual({ type: 'json_object' });
    expect(calls[1]!.body.temperature).toBe(0);
    expect(String((calls[1]!.body.messages as { content: string }[])[1]!.content)).toContain('"options":["yes","no"]');
    expect(r.via).toBe('llm');
    expect(r.answers.kind).toMatchObject({ top: 'question' });
    expect(r.answers.kind!.p).toBeCloseTo(0.8);
    expect(r.answers.pii!.top).toBe('yes');
  });

  it('turns an answer outside the options into a flat distribution, so the safe default applies', async () => {
    const { f } = fakeFetch(() => openAiReply('{"kind":{"answer":"insult","confidence":1}}'));
    const gw = createGateway(configFromEnv({ ...ENV, NPC_DECIDE_PROVIDER: 'llm' }), { fetch: f });
    const r = await gw.decide({ state: {}, questions: { kind: KIND, pii: PII } });
    expect(pick(r.answers.kind, 0.7, 'other')).toBe('other');
    expect(pick(r.answers.pii, 0.7, 'yes')).toBe('yes');
  });

  it('keeps the stated answer on top even with a very low confidence', async () => {
    const { f } = fakeFetch(() => openAiReply('{"kind":{"answer":"other","confidence":0.05}}'));
    const gw = createGateway(configFromEnv({ ...ENV, NPC_DECIDE_PROVIDER: 'llm' }), { fetch: f });
    const r = await gw.decide({ state: {}, questions: { kind: KIND } });
    expect(r.answers.kind!.top).toBe('other');
  });
});

describe('settings', () => {
  it('reads .env without letting it override the process environment', () => {
    const dir = mkdtempSync(join(tmpdir(), 'npc-env-'));
    const file = join(dir, '.env');
    writeFileSync(file, '# c\nNPC_LLM_MODEL="deepseek-flash"\nNPC_DECIDE_MIN_P=0.8 # comment\r\nexport NPC_X=1\nBAD LINE\n');
    const env = loadEnv(file, { NPC_X: '2' });
    expect(env.NPC_LLM_MODEL).toBe('deepseek-flash');
    expect(env.NPC_DECIDE_MIN_P).toBe('0.8');
    expect(env.NPC_X).toBe('2');
    expect(loadEnv(join(dir, 'missing'), { A: 'b' })).toEqual({ A: 'b' });
  });

  it('defaults to DeepSeek flash, Clef threshold 0.7 and an 8 s budget', () => {
    const c = configFromEnv({});
    expect(c.llm).toMatchObject({ provider: 'openai', baseUrl: 'https://api.deepseek.com', model: 'deepseek-flash', timeoutMs: 8000 });
    expect(c.decide).toMatchObject({ provider: 'clef', minP: 0.7 });
    expect(c.llm.thinking).toBe('off'); // DeepSeek thinks by default; NPC lines do not need it
    expect(configFromEnv({ NPC_LLM_BASE_URL: 'http://localhost:11434/v1' }).llm.thinking).toBeUndefined();
    expect(configFromEnv({ NPC_LLM_THINKING: 'on' }).llm.thinking).toBe('on');
    expect(() => configFromEnv({ NPC_LLM_EXTRA_BODY: '{nope' })).toThrow(LlmError);
  });

  it('prices DeepSeek at peak and half off-peak', () => {
    const usage = { inputTokens: 2200, cachedInputTokens: 1000, outputTokens: 80 };
    const peak = new Date('2026-10-06T07:00:00Z'); // Tuesday 07:00 UTC
    const off = new Date('2026-10-06T12:00:00Z');
    expect(isDeepSeekPeak(peak)).toBe(true);
    expect(isDeepSeekPeak(off)).toBe(false);
    expect(isDeepSeekPeak(new Date('2026-10-10T07:00:00Z'))).toBe(false); // Saturday
    const p = costUsd(usage, PRICES['deepseek-flash'], peak);
    expect(p).toBeCloseTo((1000 * 0.006 + 1200 * 0.3 + 80 * 1.2) / 1e6, 12);
    expect(costUsd(usage, PRICES['deepseek-flash'], off)).toBeCloseTo(p / 2, 12);
  });
});
