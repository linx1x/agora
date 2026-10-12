/**
 * Energy across the day's end (ADR-053, P17.23): who is settled to which day, and the one place the
 * rollover is written. Every write goes through `WorldTxn`, in the caller's transaction.
 *
 * Two paths reach the same result. A person in the world when the day ends is settled by the room
 * (`settleEnergy` with `live`): passing out away from home costs money. Anyone else is settled the
 * next time they act or join (`settleEnergy` without `live`, or the read in `accountView`): the same
 * energy, no money lost. The rule itself is `settleDay` in shared (rest.ts).
 */
import { noChanges, passOutFine, settleDay, type EnergyState, type GameData } from '@agora/shared';
import type { ProgressRow, WorldTxn } from './worldTxn';
import { ConflictError } from './inventory';

/** The ledger key of a person's pass-out fine on a day: one fine per person per day. */
export const passOutKey = (uid: string, day: number): string => `passout:${uid}:${day}`;

/** A stored progress row as the energy state, settled to nothing yet. No row: full energy, on `day`. */
export function energyOf(row: ProgressRow | null, max: number, day: number): EnergyState {
  return row ? { energy: row.energy, day: row.day, rest: row.rest } : { energy: max, day, rest: null };
}

/**
 * Settles a person's energy to `day` and saves it, once: a second call on the same day finds it
 * settled and writes nothing. `live` is set for someone in the world when the day ended: they pass
 * out where they stand, and away from home (outside progression.home) that costs a share of money,
 * unless they were in bed.
 */
export async function settleEnergy(
  tx: WorldTxn,
  uid: string,
  data: GameData,
  day: number,
  now: number,
  live: { readonly worldId: string; readonly awayFromHome: boolean } | null,
): Promise<EnergyState> {
  const max = data.progression.energy.max;
  const row = await tx.progressOf(uid, true);
  const current = energyOf(row, max, day);
  if (current.day >= day) return current;
  if (live?.awayFromHome && current.rest === null) {
    await chargePassOut(tx, uid, data, day, now, live.worldId);
  }
  const next = settleDay(current, day, max);
  await tx.saveProgress(uid, { skills: row?.skills ?? {}, energy: next.energy, day: next.day, rest: next.rest });
  return next;
}

/** The fine for passing out away from home, through the ledger so it is charged once for the day. */
async function chargePassOut(tx: WorldTxn, uid: string, data: GameData, day: number, now: number, worldId: string): Promise<void> {
  const { moneyPct, moneyCap } = data.progression.passOut;
  const account = await tx.accountOf(uid, true);
  const fine = passOutFine(account.inventory.money, moneyPct, moneyCap);
  if (fine === 0) return;
  const inserted = await tx.insertLedger({
    key: passOutKey(uid, day),
    actor: uid,
    worldId,
    kind: 'passout',
    delta: { ...noChanges(), money: -fine },
    at: now,
  });
  if (!inserted) return;
  const inventory = { ...account.inventory, money: account.inventory.money - fine };
  if ((await tx.saveAccount(uid, inventory, account.rev)) === null) throw new ConflictError();
}
