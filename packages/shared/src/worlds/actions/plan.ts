/**
 * The contract of an action rule (ADR-053, skill agora-world-action). A rule is a pure function
 * from a read-only view of the world and the account to either a refusal or a plan: the changes to
 * the actor's account, the cell edits, and the farm state after the action. The server runs it
 * inside the transaction on freshly read rows, then applies the plan and writes the ledger row
 * from the same `changes`. The client may run the same rule to predict visuals, never to decide.
 */
import { CHUNK_SIZE, WORLD_CELL_PX } from '../constants';
import type { CellPatch, WorldCell } from '../cells';
import type { GameData } from '../gamedata/load';
import type { WorldSimState } from '../gamedata/state';
import { chunkIndex } from '../terrain';
import type { ActionChanges, ActionKind, ActionRequest, WorldRefusal } from './kinds';
import type { Inventory } from './inventory';

/** How far the actor's feet may be from the target cell's centre, in cells (skill: reach 1.5). */
export const REACH_CELLS = 1.5;

export interface CellRef {
  readonly x: number;
  readonly y: number;
}

/** Whether the feet point (world pixels) is within reach of the target cell. Squares only: no sqrt. */
export function inReach(feetX: number, feetY: number, at: CellRef): boolean {
  const dx = feetX / WORLD_CELL_PX - (at.x + 0.5);
  const dy = feetY / WORLD_CELL_PX - (at.y + 0.5);
  return dx * dx + dy * dy <= REACH_CELLS * REACH_CELLS;
}

/** The square of cells within `radius` of `at` (0 = the cell alone), in row-major order. */
export function cellsAround(at: CellRef, radius: number): CellRef[] {
  const out: CellRef[] = [];
  for (let dy = -radius; dy <= radius; dy++)
    for (let dx = -radius; dx <= radius; dx++) out.push({ x: at.x + dx, y: at.y + dy });
  return out;
}

/** The chunk a world cell belongs to. */
export function chunkOfCell(x: number, y: number): { cx: number; cy: number } {
  return { cx: Math.floor(x / CHUNK_SIZE), cy: Math.floor(y / CHUNK_SIZE) };
}

/** The key of a cell inside its chunk's delta (the local index, as a string). */
export function localIndexOf(x: number, y: number): string {
  const { cx, cy } = chunkOfCell(x, y);
  return String(chunkIndex(x - cx * CHUNK_SIZE, y - cy * CHUNK_SIZE));
}

/** The distinct chunks that cover the given cells, in first-seen order. */
export function chunksCovering(cells: readonly CellRef[]): { cx: number; cy: number }[] {
  const seen = new Map<string, { cx: number; cy: number }>();
  for (const c of cells) {
    const chunk = chunkOfCell(c.x, c.y);
    seen.set(`${chunk.cx},${chunk.cy}`, chunk);
  }
  return [...seen.values()];
}

/** What a rule may read. Nothing here can be changed by the rule. */
export interface ActionView {
  readonly day: number;
  /** the actor's feet, in world pixels */
  readonly actor: { readonly x: number; readonly y: number };
  readonly inventory: Inventory;
  readonly energy: number;
  /** total xp per skill */
  readonly skills: Readonly<Record<string, number>>;
  readonly sim: WorldSimState;
  /** the cell as it is now: base terrain with the stored edits over it */
  cell(x: number, y: number): WorldCell;
}

export interface ActionEnv {
  readonly data: GameData;
  /** Random numbers for this action only. Seeded by the world and the action key, so a rerun is the same. */
  readonly rng: () => number;
}

export interface CellEdit extends CellRef {
  readonly patch: CellPatch;
}

export interface ActionPlan {
  /** what the actor gains or pays; the server applies it and writes the ledger row from it */
  readonly changes: ActionChanges;
  readonly edits: readonly CellEdit[];
  /** the farm state after the action (the same object when the farm did not change) */
  readonly sim: WorldSimState;
}

export type ActionOutcome = { readonly ok: true; readonly plan: ActionPlan } | { readonly ok: false; readonly reason: WorldRefusal };

export type ActionPlanner = (view: ActionView, req: ActionRequest, env: ActionEnv) => ActionOutcome;

export type ActionPlanners = Partial<Record<ActionKind, ActionPlanner>>;

/** The rules the server runs. Filled per kind in P17.21 (tools), P17.22 (farm), P17.23 (food, bed). */
export const ACTION_PLANNERS: ActionPlanners = {};

export const refuse = (reason: WorldRefusal): ActionOutcome => ({ ok: false, reason });
