import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { cellKey, loadGameData, stockOf, type MachineState } from '@agora/shared';
import { batchAt, recipesAt } from './CraftPanel';
import { createHudStore } from './hudState';
import { WorldHud } from './WorldHud';

const data = loadGameData();

const count = (html: string, needle: string) => html.split(needle).length - 1;

describe('the shop board stock (P17.25)', () => {
  it('sells the open and limited items that have a price, at their stable prices, and nothing else', () => {
    const stock = stockOf(data);
    expect(stock).toHaveLength(24);
    expect(stock.find((s) => s.id === 'dawn_radish_seed')?.price).toBe(data.itemsById.get('dawn_radish_seed')!.buy);
    expect(stock.find((s) => s.id === 'plume_hen')?.price).toBe(data.itemsById.get('plume_hen')!.buy);
    expect(stock.some((s) => s.id === 'furnace')).toBe(false);
    expect(stock.some((s) => s.id === 'hoe_2')).toBe(false);
    expect(stock.some((s) => s.id === 'dawn_radish')).toBe(false);
  });

  it('the panel lists the stock, with a buy button for each item and the money the person has', () => {
    const store = createHudStore();
    store.openPanel({ kind: 'shop', at: { x: 2, y: 0 } });
    const html = renderToStaticMarkup(createElement(WorldHud, { store }));
    expect(html).toContain('role="dialog"');
    expect(html).toContain('worlds.shop.title');
    expect(count(html, 'worlds.shop.buyLabel')).toBe(stockOf(data).length);
    expect(html).toContain('worlds.hud.money');
  });
});

describe('the crafting panel of a station (P17.25)', () => {
  it('lists the recipes of its own station: a bench, a stove, a furnace', () => {
    expect(recipesAt(data, 'workbench').map((r) => r.id)).toEqual(expect.arrayContaining(['fence', 'coop', 'barn', 'stove']));
    expect(recipesAt(data, 'stove').map((r) => r.id)).toEqual(expect.arrayContaining(['dawn_salad']));
    expect(recipesAt(data, 'stove').some((r) => r.id === 'fence')).toBe(false);
    expect(recipesAt(data, 'furnace').map((r) => r.id).sort()).toEqual(['smelt_dull', 'smelt_ember', 'smelt_lumen']);
    expect(recipesAt(data, 'coop')).toEqual([]);
  });

  it('finds the batch a machine holds on its cell, and none on another cell', () => {
    const batch: MachineState = { id: cellKey(4, 4), cell: cellKey(4, 4), machine: 'furnace', output: 'dull_bar', qty: 1, daysLeft: 1 };
    expect(batchAt([batch], { x: 4, y: 4 })).toBe(batch);
    expect(batchAt([batch], { x: 4, y: 5 })).toBeUndefined();
    expect(batchAt([], { x: 4, y: 4 })).toBeUndefined();
  });

  it('a bench lists its recipes, each a craft button that the server decides', () => {
    const store = createHudStore();
    store.openPanel({ kind: 'craft', at: { x: 3, y: 3 }, block: 'workbench' });
    const html = renderToStaticMarkup(createElement(WorldHud, { store }));
    expect(html).toContain('role="dialog"');
    expect(count(html, 'worlds.craft.craft')).toBe(recipesAt(data, 'workbench').length);
    expect(html).not.toContain('worlds.craft.inProgress');
    expect(html).not.toContain('worlds.craft.ready');
  });

  it('a furnace shows its batch: in progress with the days left (buttons off), or ready with a collect button', () => {
    const at = { x: 3, y: 3 };
    const key = cellKey(at.x, at.y);
    const store = createHudStore();
    store.dispatch({ t: 'world:farm', day: 2, plots: {}, machines: [{ id: key, cell: key, machine: 'furnace', output: 'dull_bar', qty: 1, daysLeft: 1 }] });
    store.openPanel({ kind: 'craft', at, block: 'furnace' });
    const busy = renderToStaticMarkup(createElement(WorldHud, { store }));
    expect(busy).toContain('worlds.craft.inProgress');
    expect(busy).not.toContain('worlds.craft.collect');
    expect(busy).toContain('disabled=""');

    store.dispatch({ t: 'world:farm', day: 3, plots: {}, machines: [{ id: key, cell: key, machine: 'furnace', output: 'dull_bar', qty: 1, daysLeft: 0 }] });
    const ready = renderToStaticMarkup(createElement(WorldHud, { store }));
    expect(ready).toContain('worlds.craft.ready');
    expect(ready).toContain('worlds.craft.collect');
    expect(ready).not.toContain('worlds.craft.inProgress');
  });

  it('a furnace with nothing in it lets a recipe be chosen (no batch status, no disabled craft)', () => {
    const store = createHudStore();
    store.openPanel({ kind: 'craft', at: { x: 3, y: 3 }, block: 'furnace' });
    const html = renderToStaticMarkup(createElement(WorldHud, { store }));
    expect(count(html, 'worlds.craft.craft')).toBe(3);
    expect(html).not.toContain('disabled=""');
  });
});
