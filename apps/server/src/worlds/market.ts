/**
 * The marketplace board (P17.30, ADR-053): list, buy, cancel and the expiry sweep, each one
 * transaction with ledger rows. The items leave the seller when listed and are held by the listing;
 * a buy pays the seller and gives the buyer the items in the same transaction, once (the listing row
 * is locked and must still be open); an expired or cancelled listing gives its items back, once.
 */
import { createHash } from 'node:crypto';
import {
  MARKET_EXPIRY_MS,
  applyInventoryChanges,
  baseItemOf,
  canBuy,
  dailyLimits,
  listingView,
  noChanges,
  officeDayOf,
  planListing,
  type ActionChanges,
  type GameData,
  type Listing,
  type ListingView,
  type MarketLimits,
  type MarketRefusal,
} from '@agora/shared';
import { ConflictError, grantStarterKit } from './inventory';
import type { WorldTxn } from './worldTxn';
import type { WorldStore } from './worldStore';

/** The listings the board shows at once. */
export const BOARD_SIZE = 60;
/** Expired listings given back per sweep. */
const SWEEP = 50;
const DAY_MS = 86_400_000;

export type MarketResult = { readonly ok: true; readonly listing: Listing } | { readonly ok: false; readonly reason: MarketRefusal };

export const listingIdOf = (key: string): string =>
  'm' + createHash('sha256').update(`market:${key}`).digest('hex').slice(0, 15);

async function change(tx: WorldTxn, data: GameData, userId: string, delta: ActionChanges): Promise<'ok' | 'missing' | 'full'> {
  const account = await tx.accountOf(userId, true);
  const next = applyInventoryChanges(account.inventory, delta, (key) => data.itemsById.get(baseItemOf(key))?.stack);
  if (!next.ok) return next.reason === 'full' ? 'full' : 'missing';
  if ((await tx.saveAccount(userId, next.inventory, account.rev)) === null) throw new ConflictError();
  return 'ok';
}

async function limitsOf(tx: WorldTxn, userId: string, now: number): Promise<MarketLimits> {
  const first = await tx.firstSeenOf(userId);
  return dailyLimits(first === null ? 0 : (now - first) / DAY_MS);
}

async function guarded(run: () => Promise<MarketResult>): Promise<MarketResult> {
  try {
    return await run();
  } catch (err) {
    if (err instanceof ConflictError) return { ok: false, reason: 'conflict' };
    throw err;
  }
}

/** Give back the items of expired listings (each once: its return row has a fixed key). */
async function sweepIn(tx: WorldTxn, data: GameData, now: number): Promise<void> {
  for (const l of await tx.expiredListings(now, SWEEP)) {
    // a full bag keeps the listing (expired, not shown) until there is room: nothing is lost
    if ((await change(tx, data, l.sellerId, { ...noChanges(), items: { [l.item]: l.qty } })) !== 'ok') continue;
    const wrote = await tx.insertLedger({
      key: `market-return-${l.id}`,
      actor: l.sellerId,
      worldId: null,
      kind: 'market:return',
      delta: { ...noChanges(), items: { [l.item]: l.qty } },
      at: now,
    });
    if (!wrote) throw new ConflictError();
    await tx.saveListing({ ...l, state: 'expired', closedAt: now });
  }
}

/** Gives back the items of every expired listing (the board runs this before it shows the list). */
export function sweepExpired(store: WorldStore, data: GameData, now: number): Promise<void> {
  return store
    .withTxn((tx) => sweepIn(tx, data, now))
    .catch((err: unknown) => {
      if (!(err instanceof ConflictError)) throw err;
    });
}

/** Put a stack up on the board: the items and the fee leave the bag. */
export function listItem(
  store: WorldStore,
  data: GameData,
  req: { userId: string; item: string; qty: number; price: number; key: string; now: number },
): Promise<MarketResult> {
  return guarded(() =>
    store.withTxn(async (tx): Promise<MarketResult> => {
      const id = listingIdOf(req.key);
      const stored = await tx.ledgerOf(req.key);
      if (stored) {
        tx.abort();
        const l = await tx.listingById(id, false);
        if (!l || stored.actor !== req.userId || stored.kind !== 'market:list') return { ok: false, reason: 'invalid' };
        return { ok: true, listing: l };
      }
      await grantStarterKit(tx, req.userId, data, req.now);
      const day = officeDayOf(req.now);
      const counts = await tx.marketCounts(req.userId, day);
      const account = await tx.accountOf(req.userId, true);
      const plan = planListing(data, req, { ...counts, limits: await limitsOf(tx, req.userId, req.now), money: account.inventory.money });
      if (!plan.ok) {
        tx.abort();
        return plan;
      }
      const delta = { ...noChanges(), items: { [req.item]: -req.qty }, money: -plan.fee };
      const moved = await change(tx, data, req.userId, delta);
      if (moved !== 'ok') {
        tx.abort();
        return { ok: false, reason: 'missing' };
      }
      if (!(await tx.insertLedger({ key: req.key, actor: req.userId, worldId: null, kind: 'market:list', delta, at: req.now })))
        throw new ConflictError();
      const listing: Listing = {
        id,
        sellerId: req.userId,
        item: req.item,
        qty: req.qty,
        price: req.price,
        fee: plan.fee,
        state: 'open',
        buyerId: null,
        createdAt: req.now,
        expiresAt: req.now + MARKET_EXPIRY_MS,
        closedAt: null,
        listDay: day,
        buyDay: null,
      };
      await tx.saveListing(listing);
      return { ok: true, listing };
    }),
  );
}

/** Buy a listing whole: the money goes to the seller and the items to the buyer, once. */
export function buyListing(
  store: WorldStore,
  data: GameData,
  req: { userId: string; id: string; key: string; now: number },
): Promise<MarketResult> {
  return guarded(() =>
    store.withTxn(async (tx): Promise<MarketResult> => {
      const stored = await tx.ledgerOf(req.key);
      if (stored) {
        tx.abort();
        const l = await tx.listingById(req.id, false);
        if (!l || stored.actor !== req.userId || stored.kind !== 'market:buy' || l.buyerId !== req.userId)
          return { ok: false, reason: 'invalid' };
        return { ok: true, listing: l };
      }
      await grantStarterKit(tx, req.userId, data, req.now);
      const l = await tx.listingById(req.id, true);
      if (!l) {
        tx.abort();
        return { ok: false, reason: 'gone' };
      }
      const day = officeDayOf(req.now);
      const counts = await tx.marketCounts(req.userId, day);
      const buyer = await tx.accountOf(req.userId, true);
      const verdict = canBuy(l, req.userId, req.now, {
        boughtToday: counts.boughtToday,
        limits: await limitsOf(tx, req.userId, req.now),
        money: buyer.inventory.money,
      });
      if (!verdict.ok) {
        tx.abort();
        return verdict;
      }
      const gets = { ...noChanges(), items: { [l.item]: l.qty }, money: -l.price };
      const moved = await change(tx, data, req.userId, gets);
      if (moved !== 'ok') {
        tx.abort();
        return { ok: false, reason: moved === 'full' ? 'full' : 'money' };
      }
      const paid = { ...noChanges(), money: l.price };
      if ((await change(tx, data, l.sellerId, paid)) !== 'ok') throw new ConflictError();
      if (!(await tx.insertLedger({ key: req.key, actor: req.userId, worldId: null, kind: 'market:buy', delta: gets, at: req.now })))
        throw new ConflictError();
      if (!(await tx.insertLedger({ key: `market-sale-${l.id}`, actor: l.sellerId, worldId: null, kind: 'market:sale', delta: paid, at: req.now })))
        throw new ConflictError();
      const sold: Listing = { ...l, state: 'sold', buyerId: req.userId, closedAt: req.now, buyDay: day };
      await tx.saveListing(sold);
      return { ok: true, listing: sold };
    }),
  );
}

/** The seller takes a listing back: the items return (the fee does not). */
export function cancelListing(store: WorldStore, data: GameData, req: { userId: string; id: string; now: number }): Promise<MarketResult> {
  return guarded(() =>
    store.withTxn(async (tx): Promise<MarketResult> => {
      const l = await tx.listingById(req.id, true);
      if (!l || l.state !== 'open') {
        tx.abort();
        return { ok: false, reason: 'gone' };
      }
      if (l.sellerId !== req.userId) {
        tx.abort();
        return { ok: false, reason: 'own' };
      }
      const back = { ...noChanges(), items: { [l.item]: l.qty } };
      const moved = await change(tx, data, l.sellerId, back);
      if (moved !== 'ok') {
        tx.abort();
        return { ok: false, reason: 'full' };
      }
      if (!(await tx.insertLedger({ key: `market-return-${l.id}`, actor: l.sellerId, worldId: null, kind: 'market:return', delta: back, at: req.now })))
        throw new ConflictError();
      const closed: Listing = { ...l, state: 'cancelled', closedAt: req.now };
      await tx.saveListing(closed);
      return { ok: true, listing: closed };
    }),
  );
}

export interface BoardView {
  readonly listings: ListingView[];
  readonly limits: MarketLimits;
  readonly listedToday: number;
  readonly boughtToday: number;
  readonly active: number;
}

/** The board as one person sees it: open listings (theirs marked), their limits and counts today. */
export function boardOf(store: WorldStore, userId: string, now: number): Promise<BoardView> {
  return store.withTxn(async (tx) => {
    const listings = (await tx.openListings(BOARD_SIZE)).filter((l) => l.expiresAt > now);
    const counts = await tx.marketCounts(userId, officeDayOf(now));
    const limits = await limitsOf(tx, userId, now);
    tx.abort();
    return { listings: listings.map((l) => listingView(l, userId)), limits, ...counts };
  });
}
