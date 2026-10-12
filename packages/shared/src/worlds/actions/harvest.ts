/**
 * Chop and mine (ADR-053, P17.21): an axe fells a tree and a pick breaks a boulder. Both are decor
 * blocks with a `harvest` entry in blocks.json: the tool kind and tier must match, the drops are
 * rolled from the action's rng, the decor is cleared (no stump block yet, so the cell becomes bare
 * ground) and the skill gets its xp. The hits in the data are the swing count for the client, not
 * a server-side counter: one accepted action fells the tree.
 */
import { BLOCKS, getBlock } from '../registry';
import { noChanges, type ActionChanges } from './kinds';
import { useTool, type ToolUse } from './tools';
import { refuse, type ActionPlanner } from './plan';

type HarvestUse = Extract<ToolUse, 'axe' | 'pick'>;

/** A harvest planner for one tool. `grant` names the progression.xp entry the action earns. */
export function planHarvestWith(use: HarvestUse, grant: 'chop' | 'mine'): ActionPlanner {
  return (view, req, env) => {
    if (!req.at) return refuse('invalid');
    const check = useTool(view, req, env.data, use);
    if (!check.ok) return refuse(check.reason);
    const cell = view.cell(req.at.x, req.at.y);
    if (cell.decor === '') return refuse('gone');
    const harvest = getBlock(BLOCKS, cell.decor)?.harvest;
    if (!harvest) return refuse('invalid');
    if (harvest.tool !== use) return refuse('tool');
    if (check.tool.tier < harvest.minTier) return refuse('tier');
    const items: Record<string, number> = {};
    for (const drop of harvest.drops) {
      const qty = drop.min + Math.floor(env.rng() * (drop.max - drop.min + 1));
      if (qty > 0) items[drop.item] = (items[drop.item] ?? 0) + qty;
    }
    const reward = env.data.progression.xp[grant];
    const changes: ActionChanges = { ...noChanges(), items, energy: -check.cost, xp: { [reward.skill]: reward.amount } };
    return {
      ok: true,
      plan: { changes, edits: [{ x: req.at.x, y: req.at.y, patch: { decor: '' } }], sim: view.sim },
    };
  };
}

export const planChop = planHarvestWith('axe', 'chop');
export const planMine = planHarvestWith('pick', 'mine');
