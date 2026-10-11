import { describe, expect, it } from 'vitest';
import { loadGameData } from './gamedata/load';
import { FRIEND_CAP, NO_FRIEND, giftPoints, giveGift, heartsOf, tasteOf, weekOf, type FriendRecord } from './friendship';

const data = loadGameData();

describe('the taste of a character (P17.26, npc-gifts.json)', () => {
  it('reads loved, liked, disliked and hated items from the character\'s list, and anything else is neutral', () => {
    expect(tasteOf(data, 'zoe', 'honey_bread')).toBe('love');
    expect(tasteOf(data, 'zoe', 'dawn_salad')).toBe('like');
    expect(tasteOf(data, 'zoe', 'stone')).toBe('dislike');
    expect(tasteOf(data, 'zoe', 'fallen_nut')).toBe('hate');
    expect(tasteOf(data, 'zoe', 'dawn_radish')).toBe('neutral');
  });

  it('is per character: the same item can be loved by one and disliked by another', () => {
    expect(tasteOf(data, 'felix', 'sun_jam')).toBe('dislike');
    expect(tasteOf(data, 'zoe', 'sun_jam')).toBe('love');
  });
});

describe('the points of a gift (P17.26, research section 13)', () => {
  it('is worth the taste\'s base points: loved 80, liked 45, neutral 20, disliked -20, hated -40', () => {
    expect(giftPoints(data, 'zoe', 'honey_bread')).toBe(80);
    expect(giftPoints(data, 'zoe', 'dawn_salad')).toBe(45);
    expect(giftPoints(data, 'zoe', 'dawn_radish')).toBe(20);
    expect(giftPoints(data, 'zoe', 'stone')).toBe(-20);
    expect(giftPoints(data, 'zoe', 'fallen_nut')).toBe(-40);
  });

  it('raises a loved or liked gift by its quality (silver x1.1, gold x1.25, best x1.5); other gifts ignore quality', () => {
    expect(giftPoints(data, 'zoe', 'honey_bread', 1)).toBe(88);
    expect(giftPoints(data, 'zoe', 'honey_bread', 2)).toBe(100);
    expect(giftPoints(data, 'zoe', 'honey_bread', 4)).toBe(120);
    expect(giftPoints(data, 'zoe', 'dawn_salad', 4)).toBe(67);
    expect(giftPoints(data, 'zoe', 'stone', 4)).toBe(-20);
    expect(giftPoints(data, 'zoe', 'dawn_radish', 4)).toBe(20);
  });
});

describe('hearts (P17.26)', () => {
  it('is 250 points each, from zero to ten hearts, and the points stop at the cap', () => {
    expect(heartsOf(0)).toBe(0);
    expect(heartsOf(249)).toBe(0);
    expect(heartsOf(250)).toBe(1);
    expect(heartsOf(2499)).toBe(9);
    expect(heartsOf(FRIEND_CAP)).toBe(10);
    expect(heartsOf(9999)).toBe(10);
    expect(heartsOf(-30)).toBe(0);
  });
});

describe('gifts per day and per week (P17.26)', () => {
  it('a character takes one gift a day: the second is refused the same day, and the next day is open', () => {
    const first = giveGift(data, NO_FRIEND, 'zoe', 'honey_bread', 0, 3);
    expect(first).toMatchObject({ ok: true, points: 80, bonus: 0, record: { points: 80, giftDay: 3, week: 0, giftsThisWeek: 1 } });
    if (!first.ok) throw new Error('first gift refused');
    expect(giveGift(data, first.record, 'zoe', 'dawn_salad', 0, 3)).toEqual({ ok: false, reason: 'limit' });
    expect(giveGift(data, first.record, 'zoe', 'dawn_salad', 0, 4)).toMatchObject({ ok: true, points: 45 });
  });

  it('two gifts a week at most: the third in the same week is refused, and the next week starts again', () => {
    let record: FriendRecord = NO_FRIEND;
    for (const day of [1, 2]) {
      const out = giveGift(data, record, 'felix', 'dawn_radish', 0, day);
      if (!out.ok) throw new Error(`gift on day ${day} refused`);
      record = out.record;
    }
    expect(giveGift(data, record, 'felix', 'dawn_radish', 0, 3)).toEqual({ ok: false, reason: 'limit' });
    expect(weekOf(7)).toBe(0);
    expect(weekOf(8)).toBe(1);
    expect(giveGift(data, record, 'felix', 'dawn_radish', 0, 8)).toMatchObject({ ok: true, record: { week: 1, giftsThisWeek: 1 } });
  });

  it('two gifts in one week earn +10 with the first gift of the next week, once', () => {
    let record: FriendRecord = NO_FRIEND;
    for (const day of [1, 2]) {
      const out = giveGift(data, record, 'theo', 'dawn_radish', 0, day);
      if (!out.ok) throw new Error(`gift on day ${day} refused`);
      record = out.record;
    }
    const nextWeek = giveGift(data, record, 'theo', 'dawn_radish', 0, 8);
    expect(nextWeek).toMatchObject({ ok: true, points: 20, bonus: 10 });
    if (!nextWeek.ok) throw new Error('next week refused');
    expect(nextWeek.record.points).toBe(record.points + 20 + 10);
    const again = giveGift(data, nextWeek.record, 'theo', 'dawn_radish', 0, 9);
    expect(again).toMatchObject({ ok: true, bonus: 0 });
  });

  it('a character who is not in the gift list is refused as invalid; points never pass the cap', () => {
    expect(giveGift(data, NO_FRIEND, 'nobody' as never, 'honey_bread', 0, 1)).toEqual({ ok: false, reason: 'invalid' });
    const nearly = { ...NO_FRIEND, points: FRIEND_CAP - 10 };
    expect(giveGift(data, nearly, 'zoe', 'honey_bread', 0, 1)).toMatchObject({ ok: true, record: { points: FRIEND_CAP } });
  });
});
