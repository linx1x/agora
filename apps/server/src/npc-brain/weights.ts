import { existsSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { WeightsFileSchema, type ScoreWeights } from '@agora/shared';

interface Logger {
  info(o: object, msg?: string): void;
  warn(o: object, msg?: string): void;
}

const CHECK_MS = 5000;

/**
 * Fitted score weights (P15.3b), read from `<NPC_DIR>/weights.json` like the persona files: edited
 * or replaced while the server runs, picked up within 5 s, a bad file logged once and ignored. No
 * file means the hand-set weights (all 1).
 */
export class NpcWeights {
  private cur: ScoreWeights = {};
  private stamp = -1;
  private checked = 0;
  private bad = '';

  constructor(
    private dir: string | undefined,
    private log: Logger,
  ) {
    if (dir) this.get(0);
  }

  get(now = Date.now()): ScoreWeights {
    if (!this.dir || now - this.checked < CHECK_MS) return this.cur;
    this.checked = now;
    const f = join(this.dir, 'weights.json');
    try {
      if (!existsSync(f)) {
        if (this.stamp !== -1)
          this.log.info({}, 'NPC weights file removed: hand-set weights again');
        this.stamp = -1;
        return (this.cur = {});
      }
      const m = statSync(f).mtimeMs;
      if (m === this.stamp) return this.cur;
      this.stamp = m;
      const r = WeightsFileSchema.safeParse(JSON.parse(readFileSync(f, 'utf8')));
      if (!r.success) throw new Error(r.error.issues[0]?.message ?? 'bad shape');
      this.cur = r.data.weights;
      this.bad = '';
      this.log.info({ weights: this.cur, fittedAt: r.data.fittedAt }, 'NPC fitted weights loaded');
    } catch (err) {
      const msg = String(err);
      if (msg !== this.bad) this.log.warn({ file: f, err: msg }, 'NPC weights file ignored');
      this.bad = msg;
      this.cur = {};
    }
    return this.cur;
  }
}
