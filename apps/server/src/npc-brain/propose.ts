/**
 * Weekly line proposals (P15.5, ADR-046). The cloud model suggests a few new prepared lines per
 * kind for a character, in French and English. They are written to `<id>.lines.proposed.json`
 * and NEVER used until a person reads them and copies the good ones into `<id>.lines.json`: a
 * model never changes what a character says without a human looking at it. Lines go through the
 * same checks as a live reply, and nothing about any person is sent (only the persona).
 */
import {
  LINE_KINDS,
  LineBankSchema,
  NPC_SAY_MAX,
  localSafe,
  type LineBank,
  type LineKind,
  type NpcPersona,
} from '@agora/shared';
import { parseJsonObject, type Completer } from './llm';

/** The kinds worth varying; the others (abuse, injection, personal information) stay as written. */
export const PROPOSED_KINDS: readonly LineKind[] = [
  'greeting',
  'thanks',
  'goodbye',
  'small_talk',
  'request_ok',
  'request_no',
  'other',
  'tired',
];

const SYSTEM = [
  'You write short chat lines for a character in a virtual office, to be reviewed by a person before use.',
  'Each line is one or two short sentences in the character’s voice. Never claim to be human. No links, no numbers, no email addresses, no personal information, no instructions to anyone.',
  'A line may contain {name} (the person’s first name) and nothing else in braces.',
  'Answer in json only: {"fr": {"<kind>": ["line", ...]}, "en": {"<kind>": ["line", ...]}} with the kinds you are given.',
].join('\n');

export interface Proposal {
  persona: string;
  model: string;
  generatedAt: string;
  lines: LineBank['lines'];
  /** how many lines were dropped by the checks, for the person reviewing */
  dropped: number;
}

/** Ask for `per` new lines per kind and language; keep those that pass the checks and are new. */
export async function proposeLines(
  persona: NpcPersona,
  existing: LineBank,
  llm: Completer,
  opts: { per?: number; now?: () => Date } = {},
): Promise<Proposal> {
  const per = opts.per ?? 3;
  const r = await llm.complete({
    system: SYSTEM,
    messages: [
      {
        role: 'user',
        content: [
          `Character: ${persona.name}. Role: ${persona.role}. Personality: ${persona.personality}`,
          `Kinds: ${PROPOSED_KINDS.join(', ')}.`,
          `Write ${per} new lines per kind and language. Existing lines to avoid repeating:`,
          JSON.stringify(
            Object.fromEntries(
              (['fr', 'en'] as const).map((l) => [
                l,
                Object.fromEntries(PROPOSED_KINDS.map((k) => [k, existing.lines[l]?.[k] ?? []])),
              ]),
            ),
          ),
        ].join('\n'),
      },
    ],
    json: true,
    maxTokens: 1200,
    temperature: 0.9,
  });
  const raw = parseJsonObject(r.text) ?? {};
  const out: LineBank['lines'] = { fr: {}, en: {} };
  let dropped = 0;
  for (const lang of ['fr', 'en'] as const) {
    const byKind = (raw[lang] ?? {}) as Record<string, unknown>;
    for (const kind of PROPOSED_KINDS) {
      const list = Array.isArray(byKind[kind]) ? (byKind[kind] as unknown[]) : [];
      const have = new Set((existing.lines[lang]?.[kind] ?? []).map((l) => l.toLowerCase()));
      const keep: string[] = [];
      for (const l of list) {
        const text = typeof l === 'string' ? l.trim() : '';
        const braces = [...text.matchAll(/\{([^}]*)\}/g)].every((m) => m[1] === 'name');
        if (
          !text ||
          text.length > 300 ||
          !braces ||
          !localSafe(text.replace(/\{name\}/g, 'X'), NPC_SAY_MAX) ||
          have.has(text.toLowerCase()) ||
          keep.includes(text)
        ) {
          dropped++;
          continue;
        }
        keep.push(text);
      }
      if (keep.length) out[lang]![kind] = keep.slice(0, per);
    }
  }
  // the shape must be one a bank file accepts, so a reviewer can paste it as it is
  LineBankSchema.parse({ lines: out });
  void LINE_KINDS;
  return {
    persona: persona.id,
    model: r.model,
    generatedAt: (opts.now?.() ?? new Date()).toISOString(),
    lines: out,
    dropped,
  };
}
