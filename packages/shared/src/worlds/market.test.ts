import { describe, expect, it } from 'vitest';
import { loadGameData } from './gamedata';
import {
  MARKET_ACTIVE_MAX,
  canBuy,
  dailyLimits,
  listable,
  listingFee,
  listingView,
  planListing,
  type Listing,
} from './market';

const data = loadGameData();
const CROP = data.items.find((i) => i.category === 'open' && i.kind === 'crop')!.id;
const TOOL = data.items.find((i) => i.category === 'restricted')!.id;
const fresh = { active: 0, listedToday: 0, limits: dailyLimits(0), money: 100 };

const listing: Listing = {
  id: 'm1',
  sellerId: 'seller',
  item: CROP,
  qty: 3,
  price: 40,
  fee: 2,
  state: 'open',
  buyerId: null,
  createdAt: 0,
  expiresAt: 1000,
  closedAt: null,
  listDay: 1,
  buyDay: null,
};

describe('the marketplace board (P17.30)', () => {
  it('the fee is a share of the price, at least 1', () => {
    expect(listingFee(1)).toBe(1);
    expect(listingFee(100)).toBe(5);
    expect(listingFee(1999)).toBe(99);
  });

  it('daily limits grow with the account’s age, up to a cap', () => {
    expect(dailyLimits(0)).toEqual({ list: 2, buy: 5 });
    expect(dailyLimits(4)).toEqual({ list: 4, buy: 9 });
    expect(dailyLimits(365)).toEqual({ list: 10, buy: 30 });
  });

  it('lists open and limited items only, with sane numbers, under the active and daily limits, with the fee', () => {
    expect(planListing(data, { item: CROP, qty: 3, price: 40 }, fresh)).toEqual({ ok: true, fee: 2 });
    expect(listable(data, TOOL)).toBe(false);
    expect(planListing(data, { item: TOOL, qty: 1, price: 40 }, fresh)).toEqual({ ok: false, reason: 'restricted' });
    expect(planListing(data, { item: 'nope', qty: 1, price: 40 }, fresh)).toEqual({ ok: false, reason: 'invalid' });
    expect(planListing(data, { item: CROP, qty: 0, price: 40 }, fresh)).toEqual({ ok: false, reason: 'invalid' });
    expect(planListing(data, { item: CROP, qty: 1, price: 0 }, fresh)).toEqual({ ok: false, reason: 'invalid' });
    expect(planListing(data, { item: CROP, qty: 1, price: 40 }, { ...fresh, active: MARKET_ACTIVE_MAX })).toEqual({
      ok: false,
      reason: 'active',
    });
    expect(planListing(data, { item: CROP, qty: 1, price: 40 }, { ...fresh, listedToday: 2 })).toEqual({
      ok: false,
      reason: 'daily',
    });
    expect(planListing(data, { item: CROP, qty: 1, price: 400 }, { ...fresh, money: 19 })).toEqual({
      ok: false,
      reason: 'money',
    });
  });

  it('a listing is bought by someone else, before it expires, within their daily buys and money', () => {
    const state = { boughtToday: 0, limits: dailyLimits(0), money: 40 };
    expect(canBuy(listing, 'buyer', 10, state)).toEqual({ ok: true });
    expect(canBuy(listing, 'seller', 10, state)).toEqual({ ok: false, reason: 'own' });
    expect(canBuy(listing, 'buyer', 1000, state)).toEqual({ ok: false, reason: 'gone' });
    expect(canBuy({ ...listing, state: 'sold' }, 'buyer', 10, state)).toEqual({ ok: false, reason: 'gone' });
    expect(canBuy(listing, 'buyer', 10, { ...state, boughtToday: 5 })).toEqual({ ok: false, reason: 'daily' });
    expect(canBuy(listing, 'buyer', 10, { ...state, money: 39 })).toEqual({ ok: false, reason: 'money' });
  });

  it('a person sees whether a listing is theirs, never who sells it', () => {
    expect(listingView(listing, 'buyer')).toEqual({ id: 'm1', item: CROP, qty: 3, price: 40, expiresAt: 1000, mine: false });
    expect(JSON.stringify(listingView(listing, 'buyer'))).not.toContain('seller');
  });
});
