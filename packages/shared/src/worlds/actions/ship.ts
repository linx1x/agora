/**
 * The shipping bin (ADR-053, P17.26): a whole stack put in a bin leaves the bag and is sold at the next
 * day change (06:00). A sale pays half the item's base value, times the quality multiplier of the stack
 * (levels 0, 1, 2, 4 give x1.0, x1.25, x1.5, x2.0; research STARDEW-MECHANICS.md section 15). Only produce
 * is shipped (crops, forage, fish, products, materials, food). The server pays the sale to the world's
 * owner once per day, as one ledger row. Pure: the server applies the plan and the sale.
 */
import { BLOCKS, getBlock } from '../registry';
import type { GameData } from '../gamedata/load';
import { baseItemOf, qualityOfStack } from './farm';
import { noChanges } from './kinds';
import { refuse, type ActionPlanner } from './plan';

/** The item kinds the bin takes (items.json `kind`). Seeds, tools, buildings, animals and machines are not shipped. */
export const SHIPPABLE_KINDS: readonly string[] = ['crop', 'forage', 'fish', 'product', 'material', 'food'];

/** One unit's price at the bin: half the base value (rounded down), times 1 + 0.25 x quality level, rounded down. */
export function shipUnitPrice(value: number, quality: number): number {
  return Math.floor(Math.floor(value / 2) * (1 + 0.25 * quality));
}

/**
 * Puts a whole stack from the bag into the shipping bin in reach. Refusals: `invalid` (no bin on the
 * cell, or an item that is not shipped), `missing` (the stack is not in the bag).
 */
export const planShip: ActionPlanner = (view, req, env) => {
  if (!req.at || !req.item) return refuse('invalid');
  if (!getBlock(BLOCKS, view.cell(req.at.x, req.at.y).decor)?.shipping) return refuse('invalid');
  const item = env.data.itemsById.get(baseItemOf(req.item));
  if (!item || !SHIPPABLE_KINDS.includes(item.kind)) return refuse('invalid');
  const qty = view.inventory.items[req.item] ?? 0;
  if (qty <= 0) return refuse('missing');
  const bin = view.sim.shipping ?? {};
  return {
    ok: true,
    plan: {
      changes: { ...noChanges(), items: { [req.item]: -qty } },
      edits: [],
      sim: { ...view.sim, shipping: { ...bin, [req.item]: (bin[req.item] ?? 0) + qty } },
    },
  };
};

/**
 * The sale of a bin's stacks at a day change: the money they fetch and the units sold. Null when the
 * bin is empty (nothing to pay, nothing to write). A stack whose item is no longer in the data, or is
 * no longer shipped, sells for nothing.
 */
export function sellShipping(bin: Readonly<Record<string, number>>, data: GameData): { money: number; units: number } | null {
  let money = 0;
  let units = 0;
  for (const [key, qty] of Object.entries(bin)) {
    if (qty <= 0) continue;
    const item = data.itemsById.get(baseItemOf(key));
    if (!item || !SHIPPABLE_KINDS.includes(item.kind)) continue;
    money += shipUnitPrice(item.value, qualityOfStack(key)) * qty;
    units += qty;
  }
  return units === 0 ? null : { money, units };
}
