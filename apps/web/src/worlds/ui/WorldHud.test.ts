import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { HOTBAR_SLOTS, createHudStore } from './hudState';
import { WorldHud } from './WorldHud';

describe('WorldHud (P17.20)', () => {
  it('labels every hotbar slot, and marks the item in hand as pressed', () => {
    const store = createHudStore();
    store.dispatch({ t: 'world:inv', items: { hoe_1: 1, dawn_radish_seed: 6 }, money: 500, energy: 270, maxEnergy: 270 });
    store.pick('dawn_radish_seed');
    const html = renderToStaticMarkup(createElement(WorldHud, { store }));
    expect(html.match(/class="wh-slot"/g)).toHaveLength(HOTBAR_SLOTS);
    expect(html).toContain('aria-label="worlds.hud.slot"');
    expect(html).toContain('aria-pressed="true"');
    expect(html).toContain('aria-label="worlds.hud.slotEmpty"');
    expect(html).toContain('worlds.hud.inHand');
  });

  it('says nothing is in hand, and keeps the inventory closed until asked', () => {
    const html = renderToStaticMarkup(createElement(WorldHud, { store: createHudStore() }));
    expect(html).toContain('worlds.hud.nothingInHand');
    expect(html).toContain('aria-haspopup="dialog"');
    expect(html).not.toContain('role="dialog"');
    expect(html).toContain('role="status"');
  });

  it('puts a refusal in the live status line', () => {
    const store = createHudStore();
    store.dispatch({ t: 'world:refused', op: 1, reason: 'far' });
    const html = renderToStaticMarkup(createElement(WorldHud, { store }));
    expect(html).toContain('worlds.refused.far');
  });
});
