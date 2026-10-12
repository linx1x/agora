/**
 * Accounts in personal worlds (ADR-053, P17.20): the starter kit, granted once per account through
 * the ledger, and the read of an account's inventory, energy and money. Every write goes through
 * `WorldTxn`, so a grant and its ledger row land together or not at all.
 */
import {
  applyInventoryChanges,
  noChanges,
  settleDay,
  type GameData,
  type Inventory,
} from '@agora/shared';
import type { WorldTxn } from './worldTxn';

/** The key of an account's starter grant. The ledger key is unique, so it is granted once. */
export const starterKey = (uid: string): string => `starter:${uid}`;

/** A rule or write that found the rows changed under it. Nothing is written; the action may be retried. */
export class ConflictError extends Error {
  constructor() {
    super('the account or the world changed during the action');
    this.name = 'ConflictError';
  }
}

/**
 * Grants the starter kit to an account, once. Returns false when it was granted before (the ledger
 * row exists). Must run inside a transaction.
 */
export async function grantStarterKit(tx: WorldTxn, uid: string, data: GameData, now: number): Promise<boolean> {
  const kit = data.progression.starterKit;
  const changes = { ...noChanges(), items: { ...kit.items }, money: kit.money };
  const granted = await tx.insertLedger({
    key: starterKey(uid),
    actor: uid,
    worldId: null,
    kind: 'starter',
    delta: changes,
    at: now,
  });
  if (!granted) return false;
  const account = await tx.accountOf(uid, true);
  const next = applyInventoryChanges(account.inventory, changes, (id) => data.itemsById.get(id)?.stack);
  // the kit must fit an empty inventory: a data error otherwise, so refuse loudly
  if (!next.ok) throw new Error(`starter kit does not fit: ${next.reason}`);
  if ((await tx.saveAccount(uid, next.inventory, account.rev)) === null) throw new ConflictError();
  return true;
}

export interface AccountView {
  readonly inventory: Inventory;
  readonly energy: number;
  readonly maxEnergy: number;
}

/**
 * An account as the player sees it, on game day `day`. Energy starts full for an account with no
 * progress row yet, and is read as settled to `day` (the rollover is written by energy.ts).
 */
export async function accountView(tx: WorldTxn, uid: string, data: GameData, lock: boolean, day: number): Promise<AccountView> {
  const maxEnergy = data.progression.energy.max;
  const account = await tx.accountOf(uid, lock);
  const progress = await tx.progressOf(uid, lock);
  const energy = progress
    ? settleDay({ energy: progress.energy, day: progress.day, rest: progress.rest }, day, maxEnergy).energy
    : maxEnergy;
  return { inventory: account.inventory, energy, maxEnergy };
}
