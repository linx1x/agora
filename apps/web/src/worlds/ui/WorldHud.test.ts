import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { HOTBAR_SLOTS, createHudStore } from './hudState';
import { WorldHud, clockText } from './WorldHud';

describe('WorldHud (P17.20)', () => {
  it('shows a forecast button and forgets it when leaving or entering another world', () => {
    const store = createHudStore();
    store.dispatch({ t: 'world:time', time: { day: 5, season: 'spring', year: 1, hour: 6, minute: 0, dayOfSeason: 5 },
      weather: { day: 5, today: 'rain', tomorrow: 'cloudy' } });
    const html = renderToStaticMarkup(createElement(WorldHud, { store }));
    expect(html).toContain('data-weather="rain"');
    expect(html).toContain('worlds.weather.tomorrow');
    store.dispatch({ t: 'world:exit' });
    expect(store.get().weather).toBeNull();
    expect(renderToStaticMarkup(createElement(WorldHud, { store }))).not.toContain('wh-weather');
  });
  it('offers a turn control only while holding a bed and displays the selected axis',()=> {
    const store=createHudStore();
    store.dispatch({t:'world:inv',items:{bed:1,hoe_1:1},money:0,energy:100,maxEnergy:100});
    store.pick('bed');
    expect(renderToStaticMarkup(createElement(WorldHud,{store}))).toContain('worlds.hud.bedAxis.vertical');
    store.turnBed();
    expect(renderToStaticMarkup(createElement(WorldHud,{store}))).toContain('worlds.hud.bedAxis.horizontal');
    store.pick('hoe_1');
    expect(renderToStaticMarkup(createElement(WorldHud,{store}))).not.toContain('worlds.hud.turnBed');
  });
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

  it('shows each stack as an icon and its count, with the name only in the tooltip and the label (P17.21d)', () => {
    const store = createHudStore();
    store.dispatch({ t: 'world:inv', items: { hoe_3: 1, dawn_radish_seed: 6 }, money: 500, energy: 270, maxEnergy: 270 });
    const html = renderToStaticMarkup(createElement(WorldHud, { store }));
    // no name is drawn in a slot, so none can be cut with an ellipsis
    expect(html).not.toContain('wh-name');
    expect(html).not.toContain('text-overflow');
    // the glyph of each stack, and its tooltip (the same text as the accessible name)
    expect(html.match(/class="wh-icon"/g)).toHaveLength(2);
    expect(html).toContain('data-glyph="hoe"');
    expect(html).toContain('data-glyph="sprout"');
    expect(html.match(/title="worlds\.hud\.slot"/g)).toHaveLength(2);
    expect(html.match(/title="worlds\.hud\.slotEmpty"/g)).toHaveLength(HOTBAR_SLOTS - 2);
  });

  it('steps the hotbar aside when asked (a phone sheet is open), and shows it otherwise (P17.15c)', () => {
    const store = createHudStore();
    const shown = renderToStaticMarkup(createElement(WorldHud, { store }));
    const aside = renderToStaticMarkup(createElement(WorldHud, { store, barHidden: true }));
    expect(shown).not.toMatch(/<nav[^>]*hidden/);
    expect(aside).toMatch(/<nav[^>]*class="wh-hud"[^>]*hidden=""/);
  });

  it('says nothing is in hand, and keeps the inventory closed until asked', () => {
    const html = renderToStaticMarkup(createElement(WorldHud, { store: createHudStore() }));
    expect(html).toContain('worlds.hud.nothingInHand');
    expect(html).toContain('aria-haspopup="dialog"');
    expect(html).not.toContain('role="dialog"');
    expect(html).toContain('role="status"');
  });

  it('shows the clock (time, day, season) once the server sends it, and the energy as a meter', () => {
    const store = createHudStore();
    store.dispatch({ t: 'world:inv', items: {}, money: 0, energy: 270, maxEnergy: 270 });
    expect(renderToStaticMarkup(createElement(WorldHud, { store }))).not.toContain('wh-clock');
    store.dispatch({ t: 'world:time', time: { day: 3, season: 'winter', year: 1, hour: 23, minute: 40, dayOfSeason: 3 } });
    const html = renderToStaticMarkup(createElement(WorldHud, { store }));
    expect(html).toContain('class="wh-clock"');
    expect(html).toContain('worlds.hud.clock');
    expect(html).toContain('role="progressbar"');
    expect(html).toContain('aria-valuenow="270"');
    expect(html).toContain('aria-valuemax="270"');
    expect(html).toContain('data-low="false"');
    expect(html).toContain('width:100%');
  });

  it('marks low energy, below a fifth of the maximum', () => {
    const store = createHudStore();
    store.dispatch({ t: 'world:inv', items: {}, money: 0, energy: 40, maxEnergy: 270 });
    const html = renderToStaticMarkup(createElement(WorldHud, { store }));
    expect(html).toContain('data-low="true"');
    expect(html).toContain('width:15%');
  });

  it('writes the game clock as 24-hour digits, from 06:00 through 02:00', () => {
    expect(clockText({ day: 1, season: 'spring', year: 1, hour: 6, minute: 0, dayOfSeason: 1 })).toBe('06:00');
    expect(clockText({ day: 1, season: 'spring', year: 1, hour: 23, minute: 59, dayOfSeason: 1 })).toBe('23:59');
    expect(clockText({ day: 1, season: 'spring', year: 1, hour: 2, minute: 0, dayOfSeason: 1 })).toBe('02:00');
  });

  it('puts a refusal in the live status line', () => {
    const store = createHudStore();
    store.dispatch({ t: 'world:refused', op: 1, reason: 'far' });
    const html = renderToStaticMarkup(createElement(WorldHud, { store }));
    expect(html).toContain('worlds.refused.far');
  });
});
