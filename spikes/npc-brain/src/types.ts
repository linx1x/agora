/**
 * P15.1 spike: the NPC brain's one interface (ADR-042).
 * "Clef decides, the LLM writes": decide() for every choice with a known set of answers,
 * complete() only for words no prepared line covers.
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

/** Clef question types (Jev API): yes/no, pick one, ordered scale. */
export type Question =
  | { type: 'noul'; instructions: string }
  | { type: 'choice'; instructions?: string; criteria: Record<string, string> }
  | { type: 'score'; instructions?: string; criteria: string[] };

export interface DecideRequest {
  /** Compact JSON: persona summary, needs, time, place, who is near, last lines. */
  state: unknown;
  questions: Record<string, Question>;
  timeoutMs?: number;
}

/**
 * One answer. Option ids: a choice's criteria keys; `yes` / `no` for noul;
 * `"0"`..`"n-1"` for score.
 */
export interface Answer {
  top: string;
  p: number;
  probs: Record<string, number>;
}

export interface DecideResult {
  answers: Record<string, Answer>;
  ms: number;
  via: 'clef' | 'llm';
  costUsd: number;
}

export interface Decider {
  readonly name: 'clef' | 'llm';
  decide(req: DecideRequest): Promise<DecideResult>;
}

export interface Completer {
  readonly provider: string;
  readonly model: string;
  complete(req: CompleteRequest): Promise<CompleteResult>;
}

export type FetchLike = (url: string, init: RequestInit) => Promise<Response>;
