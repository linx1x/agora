/**
 * Weekly line proposals for the characters (P15.5, ADR-046).
 *
 *   pnpm tsx scripts/npc-lines.ts [--per 3]
 *
 * Reads the characters in NPC_DIR (default data/npcs), asks the cloud model in NPC_LLM_* for a few
 * new lines per kind and writes `<id>.lines.proposed.json` next to each bank. Nothing is used until
 * you copy the lines you like into `<id>.lines.json`. Run it weekly from a scheduled task if you
 * want; it only needs the API key, no flag, and sends the persona only (no person's data).
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { loadConfig } from '../apps/server/src/config';
import { createCompleter } from '../apps/server/src/npc-brain/llm';
import { NpcLineBanks } from '../apps/server/src/npc-brain/lines';
import { proposeLines } from '../apps/server/src/npc-brain/propose';
import { NpcPersonas } from '../apps/server/src/world/npc-personas';

const cfg = loadConfig();
const llm = cfg.npc.llm;
if (!llm || llm.fake) {
  console.error('Set NPC_LLM_API_KEY (and NPC_LLM_BASE_URL / NPC_LLM_MODEL) to ask for proposals.');
  process.exit(1);
}
const per = Number(process.argv[process.argv.indexOf('--per') + 1]) || 3;
const dir = cfg.npc.dir ?? 'data/npcs';
mkdirSync(dir, { recursive: true });
const log = { info: () => {}, warn: (o: object, m?: string) => console.warn(m, o) };
const personas = new NpcPersonas(dir, log, { writeDefaults: false });
const banks = new NpcLineBanks(dir, log);
const completer = createCompleter(llm.cfg);

for (const persona of personas.list()) {
  try {
    const p = await proposeLines(persona, banks.get(persona.id), completer, { per });
    const file = join(dir, `${persona.id}.lines.proposed.json`);
    writeFileSync(file, JSON.stringify(p, null, 2) + '\n');
    const n = Object.values(p.lines).reduce(
      (a, byKind) => a + Object.values(byKind ?? {}).reduce((b, l) => b + (l?.length ?? 0), 0),
      0,
    );
    console.log(`${persona.id}: ${n} proposed lines (${p.dropped} dropped) → ${file}`);
  } catch (e) {
    console.error(`${persona.id}: failed (${e instanceof Error ? e.message : String(e)})`);
  }
}
