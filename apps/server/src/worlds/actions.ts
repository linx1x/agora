/**
 * The server side of a world action (ADR-053, skill agora-world-action). The stages, in order:
 * permission and reach (no database), then one transaction in which the world row is locked, the
 * key is checked against the ledger (a resend replays the stored reply), the rule runs on freshly
 * read rows, the plan is applied and the ledger row is written. Refused actions write nothing.
 */
import {
  ACTION_PLANNERS,
  WORLD_CELL_PX,
  WORLD_DELTA_CELL_CAP,
  WorldTerrain,
  applyInventoryChanges,
  canDo,
  cellsAround,
  chunkKey,
  chunkOfCell,
  chunksCovering,
  createRng,
  deltaOverlay,
  baseItemOf,
  hash32,
  inReach,
  localIndexOf,
  mergeDeltas,
  progressionStep,
  settleDay,
  worldTime,
  type ActionChanges,
  type ActionKind,
  type ActionPlanner,
  type ActionPlanners,
  type ActionReply,
  type ActionRequest,
  type ActionView,
  type CellEdit,
  type ChunkDelta,
  type GameData,
  type Inventory,
  type WorldGenParams,
  type WorldRefusal,
  type WorldSimState,
} from '@agora/shared';
import type { WorldStore } from './worldStore';
import { ConflictError, grantStarterKit } from './inventory';
import { paySale, readFarm, saveFarm } from './farm';
import { energyOf } from './energy';
import type { WorldTxn } from './worldTxn';

/** What the rules may read about a world (a stored world, without its chunks). */
export interface ActionWorld {
  readonly id: string;
  readonly ownerId: string;
  readonly seed: number;
  readonly createdAt: number;
  readonly settings: Readonly<Record<string, unknown>>;
  /** P17.28: kinds the world's open contracts open to visitors */
  readonly opened?: readonly ActionKind[];
}

export interface ActionInput {
  readonly world: ActionWorld;
  readonly params: WorldGenParams;
  /** the starter stamp per chunk key: what a world looks like before any stored edit */
  readonly stamp: ReadonlyMap<string, ChunkDelta>;
  readonly actor: { readonly uid: string; readonly x: number; readonly y: number };
  /** where everyone in the world stands (feet, world pixels): nothing is built under them (P17.24) */
  readonly people: readonly { readonly x: number; readonly y: number }[];
  readonly req: ActionRequest;
  readonly key: string;
  readonly now: number;
  readonly store: WorldStore;
  readonly data: GameData;
  readonly planners?: ActionPlanners;
}

/** A chunk this action wrote: its new revision and whole delta (what `world:chunks` carries). */
export interface AppliedChunk {
  readonly cx: number;
  readonly cy: number;
  readonly rev: number;
  readonly delta: ChunkDelta;
}

export type ActionResult =
  | { readonly ok: true; readonly replayed: true; readonly changes: ActionChanges }
  | {
      readonly ok: true;
      readonly replayed: false;
      readonly changes: ActionChanges;
      readonly inventory: Inventory;
      readonly energy: number;
      readonly maxEnergy: number;
      readonly chunks: readonly AppliedChunk[];
      /** the farm state this action wrote, or null when the farm did not change */
      readonly sim: { readonly state: WorldSimState; readonly rev: number } | null;
      /** for the actor alone: a chest's contents after an open, stash or take */
      readonly reply?: ActionReply;
    }
  | { readonly ok: false; readonly reason: WorldRefusal };

const refused = (reason: WorldRefusal): ActionResult => ({ ok: false, reason });

/** The cells a rule may read around its target: every tool radius is at most 2. */
const READ_RADIUS = 2;

/** Runs one action from request to committed result. Throws only on infrastructure failure, with nothing written. */
export async function runAction(input: ActionInput): Promise<ActionResult> {
  const { world, actor, req } = input;
  // permission first: no database read for a refused visitor
  if (!canDo(world, actor.uid, req.kind)) return refused('forbidden');
  const planner = (input.planners ?? ACTION_PLANNERS)[req.kind];
  if (!planner) return refused('invalid');
  if (req.at && !inReach(actor.x, actor.y, req.at)) return refused('far');
  try {
    return await input.store.withTxn((tx) => transact(tx, input, planner));
  } catch (err) {
    if (err instanceof ConflictError) return refused('conflict');
    throw err;
  }
}

async function transact(tx: WorldTxn, input: ActionInput, planner: ActionPlanner): Promise<ActionResult> {
  const { world, actor, req, key, data, now, params, stamp } = input;
  if (!(await tx.lockWorld(world.id))) {
    tx.abort();
    return refused('invalid');
  }
  // a resend of an action that was approved: the stored reply, and nothing else
  const prior = await tx.ledgerOf(key);
  if (prior) {
    tx.abort();
    if (prior.actor !== actor.uid) return refused('key_taken');
    return { ok: true, replayed: true, changes: prior.delta };
  }
  await grantStarterKit(tx, actor.uid, data, now);

  const clock = worldTime(world.createdAt, now);
  const day = clock.day;
  // the farm, brought up to today first: a catch-up over the nights since it was last written. A shipping
  // bin sold at this rollover pays its owner before the actor's account is read (P17.26)
  const farm = await readFarm(tx, world.id, day, data, world.seed, true);
  if (farm.sale !== null) await paySale(tx, world, day, farm.sale, now);
  const account = await tx.accountOf(actor.uid, true);
  const progressRow = await tx.progressOf(actor.uid, true);
  const maxEnergy = data.progression.energy.max;
  // energy settles to today first (no money: the room settles the people in the world at the rollover).
  // A rest a bed set lasts until the rollover, and nothing can be done meanwhile.
  const settled = settleDay(energyOf(progressRow, maxEnergy, day), day, maxEnergy);
  if (settled.rest !== null) {
    tx.abort();
    return refused('asleep');
  }
  const energy = settled.energy;
  const skills = progressRow?.skills ?? {};
  const sim = farm.state;

  // the stored deltas around the target, so the rule reads what is there now
  const around = req.at ? cellsAround(req.at, READ_RADIUS) : [];
  const chunks = chunksCovering(around);
  const stored = await tx.chunksOf(world.id, chunks);
  const storedDelta = new Map(stored.map((c) => [chunkKey(c.cx, c.cy), c.delta] as const));
  const storedRev = new Map(stored.map((c) => [chunkKey(c.cx, c.cy), c.rev] as const));
  const terrain = new WorldTerrain(world.seed, params, {
    overlay: deltaOverlay((cx, cy) => {
      const k = chunkKey(cx, cy);
      return mergeDeltas(stamp.get(k), storedDelta.get(k));
    }),
  });
  const view: ActionView = {
    day,
    actor: { x: actor.x, y: actor.y },
    inventory: account.inventory,
    energy,
    time: { hour: clock.hour, minute: clock.minute },
    skills,
    sim,
    cell: (x, y) => terrain.cellAt(x, y),
    occupied: (x, y) => input.people.some((p) => Math.floor(p.x / WORLD_CELL_PX) === x && Math.floor(p.y / WORLD_CELL_PX) === y),
  };

  const outcome = planner(view, req, {
    data,
    rng: createRng(hash32(`${world.id}:${key}`)),
  });
  if (!outcome.ok) {
    tx.abort();
    return refused(outcome.reason);
  }
  // progression (P17.31): the one hook. It refuses a locked tool and sets the xp this action earns
  const step = progressionStep(data, req, skills, outcome.plan.changes);
  if (!step.ok) {
    tx.abort();
    return refused(step.reason);
  }
  const changes = step.changes;
  const { edits, sim: nextSim, rest } = outcome.plan;

  // a stack key may carry a quality (`id~q`): the limit is the base item's
  const nextAccount = applyInventoryChanges(account.inventory, changes, (key) => data.itemsById.get(baseItemOf(key))?.stack);
  if (!nextAccount.ok) {
    tx.abort();
    return refused(nextAccount.reason);
  }
  const nextEnergy = energy + changes.energy;
  if (nextEnergy < 0) {
    tx.abort();
    return refused('energy');
  }
  const energyAfter = Math.min(maxEnergy, nextEnergy);
  const nextSkills: Record<string, number> = { ...skills };
  for (const [skill, xp] of Object.entries(changes.xp)) nextSkills[skill] = (nextSkills[skill] ?? 0) + xp;

  // the ledger row is the last check: a concurrent write of the same key sees it and replays
  const inserted = await tx.insertLedger({
    key,
    actor: actor.uid,
    worldId: world.id,
    kind: req.kind,
    delta: changes,
    at: now,
  });
  if (!inserted) {
    const row = await tx.ledgerOf(key);
    tx.abort();
    if (!row) return refused('conflict');
    if (row.actor !== actor.uid) return refused('key_taken');
    return { ok: true, replayed: true, changes: row.delta };
  }

  if (changes.money !== 0 || Object.keys(changes.items).length > 0) {
    if ((await tx.saveAccount(actor.uid, nextAccount.inventory, account.rev)) === null) throw new ConflictError();
  }
  // every accepted action saves the energy state: its day, and the rest a bed just set
  await tx.saveProgress(actor.uid, { skills: nextSkills, energy: energyAfter, day: settled.day, rest: rest ?? null });
  const savedSim = await saveFarm(tx, world.id, farm, nextSim);

  const applied = await writeEdits(tx, world.id, edits, storedDelta, storedRev);
  if (applied === 'cap') {
    tx.abort();
    return refused('cap');
  }
  return {
    ok: true,
    replayed: false,
    changes,
    inventory: nextAccount.inventory,
    energy: energyAfter,
    maxEnergy,
    chunks: applied,
    sim: savedSim,
    reply: outcome.plan.reply,
  };
}

/** Writes the cell edits, one delta per chunk, each over the stored delta it started from. */
async function writeEdits(
  tx: WorldTxn,
  worldId: string,
  edits: readonly CellEdit[],
  storedDelta: ReadonlyMap<string, ChunkDelta>,
  storedRev: ReadonlyMap<string, number>,
): Promise<AppliedChunk[] | 'cap'> {
  const byChunk = new Map<string, { cx: number; cy: number; delta: Record<string, object> }>();
  for (const edit of edits) {
    const { cx, cy } = chunkOfCell(edit.x, edit.y);
    const k = chunkKey(cx, cy);
    const entry = byChunk.get(k) ?? { cx, cy, delta: { ...(storedDelta.get(k) ?? {}) } };
    const index = localIndexOf(edit.x, edit.y);
    entry.delta[index] = { ...((entry.delta[index] as object | undefined) ?? {}), ...edit.patch };
    byChunk.set(k, entry);
  }
  const out: AppliedChunk[] = [];
  for (const [k, entry] of byChunk) {
    const delta = entry.delta as ChunkDelta;
    const saved = await tx.saveChunk(worldId, entry.cx, entry.cy, delta, storedRev.get(k) ?? 0, WORLD_DELTA_CELL_CAP);
    if (!saved.ok) {
      if (saved.reason === 'cap') return 'cap';
      // `no_world` cannot happen after the world row was locked; treated as a conflict all the same
      throw new ConflictError();
    }
    out.push({ cx: entry.cx, cy: entry.cy, rev: saved.rev, delta });
  }
  return out;
}
