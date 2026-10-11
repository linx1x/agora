/**
 * Building and digging (ADR-053, P17.24): place a block from the inventory, remove a placed block
 * back into it, raise or lower the ground by one level with a shovel, and chests that hold items.
 * Pure rules: the server runs them inside the transaction and applies the plan (agora-world-action).
 *
 * Trap rule (ground): a cell may change level only when nobody stands on it and every walkable
 * orthogonal neighbour can still be stepped onto and off it (`canStep` both ways). So nobody is left
 * on a cell they cannot leave, and a wall of more than one level is refused, not built.
 * Chests: the contents live on the farm layer (`WorldSimState.chests`), never in a chunk delta, so
 * the people in view never see them. Visitors need an owner grant for open, stash and take.
 */
import { LEVEL_MAX } from '../constants';
import type { WorldCell } from '../cells';
import type { GameData } from '../gamedata/load';
import { cellKey } from '../gamedata/state';
import { BLOCKS, getBlock } from '../registry';
import { canStep } from '../walk';
import { baseItemOf } from './farm';
import { countOf } from './inventory';
import { noChanges, type ActionRequest, type WorldRefusal } from './kinds';
import { refuse, type ActionEnv, type ActionOutcome, type ActionPlanner, type ActionView, type CellEdit, type CellRef } from './plan';
import { useTool } from './tools';

/** Most stacks a chest holds (different stack keys). */
export const CHEST_SLOTS = 20;

const NEIGHBOURS: readonly (readonly [number, number])[] = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
];

type ChestMap = Readonly<Record<string, Readonly<Record<string, number>>>>;

/** The chest map with one cell's contents set (`null` removes the cell's chest). */
function withChest(chests: ChestMap | undefined, key: string, contents: Record<string, number> | null): ChestMap {
  const next: Record<string, Record<string, number>> = { ...(chests ?? {}) };
  if (contents === null) delete next[key];
  else next[key] = contents;
  return next;
}

/** The item that places a block (every placeable block has one item), if any. */
export function itemOfBlock(data: GameData, blockId: string): string | undefined {
  return data.items.find((item) => item.block === blockId)?.id;
}

function built(view: ActionView, item: string, edit: CellEdit, chests?: ChestMap): ActionOutcome {
  return {
    ok: true,
    plan: {
      changes: { ...noChanges(), items: { [item]: -1 } },
      edits: [edit],
      sim: chests === undefined ? view.sim : { ...view.sim, chests },
    },
  };
}

/**
 * Place a block from the bag (an item with a `block`). Ground blocks change the cell's top block;
 * decor blocks stand on it. Refusals: `invalid` (not a placeable block, water, a plot), `missing`,
 * `occupied` (someone stands there), `gone` (the cell already holds a decor block or this ground).
 */
export const planPlaceBlock: ActionPlanner = (view, req, env) => {
  if (!req.at || !req.item) return refuse('invalid');
  const blockId = env.data.itemsById.get(baseItemOf(req.item))?.block;
  const block = blockId === undefined ? undefined : getBlock(BLOCKS, blockId);
  if (!block?.placeable) return refuse('invalid');
  if (countOf(view.inventory, req.item) < 1) return refuse('missing');
  const { x, y } = req.at;
  if (view.occupied(x, y)) return refuse('occupied');
  const key = cellKey(x, y);
  const cell = view.cell(x, y);
  if (view.sim.plots[key] !== undefined || cell.liquid) return refuse('invalid');
  if (block.layer === 'ground') {
    if (cell.block === block.id) return refuse('gone');
    if (cell.decor !== '') return refuse('invalid');
    return built(view, req.item, { x, y, patch: { block: block.id } });
  }
  if (cell.decor !== '') return refuse('gone');
  return built(view, req.item, { x, y, patch: { decor: block.id } }, block.container ? withChest(view.sim.chests, key, {}) : undefined);
};

/**
 * Remove a placed decor block into the bag. Only blocks a player places (placeable, with an item)
 * come back; a chest must be empty first. Refusals: `gone` (nothing there), `invalid` (a tree or a
 * boulder, or a chest with items in it).
 */
export const planRemove: ActionPlanner = (view, req, env) => {
  if (!req.at) return refuse('invalid');
  const { x, y } = req.at;
  const key = cellKey(x, y);
  const cell = view.cell(x, y);
  if (cell.decor === '') return refuse('gone');
  const block = getBlock(BLOCKS, cell.decor);
  const item = block?.placeable ? itemOfBlock(env.data, block.id) : undefined;
  if (item === undefined) return refuse('invalid');
  const contents = view.sim.chests?.[key];
  if (contents !== undefined && Object.values(contents).some((n) => n > 0)) return refuse('invalid');
  const chests = contents === undefined ? view.sim.chests : withChest(view.sim.chests, key, null);
  return {
    ok: true,
    plan: {
      changes: { ...noChanges(), items: { [item]: 1 } },
      edits: [{ x, y, patch: { decor: '' } }],
      sim: chests === undefined ? view.sim : { ...view.sim, chests },
    },
  };
};

/**
 * The shovel: one level up (`step` 1) or down (-1) for the cell. Refusals: `tool` / `missing` /
 * `energy` (as any tool), `invalid` (water, decor or a plot on the cell, or the top or bottom
 * level), `occupied`, `trap` (a walkable neighbour could no longer be stepped onto or off).
 */
function digPlan(view: ActionView, req: ActionRequest, env: ActionEnv, step: 1 | -1): ActionOutcome {
  if (!req.at) return refuse('invalid');
  const check = useTool(view, req, env.data, 'shovel');
  if (!check.ok) return refuse(check.reason);
  const { x, y } = req.at;
  const cell = view.cell(x, y);
  if (cell.liquid || cell.decor !== '' || view.sim.plots[cellKey(x, y)] !== undefined) return refuse('invalid');
  if (view.occupied(x, y)) return refuse('occupied');
  const level = cell.level + step;
  if (level < 0 || level > LEVEL_MAX) return refuse('invalid');
  const raised: WorldCell = { ...cell, level };
  for (const [dx, dy] of NEIGHBOURS) {
    const other = view.cell(x + dx, y + dy);
    if (other.walkable && (!canStep(raised, other) || !canStep(other, raised))) return refuse('trap');
  }
  return {
    ok: true,
    plan: { changes: { ...noChanges(), energy: -check.cost }, edits: [{ x, y, patch: { level } }], sim: view.sim },
  };
}

export const planRaise: ActionPlanner = (view, req, env) => digPlan(view, req, env, 1);
export const planLower: ActionPlanner = (view, req, env) => digPlan(view, req, env, -1);

/** The chest on a cell and its contents. A cell with no container is refused (`gone` when empty). */
function chestAt(view: ActionView, at: CellRef): { ok: true; items: Record<string, number> } | { ok: false; reason: WorldRefusal } {
  const cell = view.cell(at.x, at.y);
  if (cell.decor === '') return { ok: false, reason: 'gone' };
  if (!getBlock(BLOCKS, cell.decor)?.container) return { ok: false, reason: 'invalid' };
  return { ok: true, items: { ...(view.sim.chests?.[cellKey(at.x, at.y)] ?? {}) } };
}

/** Open a chest: its contents go to the actor alone (`reply`). Nothing changes. */
export const planOpen: ActionPlanner = (view, req) => {
  if (!req.at) return refuse('invalid');
  const chest = chestAt(view, req.at);
  if (!chest.ok) return refuse(chest.reason);
  return { ok: true, plan: { changes: noChanges(), edits: [], sim: view.sim, reply: { chest: { at: req.at, items: chest.items } } } };
};

/**
 * Put the whole stack of the held item into the chest. Refusals: `missing` (none in the bag),
 * `full` (a new stack and the chest has `CHEST_SLOTS` already), and the chest refusals above.
 */
export const planStash: ActionPlanner = (view, req) => {
  if (!req.at || !req.item) return refuse('invalid');
  const chest = chestAt(view, req.at);
  if (!chest.ok) return refuse(chest.reason);
  const have = countOf(view.inventory, req.item);
  if (have < 1) return refuse('missing');
  const items = { ...chest.items };
  if (items[req.item] === undefined && Object.keys(items).length >= CHEST_SLOTS) return refuse('full');
  items[req.item] = (items[req.item] ?? 0) + have;
  return {
    ok: true,
    plan: {
      changes: { ...noChanges(), items: { [req.item]: -have } },
      edits: [],
      sim: { ...view.sim, chests: withChest(view.sim.chests, cellKey(req.at.x, req.at.y), items) },
      reply: { chest: { at: req.at, items } },
    },
  };
};

/**
 * Take the whole stack named by `item` out of the chest. Refusals: `gone` (the chest no longer has
 * it: another person took it first), `full` (the bag is full, from the inventory check).
 */
export const planTake: ActionPlanner = (view, req) => {
  if (!req.at || !req.item) return refuse('invalid');
  const chest = chestAt(view, req.at);
  if (!chest.ok) return refuse(chest.reason);
  const n = chest.items[req.item] ?? 0;
  if (n < 1) return refuse('gone');
  const items = { ...chest.items };
  delete items[req.item];
  return {
    ok: true,
    plan: {
      changes: { ...noChanges(), items: { [req.item]: n } },
      edits: [],
      sim: { ...view.sim, chests: withChest(view.sim.chests, cellKey(req.at.x, req.at.y), items) },
      reply: { chest: { at: req.at, items } },
    },
  };
};
