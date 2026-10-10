import { appendFile, mkdir, readdir, unlink } from 'node:fs/promises';
import { join } from 'node:path';

/**
 * The local decision log (ADR-044): one JSON line per character decision, in
 * `<NPC_LOG_DIR>/<YYYY-MM-DD>.jsonl`, kept `NPC_LOG_DAYS` (30) days. It is the training set for a
 * later step that fits the scoring to Clef's choices, so the fallback behaves more like Clef.
 * People are never named in it (`anonymize`), there is no account id, and no Talk text.
 */
export interface DecisionRecord {
  /** ISO time */
  t: string;
  space: string;
  npc: string;
  kind: 'next' | 'approach';
  /** clef: Clef was sure; unsure: Clef answered under NPC_DECIDE_MIN_P (default used); score: Clef off or down */
  via: 'clef' | 'unsure' | 'score';
  /** game minute */
  minute: number;
  /** the state Clef read, names replaced */
  state: unknown;
  /** the options with their scores and score parts (the scoring's features) */
  options: { id: string; score?: number; parts?: Record<string, number> }[];
  /** Clef's probabilities per question, when it answered */
  probs?: Record<string, Record<string, number>>;
  chosen: Record<string, string>;
}

interface Logger {
  warn: (o: object, m?: string) => void;
}

const DAY_FILE = /^(\d{4}-\d{2}-\d{2})\.jsonl$/;
const PURGE_EVERY_MS = 60 * 60_000;

export class DecisionLog {
  private chain: Promise<void> = Promise.resolve();
  private ready: Promise<void> | null = null;
  private purgedAt = -Infinity;
  private failed = false;

  constructor(
    readonly dir: string,
    private days: number,
    private log: Logger,
  ) {}

  /** Append one record (in order, never blocking the tick). */
  write(rec: DecisionRecord, now = Date.now()) {
    this.chain = this.chain.then(async () => {
      try {
        this.ready ??= mkdir(this.dir, { recursive: true }).then(() => undefined);
        await this.ready;
        if (now - this.purgedAt > PURGE_EVERY_MS) await this.purge(now);
        await appendFile(join(this.dir, `${rec.t.slice(0, 10)}.jsonl`), JSON.stringify(rec) + '\n');
      } catch (err) {
        if (!this.failed)
          this.log.warn({ dir: this.dir, err: String(err) }, 'NPC decision log not written');
        this.failed = true;
      }
    });
  }

  /** Wait for pending writes (tests, shutdown). */
  flush() {
    return this.chain;
  }

  /** Delete day files older than the retention. */
  async purge(now = Date.now()) {
    this.purgedAt = now;
    const cutoff = new Date(now - this.days * 86_400_000).toISOString().slice(0, 10);
    let files: string[] = [];
    try {
      files = await readdir(this.dir);
    } catch {
      return;
    }
    for (const f of files) {
      const m = DAY_FILE.exec(f);
      if (m && m[1]! < cutoff) await unlink(join(this.dir, f)).catch(() => {});
    }
  }
}
