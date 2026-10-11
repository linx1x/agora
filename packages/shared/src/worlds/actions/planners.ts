/**
 * The rules the server runs, by action kind (ADR-053). The server takes this map unless a test
 * passes its own. P17.23 adds eat and sleep; until then they refuse with `invalid`.
 */
import type { ActionPlanners } from './plan';
import { planFertilize, planHarvest, planPlace, planPlant } from './farm';
import { planChop, planMine } from './harvest';
import { planTill } from './till';
import { planWater } from './water';

export const ACTION_PLANNERS: ActionPlanners = {
  till: planTill,
  water: planWater,
  plant: planPlant,
  harvest: planHarvest,
  fertilize: planFertilize,
  place: planPlace,
  chop: planChop,
  mine: planMine,
};
