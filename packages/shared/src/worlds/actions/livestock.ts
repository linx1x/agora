/**
 * Livestock (ADR-053, P17.25): a coop holds hens, a barn the other animals, up to the housing's
 * `capacity`. An animal is placed from the bag onto its housing and fed from the bag (its feed item,
 * `feedPerDay` each). A fed night adds progress until the product is ready (clock.ts); products wait
 * on the animal and go into the bag when collected. Feeding on day D counts for the night D to D + 1
 * (`fedOn` = D + 1), the same rule as watering. Pure: the server applies the plan.
 */
import { BLOCKS, getBlock, type Block } from '../registry';
import { cellKey, type AnimalState, type WorldSimState } from '../gamedata/state';
import { countOf } from './inventory';
import { noChanges } from './kinds';
import { refuse, type ActionPlanner, type ActionView } from './plan';

/** The animals standing in a housing cell ("x,y"). */
export const animalsAt = (sim: WorldSimState, key: string): AnimalState[] => sim.animals.filter((a) => a.cell === key);

/** The next free animal id: `a<n>` with n one above the largest in the world. */
export function nextAnimalId(sim: WorldSimState): string {
  let top = 0;
  for (const a of sim.animals) top = Math.max(top, Number(/^a(\d+)$/.exec(a.id)?.[1] ?? 0));
  return `a${top + 1}`;
}

/** The housing block (coop or barn) on a cell, if any. */
function housingAt(view: ActionView, x: number, y: number): Block | undefined {
  const block = getBlock(BLOCKS, view.cell(x, y).decor);
  return block?.housing === undefined ? undefined : block;
}

/**
 * Place an animal from the bag on its housing. Refusals: `invalid` (not an animal, not a housing of
 * its kind), `missing` (none in the bag), `capacity` (the housing is full).
 */
export const planPlaceAnimal: ActionPlanner = (view, req, env) => {
  if (!req.at || !req.item) return refuse('invalid');
  const item = env.data.itemsById.get(req.item);
  const row = env.data.animals.find((a) => a.id === req.item);
  if (!item || item.kind !== 'animal' || !row) return refuse('invalid');
  const { x, y } = req.at;
  const block = housingAt(view, x, y);
  if (!block || block.housing !== row.housing) return refuse('invalid');
  if (countOf(view.inventory, req.item) < 1) return refuse('missing');
  const key = cellKey(x, y);
  if (animalsAt(view.sim, key).length >= (block.capacity ?? 0)) return refuse('capacity');
  const animal: AnimalState = { id: nextAnimalId(view.sim), animal: row.id, cell: key, fedOn: 0, progress: 0, pending: 0 };
  return {
    ok: true,
    plan: {
      changes: { ...noChanges(), items: { [row.id]: -1 } },
      edits: [],
      sim: { ...view.sim, animals: [...view.sim.animals, animal] },
    },
  };
};

/**
 * Feed the animals of a housing that are not fed for tonight, with the feed item in hand (fodder).
 * Refusals: `invalid` (not a housing, not feed), `gone` (nobody there needs this feed tonight),
 * `missing` (not enough in the bag for all of them).
 */
export const planFeed: ActionPlanner = (view, req, env) => {
  if (!req.at || !req.item) return refuse('invalid');
  const { x, y } = req.at;
  if (housingAt(view, x, y) === undefined) return refuse('invalid');
  const feed = env.data.itemsById.get(req.item);
  if (!feed || feed.kind !== 'feed') return refuse('invalid');
  const rows = new Map(env.data.animals.map((a) => [a.id, a] as const));
  const due = animalsAt(view.sim, cellKey(x, y)).filter((a) => a.fedOn <= view.day && rows.get(a.animal)?.feed === feed.id);
  if (due.length === 0) return refuse('gone');
  const need = due.reduce((sum, a) => sum + (rows.get(a.animal)?.feedPerDay ?? 0), 0);
  if (countOf(view.inventory, feed.id) < need) return refuse('missing');
  const fed = new Set(due);
  const animals = view.sim.animals.map((a) => (fed.has(a) ? { ...a, fedOn: view.day + 1 } : a));
  return {
    ok: true,
    plan: { changes: { ...noChanges(), items: { [feed.id]: -need } }, edits: [], sim: { ...view.sim, animals } },
  };
};

/**
 * Collect the products waiting in a housing into the bag. Refusals: `invalid` (not a housing),
 * `gone` (nothing waits; the products come as the animals are fed day after day).
 */
export const planCollectProducts: ActionPlanner = (view, req, env) => {
  if (!req.at) return refuse('invalid');
  const { x, y } = req.at;
  if (housingAt(view, x, y) === undefined) return refuse('invalid');
  const key = cellKey(x, y);
  const rows = new Map(env.data.animals.map((a) => [a.id, a] as const));
  const items: Record<string, number> = {};
  for (const a of animalsAt(view.sim, key)) {
    const product = rows.get(a.animal)?.product;
    if (product === undefined || a.pending < 1) continue;
    items[product] = (items[product] ?? 0) + a.pending;
  }
  if (Object.keys(items).length === 0) return refuse('gone');
  const animals = view.sim.animals.map((a) => (a.cell === key && a.pending > 0 ? { ...a, pending: 0 } : a));
  return { ok: true, plan: { changes: { ...noChanges(), items }, edits: [], sim: { ...view.sim, animals } } };
};
