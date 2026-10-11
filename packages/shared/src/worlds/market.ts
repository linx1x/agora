/**
 * The marketplace board (P17.30, ADR-053): people list items from their bag at a price of their own;
 * anyone else buys a listing whole. At the office board only. The rules against inflation and abuse
 * (reviewed at checkpoint N):
 *
 * - a listing fee (`MARKET_FEE_PCT` of the price, at least 1) is paid when listing and never refunded:
 *   a money sink;
 * - at most `MARKET_ACTIVE_MAX` open listings per person;
 * - a listing expires after `MARKET_EXPIRY_MS`: its items go back to the seller's bag;
 * - per office day (Québec), a person may list and buy a few times, more as their account ages
 *   (`dailyLimits`): a fresh account cannot flood the board or empty it.
 *
 * The items leave the seller's bag when listed (held by the listing) and reach the buyer in the same
 * transaction that pays the seller: a buy is atomic, and a listing is sold once.
 */
import type { GameData } from './gamedata/load';
import { baseItemOf } from './actions/farm';

export const MARKET_FEE_PCT = 5;
export const MARKET_ACTIVE_MAX = 5;
export const MARKET_EXPIRY_MS = 3 * 86_400_000;
export const MARKET_PRICE_MAX = 100_000;
/** Of one item in one listing. */
export const MARKET_QTY_MAX = 99;

/** Why a market request did nothing; each has an i18n key `market.refused.<reason>`. */
export const MARKET_REFUSALS = [
  'disabled',
  'rate',
  'range',
  'invalid',
  'restricted',
  'missing',
  'money',
  'full',
  'active',
  'daily',
  'own',
  'gone',
  'conflict',
] as const;
export type MarketRefusal = (typeof MARKET_REFUSALS)[number];

export type ListingState = 'open' | 'sold' | 'expired' | 'cancelled';

export interface Listing {
  readonly id: string;
  readonly sellerId: string;
  /** stack key (an item id, with its quality) */
  readonly item: string;
  readonly qty: number;
  /** for the whole listing */
  readonly price: number;
  readonly fee: number;
  readonly state: ListingState;
  readonly buyerId: string | null;
  readonly createdAt: number;
  readonly expiresAt: number;
  readonly closedAt: number | null;
  /** the office day it was listed, and the one it was bought (for the daily limits) */
  readonly listDay: number;
  readonly buyDay: number | null;
}

/** What a person sees of a listing: never who sells it. */
export interface ListingView {
  readonly id: string;
  readonly item: string;
  readonly qty: number;
  readonly price: number;
  readonly expiresAt: number;
  readonly mine: boolean;
}

export interface MarketLimits {
  readonly list: number;
  readonly buy: number;
}

/** The fee to list at a price: a share of it, at least 1. */
export const listingFee = (price: number): number => Math.max(1, Math.floor((price * MARKET_FEE_PCT) / 100));

/**
 * Listings and purchases a person may make per office day, from the age of their account in the
 * economy (days since their first ledger row): 2 and 5 on day 0, one more listing every 2 days and
 * one more purchase a day, up to 10 and 30.
 */
export function dailyLimits(ageDays: number): MarketLimits {
  const d = Math.max(0, Math.floor(ageDays));
  return { list: Math.min(10, 2 + Math.floor(d / 2)), buy: Math.min(30, 5 + d) };
}

/** Whether an item can be listed (open and limited items, as for trades). */
export function listable(data: GameData, key: string): boolean {
  const item = data.itemsById.get(baseItemOf(key));
  return !!item && (item.category === 'open' || item.category === 'limited');
}

/** The rules for a new listing, before the bag is looked at. */
export function planListing(
  data: GameData,
  req: { item: string; qty: number; price: number },
  state: { active: number; listedToday: number; limits: MarketLimits; money: number },
): { ok: true; fee: number } | { ok: false; reason: MarketRefusal } {
  if (!data.itemsById.get(baseItemOf(req.item))) return { ok: false, reason: 'invalid' };
  if (!listable(data, req.item)) return { ok: false, reason: 'restricted' };
  if (!Number.isInteger(req.qty) || req.qty < 1 || req.qty > MARKET_QTY_MAX) return { ok: false, reason: 'invalid' };
  if (!Number.isInteger(req.price) || req.price < 1 || req.price > MARKET_PRICE_MAX) return { ok: false, reason: 'invalid' };
  if (state.active >= MARKET_ACTIVE_MAX) return { ok: false, reason: 'active' };
  if (state.listedToday >= state.limits.list) return { ok: false, reason: 'daily' };
  const fee = listingFee(req.price);
  if (state.money < fee) return { ok: false, reason: 'money' };
  return { ok: true, fee };
}

/** Whether a listing can be bought now by this person. */
export function canBuy(
  l: Listing,
  buyerId: string,
  now: number,
  state: { boughtToday: number; limits: MarketLimits; money: number },
): { ok: true } | { ok: false; reason: MarketRefusal } {
  if (l.state !== 'open' || now >= l.expiresAt) return { ok: false, reason: 'gone' };
  if (l.sellerId === buyerId) return { ok: false, reason: 'own' };
  if (state.boughtToday >= state.limits.buy) return { ok: false, reason: 'daily' };
  if (state.money < l.price) return { ok: false, reason: 'money' };
  return { ok: true };
}

export function listingView(l: Listing, uid: string): ListingView {
  return { id: l.id, item: l.item, qty: l.qty, price: l.price, expiresAt: l.expiresAt, mine: l.sellerId === uid };
}
