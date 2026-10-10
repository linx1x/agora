import { LlmError, type Answer, type Completer, type Decider, type DecideRequest, type FetchLike, type Question } from './types.js';
import { parseJsonObject } from './llm.js';

/** Allowed option ids of a question, in order. */
export function optionsOf(q: Question): string[] {
  if (q.type === 'noul') return ['yes', 'no'];
  if (q.type === 'choice') return Object.keys(q.criteria);
  return q.criteria.map((_, i) => String(i));
}

/** Turn a probability map into an Answer: renormalised over the allowed options, top first. */
export function toAnswer(q: Question, raw: Record<string, number>): Answer {
  const opts = optionsOf(q);
  const probs: Record<string, number> = {};
  let sum = 0;
  for (const o of opts) {
    const v = raw[o];
    const p = typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : 0;
    probs[o] = p;
    sum += p;
  }
  if (sum <= 0) {
    for (const o of opts) probs[o] = 1 / opts.length;
  } else {
    for (const o of opts) probs[o] = (probs[o] ?? 0) / sum;
  }
  let top = opts[0] ?? '';
  for (const o of opts) if ((probs[o] ?? 0) > (probs[top] ?? 0)) top = o;
  return { top, p: probs[top] ?? 0, probs };
}

/**
 * The safe-default rule (ADR-042): use the answer only when its top option reaches minP,
 * otherwise the decision's own default. Every decision goes through this.
 */
export function pick<T extends string>(answer: Answer | undefined, minP: number, fallback: T): T | string {
  return answer && answer.p >= minP ? answer.top : fallback;
}

/**
 * Local Clef-flash over HTTP (`spikes/npc-brain/clef/clef_server.py`, later `apps/ml`).
 * Request: Jev-style `{state, questions}`. Response: `{answers: {id: {probs: {option: p}}}}`.
 */
export function clefDecider(url: string, opts: { timeoutMs: number; fetch?: FetchLike }): Decider {
  const doFetch: FetchLike = opts.fetch ?? ((u, i) => fetch(u, i));
  return {
    name: 'clef',
    async decide(req) {
      const t0 = performance.now();
      const timeoutMs = req.timeoutMs ?? opts.timeoutMs;
      let res: Response;
      try {
        res = await doFetch(`${url.replace(/\/+$/, '')}/decide`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ state: req.state, questions: req.questions }),
          signal: AbortSignal.timeout(Math.max(1, Math.round(timeoutMs))),
        });
      } catch (e) {
        const name = (e as { name?: string }).name;
        throw new LlmError(name === 'TimeoutError' || name === 'AbortError' ? 'timeout' : 'network', `clef: ${(e as Error).message}`);
      }
      if (!res.ok) throw new LlmError('http', `clef: HTTP ${res.status}`, res.status);
      const body = (await res.json()) as { answers?: Record<string, { probs?: Record<string, number> }> };
      const answers: Record<string, Answer> = {};
      for (const [id, q] of Object.entries(req.questions)) {
        const probs = body.answers?.[id]?.probs;
        if (!probs) throw new LlmError('http', `clef: no answer for ${id}`);
        answers[id] = toAnswer(q, probs);
      }
      return { answers, ms: performance.now() - t0, via: 'clef', costUsd: 0 };
    },
  };
}

const DECIDE_SYSTEM = `You are a decision function inside a game server. You read a STATE (JSON) and answer every QUESTION with exactly one of its allowed options, plus your confidence from 0 to 1.
Answer in json only, one key per question id:
{"<question id>": {"answer": "<one allowed option>", "confidence": 0.0}}`;

/** Render questions with explicit allowed options, so the LLM sees the same choices Clef does. */
export function renderQuestions(questions: Record<string, Question>): string {
  const out: Record<string, unknown> = {};
  for (const [id, q] of Object.entries(questions)) {
    if (q.type === 'noul') out[id] = { instructions: q.instructions, options: ['yes', 'no'] };
    else if (q.type === 'choice') out[id] = { instructions: q.instructions, options: q.criteria };
    else out[id] = { instructions: q.instructions, options: Object.fromEntries(q.criteria.map((c, i) => [String(i), c])) };
  }
  return JSON.stringify(out);
}

/**
 * Fallback when Clef is off or down: the LLM in JSON mode, through the same provider as
 * complete() (Vincent, 2026-10-06: not Workers AI). Stated confidence becomes the top
 * option's probability; the rest is shared evenly.
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
      const answers: Record<string, Answer> = {};
      for (const [id, q] of Object.entries(req.questions)) {
        const opts = optionsOf(q);
        const a = obj[id] as { answer?: unknown; confidence?: unknown } | undefined;
        let ans = typeof a?.answer === 'string' || typeof a?.answer === 'number' ? String(a.answer).trim() : '';
        if (q.type === 'noul') ans = /^(yes|oui|true)$/i.test(ans) ? 'yes' : /^(no|non|false)$/i.test(ans) ? 'no' : '';
        if (!opts.includes(ans)) {
          // Unknown or missing answer: a flat distribution, so pick() falls back to the safe default.
          answers[id] = toAnswer(q, {});
          continue;
        }
        // At least an even share, so the stated answer stays on top.
        const stated = typeof a?.confidence === 'number' ? a.confidence : 0.5;
        const c = Math.min(1, Math.max(1 / opts.length + 1e-6, stated));
        const rest = opts.length > 1 ? (1 - c) / (opts.length - 1) : 0;
        answers[id] = toAnswer(q, Object.fromEntries(opts.map((o) => [o, o === ans ? c : rest])));
      }
      return { answers, ms: r.ms, via: 'llm', costUsd: r.costUsd };
    },
  };
}

/** Try each decider in order; the first that answers wins (Clef, then the LLM fallback). */
export function chainDeciders(deciders: Decider[], onFail?: (name: string, e: unknown) => void) {
  return async (req: DecideRequest) => {
    let last: unknown = new LlmError('config', 'no decider configured');
    for (const d of deciders) {
      try {
        return await d.decide(req);
      } catch (e) {
        last = e;
        onFail?.(d.name, e);
      }
    }
    throw last;
  };
}
