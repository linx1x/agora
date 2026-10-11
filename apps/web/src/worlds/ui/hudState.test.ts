import { describe, expect, it } from 'vitest';
import type { S2CMsg } from '@agora/shared';
import { createHudStore, hotbarItems, initialHud, reduceHud, slotForKey } from './hudState';

const inv = (items: Record<string, number>, money = 0): S2CMsg => ({
  t: 'world:inv',
  items,
  money,
  energy: 270,
  maxEnergy: 270,
});

describe('world HUD state (P17.20)', () => {
  it('shows the inventory, money and energy the server last sent, and ignores other messages', () => {
    const s1 = reduceHud(initialHud(), inv({ hoe_1: 1, dawn_radish_seed: 6 }, 500));
    expect(s1).toMatchObject({ items: { hoe_1: 1, dawn_radish_seed: 6 }, money: 500, energy: 270, maxEnergy: 270 });
    expect(reduceHud(s1, { t: 'world:time', time: { day: 2, season: 'spring', year: 1, hour: 6, minute: 0, dayOfSeason: 2 } })).toBe(s1);
  });

  it('keeps the item in hand only while the server still has one', () => {
    const store = createHudStore();
    store.dispatch(inv({ hoe_1: 1, can_1: 1 }));
    store.pick('can_1');
    expect(store.get().inHand).toBe('can_1');
    store.dispatch(inv({ hoe_1: 1 }));
    expect(store.get().inHand).toBeNull();
  });

  it('refuses to put an item in hand that the player does not hold', () => {
    const store = createHudStore();
    store.dispatch(inv({ hoe_1: 1 }));
    store.pick('axe_1');
    expect(store.get().inHand).toBeNull();
    store.pick('hoe_1');
    store.pick(null);
    expect(store.get().inHand).toBeNull();
  });

  it('notifies listeners only when something changed', () => {
    const store = createHudStore();
    let calls = 0;
    store.subscribe(() => calls++);
    expect(store.dispatch(inv({ hoe_1: 1 }))).toBe(true);
    expect(calls).toBe(1);
    store.pick('hoe_1');
    store.pick('hoe_1');
    expect(calls).toBe(2);
  });

  it('announces a refusal until the next approved action, and keeps the inventory as it was', () => {
    const store = createHudStore();
    store.dispatch(inv({ hoe_1: 1 }));
    store.dispatch({ t: 'world:refused', op: 3, reason: 'far' });
    expect(store.get()).toMatchObject({ notice: 'far', items: { hoe_1: 1 } });
    store.dispatch({ t: 'world:acted', op: 4, changes: { items: {}, money: 0, energy: 0, xp: {} } });
    expect(store.get().notice).toBeNull();
  });

  it('puts the first nine stacks on the hotbar, and maps keys 1 to 9 to slots', () => {
    const items = Object.fromEntries(Array.from({ length: 12 }, (_, i) => [`item_${i}`, 1]));
    expect(hotbarItems(items)).toHaveLength(9);
    expect(hotbarItems(items)[0]).toBe('item_0');
    expect(slotForKey('1')).toBe(0);
    expect(slotForKey('9')).toBe(8);
    expect(slotForKey('0')).toBeNull();
    expect(slotForKey('i')).toBeNull();
    expect(slotForKey('10')).toBeNull();
  });
});
