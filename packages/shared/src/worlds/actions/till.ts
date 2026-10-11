/**
 * Till (ADR-053, P17.21): a hoe turns tillable ground into a plot on the farm layer (`WorldSimState`,
 * not the terrain). A hoe of radius r tills the (2r+1)-square around the target, skipping cells that
 * cannot be tilled or are already plots, and needs at least one cell it can till.
 */
import type { WorldCell } from '../cells';
import { BLOCKS, getBlock } from '../registry';
import { cellKey, type PlotState } from '../gamedata/state';
import { noChanges } from './kinds';
import { useTool } from './tools';
import { cellsAround, refuse, type ActionPlanner } from './plan';

/** Ground a hoe can turn: tillable ground, dry, with nothing on it. */
export function isTillable(cell: WorldCell): boolean {
  return !cell.liquid && cell.decor === '' && getBlock(BLOCKS, cell.block)?.tillable === true;
}

export const planTill: ActionPlanner = (view, req, env) => {
  if (!req.at) return refuse('invalid');
  const check = useTool(view, req, env.data, 'hoe');
  if (!check.ok) return refuse(check.reason);
  const plots: Record<string, PlotState> = { ...view.sim.plots };
  let tilled = 0;
  for (const c of cellsAround(req.at, check.tool.radius)) {
    const key = cellKey(c.x, c.y);
    if (plots[key]?.tilled || !isTillable(view.cell(c.x, c.y))) continue;
    plots[key] = { tilled: true, wateredOn: 0, crop: null, sprinkler: null };
    tilled++;
  }
  if (tilled === 0) return refuse('invalid');
  return {
    ok: true,
    plan: { changes: { ...noChanges(), energy: -check.cost }, edits: [], sim: { ...view.sim, plots } },
  };
};
