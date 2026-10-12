/**
 * Energy outside the tools (ADR-053, P17.23): food, the bed and the day's end. Pure.
 *
 * A game day runs from 06:00 to 02:00 and the next day starts at 06:00 (clock.ts), so the 02:00
 * pass-out and the morning are one moment: the rollover. What the night does to energy:
 * - Bed (research section 9): in bed by midnight, the next morning restores all of it. After
 *   midnight the restore falls: 2.5 points per 10 clock minutes, half of it gone at 02:00. Going to
 *   bed at 0 energy halves the restore again. The restore never goes below 1.
 * - Pass out (still up at the rollover): half the energy is restored, a quarter at 0 energy. Away
 *   from home it also costs a share of the money (progression.json passOut).
 * - Nobody in the world at the rollover is settled the next time they act or join: as if they had
 *   passed out at home, with no money lost.
 */
import { noChanges } from './kinds';
import { refuse, type ActionPlanner } from './plan';
import { countOf } from './inventory';
import { baseItemOf, qualityOfStack } from './farm';

/** The share of max energy the next morning restores; the bed and the pass-out set it. */
export interface RestState {
  readonly fraction: number;
}

/** A person's energy and where it stands in the day. `rest` is set while they sleep (until the rollover). */
export interface EnergyState {
  readonly energy: number;
  /** the game day the energy was last settled on */
  readonly day: number;
  readonly rest: RestState | null;
}

/** The bed clock, as hhmm (research section 9): 2400 is midnight and 2600 is 02:00, the rollover. */
export const BED_MIDNIGHT = 2400;
export const BED_LATEST = 2600;
/** The restore falls by 1 over this many hhmm units after midnight: 10 units (10 clock minutes) cost 2.5 points. */
export const BED_SPAN = 400;
export const EXHAUSTED_SHARE = 0.5;
export const PASS_OUT_SHARE = 0.5;

/** The share of max energy a bed restores for a bedtime, read off the game clock (hours 0 to 5 are after midnight). */
export function bedShare(hour: number, minute: number): number {
  const hhmm = (hour < 6 ? hour + 24 : hour) * 100 + minute;
  const cut = (Math.min(hhmm, BED_LATEST) - BED_MIDNIGHT) / BED_SPAN;
  return 1 - Math.max(0, cut);
}

/** The factor exhaustion puts on a restore: no energy left halves it. */
export const exhaustedShare = (energy: number): number => (energy <= 0 ? EXHAUSTED_SHARE : 1);

/** The energy a restore gives: a share of max, at least 1, never above max. */
export const restoredEnergy = (max: number, share: number): number =>
  Math.min(max, Math.max(1, Math.round(max * share)));

/** Food restores ceil(2.5 x edibility) + quality x edibility (research section 9). */
export function foodRestore(edibility: number, quality: number): number {
  return Math.ceil(2.5 * edibility) + quality * edibility;
}

/** What passing out at the rollover sets as the rest (the same whether or not the person is in the world). */
export const passOutRest = (energy: number): RestState => ({ fraction: PASS_OUT_SHARE * exhaustedShare(energy) });

/**
 * The energy state on `today`. The same state when it is already settled for that day. Otherwise
 * the rollover has passed: the rest the person set (or the pass-out, for nobody who set one)
 * restores the energy and the rest is over. Each further day away is a pass-out at the energy the
 * one before left, which is never 0, so it is a half.
 */
export function settleDay(state: EnergyState, today: number, max: number): EnergyState {
  if (state.day >= today) return state;
  const first = restoredEnergy(max, state.rest?.fraction ?? passOutRest(state.energy).fraction);
  if (today - state.day < 2) return { energy: first, day: today, rest: null };
  return { energy: restoredEnergy(max, PASS_OUT_SHARE), day: today, rest: null };
}

/** The money lost to passing out away from home: a share of the money, up to the cap. */
export function passOutFine(money: number, pct: number, cap: number): number {
  return Math.max(0, Math.min(cap, Math.floor((money * pct) / 100)));
}

/** Eats one food from the bag: the energy it gives, never above max. A stack of another quality eats for more. */
export const planEat: ActionPlanner = (view, req, env) => {
  if (!req.item) return refuse('invalid');
  const item = env.data.itemsById.get(baseItemOf(req.item));
  if (item?.edibility === undefined) return refuse('invalid');
  if (countOf(view.inventory, req.item) < 1) return refuse('missing');
  const max = env.data.progression.energy.max;
  const restore = foodRestore(item.edibility, qualityOfStack(req.item));
  const gain = Math.min(max, view.energy + restore) - view.energy;
  return {
    ok: true,
    plan: { changes: { ...noChanges(), items: { [req.item]: -1 }, energy: gain }, edits: [], sim: view.sim },
  };
};

/** Goes to bed in a bed cell: the rest is set now and restores energy at the rollover. */
export const planSleep: ActionPlanner = (view, req) => {
  if (!req.at) return refuse('invalid');
  if (view.cell(req.at.x, req.at.y).decor !== 'bed') return refuse('invalid');
  const fraction = bedShare(view.time.hour, view.time.minute) * exhaustedShare(view.energy);
  return { ok: true, plan: { changes: noChanges(), edits: [], sim: view.sim, rest: { fraction } } };
};
