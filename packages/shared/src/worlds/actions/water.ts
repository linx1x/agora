/**
 * Water (ADR-053, P17.21): a watering can wets the tilled plots in its area for tomorrow's growth
 * step (gamedata/state.ts: a player watering on day D sets wateredOn to D + 1). Watering a plot that
 * is already wet for tomorrow does nothing, so a refusal costs no energy.
 */
import { cellKey, type PlotState } from '../gamedata/state';
import { noChanges } from './kinds';
import { useTool } from './tools';
import { cellsAround, refuse, type ActionPlanner } from './plan';

export const planWater: ActionPlanner = (view, req, env) => {
  if (!req.at) return refuse('invalid');
  const check = useTool(view, req, env.data, 'can');
  if (!check.ok) return refuse(check.reason);
  const tomorrow = view.day + 1;
  const plots: Record<string, PlotState> = { ...view.sim.plots };
  let wet = 0;
  for (const c of cellsAround(req.at, check.tool.radius)) {
    const key = cellKey(c.x, c.y);
    const plot = plots[key];
    if (!plot?.tilled || plot.wateredOn === tomorrow) continue;
    plots[key] = { ...plot, wateredOn: tomorrow };
    wet++;
  }
  if (wet === 0) return refuse('invalid');
  return {
    ok: true,
    plan: { changes: { ...noChanges(), energy: -check.cost }, edits: [], sim: { ...view.sim, plots } },
  };
};
