import { readFileSync } from 'node:fs';
import { PRICES, parsePrice } from './cost.js';
import { chainDeciders, clefDecider, llmDecider } from './decide.js';
import { createCompleter, type LlmConfig } from './llm.js';
import { LlmError, type Completer, type DecideRequest, type DecideResult, type Decider, type FetchLike } from './types.js';

export type Env = Record<string, string | undefined>;

/**
 * Minimal .env reader (KEY=VALUE, # comments, optional quotes). Values already in the
 * process environment win. Returns the merged view; never prints values.
 */
export function loadEnv(path: string, base: Env = process.env): Env {
  const out: Env = {};
  let text = '';
  try {
    text = readFileSync(path, 'utf8');
  } catch {
    return { ...base };
  }
  for (const line of text.split(/\r?\n/)) {
    const m = /^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/.exec(line);
    if (!m) continue;
    let v = m[2] ?? '';
    if (/^(['"]).*\1$/.test(v)) v = v.slice(1, -1);
    else v = v.replace(/\s+#.*$/, '');
    out[m[1]!] = v;
  }
  return { ...out, ...base };
}

export interface GatewayConfig {
  llm: LlmConfig;
  decide: {
    /** clef: local Clef-flash first, the LLM as fallback. llm: the LLM only. */
    provider: 'clef' | 'llm';
    url?: string;
    minP: number;
    timeoutMs: number;
  };
}

const hostOf = (url: string) => {
  try {
    return new URL(url).hostname;
  } catch {
    return '';
  }
};

const num = (v: string | undefined, d: number) => (v !== undefined && v !== '' && Number.isFinite(Number(v)) ? Number(v) : d);

/** Read the NPC_* settings (see .env.example). DeepSeek's deepseek-flash is the default. */
export function configFromEnv(env: Env): GatewayConfig {
  const provider = env.NPC_LLM_PROVIDER === 'anthropic' ? 'anthropic' : 'openai';
  const model = env.NPC_LLM_MODEL || 'deepseek-flash';
  const baseUrl = env.NPC_LLM_BASE_URL || (provider === 'anthropic' ? 'https://api.anthropic.com' : 'https://api.deepseek.com');
  // DeepSeek thinks by default (seconds and output tokens an NPC line does not need): off unless asked.
  const thinking =
    env.NPC_LLM_THINKING === 'on' || env.NPC_LLM_THINKING === 'off'
      ? env.NPC_LLM_THINKING
      : provider === 'openai' && /(^|\.)deepseek\.com$/.test(hostOf(baseUrl))
        ? 'off'
        : undefined;
  let extraBody: Record<string, unknown> | undefined;
  if (env.NPC_LLM_EXTRA_BODY) {
    try {
      extraBody = JSON.parse(env.NPC_LLM_EXTRA_BODY) as Record<string, unknown>;
    } catch {
      throw new LlmError('config', 'NPC_LLM_EXTRA_BODY is not valid JSON');
    }
  }
  return {
    llm: {
      provider,
      baseUrl,
      model,
      apiKey: env.NPC_LLM_API_KEY ?? '',
      timeoutMs: num(env.NPC_LLM_TIMEOUT_MS, 8000),
      thinking,
      extraBody,
      price: parsePrice(env.NPC_LLM_PRICE) ?? PRICES[model],
    },
    decide: {
      provider: env.NPC_DECIDE_PROVIDER === 'llm' ? 'llm' : 'clef',
      url: env.NPC_DECIDE_URL || undefined,
      minP: num(env.NPC_DECIDE_MIN_P, 0.7),
      timeoutMs: num(env.NPC_DECIDE_TIMEOUT_MS, 1500),
    },
  };
}

export interface LlmGateway {
  readonly config: GatewayConfig;
  readonly llm: Completer;
  complete: Completer['complete'];
  decide(req: DecideRequest): Promise<DecideResult>;
}

/**
 * The NPC brain's gateway: complete() for words, decide() for choices. decide() asks Clef
 * when NPC_DECIDE_URL is set and falls back to the LLM in JSON mode when Clef is off or down.
 */
export function createGateway(
  cfg: GatewayConfig,
  opts: { fetch?: FetchLike; onDecideFail?: (name: string, e: unknown) => void } = {},
): LlmGateway {
  const llm = createCompleter({ ...cfg.llm, fetch: opts.fetch ?? cfg.llm.fetch });
  const deciders: Decider[] = [];
  if (cfg.decide.provider === 'clef' && cfg.decide.url) {
    deciders.push(clefDecider(cfg.decide.url, { timeoutMs: cfg.decide.timeoutMs, fetch: opts.fetch }));
  }
  // The LLM fallback gets the LLM's time budget, not Clef's.
  deciders.push(llmDecider(llm, { timeoutMs: cfg.llm.timeoutMs }));
  return {
    config: cfg,
    llm,
    complete: (req) => llm.complete(req),
    decide: chainDeciders(deciders, opts.onDecideFail),
  };
}
