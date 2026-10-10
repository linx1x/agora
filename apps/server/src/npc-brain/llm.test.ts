import { describe, expect, it } from 'vitest';
import { LlmError, createCompleter, type FetchLike, type LlmConfig } from './llm';

/** A fetch that answers with the given OpenAI-style bodies in turn, and keeps the requests. */
function stub(...bodies: object[]) {
  const sent: Record<string, unknown>[] = [];
  const fetch: FetchLike = async (_url, init) => {
    sent.push(JSON.parse(String(init.body)) as Record<string, unknown>);
    const body = bodies[Math.min(sent.length - 1, bodies.length - 1)]!;
    return new Response(JSON.stringify(body), { status: 200 });
  };
  return { fetch, sent };
}

const cfg = (fetch: FetchLike): LlmConfig => ({
  provider: 'openai',
  baseUrl: 'https://llm.example',
  model: 'm',
  apiKey: 'k',
  timeoutMs: 5000,
  fetch,
});

const answer = (content: string | null, finish = 'stop', extra = {}) => ({
  model: 'm',
  choices: [{ message: { content }, finish_reason: finish }],
  usage: { prompt_tokens: 100, completion_tokens: 10, ...extra },
});

const req = { system: 'sys', messages: [{ role: 'user' as const, content: 'hi' }], json: true };

describe('complete(): an empty answer', () => {
  it('is retried without JSON mode, with the JSON asked for in the prompt', async () => {
    const { fetch, sent } = stub(answer(''), answer('{"say":"Salut!"}'));
    const r = await createCompleter(cfg(fetch)).complete({ ...req, maxTokens: 160 });
    expect(r.text).toBe('{"say":"Salut!"}');
    expect(r.attempts).toBe(2);
    expect(sent[0]!.response_format).toEqual({ type: 'json_object' });
    expect(sent[1]!.response_format).toBeUndefined();
    const system = (sent[1]!.messages as { content: string }[])[0]!.content;
    expect(system).toContain('JSON object only');
    expect(sent[1]!.max_tokens).toBe(160);
  });

  it('gets more tokens on the retry when the first ran out of them', async () => {
    const { fetch, sent } = stub(
      answer(null, 'length', { completion_tokens: 160 }),
      answer('{"say":"Oui"}'),
    );
    const r = await createCompleter(cfg(fetch)).complete({ ...req, maxTokens: 160 });
    expect(r.attempts).toBe(2);
    expect(sent[1]!.max_tokens).toBe(320);
  });

  it('says why when it is empty twice (stop reason, tokens, thinking), never the key', async () => {
    const { fetch } = stub(
      answer(null, 'length', {
        completion_tokens: 160,
        completion_tokens_details: { reasoning_tokens: 160 },
      }),
    );
    const err = await createCompleter(cfg(fetch))
      .complete({ ...req, maxTokens: 160 })
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(LlmError);
    expect((err as LlmError).kind).toBe('empty');
    expect((err as LlmError).message).toMatch(
      /json mode: finish=length, out=160\/160, thinking=160/,
    );
    expect((err as LlmError).message).toMatch(/prompt only: finish=length, out=160\/320/);
    expect((err as LlmError).message).not.toContain('"k"');
  });

  it('is not retried when the first answer has text', async () => {
    const { fetch, sent } = stub(answer('{"say":"Ok"}'));
    const r = await createCompleter(cfg(fetch)).complete(req);
    expect(r.attempts).toBe(1);
    expect(sent).toHaveLength(1);
  });
});
