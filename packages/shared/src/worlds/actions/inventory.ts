/**
 * The inventory of an account (ADR-053, "Accounts"): item stacks and money. Pure: every change is
 * one `applyInventoryChanges` call that either returns the new inventory or says why not, so the server
 * writes exactly what the rules approved and the ledger can reconcile the totals.
 */
import type { ActionChanges } from './kinds';

/** Distinct stacks one account can hold. Our rule (tunable); a new stack past it is `full`. */
export const INVENTORY_SLOTS = 36;

export interface Inventory {
  /** stack key to quantity; no zero entries */
  readonly items: Readonly<Record<string, number>>;
  readonly money: number;
}

export const emptyInventory = (): Inventory => ({ items: {}, money: 0 });

/** The stack size of an item, or undefined for an unknown item. */
export type StackOf = (id: string) => number | undefined;

export type InventoryRefusal = 'full' | 'missing' | 'invalid';

export type InventoryResult = { readonly ok: true; readonly inventory: Inventory } | { readonly ok: false; readonly reason: InventoryRefusal };

/**
 * The inventory after `changes` (items and money only). Refused, with nothing changed, when an item
 * is unknown (`invalid`), a stack would go below zero or money would (`missing`), or a stack or the
 * slot count would pass its limit (`full`).
 */
export function applyInventoryChanges(inv: Inventory, changes: Pick<ActionChanges, 'items' | 'money'>, stackOf: StackOf): InventoryResult {
  const items: Record<string, number> = { ...inv.items };
  for (const [id, delta] of Object.entries(changes.items)) {
    const limit = stackOf(id);
    if (limit === undefined || !Number.isInteger(delta)) return { ok: false, reason: 'invalid' };
    const next = (items[id] ?? 0) + delta;
    if (next < 0) return { ok: false, reason: 'missing' };
    if (next > limit) return { ok: false, reason: 'full' };
    if (next === 0) delete items[id];
    else items[id] = next;
  }
  if (Object.keys(items).length > INVENTORY_SLOTS) return { ok: false, reason: 'full' };
  const money = inv.money + changes.money;
  if (money < 0) return { ok: false, reason: 'missing' };
  return { ok: true, inventory: { items, money } };
}

/** How many of `id` the inventory holds. */
export const countOf = (inv: Inventory, id: string): number => inv.items[id] ?? 0;

/** The sum of every stack and the money, for conservation checks. */
export function totalsOf(inv: Inventory): { items: number; money: number } {
  let items = 0;
  for (const qty of Object.values(inv.items)) items += qty;
  return { items, money: inv.money };
}
