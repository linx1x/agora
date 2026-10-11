/**
 * Tools (ADR-053, P17.21): the held tool a rule needs, its energy cost and the skill that makes it
 * cheaper. The tool data is tools.json (kind, tier, base energy, radius). The discount follows
 * STARDEW-MECHANICS.md section 8: 0.1 less per level of the skill the tool trains (hoe and can:
 * farming; axe: foraging; pick: mining). Pure, so the client can predict the cost it shows.
 */
import type { GameData } from '../gamedata/load';
import type { Skill, Tool } from '../gamedata/schema';
import { countOf } from './inventory';
import type { ActionRequest, WorldRefusal } from './kinds';
import type { ActionView } from './plan';

/** The tools a rule can use, by the action they perform. */
export type ToolUse = 'hoe' | 'can' | 'axe' | 'pick';

/** The skill each tool trains, and so the one whose level discounts its energy. */
export const SKILL_OF_TOOL: Readonly<Record<ToolUse, Skill>> = {
  hoe: 'farming',
  can: 'farming',
  axe: 'foraging',
  pick: 'mining',
};

/** Energy taken off a tool's base cost for each level of its skill. */
export const ENERGY_DISCOUNT_PER_LEVEL = 0.1;

/** The level (0 to the table length) a total of xp has reached: how many thresholds it has passed. */
export function skillLevelOf(xp: number, levelXp: readonly number[]): number {
  let level = 0;
  for (const need of levelXp) {
    if (xp < need) break;
    level++;
  }
  return level;
}

/** The tool with this item id, if the item is a tool. */
export function toolOf(data: GameData, id: string): Tool | undefined {
  return data.tools.find((tool) => tool.id === id);
}

/** Energy one use costs at a skill level: the base less the discount, rounded, and at least 1. */
export function toolEnergy(tool: Pick<Tool, 'energy'>, skillLevel: number): number {
  return Math.max(1, Math.round(tool.energy - ENERGY_DISCOUNT_PER_LEVEL * skillLevel));
}

export type ToolCheck =
  | { readonly ok: true; readonly tool: Tool; readonly cost: number }
  | { readonly ok: false; readonly reason: WorldRefusal };

/**
 * The held tool, when it is a tool of this kind, the actor holds one and has the energy for a use.
 * Refusals: `missing` (nothing in hand, or none in the bag), `tool` (the item is not this kind of
 * tool), `energy` (the use would take the actor below zero).
 */
export function useTool(view: ActionView, req: ActionRequest, data: GameData, use: ToolUse): ToolCheck {
  if (!req.item) return { ok: false, reason: 'missing' };
  const tool = toolOf(data, req.item);
  if (!tool || tool.tool !== use) return { ok: false, reason: 'tool' };
  if (countOf(view.inventory, req.item) < 1) return { ok: false, reason: 'missing' };
  const level = skillLevelOf(view.skills[SKILL_OF_TOOL[use]] ?? 0, data.progression.levelXp);
  const cost = toolEnergy(tool, level);
  if (view.energy < cost) return { ok: false, reason: 'energy' };
  return { ok: true, tool, cost };
}
