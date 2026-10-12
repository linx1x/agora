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
    expect(reduceHud(s1, { t: 'world:refused', op: 1, reason: 'missing' }).items).toEqual(s1.items);
  });

  it('keeps the game clock the server last sent, without touching the account', () => {
    const store = createHudStore();
    store.dispatch(inv({ hoe_1: 1 }, 500));
    expect(store.get().time).toBeNull();
    const time = { day: 2, season: 'autumn' as const, year: 1, hour: 6, minute: 10, dayOfSeason: 2 };
    expect(store.dispatch({ t: 'world:time', time })).toBe(true);
    expect(store.get()).toMatchObject({ time, money: 500, items: { hoe_1: 1 } });
    expect(store.dispatch({ t: 'world:time', time })).toBe(true);
    store.dispatch({ t: 'world:time', time: { ...time, hour: 6, minute: 20 } });
    expect(store.get().time).toMatchObject({ minute: 20 });
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

describe('the chest the person opened (P17.24)', () => {
  it('holds the chest the server last sent, and closes on request without touching the account', () => {
    const store = createHudStore();
    store.dispatch(inv({ hoe_1: 1 }, 500));
    expect(store.get().chest).toBeNull();
    expect(store.dispatch({ t: 'world:chest', at: { x: 3, y: 4 }, items: { dawn_radish_seed: 2 } })).toBe(true);
    expect(store.get().chest).toEqual({ at: { x: 3, y: 4 }, items: { dawn_radish_seed: 2 } });
    expect(store.get()).toMatchObject({ items: { hoe_1: 1 }, money: 500 });
    store.closeChest();
    expect(store.get().chest).toBeNull();
    expect(store.get()).toMatchObject({ items: { hoe_1: 1 }, money: 500 });
  });

  it('a later chest message replaces the contents, and closing a closed chest changes nothing', () => {
    const store = createHudStore();
    store.dispatch({ t: 'world:chest', at: { x: 3, y: 4 }, items: { dawn_radish_seed: 2 } });
    store.dispatch({ t: 'world:chest', at: { x: 3, y: 4 }, items: {} });
    expect(store.get().chest?.items).toEqual({});
    store.closeChest();
    const before = store.get();
    store.closeChest();
    expect(store.get()).toBe(before);
  });
});

describe('the farm the person sees: animals and machines (P17.25)', () => {
  const hen = { id: 'a1', animal: 'plume_hen', cell: '1,0', fedOn: 0, progress: 0, pending: 1 };
  const furnace = { id: '1,0', cell: '1,0', machine: 'furnace', output: 'dull_bar', qty: 1, daysLeft: 0 };
  const farm = (extra: Partial<Extract<S2CMsg, { t: 'world:farm' }>> = {}): S2CMsg => ({ t: 'world:farm', day: 2, plots: {}, ...extra });

  it('takes the whole lists of animals and machines when a farm message carries them', () => {
    const store = createHudStore();
    expect(store.get()).toMatchObject({ animals: [], machines: [] });
    expect(store.dispatch(farm({ animals: [hen], machines: [furnace] }))).toBe(true);
    expect(store.get()).toMatchObject({ animals: [hen], machines: [furnace] });
  });

  it('keeps the lists it has when a farm message leaves them out (they did not change)', () => {
    const state = reduceHud(initialHud(), farm({ animals: [hen] }));
    expect(reduceHud(state, farm({ plots: {} })).animals).toEqual([hen]);
    expect(reduceHud(state, farm({ machines: [] })).machines).toEqual([]);
    expect(reduceHud(state, farm({}))).toBe(state);
  });

  it('a farm message with no animals and no machines changes nothing', () => {
    const store = createHudStore();
    const before = store.get();
    expect(store.dispatch(farm({}))).toBe(false);
    expect(store.get()).toBe(before);
  });
});

describe('the shop or crafting panel open on a block (P17.25)', () => {
  it('opens the panel the scene asks for and closes it; closing a closed panel changes nothing', () => {
    const store = createHudStore();
    store.dispatch({ t: 'world:inv', items: { hoe_1: 1 }, money: 500, energy: 270, maxEnergy: 270 });
    store.openPanel({ kind: 'shop', at: { x: 2, y: 0 } });
    expect(store.get()).toMatchObject({ panel: { kind: 'shop', at: { x: 2, y: 0 } }, money: 500, items: { hoe_1: 1 } });
    store.openPanel({ kind: 'craft', at: { x: 3, y: 0 }, block: 'workbench' });
    expect(store.get().panel).toEqual({ kind: 'craft', at: { x: 3, y: 0 }, block: 'workbench' });
    store.closePanel();
    expect(store.get().panel).toBeNull();
    const before = store.get();
    store.closePanel();
    expect(store.get()).toBe(before);
  });
});
