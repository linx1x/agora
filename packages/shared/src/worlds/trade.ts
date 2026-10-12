/**
 * Direct trading (P17.29, ADR-053): two people side by side (in the same world, or near each other on
 * the office floor) each put up stacks and money; both confirm the exact state they see (its revision);
 * any change to either side clears both confirmations; then the server swaps both sides in one
 * transaction with a ledger row per side, or not at all.
 *
 * Category rules (ADR-053 item categories): `open` items trade freely; `limited` items at most
 * `TRADE_LIMITED_MAX` of each per trade; `restricted` (tools, machines) and `account-bound` never.
 */
import type { GameData } from './gamedata/load';
import { baseItemOf } from './actions/farm';

/** Different stacks one side may offer. */
export const TRADE_STACKS_MAX = 9;
/** Money one side may offer in one trade. */
export const TRADE_MONEY_MAX = 10_000;
/** Of each `limited` item, per trade. */
export const TRADE_LIMITED_MAX = 5;
/** Of any stack, per trade (a whole stack at most). */
export const TRADE_QTY_MAX = 999;
/** How far apart two people may trade on the office floor (tiles) and in a world (cells). */
export const TRADE_RANGE_TILES = 4;

/** Why a trade step did nothing; each has an i18n key `trade.refused.<reason>`. */
export const TRADE_REFUSALS = [
  'disabled',
  'rate',
  'self',
  'far',
  'busy',
  'gone',
  'invalid',
  'restricted',
  'limit',
  'missing',
  'full',
  'stale',
  'conflict',
] as const;
export type TradeRefusal = (typeof TRADE_REFUSALS)[number];

/** Why a trade ended. */
export const TRADE_ENDS = ['done', 'cancelled', 'declined', 'gone'] as const;
export type TradeEnd = (typeof TRADE_ENDS)[number];

export interface TradeOffer {
  readonly items: Readonly<Record<string, number>>;
  readonly money: number;
}

export const EMPTY_OFFER: TradeOffer = { items: {}, money: 0 };

/** Whether an offer follows the rules (it does not look at the bag: the swap checks that). */
export function checkOffer(data: GameData, offer: TradeOffer): { ok: true } | { ok: false; reason: TradeRefusal } {
  if (!Number.isInteger(offer.money) || offer.money < 0 || offer.money > TRADE_MONEY_MAX)
    return { ok: false, reason: 'invalid' };
  const keys = Object.keys(offer.items);
  if (keys.length > TRADE_STACKS_MAX) return { ok: false, reason: 'limit' };
  for (const key of keys) {
    const n = offer.items[key]!;
    if (!Number.isInteger(n) || n < 1 || n > TRADE_QTY_MAX) return { ok: false, reason: 'invalid' };
    const item = data.itemsById.get(baseItemOf(key));
    if (!item) return { ok: false, reason: 'invalid' };
    if (item.category === 'restricted' || item.category === 'account-bound') return { ok: false, reason: 'restricted' };
    if (item.category === 'limited' && n > TRADE_LIMITED_MAX) return { ok: false, reason: 'limit' };
  }
  return { ok: true };
}

/** One side's change to its own bag in the swap: what it gives leaves, what it gets comes in. */
export function swapChanges(gives: TradeOffer, gets: TradeOffer): { items: Record<string, number>; money: number } {
  const items: Record<string, number> = {};
  for (const [k, n] of Object.entries(gives.items)) items[k] = (items[k] ?? 0) - n;
  for (const [k, n] of Object.entries(gets.items)) items[k] = (items[k] ?? 0) + n;
  for (const k of Object.keys(items)) if (items[k] === 0) delete items[k];
  return { items, money: gets.money - gives.money };
}

/** Whether an item can be offered at all (the trade panel lists only these). */
export function tradeable(data: GameData, key: string): boolean {
  const item = data.itemsById.get(baseItemOf(key));
  return !!item && (item.category === 'open' || item.category === 'limited');
}
