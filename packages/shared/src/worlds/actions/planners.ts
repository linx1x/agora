/**
 * The rules the server runs, by action kind (ADR-053). The server takes this map unless a test
 * passes its own. Kinds without a rule refuse with `invalid`. P17.22 adds plant, harvest, fertilize
 * and place; P17.23 adds eat and sleep.
 */
import type { ActionPlanners } from './plan';
import { planChop, planMine } from './harvest';
import { planTill } from './till';
import { planWater } from './water';

export const ACTION_PLANNERS: ActionPlanners = {
  till: planTill,
  water: planWater,
  chop: planChop,
  mine: planMine,
};
