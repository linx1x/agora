/**
 * The words half of the NPC brain (ADR-042, P15.4): `complete()` for the few things no prepared
 * line covers. Provider-agnostic: an OpenAI-compatible adapter (DeepSeek, Mistral, OpenRouter,
 * Ollama, vLLM, llama.cpp) and an Anthropic Messages adapter, chosen by `.env`. Ported from the
 * P15.1 spike (`spikes/npc-brain/src`). A `fake` provider answers canned JSON for tests and the
 * e2e suite; it refuses to start in production.
 */

export interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
}

export interface CompleteRequest {
  system: string;
  messages: ChatMessage[];
  /** Ask the provider for a JSON object (OpenAI `response_format`, or an instruction for Anthropic). */
  json?: boolean;
  maxTokens?: number;
  timeoutMs?: number;
  temperature?: number;
}

export interface Usage {
  /** All input tokens, cached ones included. */
  inputTokens: number;
  /** Input tokens served from the provider's prompt cache (cheaper). */
  cachedInputTokens: number;
  outputTokens: number;
}

export interface CompleteResult {
  text: string;
  usage: Usage;
  /** Wall time of the whole call, retries included. */
  ms: number;
  /** 1, or 2 when the first answer came back empty (a known DeepSeek JSON-mode issue). */
  attempts: number;
  provider: string;
  model: string;
  costUsd: number;
}

export type LlmErrorKind = 'timeout' | 'http' | 'empty' | 'network' | 'config';

export class LlmError extends Error {
  constructor(
    readonly kind: LlmErrorKind,
    message: string,
    readonly status?: number,
  ) {
    super(message);
    this.name = 'LlmError';
  }
}

export interface Completer {
  readonly provider: string;
  readonly model: string;
  complete(req: CompleteRequest): Promise<CompleteResult>;
}

export type FetchLike = (url: string, init: RequestInit) => Promise<Response>;

// ───────────────────────────────────────────── cost
/** US$ per 1M tokens at peak time. */
export interface Price {
  cacheHit: number;
  cacheMiss: number;
  output: number;
  /** Off-peak multiplier (DeepSeek: 0.5). */
  offPeak?: number;
}

/**
 * Known prices. DeepSeek, checked 2026-10-06 on https://api-docs.deepseek.com/quick_start/pricing:
 * deepseek-flash (DeepSeek-V4.1-Flash) 0.006 / 0.30 / 1.20 peak, half off-peak.
 * Override with NPC_LLM_PRICE="hit,miss,out" (US$ per 1M tokens, peak).
 */
export const PRICES: Record<string, Price> = {
  'deepseek-flash': { cacheHit: 0.006, cacheMiss: 0.3, output: 1.2, offPeak: 0.5 },
  'deepseek-v4-flash': { cacheHit: 0.006, cacheMiss: 0.3, output: 1.2, offPeak: 0.5 },
};

/** DeepSeek peak hours: 01:00–04:00 and 06:00–10:00 UTC, Monday to Friday. */
export function isDeepSeekPeak(at: Date): boolean {
  const day = at.getUTCDay();
  if (day === 0 || day === 6) return false;
  const h = at.getUTCHours();
  return (h >= 1 && h < 4) || (h >= 6 && h < 10);
}

export function parsePrice(spec: string | undefined): Price | undefined {
  if (!spec) return undefined;
  const parts = spec.split(',').map((s) => Number(s.trim()));
  if (parts.length !== 3 || parts.some((n) => !Number.isFinite(n) || n < 0)) return undefined;
  const [cacheHit, cacheMiss, output] = parts as [number, number, number];
  return { cacheHit, cacheMiss, output };
}

export function costUsd(usage: Usage, price: Price | undefined, at = new Date()): number {
  if (!price) return 0;
  const k = price.offPeak !== undefined && !isDeepSeekPeak(at) ? price.offPeak : 1;
  const miss = Math.max(0, usage.inputTokens - usage.cachedInputTokens);
  return (
    (k *
      (usage.cachedInputTokens * price.cacheHit +
        miss * price.cacheMiss +
        usage.outputTokens * price.output)) /
    1_000_000
  );
}

// ───────────────────────────────────────────── adapters
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
    if (name === 'TimeoutError' || name === 'AbortError')
      throw new LlmError('timeout', `no answer within ${timeoutMs} ms`);
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
    completion_tokens_details?: { reasoning_tokens?: number };
  };
}

interface AnthropicResponse {
  model?: string;
  content?: { type: string; text?: string }[];
  stop_reason?: string;
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

/** What one provider call gave back (the gateway may make two). */
interface Once {
  text: string;
  usage: Usage;
  model: string;
  /** The provider's stop reason (`stop`, `length`, ...), kept to explain an empty answer. */
  finish?: string;
  /** Tokens the model spent thinking, when the provider says (they count against max_tokens). */
  reasoningTokens?: number;
}

/** How an attempt asks for JSON: the provider's JSON mode, or only an instruction in the prompt. */
interface Attempt {
  jsonMode: boolean;
  maxTokens: number;
}

/** OpenAI-compatible chat completions: DeepSeek, Mistral, OpenRouter, Ollama, vLLM, llama.cpp. */
async function openAiOnce(
  cfg: LlmConfig,
  req: CompleteRequest,
  timeoutMs: number,
  at: Attempt,
): Promise<Once> {
  const body: Record<string, unknown> = {
    model: cfg.model,
    messages: [
      { role: 'system', content: req.json && !at.jsonMode ? req.system + JSON_HINT : req.system },
      ...req.messages,
    ],
    max_tokens: at.maxTokens,
    stream: false,
    ...(req.json && at.jsonMode ? { response_format: { type: 'json_object' } } : {}),
    ...(req.temperature !== undefined ? { temperature: req.temperature } : {}),
    ...(cfg.thinking
      ? { thinking: { type: cfg.thinking === 'off' ? 'disabled' : 'enabled' } }
      : {}),
    ...cfg.extraBody,
  };
  const headers: Record<string, string> = cfg.apiKey
    ? { authorization: `Bearer ${cfg.apiKey}` }
    : {};
  const r = (await post(
    cfg,
    `${trimSlash(cfg.baseUrl)}/chat/completions`,
    headers,
    body,
    timeoutMs,
  )) as OpenAiResponse;
  return {
    text: r.choices?.[0]?.message?.content ?? '',
    usage: openAiUsage(r.usage),
    model: r.model ?? cfg.model,
    finish: r.choices?.[0]?.finish_reason,
    reasoningTokens: r.usage?.completion_tokens_details?.reasoning_tokens,
  };
}

/** Anthropic Messages: Claude, and providers with an Anthropic-style endpoint. */
async function anthropicOnce(
  cfg: LlmConfig,
  req: CompleteRequest,
  timeoutMs: number,
  at: Attempt,
): Promise<Once> {
  const body: Record<string, unknown> = {
    model: cfg.model,
    system: req.json ? req.system + JSON_HINT : req.system,
    messages: req.messages,
    max_tokens: at.maxTokens,
    ...(req.temperature !== undefined ? { temperature: req.temperature } : {}),
    ...cfg.extraBody,
  };
  const headers = { 'x-api-key': cfg.apiKey, 'anthropic-version': '2023-06-01' };
  const r = (await post(
    cfg,
    `${trimSlash(cfg.baseUrl)}/v1/messages`,
    headers,
    body,
    timeoutMs,
  )) as AnthropicResponse;
  const text = (r.content ?? [])
    .filter((c) => c.type === 'text')
    .map((c) => c.text ?? '')
    .join('');
  return {
    text,
    usage: anthropicUsage(r.usage),
    model: r.model ?? cfg.model,
    finish: r.stop_reason,
  };
}

/**
 * The gateway's complete(). One retry when the answer comes back empty. DeepSeek documents that
 * JSON mode "may occasionally return empty content", so the retry asks for JSON in the prompt
 * only (no `response_format`), and gets twice the tokens when the first one ran out of them
 * (a model that thinks spends max_tokens before it writes). The retry shares the time budget.
 * An empty answer twice throws `empty`, and says why (stop reason, tokens) so the log can tell
 * a provider that returns nothing from one that ran out of tokens.
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
      const why: string[] = [];
      let at: Attempt = { jsonMode: true, maxTokens: req.maxTokens ?? 300 };
      for (let attempt = 1; attempt <= 2; attempt++) {
        const left = budget - (performance.now() - t0);
        if (left <= 50) throw new LlmError('timeout', `no answer within ${budget} ms`);
        const r = await once(cfg, req, left, at);
        usage = addUsage(usage, r.usage);
        model = r.model;
        if (r.text.trim()) {
          return {
            text: r.text,
            usage,
            ms: performance.now() - t0,
            attempts: attempt,
            provider: cfg.provider,
            model,
            costUsd: costUsd(usage, cfg.price),
          };
        }
        why.push(
          `${at.jsonMode ? 'json mode' : 'prompt only'}: finish=${r.finish ?? '?'}, ` +
            `out=${r.usage.outputTokens}/${at.maxTokens}` +
            (r.reasoningTokens ? `, thinking=${r.reasoningTokens}` : ''),
        );
        at = {
          jsonMode: false,
          maxTokens: r.finish === 'length' ? Math.min(at.maxTokens * 2, 800) : at.maxTokens,
        };
      }
      throw new LlmError('empty', `empty answer twice (${why.join('; ')})`);
    },
  };
}

/**
 * A stand-in provider for tests and the e2e suite (`NPC_LLM_PROVIDER=fake`): answers with
 * `reply(request)` as a `{say}` JSON object (or a JSON decision when the request asks for one),
 * records every request, and can be told to fail. Never available in production.
 */
export function fakeCompleter(
  reply: (req: CompleteRequest) => string | LlmError = () => 'Bien sûr!',
): Completer & { calls: CompleteRequest[] } {
  const calls: CompleteRequest[] = [];
  return {
    provider: 'fake',
    model: 'fake',
    calls,
    async complete(req) {
      calls.push(req);
      const r = reply(req);
      if (r instanceof LlmError) throw r;
      return {
        text: r.trim().startsWith('{') ? r : JSON.stringify({ say: r }),
        usage: { inputTokens: 100, cachedInputTokens: 0, outputTokens: 20 },
        ms: 1,
        attempts: 1,
        provider: 'fake',
        model: 'fake',
        costUsd: 0.0001,
      };
    },
  };
}

// ───────────────────────────────────────────── replies
/** Pull the first JSON object out of a reply (models sometimes wrap it in ``` fences). */
export function parseJsonObject(text: string): Record<string, unknown> | undefined {
  const tryParse = (s: string) => {
    try {
      const v: unknown = JSON.parse(s);
      return v && typeof v === 'object' && !Array.isArray(v)
        ? (v as Record<string, unknown>)
        : undefined;
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
