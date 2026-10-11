/**
 * The rules the server runs, by action kind (ADR-053). The server takes this map unless a test
 * passes its own.
 */
import type { ActionPlanners } from './plan';
import { baseItemOf, planFertilize, planHarvest, planPlace, planPlant } from './farm';
import { planLower, planOpen, planPlaceBlock, planRaise, planRemove, planStash, planTake } from './build';
import { planCollect, planCraft } from './crafting';
import { planFeed, planPlaceAnimal } from './livestock';
import { planBuy } from './shop';
import { planChop, planMine } from './harvest';
import { planEat, planSleep } from './rest';
import { planTill } from './till';
import { planWater } from './water';

export const ACTION_PLANNERS: ActionPlanners = {
  till: planTill,
  water: planWater,
  plant: planPlant,
  harvest: planHarvest,
  fertilize: planFertilize,
  // an animal goes onto its housing (livestock.ts); a block item is placed as a block (build.ts);
  // anything else as a sprinkler (farm.ts)
  place: (view, req, env) => {
    const item = req.item === undefined ? undefined : env.data.itemsById.get(baseItemOf(req.item));
    if (item?.kind === 'animal') return planPlaceAnimal(view, req, env);
    if (item?.block !== undefined) return planPlaceBlock(view, req, env);
    return planPlace(view, req, env);
  },
  buy: planBuy,
  feed: planFeed,
  collect: planCollect,
  craft: planCraft,
  raise: planRaise,
  lower: planLower,
  remove: planRemove,
  open: planOpen,
  stash: planStash,
  take: planTake,
  chop: planChop,
  mine: planMine,
  eat: planEat,
  sleep: planSleep,
};
