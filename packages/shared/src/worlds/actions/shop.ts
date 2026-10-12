/**
 * The shop board (ADR-053, P17.25): buy one item with money at a shop block. A price is the stable
 * `buy` of items.json (no dynamic pricing). Restricted and account-bound items are not sold here.
 * The change to the bag and the money is one plan, so the ledger row and the account agree.
 */
import type { GameData } from '../gamedata/load';
import { BLOCKS, getBlock } from '../registry';
import { noChanges } from './kinds';
import { refuse, type ActionPlanner } from './plan';

/** The item categories a shop board sells (items.json `category`). */
export const SOLD_CATEGORIES: readonly string[] = ['open', 'limited'];

/** What a shop board sells, in items.json order: each item with its stable price (what the board shows). */
export function stockOf(data: GameData): readonly { readonly id: string; readonly price: number }[] {
  return data.items.flatMap((item) => (item.buy === null || !SOLD_CATEGORIES.includes(item.category) ? [] : [{ id: item.id, price: item.buy }]));
}

/** Buy one of an item at a shop board in reach. Refusals: `invalid` (no shop, not for sale), `money`. */
export const planBuy: ActionPlanner = (view, req, env) => {
  if (!req.at || !req.item) return refuse('invalid');
  if (!getBlock(BLOCKS, view.cell(req.at.x, req.at.y).decor)?.shop) return refuse('invalid');
  const item = env.data.itemsById.get(req.item);
  if (!item || item.id !== req.item || item.buy === null || !SOLD_CATEGORIES.includes(item.category)) return refuse('invalid');
  if (view.inventory.money < item.buy) return refuse('money');
  return {
    ok: true,
    plan: { changes: { ...noChanges(), items: { [item.id]: 1 }, money: -item.buy }, edits: [], sim: view.sim },
  };
};
