/**
 * The NPC brain's `decide()` (ADR-042, P15.3): every choice with a known set of answers is a
 * Clef-flash call to `apps/ml` on Vincent's PC (`NPC_DECIDE_URL`). Body decisions (next activity,
 * approach, busy) never go to the cloud model: when Clef is off, down or slow, the characters'
 * own scoring decides (Vincent, 2026-10-07, ADR-044). Ported from the P15.1 spike
 * (`spikes/npc-brain/src/decide.ts`). The LLM-JSON fallback (`llmDecider`) is for sorting Talk
 * messages only (P15.4): those already go to the cloud model when no prepared line answers.
 */
import type { DecideAnswer, DecideQuestion } from '@agora/shared';
import { parseJsonObject, type Completer } from './llm';

export type FetchLike = (url: string, init: RequestInit) => Promise<Response>;

export interface DecideRequest {
  /** compact JSON: persona summary, needs, time, place, who is near */
  state: unknown;
  questions: Record<string, DecideQuestion>;
  timeoutMs?: number;
}

export interface DecideResult {
  answers: Record<string, DecideAnswer>;
  ms: number;
  via: 'clef' | 'fake' | 'llm';
  /** what the call cost, for the daily budget (the LLM fallback only) */
  costUsd?: number;
}

export interface Decider {
  readonly name: 'clef' | 'fake' | 'llm';
  decide(req: DecideRequest): Promise<DecideResult>;
}

export class DecideError extends Error {
  constructor(
    readonly kind: 'timeout' | 'network' | 'http' | 'answer',
    message: string,
  ) {
    super(message);
    this.name = 'DecideError';
  }
}

/** Allowed option ids of a question, in order (the same as `apps/ml`). */
export function optionsOf(q: DecideQuestion): string[] {
  if (q.type === 'noul') return ['yes', 'no'];
  if (q.type === 'choice') return Object.keys(q.criteria);
  return q.criteria.map((_, i) => String(i));
}

/** A probability map as an answer: renormalised over the allowed options, top first. */
export function toAnswer(q: DecideQuestion, raw: Record<string, number>): DecideAnswer {
  const opts = optionsOf(q);
  const probs: Record<string, number> = {};
  let sum = 0;
  for (const o of opts) {
    const v = raw[o];
    const p = typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : 0;
    probs[o] = p;
    sum += p;
  }
  for (const o of opts) probs[o] = sum > 0 ? probs[o]! / sum : 1 / opts.length;
  let top = opts[0] ?? '';
  for (const o of opts) if (probs[o]! > (probs[top] ?? 0)) top = o;
  return { top, p: probs[top] ?? 0, probs };
}

/**
 * Local Clef-flash over HTTP (`apps/ml`). Request `{state, questions}`; response
 * `{answers: {id: {probs: {option: p}}}}`. `token` is sent as a bearer token when `apps/ml` asks
 * for one (`ML_TOKEN`), for when it listens beyond localhost.
 */
export function clefDecider(
  url: string,
  opts: { timeoutMs: number; token?: string; fetch?: FetchLike },
): Decider {
  const doFetch: FetchLike = opts.fetch ?? ((u, i) => fetch(u, i));
  const base = url.replace(/\/+$/, '');
  return {
    name: 'clef',
    async decide(req) {
      const t0 = performance.now();
      let res: Response;
      try {
        res = await doFetch(`${base}/decide`, {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            ...(opts.token ? { authorization: `Bearer ${opts.token}` } : {}),
          },
          body: JSON.stringify({ state: req.state, questions: req.questions }),
          signal: AbortSignal.timeout(Math.max(1, Math.round(req.timeoutMs ?? opts.timeoutMs))),
        });
      } catch (e) {
        const name = (e as { name?: string }).name;
        throw new DecideError(
          name === 'TimeoutError' || name === 'AbortError' ? 'timeout' : 'network',
          `clef: ${(e as Error).message}`,
        );
      }
      if (!res.ok) throw new DecideError('http', `clef: HTTP ${res.status}`);
      const body = (await res.json().catch(() => ({}))) as {
        answers?: Record<string, { probs?: Record<string, number> }>;
      };
      const answers: Record<string, DecideAnswer> = {};
      for (const [id, q] of Object.entries(req.questions)) {
        const probs = body.answers?.[id]?.probs;
        if (!probs) throw new DecideError('answer', `clef: no answer for ${id}`);
        answers[id] = toAnswer(q, probs);
      }
      return { answers, ms: performance.now() - t0, via: 'clef' };
    },
  };
}

/**
 * A stand-in for tests: answers each question with what `answer` says (an option id and its
 * probability), or throws when it returns `'down'`. Records every request.
 */
export function fakeDecider(
  answer: (
    id: string,
    q: DecideQuestion,
    state: unknown,
  ) => { top: string; p: number } | 'down' | undefined,
): Decider & { calls: DecideRequest[] } {
  const calls: DecideRequest[] = [];
  return {
    name: 'fake',
    calls,
    async decide(req) {
      calls.push(req);
      const answers: Record<string, DecideAnswer> = {};
      for (const [id, q] of Object.entries(req.questions)) {
        const a = answer(id, q, req.state);
        if (a === 'down') throw new DecideError('network', 'fake: down');
        const opts = optionsOf(q);
        const top = a && opts.includes(a.top) ? a.top : opts[0]!;
        const p = a?.p ?? 1 / opts.length;
        const rest = opts.length > 1 ? (1 - p) / (opts.length - 1) : 0;
        answers[id] = toAnswer(q, Object.fromEntries(opts.map((o) => [o, o === top ? p : rest])));
      }
      return { answers, ms: 0, via: 'fake' };
    },
  };
}

const DECIDE_SYSTEM = `You are a decision function inside a game server. You read a STATE (JSON) and answer every QUESTION with exactly one of its allowed options, plus your confidence from 0 to 1.
Answer in json only, one key per question id:
{"<question id>": {"answer": "<one allowed option>", "confidence": 0.0}}`;

/** Render questions with explicit allowed options, so the LLM sees the same choices Clef does. */
export function renderQuestions(questions: Record<string, DecideQuestion>): string {
  const out: Record<string, unknown> = {};
  for (const [id, q] of Object.entries(questions)) {
    if (q.type === 'noul') out[id] = { instructions: q.instructions, options: ['yes', 'no'] };
    else if (q.type === 'choice') out[id] = { instructions: q.instructions, options: q.criteria };
    else
      out[id] = {
        instructions: q.instructions,
        options: Object.fromEntries(q.criteria.map((c, i) => [String(i), c])),
      };
  }
  return JSON.stringify(out);
}

/**
 * Fallback when Clef is off or down: the cloud model in JSON mode, through the same provider as
 * `complete()` (Vincent, 2026-10-06: not Workers AI). Its stated confidence becomes the top
 * option's probability, the rest shared evenly. It is accurate but not calibrated (P15.1 spike:
 * 94 % right, 96.5 % of answers above 0.9), so `minP` filters little: use it for Talk sorting,
 * never for the body.
 */
export function llmDecider(llm: Completer, opts: { timeoutMs: number }): Decider {
  return {
    name: 'llm',
    async decide(req) {
      const r = await llm.complete({
        system: DECIDE_SYSTEM,
        messages: [
          {
            role: 'user',
            content: `STATE:\n${JSON.stringify(req.state)}\n\nQUESTIONS:\n${renderQuestions(req.questions)}`,
          },
        ],
        json: true,
        maxTokens: 60 + 40 * Object.keys(req.questions).length,
        timeoutMs: req.timeoutMs ?? opts.timeoutMs,
        temperature: 0,
      });
      const obj = parseJsonObject(r.text) ?? {};
      const answers: Record<string, DecideAnswer> = {};
      for (const [id, q] of Object.entries(req.questions)) {
        const opts = optionsOf(q);
        const a = obj[id] as { answer?: unknown; confidence?: unknown } | undefined;
        let ans =
          typeof a?.answer === 'string' || typeof a?.answer === 'number'
            ? String(a.answer).trim()
            : '';
        if (q.type === 'noul')
          ans = /^(yes|oui|true)$/i.test(ans) ? 'yes' : /^(no|non|false)$/i.test(ans) ? 'no' : '';
        if (!opts.includes(ans)) {
          // unknown or missing: a flat distribution, so the safe default applies
          answers[id] = toAnswer(q, {});
          continue;
        }
        const stated = typeof a?.confidence === 'number' ? a.confidence : 0.5;
        const c = Math.min(1, Math.max(1 / opts.length + 1e-6, stated));
        const rest = opts.length > 1 ? (1 - c) / (opts.length - 1) : 0;
        answers[id] = toAnswer(q, Object.fromEntries(opts.map((o) => [o, o === ans ? c : rest])));
      }
      return { answers, ms: r.ms, via: 'llm', costUsd: r.costUsd };
    },
  };
}

interface Logger {
  info: (o: object, m?: string) => void;
  warn: (o: object, m?: string) => void;
}

/** What the brain is doing right now, for logs and the brain view. */
export type BrainStatus = 'off' | 'up' | 'down';

/**
 * The characters' link to Clef. One request at a time per question set; when Clef fails, the
 * link stays down for `backoffMs` (no hammering a sleeping PC) and every decision uses the
 * scoring meanwhile. Logs once per change of state, never a request body.
 */
export class Brain {
  private downUntil = 0;
  private lastStatus: BrainStatus;

  constructor(
    private decider: Decider | null,
    readonly minP: number,
    private log: Logger,
    private opts: { backoffMs?: number; now?: () => number } = {},
  ) {
    this.lastStatus = decider ? 'up' : 'off';
  }

  private now() {
    return this.opts.now ? this.opts.now() : Date.now();
  }

  get status(): BrainStatus {
    if (!this.decider) return 'off';
    return this.now() < this.downUntil ? 'down' : 'up';
  }

  /** Is Clef set up at all (even if it is down just now)? */
  get configured(): boolean {
    return !!this.decider;
  }

  /** Ask Clef. Null when it is off, down, or fails now (the caller scores instead). */
  async ask(
    state: unknown,
    questions: Record<string, DecideQuestion>,
  ): Promise<Record<string, DecideAnswer> | null> {
    if (!this.decider || this.status === 'down') return null;
    try {
      const r = await this.decider.decide({ state, questions });
      this.mark('up');
      return r.answers;
    } catch (e) {
      this.downUntil = this.now() + (this.opts.backoffMs ?? 30_000);
      this.mark('down', e);
      return null;
    }
  }

  private mark(s: BrainStatus, err?: unknown) {
    if (s === this.lastStatus) return;
    this.lastStatus = s;
    if (s === 'down')
      this.log.warn(
        { err: err instanceof Error ? err.message : String(err) },
        'Clef unreachable: characters decide with their own scoring for now',
      );
    else this.log.info({}, 'Clef reachable again: characters ask it again');
  }
}

/** `GET /health` once at start, so the log says whether Clef is there. */
export async function probeClef(
  url: string,
  log: Logger,
  opts: { token?: string; fetch?: FetchLike } = {},
): Promise<boolean> {
  const doFetch: FetchLike = opts.fetch ?? ((u, i) => fetch(u, i));
  try {
    const r = await doFetch(`${url.replace(/\/+$/, '')}/health`, {
      headers: opts.token ? { authorization: `Bearer ${opts.token}` } : {},
      signal: AbortSignal.timeout(3000),
    });
    const body = (await r.json().catch(() => ({}))) as { model?: string; quant?: string };
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    log.info({ url, model: body.model, quant: body.quant }, 'Clef reachable: characters ask it');
    return true;
  } catch (e) {
    log.warn(
      { url, err: (e as Error).message },
      'Clef not reachable at start: characters use their own scoring until it answers',
    );
    return false;
  }
}
