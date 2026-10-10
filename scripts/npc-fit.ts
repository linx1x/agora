/**
 * Fit the characters' scoring to Clef's choices (P15.3b, ADR-047).
 *
 *   pnpm tsx scripts/npc-fit.ts [--dry]
 *
 * Reads the decision log (NPC_LOG_DIR, default data/npc-log), fits one multiplier per score part by
 * imitation of Clef (supervised, no reward), reports agreement with Clef on days it was not fitted
 * on, and writes `<NPC_DIR>/weights.json` (default data/npcs) only if that agreement improves. The
 * server reads the file within 5 s; delete it to go back to the hand-set weights. Needs a few days
 * of logs with Clef on. `--dry` only prints.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fitAndCheck, type WeightsFile } from '../packages/shared/src/index';
import { loadConfig } from '../apps/server/src/config';
import { samplesFromLog } from '../apps/server/src/npc-brain/fit-data';

const cfg = loadConfig();
const logDir = cfg.npc.log?.dir ?? 'data/npc-log';
const npcDir = cfg.npc.dir ?? 'data/npcs';
const dry = process.argv.includes('--dry');

const { days, byDay } = await samplesFromLog(logDir);
const n = byDay.reduce((a, d) => a + d.length, 0);
console.log(
  `${logDir}: ${n} decisions Clef was sure about, over ${days.length} day(s) ${days.join(', ')}`,
);
const { weights, report } = fitAndCheck(byDay);
const pct = (x: number) => `${(x * 100).toFixed(1)}%`;
if (report.samples.test) {
  console.log(
    `fitted on ${report.samples.train}, checked on ${report.samples.test} from later days`,
  );
  console.log(
    `agreement with Clef on those: ${pct(report.agreement.before)} → ${pct(report.agreement.after)}`,
  );
  console.log(`log loss: ${report.logLoss.before.toFixed(3)} → ${report.logLoss.after.toFixed(3)}`);
}
if (!weights) {
  console.log(`Not adopted: ${report.reason}. The hand-set weights stay.`);
  process.exit(0);
}
console.log(`Adopted: ${report.reason}`);
console.log(JSON.stringify(weights));
if (dry) process.exit(0);
const file: WeightsFile = { version: 1, fittedAt: new Date().toISOString(), weights, report };
mkdirSync(npcDir, { recursive: true });
writeFileSync(join(npcDir, 'weights.json'), JSON.stringify(file, null, 2) + '\n');
console.log(`Wrote ${join(npcDir, 'weights.json')}`);
