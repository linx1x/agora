import { costUsd, type Price } from './cost.js';
import {
  LlmError,
  type CompleteRequest,
  type CompleteResult,
  type Completer,
  type FetchLike,
  type Usage,
} from './types.js';

export interface LlmConfig {
  provider: 'openai' | 'anthropic';
  baseUrl: string;
  model: string;
  apiKey: string;
  timeoutMs: number;
  /** off: ask DeepSeek-style providers not to think (`thinking: {type: "disabled"}`); on: ask them to; unset: send nothing. */
  thinking?: 'on' | 'off';
  /** Extra fields merged into every request body (NPC_LLM_EXTRA_BODY, JSON). */
  extraBody?: Record<string, unknown>;
  price?: Price;
  fetch?: FetchLike;
}

const trimSlash = (s: string) => s.replace(/\/+$/, '');

async function post(
  cfg: LlmConfig,
  url: string,
  headers: Record<string, string>,
  body: unknown,
  timeoutMs: number,
): Promise<unknown> {
  const doFetch: FetchLike = cfg.fetch ?? ((u, i) => fetch(u, i));
  let res: Response;
  try {
    res = await doFetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...headers },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(Math.max(1, Math.round(timeoutMs))),
    });
  } catch (e) {
    const name = (e as { name?: string }).name;
    if (name === 'TimeoutError' || name === 'AbortError') {
      throw new LlmError('timeout', `no answer within ${timeoutMs} ms`);
    }
    throw new LlmError('network', (e as Error).message);
  }
  if (!res.ok) {
    // Never echo request headers (the key); the provider's error text is enough.
    const text = (await res.text().catch(() => '')).slice(0, 300);
    throw new LlmError('http', `HTTP ${res.status}: ${text}`, res.status);
  }
  return res.json();
}

interface OpenAiResponse {
  model?: string;
  choices?: { message?: { content?: string | null }; finish_reason?: string }[];
  usage?: {
    prompt_tokens?: number;
    completion_tokens?: number;
    prompt_cache_hit_tokens?: number;
    prompt_tokens_details?: { cached_tokens?: number };
  };
}

interface AnthropicResponse {
  model?: string;
  content?: { type: string; text?: string }[];
  usage?: {
    input_tokens?: number;
    output_tokens?: number;
    cache_read_input_tokens?: number;
    cache_creation_input_tokens?: number;
  };
}

export function openAiUsage(u: OpenAiResponse['usage']): Usage {
  return {
    inputTokens: u?.prompt_tokens ?? 0,
    cachedInputTokens: u?.prompt_cache_hit_tokens ?? u?.prompt_tokens_details?.cached_tokens ?? 0,
    outputTokens: u?.completion_tokens ?? 0,
  };
}

export function anthropicUsage(u: AnthropicResponse['usage']): Usage {
  const cached = u?.cache_read_input_tokens ?? 0;
  return {
    // Anthropic's input_tokens excludes cache reads and writes; ours counts all input.
    inputTokens: (u?.input_tokens ?? 0) + cached + (u?.cache_creation_input_tokens ?? 0),
    cachedInputTokens: cached,
    outputTokens: u?.output_tokens ?? 0,
  };
}

const addUsage = (a: Usage, b: Usage): Usage => ({
  inputTokens: a.inputTokens + b.inputTokens,
  cachedInputTokens: a.cachedInputTokens + b.cachedInputTokens,
  outputTokens: a.outputTokens + b.outputTokens,
});

const JSON_HINT = '\n\nAnswer with one JSON object only, no other text.';

/** OpenAI-compatible chat completions: DeepSeek, Mistral, OpenRouter, Ollama, vLLM, llama.cpp. */
async function openAiOnce(cfg: LlmConfig, req: CompleteRequest, timeoutMs: number) {
  const body: Record<string, unknown> = {
    model: cfg.model,
    messages: [{ role: 'system', content: req.system }, ...req.messages],
    max_tokens: req.maxTokens ?? 300,
    stream: false,
    ...(req.json ? { response_format: { type: 'json_object' } } : {}),
    ...(req.temperature !== undefined ? { temperature: req.temperature } : {}),
    ...(cfg.thinking ? { thinking: { type: cfg.thinking === 'off' ? 'disabled' : 'enabled' } } : {}),
    ...cfg.extraBody,
  };
  const headers: Record<string, string> = cfg.apiKey ? { authorization: `Bearer ${cfg.apiKey}` } : {};
  const r = (await post(cfg, `${trimSlash(cfg.baseUrl)}/chat/completions`, headers, body, timeoutMs)) as OpenAiResponse;
  return { text: r.choices?.[0]?.message?.content ?? '', usage: openAiUsage(r.usage), model: r.model ?? cfg.model };
}

/** Anthropic Messages: Claude, and providers with an Anthropic-style endpoint. */
async function anthropicOnce(cfg: LlmConfig, req: CompleteRequest, timeoutMs: number) {
  const body: Record<string, unknown> = {
    model: cfg.model,
    system: req.json ? req.system + JSON_HINT : req.system,
    messages: req.messages,
    max_tokens: req.maxTokens ?? 300,
    ...(req.temperature !== undefined ? { temperature: req.temperature } : {}),
    ...cfg.extraBody,
  };
  const headers = { 'x-api-key': cfg.apiKey, 'anthropic-version': '2023-06-01' };
  const r = (await post(cfg, `${trimSlash(cfg.baseUrl)}/v1/messages`, headers, body, timeoutMs)) as AnthropicResponse;
  const text = (r.content ?? [])
    .filter((c) => c.type === 'text')
    .map((c) => c.text ?? '')
    .join('');
  return { text, usage: anthropicUsage(r.usage), model: r.model ?? cfg.model };
}

/**
 * The gateway's complete(). One retry when the answer comes back empty (DeepSeek documents
 * that JSON mode "may occasionally return empty content"); the retry shares the time budget.
 */
export function createCompleter(cfg: LlmConfig): Completer {
  if (!cfg.model) throw new LlmError('config', 'NPC_LLM_MODEL is not set');
  if (!cfg.baseUrl) throw new LlmError('config', 'NPC_LLM_BASE_URL is not set');
  const once = cfg.provider === 'anthropic' ? anthropicOnce : openAiOnce;
  return {
    provider: cfg.provider,
    model: cfg.model,
    async complete(req) {
      const budget = req.timeoutMs ?? cfg.timeoutMs;
      const t0 = performance.now();
      let usage: Usage = { inputTokens: 0, cachedInputTokens: 0, outputTokens: 0 };
      let model = cfg.model;
      for (let attempt = 1; attempt <= 2; attempt++) {
        const left = budget - (performance.now() - t0);
        if (left <= 50) throw new LlmError('timeout', `no answer within ${budget} ms`);
        const r = await once(cfg, req, left);
        usage = addUsage(usage, r.usage);
        model = r.model;
        if (r.text.trim()) {
          const result: CompleteResult = {
            text: r.text,
            usage,
            ms: performance.now() - t0,
            attempts: attempt,
            provider: cfg.provider,
            model,
            costUsd: costUsd(usage, cfg.price),
          };
          return result;
        }
      }
      throw new LlmError('empty', 'empty answer twice');
    },
  };
}

/** Pull the first JSON object out of a reply (models sometimes wrap it in ``` fences). */
export function parseJsonObject(text: string): Record<string, unknown> | undefined {
  const tryParse = (s: string) => {
    try {
      const v: unknown = JSON.parse(s);
      return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : undefined;
    } catch {
      return undefined;
    }
  };
  const direct = tryParse(text.trim());
  if (direct) return direct;
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  return start >= 0 && end > start ? tryParse(text.slice(start, end + 1)) : undefined;
}

export const MAX_SAY = 400;

export type SayCheck =
  | { ok: true; say: string; cut: boolean }
  | { ok: false; reason: 'not-json' | 'no-say' | 'empty-say' };

/** The reply contract: JSON `{say}` only (zod in the real server, P15.4). Over 400 characters is cut. */
export function checkSay(text: string): SayCheck {
  const obj = parseJsonObject(text);
  if (!obj) return { ok: false, reason: 'not-json' };
  if (typeof obj.say !== 'string') return { ok: false, reason: 'no-say' };
  const say = obj.say.trim();
  if (!say) return { ok: false, reason: 'empty-say' };
  return say.length > MAX_SAY ? { ok: true, say: say.slice(0, MAX_SAY - 1) + '…', cut: true } : { ok: true, say, cut: false };
}
