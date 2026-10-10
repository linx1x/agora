/**
 * A stand-in for the cloud model for the e2e suite and local trials (`NPC_LLM_PROVIDER=fake`,
 * refused in production). It answers sorting requests by rules (the same ones the engine uses
 * without any classifier) and writes a recognisable `(fake)` line for everything else, so a test
 * can tell a model-written reply from a prepared one.
 */
import { guessLang, heuristicKind } from '@agora/shared';
import { fakeCompleter, parseJsonObject, type CompleteRequest, type Completer } from './llm';

export function e2eCompleter(): Completer & { calls: CompleteRequest[] } {
  return fakeCompleter((req) => {
    if (req.system.startsWith('You are a decision function')) {
      const user = req.messages[0]?.content ?? '';
      const state = parseJsonObject(/STATE:\n([\s\S]*?)\n\nQUESTIONS:/.exec(user)?.[1] ?? '') ?? {};
      const qs = parseJsonObject(/QUESTIONS:\n([\s\S]*)$/.exec(user)?.[1] ?? '') ?? {};
      const message = String(state.message ?? '');
      const lang = guessLang(message);
      const out: Record<string, { answer: string; confidence: number }> = {};
      for (const id of Object.keys(qs)) {
        out[id] = {
          answer:
            id === 'kind'
              ? heuristicKind(message)
              : id === 'pii'
                ? 'no'
                : id === 'lang'
                  ? lang === 'en'
                    ? 'en'
                    : 'fr'
                  : id === 'emote'
                    ? 'none'
                    : id === 'action'
                      ? /cuisine|kitchen|caf[ée]/i.test(message)
                        ? 'show_kitchen'
                        : 'none'
                      : id === 'safe'
                        ? 'yes'
                        : 'none',
          confidence: 0.95,
        };
      }
      return JSON.stringify(out);
    }
    return req.system.includes('Reply in: English.')
      ? '(fake) I heard you, and that is a good question.'
      : '(fake) Je t’ai bien entendu, et c’est une bonne question.';
  });
}
