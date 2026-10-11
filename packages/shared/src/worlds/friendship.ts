/**
 * Friendship with the three characters (ADR-053, P17.26): a gift is worth points by the character's taste,
 * from npc-gifts.json (loved, liked, neutral, disliked, hated; anything not listed is neutral). Silver, gold
 * and best quality raise a loved or liked gift by x1.1, x1.25 and x1.5 (research section 13). A character
 * takes one gift a day and two a week (weeks of seven days from day 1). Two gifts in one week earn +10 in
 * the next week, counted with that week's first gift (the research says the following Sunday; a week with
 * no gift does not pay it later). Hearts are 250 points each, up to ten, and the points stop at the cap.
 * Pure: the server keeps the record and applies the result.
 */
import type { GameData } from './gamedata/load';
import type { GiftNpc } from './gamedata/schema';

export type Taste = 'love' | 'like' | 'neutral' | 'dislike' | 'hate';

export const POINTS_PER_HEART = 250;
export const MAX_HEARTS = 10;
export const FRIEND_CAP = 2500;

/** What the server keeps for one character, for one person. */
export interface FriendRecord {
  readonly points: number;
  /** the day of the last gift, 0 when there was none */
  readonly giftDay: number;
  /** the week (see `weekOf`) that `giftsThisWeek` counts */
  readonly week: number;
  readonly giftsThisWeek: number;
}

export const NO_FRIEND: FriendRecord = { points: 0, giftDay: 0, week: 0, giftsThisWeek: 0 };

/** The week a day falls in: seven days each, the first week is days 1 to 7. */
export const weekOf = (day: number): number => Math.floor((day - 1) / 7);

/** The taste a character has for an item (npc-gifts.json); an item not listed is neutral. */
export function tasteOf(data: GameData, npc: GiftNpc, item: string): Taste | null {
  const profile = data.gifts.npcs.find((p) => p.npc === npc);
  if (!profile) return null;
  if (profile.love.includes(item)) return 'love';
  if (profile.like.includes(item)) return 'like';
  if (profile.dislike.includes(item)) return 'dislike';
  if (profile.hate.includes(item)) return 'hate';
  return 'neutral';
}

/** The points one gift is worth. `quality` is the stack's level (0, 1, 2, 4): it counts for loved and liked gifts only. */
export function giftPoints(data: GameData, npc: GiftNpc, item: string, quality = 0): number {
  const taste = tasteOf(data, npc, item);
  if (taste === null) return 0;
  const base = data.gifts.points[taste];
  if (taste !== 'love' && taste !== 'like') return base;
  const multiplier = quality === 4 ? 1.5 : quality === 2 ? 1.25 : quality === 1 ? 1.1 : 1;
  return Math.floor(base * multiplier);
}

/** The hearts of a points total: 250 each, from 0 to ten. */
export function heartsOf(points: number): number {
  return Math.min(MAX_HEARTS, Math.floor(Math.max(0, Math.min(points, FRIEND_CAP)) / POINTS_PER_HEART));
}

export type GiftOutcome =
  | { readonly ok: true; readonly record: FriendRecord; readonly points: number; readonly bonus: number }
  | { readonly ok: false; readonly reason: 'invalid' | 'limit' };

/**
 * Gives an item to a character on a day. Refusals: `invalid` (no such character), `limit` (a gift has
 * already gone to them today, or they have had two this week). A gift that is taken adds its points, and
 * the week bonus when the week before had two gifts and this is its first one.
 */
export function giveGift(data: GameData, record: FriendRecord, npc: GiftNpc, item: string, quality: number, day: number): GiftOutcome {
  if (!data.gifts.npcs.some((p) => p.npc === npc)) return { ok: false, reason: 'invalid' };
  if (record.giftDay === day) return { ok: false, reason: 'limit' };
  const week = weekOf(day);
  const counted = record.week === week ? record.giftsThisWeek : 0;
  if (counted >= data.gifts.limits.perWeek) return { ok: false, reason: 'limit' };
  const bonus = record.week < week && record.giftsThisWeek >= data.gifts.limits.perWeek ? data.gifts.limits.weeklyBonus : 0;
  const points = giftPoints(data, npc, item, quality);
  const total = Math.min(FRIEND_CAP, Math.max(0, record.points + points + bonus));
  return {
    ok: true,
    record: { points: total, giftDay: day, week, giftsThisWeek: counted + 1 },
    points,
    bonus,
  };
}
