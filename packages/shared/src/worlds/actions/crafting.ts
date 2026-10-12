/**
 * Crafting (ADR-053, P17.25): a recipe is made at a station block in reach (recipes.json `station`,
 * blocks.json `station`). A bench or a stove makes its output at once. A machine (the furnace) takes
 * the inputs and holds one timed batch: the output waits in it for the recipe's `days`, which count
 * down on the world clock at each day change (clock.ts), and is collected into the bag afterwards.
 * Pure: the server applies the plan.
 */
import { BLOCKS, getBlock } from '../registry';
import { cellKey, type MachineState } from '../gamedata/state';
import { noChanges } from './kinds';
import { planCollectProducts } from './livestock';
import { refuse, type ActionPlanner } from './plan';

/**
 * Make a recipe (`target` is its id) at the station on the cell. Refusals: `invalid` (no station
 * there, or a recipe of another station), `missing` (an input is not in the bag, from the inventory
 * check), `busy` (the machine still holds a batch), `full`.
 */
export const planCraft: ActionPlanner = (view, req, env) => {
  if (!req.at || !req.target) return refuse('invalid');
  const { x, y } = req.at;
  const key = cellKey(x, y);
  const block = getBlock(BLOCKS, view.cell(x, y).decor);
  if (!block?.station) return refuse('invalid');
  const recipe = env.data.recipes.find((r) => r.id === req.target);
  if (!recipe || recipe.station !== block.station) return refuse('invalid');
  const items: Record<string, number> = {};
  for (const input of recipe.inputs) items[input.item] = (items[input.item] ?? 0) - input.qty;
  if (block.machine) {
    if (view.sim.machines.some((m) => m.cell === key)) return refuse('busy');
    const batch: MachineState = {
      id: key,
      cell: key,
      machine: block.id,
      output: recipe.output.item,
      qty: recipe.output.qty,
      daysLeft: recipe.days,
    };
    return {
      ok: true,
      plan: { changes: { ...noChanges(), items }, edits: [], sim: { ...view.sim, machines: [...view.sim.machines, batch] } },
    };
  }
  items[recipe.output.item] = (items[recipe.output.item] ?? 0) + recipe.output.qty;
  return { ok: true, plan: { changes: { ...noChanges(), items }, edits: [], sim: view.sim } };
};

/**
 * Take the output of a machine into the bag once its batch is done. Refusals: `gone` (no batch on
 * the cell), `busy` (the batch still has days to go).
 */
export const planCollectOutput: ActionPlanner = (view, req) => {
  if (!req.at) return refuse('invalid');
  const key = cellKey(req.at.x, req.at.y);
  const batch = view.sim.machines.find((m) => m.cell === key);
  if (!batch) return refuse('gone');
  if (batch.daysLeft > 0) return refuse('busy');
  return {
    ok: true,
    plan: {
      changes: { ...noChanges(), items: { [batch.output]: batch.qty } },
      edits: [],
      sim: { ...view.sim, machines: view.sim.machines.filter((m) => m !== batch) },
    },
  };
};

/** Collect from a cell: a machine's finished output, otherwise the products waiting in a housing. */
export const planCollect: ActionPlanner = (view, req, env) => {
  if (!req.at) return refuse('invalid');
  if (getBlock(BLOCKS, view.cell(req.at.x, req.at.y).decor)?.machine) return planCollectOutput(view, req, env);
  return planCollectProducts(view, req, env);
};
