import { describe, expect, it } from 'vitest';
import { loadGameData, type CellRef } from '@agora/shared';
import type { ActItem } from './inputActs';
import { keysBusy, useAt, useFaced, useOn, type Feet, type UseEnv } from './use';

const data = loadGameData();

/** A recording environment: the decor of each cell, and every ask, panel, swing and toast. */
function fakeEnv(over: { hand?: string | null; world?: string | null; decor?: Record<string, string> } = {}) {
  const asks: { world: string; act: ActItem }[] = [];
  const panels: unknown[] = [];
  const swings: { at: CellRef; tier: number; speed: number }[] = [];
  const toasts: string[] = [];
  const decor = over.decor ?? {};
  const env: UseEnv = {
    world: over.world === undefined ? 'w1' : over.world,
    hand: over.hand ?? null,
    data,
    cellAt: (cx, cy) => ({ decor: decor[`${cx},${cy}`] ?? '' }),
    submit: (world, act) => asks.push({ world, act }),
    openPanel: (panel) => panels.push(panel),
    swing: (at, tier, speed) => swings.push({ at, tier, speed }),
    toast: (key) => toasts.push(key),
  };
  return { env, asks, panels, swings, toasts };
}

/** Feet in the middle of cell (cx, cy), facing `d`. */
const feetIn = (cx: number, cy: number, d: Feet['d'] = 'down'): Feet => ({ x: cx * 32 + 16, y: cy * 32 + 16, d });

describe('useOn: the held item acts on a cell', () => {
  it('an empty hand harvests bare ground, with no item and no swing', () => {
    const f = fakeEnv();
    expect(useOn(f.env, { x: 2, y: 3 })).toBe(true);
    expect(f.asks).toEqual([{ world: 'w1', act: { kind: 'harvest', at: { x: 2, y: 3 } } }]);
    expect(f.swings).toEqual([]);
  });

  it('a tool asks its action with the item and swings at its tier and speed', () => {
    const f = fakeEnv({ hand: 'hoe_1' });
    expect(useOn(f.env, { x: 1, y: 1 })).toBe(true);
    expect(f.asks).toEqual([{ world: 'w1', act: { kind: 'till', at: { x: 1, y: 1 }, item: 'hoe_1' } }]);
    expect(f.swings).toHaveLength(1);
    expect(f.swings[0]!.at).toEqual({ x: 1, y: 1 });
    expect(f.swings[0]!.tier).toBe(1);
  });

  it('a seed is planted by hand: asked, not swung', () => {
    const f = fakeEnv({ hand: 'dawn_radish_seed' });
    expect(useOn(f.env, { x: 0, y: 0 })).toBe(true);
    expect(f.asks[0]!.act.kind).toBe('plant');
    expect(f.swings).toEqual([]);
  });

  it('an item that does nothing on the cell is not asked (false, nothing sent)', () => {
    const f = fakeEnv({ hand: 'rod_1' });
    expect(useOn(f.env, { x: 0, y: 0 })).toBe(false);
    expect(f.asks).toEqual([]);
    expect(f.swings).toEqual([]);
  });

  it('an empty hand on a shop board opens the shop, and asks nothing', () => {
    const f = fakeEnv({ decor: { '4,4': 'shop_board' } });
    expect(useOn(f.env, { x: 4, y: 4 })).toBe(true);
    expect(f.panels).toEqual([{ kind: 'shop', at: { x: 4, y: 4 } }]);
    expect(f.asks).toEqual([]);
  });

  it('an empty hand on a station opens its recipes with the block id', () => {
    const f = fakeEnv({ decor: { '5,5': 'workbench' } });
    expect(useOn(f.env, { x: 5, y: 5 })).toBe(true);
    expect(f.panels).toEqual([{ kind: 'craft', at: { x: 5, y: 5 }, block: 'workbench' }]);
    expect(f.asks).toEqual([]);
  });

  it('a held item on a station is not a panel: it goes to the server as usual', () => {
    const f = fakeEnv({ hand: 'hoe_1', decor: { '5,5': 'workbench' } });
    expect(useOn(f.env, { x: 5, y: 5 })).toBe(true);
    expect(f.panels).toEqual([]);
    expect(f.asks[0]!.act.kind).toBe('till');
  });

  it('an empty hand on a chest opens it, and a held item is stashed into it', () => {
    const empty = fakeEnv({ decor: { '1,1': 'chest' } });
    useOn(empty.env, { x: 1, y: 1 });
    expect(empty.asks[0]!.act.kind).toBe('open');
    const held = fakeEnv({ hand: 'wood_wall', decor: { '1,1': 'chest' } });
    useOn(held.env, { x: 1, y: 1 });
    expect(held.asks[0]!.act.kind).toBe('stash');
  });

  it('a shovel raises, and Shift lowers', () => {
    const up = fakeEnv({ hand: 'shovel_1' });
    useOn(up.env, { x: 0, y: 0 });
    expect(up.asks[0]!.act.kind).toBe('raise');
    const down = fakeEnv({ hand: 'shovel_1' });
    useOn(down.env, { x: 0, y: 0 }, true);
    expect(down.asks[0]!.act.kind).toBe('lower');
  });

  it('no world means nothing is asked', () => {
    const f = fakeEnv({ world: null, hand: 'hoe_1' });
    expect(useOn(f.env, { x: 0, y: 0 })).toBe(false);
    expect(f.asks).toEqual([]);
    expect(f.swings).toEqual([]);
  });
});

describe('useFaced: Space acts on the cell in front of the feet', () => {
  it('acts on the faced cell in each direction', () => {
    const cases: [Feet['d'], CellRef][] = [
      ['up', { x: 3, y: 2 }],
      ['down', { x: 3, y: 4 }],
      ['left', { x: 2, y: 3 }],
      ['right', { x: 4, y: 3 }],
    ];
    for (const [d, at] of cases) {
      const f = fakeEnv({ hand: 'hoe_1' });
      expect(useFaced(f.env, feetIn(3, 3, d))).toBe(true);
      expect(f.asks[0]!.act.at).toEqual(at);
    }
  });

  it('with nothing to do in front, says so and returns false', () => {
    const f = fakeEnv({ hand: 'rod_1' });
    expect(useFaced(f.env, feetIn(3, 3, 'right'))).toBe(false);
    expect(f.toasts).toEqual(['worlds.hud.nothingToDo']);
    expect(f.asks).toEqual([]);
  });

  it('a Shift Space passes the shift on to the shovel', () => {
    const f = fakeEnv({ hand: 'shovel_1' });
    useFaced(f.env, feetIn(0, 0, 'down'), true);
    expect(f.asks[0]!.act.kind).toBe('lower');
  });
});

describe('useAt: a click on a cell acts only within reach', () => {
  it('acts on a cell next to my feet', () => {
    const f = fakeEnv({ hand: 'hoe_1' });
    expect(useAt(f.env, feetIn(5, 5), { x: 6, y: 5 })).toBe(true);
    expect(f.asks[0]!.act.at).toEqual({ x: 6, y: 5 });
  });

  it('a cell out of reach is not acted on (the click walks instead)', () => {
    const f = fakeEnv({ hand: 'hoe_1' });
    expect(useAt(f.env, feetIn(5, 5), { x: 9, y: 5 })).toBe(false);
    expect(f.asks).toEqual([]);
    expect(f.swings).toEqual([]);
  });

  it('an empty hand on a shop board opens it from a click in reach', () => {
    const f = fakeEnv({ decor: { '6,5': 'shop_board' } });
    expect(useAt(f.env, feetIn(5, 5), { x: 6, y: 5 })).toBe(true);
    expect(f.panels).toHaveLength(1);
  });
});

describe('keysBusy: the keys that do nothing while something else has the keyboard', () => {
  const free = { typing: false, modifier: false, dialog: false, chest: false, panel: false };
  it('is false with nothing open', () => {
    expect(keysBusy(free)).toBe(false);
  });
  it('is true for each busy state', () => {
    for (const k of ['typing', 'modifier', 'dialog', 'chest', 'panel'] as const)
      expect(keysBusy({ ...free, [k]: true })).toBe(true);
  });
});
