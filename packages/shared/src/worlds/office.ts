/**
 * The office side of shop and friendship (P17.26b, ADR-053). Two account actions that happen outside
 * any world: a gift to a character (Zoé, Félix, Théo) and a purchase at the office shop board. Pure
 * rules; the server checks place and range, runs them in one transaction and writes the ledger.
 *
 * The characters live a real workday in the office (ADR-042), so their gift limits count Québec
 * calendar days (`officeDayOf`): one gift a day and two a week per character, as in `friendship.ts`.
 */
import type { GameData } from './gamedata/load';
import type { GiftNpc } from './gamedata/schema';
import { GIFT_NPCS } from './gamedata/schema';
import { baseItemOf } from './actions/farm';
import { noChanges, type ActionChanges } from './actions/kinds';
import { SOLD_CATEGORIES } from './actions/shop';

/** Why an office gift or purchase is refused (`gift:result` / `office:bought`); each has an i18n key. */
export const OFFICE_REFUSALS = [
  'disabled',
  'rate',
  'gone',
  'range',
  'zone',
  'invalid',
  'missing',
  'limit',
  'money',
  'full',
  'conflict',
] as const;
export type OfficeRefusal = (typeof OFFICE_REFUSALS)[number];

/** Item kinds a character accepts as a gift: things one can hand over, not tools, buildings or animals. */
export const GIFT_KINDS: readonly string[] = [
  'seed',
  'crop',
  'forage',
  'material',
  'product',
  'food',
  'fish',
];

const TZ = 'America/Toronto';
const DAY_MS = 86_400_000;
const ymd = new Intl.DateTimeFormat('en-CA', {
  timeZone: TZ,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

/**
 * The office day of a moment: the Québec calendar date as a day number (1 on 1970-01-01). It changes at
 * local midnight, whatever the time zone of the server.
 */
export function officeDayOf(nowMs: number): number {
  const [y, m, d] = ymd.format(new Date(nowMs)).split('-').map(Number) as [number, number, number];
  return Math.round(Date.UTC(y, m - 1, d) / DAY_MS) + 1;
}

/** The gift character of a character id (`npc:zoe` or `zoe`), or null for anyone else. */
export function giftNpcOf(id: string): GiftNpc | null {
  const bare = id.startsWith('npc:') ? id.slice(4) : id;
  return (GIFT_NPCS as readonly string[]).includes(bare) ? (bare as GiftNpc) : null;
}

/** Whether a stack (an item key, possibly with its quality `~n`) can be given to a character. */
export function giftable(data: GameData, key: string): boolean {
  const item = data.itemsById.get(baseItemOf(key));
  return !!item && item.category !== 'account-bound' && GIFT_KINDS.includes(item.kind);
}

export type OfficePlan =
  | { readonly ok: true; readonly changes: ActionChanges }
  | { readonly ok: false; readonly reason: OfficeRefusal };

/** Buy one item at the office shop board: the same stock and stable prices as a world's board (`stockOf`). */
export function planOfficeBuy(data: GameData, money: number, itemId: string): OfficePlan {
  const item = data.itemsById.get(itemId);
  if (!item || item.buy === null || !SOLD_CATEGORIES.includes(item.category))
    return { ok: false, reason: 'invalid' };
  if (money < item.buy) return { ok: false, reason: 'money' };
  return { ok: true, changes: { ...noChanges(), items: { [item.id]: 1 }, money: -item.buy } };
}
