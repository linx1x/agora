/**
 * The office side of shop and friendship (P17.26b, ADR-053): a gift to a character and a purchase at
 * the office shop board. Account actions outside any world, so they lock the account row (not a world
 * row), and follow the world-action rules: the server decides, one transaction, a ledger row under the
 * client's key (a resend after a reconnect replays the first answer, it never counts twice), and a
 * refusal changes nothing. The room checks the place and the range before calling in.
 */
import {
  applyInventoryChanges,
  baseItemOf,
  giftable,
  giveGift,
  heartsOf,
  noChanges,
  planOfficeBuy,
  qualityOfStack,
  tasteOf,
  GIFT_NPCS,
  NO_FRIEND,
  type FriendRecord,
  type GameData,
  type GiftNpc,
  type OfficeRefusal,
  type Taste,
} from '@agora/shared';
import { ConflictError, grantStarterKit } from './inventory';
import type { WorldStore } from './worldStore';

export type GiftResult =
  | {
      readonly ok: true;
      readonly replayed: boolean;
      readonly taste: Taste;
      readonly hearts: Record<string, number>;
    }
  | { readonly ok: false; readonly reason: OfficeRefusal };

export type BuyResult =
  | { readonly ok: true; readonly replayed: boolean }
  | { readonly ok: false; readonly reason: OfficeRefusal };

/** The ledger kind of a gift to a character (one kind per character, so a replay checks the target too). */
export const giftKind = (npc: GiftNpc): string => `gift:${npc}`;
export const OFFICE_BUY_KIND = 'office:buy';

/** Hearts per character from a person's friendship records (every character listed, 0 when none). */
export function heartsFrom(
  records: Readonly<Record<string, FriendRecord>>,
): Record<string, number> {
  const out: Record<string, number> = {};
  for (const npc of GIFT_NPCS) out[npc] = heartsOf(records[npc]?.points ?? 0);
  return out;
}

/** A person's hearts with each character. */
export function heartsOfUser(store: WorldStore, userId: string): Promise<Record<string, number>> {
  return store.withTxn(async (tx) => {
    const records = await tx.friendsOf(userId, false);
    tx.abort();
    return heartsFrom(records);
  });
}

/**
 * A person's bag and money as the office shows them (the same `world:inv` as in a world). Someone who
 * never went into a world gets the starter kit here too (once, through the ledger).
 */
export function officeInventory(
  store: WorldStore,
  userId: string,
  data: GameData,
  now: number,
): Promise<{ items: Record<string, number>; money: number; energy: number; maxEnergy: number }> {
  return store.withTxn(async (tx) => {
    await grantStarterKit(tx, userId, data, now);
    const account = await tx.accountOf(userId, false);
    const progress = await tx.progressOf(userId, false);
    const maxEnergy = data.progression.energy.max;
    return {
      items: { ...account.inventory.items },
      money: account.inventory.money,
      energy: progress?.energy ?? maxEnergy,
      maxEnergy,
    };
  });
}

/**
 * Gives one of a stack to a character on an office day. Refusals: `invalid` (not giftable), `missing`
 * (not in the bag), `limit` (already one today, or two this week), `conflict` (the account changed meanwhile).
 */
export async function officeGift(
  store: WorldStore,
  data: GameData,
  req: { userId: string; npc: GiftNpc; item: string; key: string; day: number; now: number },
): Promise<GiftResult> {
  try {
    return await store.withTxn(async (tx): Promise<GiftResult> => {
      const stored = await tx.ledgerOf(req.key);
      if (stored) {
        tx.abort();
        // the first answer again: the same key from the same person for the same character
        if (stored.actor !== req.userId || stored.kind !== giftKind(req.npc))
          return { ok: false, reason: 'invalid' };
        const given = Object.keys(stored.delta.items)[0] ?? req.item;
        return {
          ok: true,
          replayed: true,
          taste: tasteOf(data, req.npc, baseItemOf(given)) ?? 'neutral',
          hearts: heartsFrom(await tx.friendsOf(req.userId, false)),
        };
      }
      if (!giftable(data, req.item)) {
        tx.abort();
        return { ok: false, reason: 'invalid' };
      }
      const account = await tx.accountOf(req.userId, true);
      const friends = await tx.friendsOf(req.userId, true);
      const before = friends[req.npc] ?? NO_FRIEND;
      const outcome = giveGift(
        data,
        before,
        req.npc,
        baseItemOf(req.item),
        qualityOfStack(req.item),
        req.day,
      );
      if (!outcome.ok) {
        tx.abort();
        return { ok: false, reason: outcome.reason };
      }
      const changes = { ...noChanges(), items: { [req.item]: -1 } };
      const next = applyInventoryChanges(
        account.inventory,
        changes,
        (key) => data.itemsById.get(baseItemOf(key))?.stack,
      );
      if (!next.ok) {
        tx.abort();
        return {
          ok: false,
          reason:
            next.reason === 'full' ? 'full' : next.reason === 'missing' ? 'missing' : 'invalid',
        };
      }
      if (
        !(await tx.insertLedger({
          key: req.key,
          actor: req.userId,
          worldId: null,
          kind: giftKind(req.npc),
          delta: changes,
          at: req.now,
        }))
      )
        throw new ConflictError();
      if ((await tx.saveAccount(req.userId, next.inventory, account.rev)) === null)
        throw new ConflictError();
      await tx.saveFriend(req.userId, req.npc, outcome.record);
      return {
        ok: true,
        replayed: false,
        taste: tasteOf(data, req.npc, baseItemOf(req.item)) ?? 'neutral',
        hearts: heartsFrom({ ...friends, [req.npc]: outcome.record }),
      };
    });
  } catch (err) {
    if (err instanceof ConflictError) return { ok: false, reason: 'conflict' };
    throw err;
  }
}

/** Buys one item at the office shop board. Refusals: `invalid` (not for sale), `money`, `full`, `conflict`. */
export async function officeBuy(
  store: WorldStore,
  data: GameData,
  req: { userId: string; item: string; key: string; now: number },
): Promise<BuyResult> {
  try {
    return await store.withTxn(async (tx): Promise<BuyResult> => {
      const stored = await tx.ledgerOf(req.key);
      if (stored) {
        tx.abort();
        if (stored.actor !== req.userId || stored.kind !== OFFICE_BUY_KIND)
          return { ok: false, reason: 'invalid' };
        return { ok: true, replayed: true };
      }
      await grantStarterKit(tx, req.userId, data, req.now);
      const account = await tx.accountOf(req.userId, true);
      const plan = planOfficeBuy(data, account.inventory.money, req.item);
      if (!plan.ok) {
        tx.abort();
        return plan;
      }
      const next = applyInventoryChanges(
        account.inventory,
        plan.changes,
        (key) => data.itemsById.get(baseItemOf(key))?.stack,
      );
      if (!next.ok) {
        tx.abort();
        return {
          ok: false,
          reason: next.reason === 'full' ? 'full' : next.reason === 'missing' ? 'money' : 'invalid',
        };
      }
      if (
        !(await tx.insertLedger({
          key: req.key,
          actor: req.userId,
          worldId: null,
          kind: OFFICE_BUY_KIND,
          delta: plan.changes,
          at: req.now,
        }))
      )
        throw new ConflictError();
      if ((await tx.saveAccount(req.userId, next.inventory, account.rev)) === null)
        throw new ConflictError();
      return { ok: true, replayed: false };
    });
  } catch (err) {
    if (err instanceof ConflictError) return { ok: false, reason: 'conflict' };
    throw err;
  }
}
