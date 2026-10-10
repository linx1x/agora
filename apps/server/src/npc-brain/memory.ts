/**
 * What a character remembers about a person (P15.5, ADR-046).
 *
 * A finished conversation is looked at once. A gate decides whether anything in it is worth
 * keeping: enough messages from the person, and Clef (on the operator's machine) confidently says
 * yes. Only then does the cloud model write the notes (600 characters at most) from the part of the
 * conversation that carried no personal information, merged with the previous notes. The notes are
 * checked by rules before they are saved. Without a cloud model nothing is kept: Clef cannot write.
 * Everything is per person and per character, shown to the person on request, and deleted on
 * "Forget me", with the account, or when it has not been refreshed for `NPC_MEMORY_DAYS`.
 */
import {
  MEMORY_MAX,
  MEMORY_MIN_MESSAGES,
  MEMORY_SYSTEM,
  REMEMBER_QUESTION,
  capMemory,
  localSafe,
  scrubPii,
} from '@agora/shared';
import type { Brain } from './decide';
import { parseJsonObject, type Completer } from './llm';
import type { TalkBudget, EndedConvo } from './talk';

interface Logger {
  info(o: object, msg?: string): void;
  warn(o: object, msg?: string): void;
}

export interface MemoryStoreLike {
  getNpcMemory(uid: string, npcId: string): Promise<string | null>;
  setNpcMemory(uid: string, npcId: string, summary: string): Promise<void>;
  deleteNpcMemories(uid: string): Promise<void>;
  pruneNpcMemories(before: number): Promise<number>;
}

export class MemoryKeeper {
  readonly stats = { considered: 0, kept: 0, gated: 0 };
  private busy = new Set<string>();
  /** bumped by every "Forget me": notes still being written for that person are dropped */
  private forgot = new Map<string, number>();

  constructor(
    private deps: {
      store: MemoryStoreLike;
      brain: Brain;
      llm?: Completer;
      budget: TalkBudget;
      log: Logger;
      days: number;
      timeoutMs: number;
      now?: () => number;
    },
  ) {}

  recall(uid: string, npcId: string): Promise<string | null> {
    return this.deps.store.getNpcMemory(uid, npcId);
  }

  async forget(uid: string) {
    this.forgot.set(uid, (this.forgot.get(uid) ?? 0) + 1);
    await this.deps.store.deleteNpcMemories(uid);
  }

  /** Delete the notes nobody refreshed for `days` days. */
  async prune(): Promise<number> {
    const now = this.deps.now ? this.deps.now() : Date.now();
    const n = await this.deps.store.pruneNpcMemories(now - this.deps.days * 86_400_000);
    if (n) this.deps.log.info({ n }, 'NPC memories expired');
    return n;
  }

  /** A conversation ended: keep notes if it is worth it. Never throws. */
  async consider(c: EndedConvo): Promise<void> {
    const llm = this.deps.llm;
    const key = `${c.speakerKey}|${c.persona.id}`;
    if (!llm || this.busy.has(key)) return;
    const mine = c.turns.filter((t) => t.role === 'user' && t.content !== '[…]');
    if (mine.length < MEMORY_MIN_MESSAGES) return;
    this.busy.add(key);
    this.stats.considered++;
    const gen = this.forgot.get(c.speakerKey) ?? 0;
    try {
      // 1. the gate: Clef, locally. Unsure or down = nothing is kept.
      const a = await this.deps.brain.ask(
        {
          npc: { name: c.persona.name, personality: c.persona.personality.slice(0, 240) },
          speaker: c.name,
          messages: mine.map((t) => t.content),
        },
        { remember: REMEMBER_QUESTION },
      );
      const g = a?.remember;
      if (!g || g.top !== 'yes' || g.p < this.deps.brain.minP) {
        this.stats.gated++;
        return;
      }
      if (!this.deps.budget.canCall(c.persona.id)) return;
      // 2. the notes: only the turns without personal information go to the model
      const before = await this.deps.store.getNpcMemory(c.speakerKey, c.persona.id);
      const r = await llm.complete({
        system: MEMORY_SYSTEM,
        messages: [
          {
            role: 'user',
            content: [
              `Character: ${c.persona.name}. Person: ${c.name}.`,
              before ? `Previous notes: ${before}` : 'Previous notes: none.',
              'Conversation:',
              ...c.turns
                .filter((t) => t.content !== '[…]')
                .map((t) => `${t.role === 'user' ? c.name : c.persona.name}: ${t.content}`),
            ].join('\n'),
          },
        ],
        json: true,
        maxTokens: 260,
        temperature: 0.2,
        timeoutMs: this.deps.timeoutMs,
      });
      this.deps.budget.record(c.persona.id, r.costUsd);
      const text = capMemory(String(parseJsonObject(r.text)?.summary ?? ''));
      // 3. the checks: nothing identifying, nothing that reads as an instruction or a claim
      if (!text || scrubPii(text).found || !localSafe(text, MEMORY_MAX)) return;
      if ((this.forgot.get(c.speakerKey) ?? 0) !== gen) return;
      await this.deps.store.setNpcMemory(c.speakerKey, c.persona.id, text);
      this.stats.kept++;
    } catch (e) {
      this.deps.log.warn(
        { npc: c.persona.id, err: e instanceof Error ? e.message : String(e) },
        'NPC memory not kept',
      );
    } finally {
      this.busy.delete(key);
    }
  }
}
