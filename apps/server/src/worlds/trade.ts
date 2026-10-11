/**
 * The swap of a direct trade (P17.29, ADR-053): both sides in one transaction, or nothing. The two
 * accounts are locked in user-id order (two trades between the same people cannot deadlock), each
 * bag must hold what it gives and have room for what it gets, and each side gets a ledger row under a
 * key fixed by the trade id: a second run of the same trade writes nothing.
 */
import {
  applyInventoryChanges,
  baseItemOf,
  checkOffer,
  noChanges,
  swapChanges,
  type GameData,
  type TradeOffer,
  type TradeRefusal,
} from '@agora/shared';
import { ConflictError } from './inventory';
import type { WorldStore } from './worldStore';

export interface TradeSide {
  readonly uid: string;
  readonly offer: TradeOffer;
}

export type SwapResult = { readonly ok: true } | { readonly ok: false; readonly reason: TradeRefusal };

export async function executeTrade(
  store: WorldStore,
  data: GameData,
  req: { id: string; a: TradeSide; b: TradeSide; now: number },
): Promise<SwapResult> {
  if (req.a.uid === req.b.uid) return { ok: false, reason: 'self' };
  for (const side of [req.a, req.b]) {
    const rule = checkOffer(data, side.offer);
    if (!rule.ok) return rule;
  }
  const stackOf = (key: string) => data.itemsById.get(baseItemOf(key))?.stack;
  try {
    return await store.withTxn(async (tx): Promise<SwapResult> => {
      if (await tx.ledgerOf(`trade-${req.id}-${req.a.uid}`)) {
        tx.abort();
        return { ok: false, reason: 'gone' };
      }
      const [first, second] = req.a.uid < req.b.uid ? [req.a, req.b] : [req.b, req.a];
      const accounts = {
        [first.uid]: await tx.accountOf(first.uid, true),
        [second.uid]: await tx.accountOf(second.uid, true),
      };
      for (const [me, them] of [
        [req.a, req.b],
        [req.b, req.a],
      ] as const) {
        const change = swapChanges(me.offer, them.offer);
        const account = accounts[me.uid]!;
        const next = applyInventoryChanges(account.inventory, { ...noChanges(), ...change }, stackOf);
        if (!next.ok) {
          tx.abort();
          return { ok: false, reason: next.reason === 'full' ? 'full' : 'missing' };
        }
        const wrote = await tx.insertLedger({
          key: `trade-${req.id}-${me.uid}`,
          actor: me.uid,
          worldId: null,
          kind: 'trade',
          delta: { ...noChanges(), ...change },
          at: req.now,
        });
        if (!wrote) throw new ConflictError();
        if ((await tx.saveAccount(me.uid, next.inventory, account.rev)) === null) throw new ConflictError();
      }
      return { ok: true };
    });
  } catch (err) {
    if (err instanceof ConflictError) return { ok: false, reason: 'conflict' };
    throw err;
  }
}
