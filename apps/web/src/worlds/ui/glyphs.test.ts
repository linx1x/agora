import { describe, expect, it } from 'vitest';
import { loadGameData } from '@agora/shared';
import { tierOverlay } from '../tools/overlay';
import { GLYPHS, glyphOf } from './glyphs';

const data = loadGameData();

describe('glyphOf: the hotbar icon of an item (P17.21d)', () => {
  it('every item of the data has a drawn glyph of its own family, never the fallback', () => {
    for (const item of data.items) {
      const g = glyphOf(item.id, data);
      expect(GLYPHS).toContain(g.glyph);
      expect(g.tint).toMatch(/^#[0-9a-f]{6}$/i);
    }
  });

  it('a tool is drawn by its tool, in its tier colour, so wood, iron and diamond read apart', () => {
    expect(glyphOf('axe_1', data)).toEqual({ glyph: 'axe', tint: tierOverlay(1).color });
    expect(glyphOf('axe_2', data).tint).toBe(tierOverlay(2).color);
    expect(glyphOf('pick_3', data)).toEqual({ glyph: 'pick', tint: tierOverlay(3).color });
    expect(new Set(['hoe_1', 'hoe_2', 'hoe_3'].map((id) => glyphOf(id, data).tint)).size).toBe(3);
  });

  it('materials are told apart by their id: stone, log, fibre, ore, bar', () => {
    expect(glyphOf('stone', data).glyph).toBe('stone');
    expect(glyphOf('hardwood', data).glyph).toBe('log');
    expect(glyphOf('softwood', data).glyph).toBe('log');
    expect(glyphOf('fiber', data).glyph).toBe('fiber');
    expect(glyphOf('ember_ore', data).glyph).toBe('gem');
    expect(glyphOf('lumen_bar', data).glyph).toBe('ingot');
  });

  it('a stack key with a quality suffix is read as its base item', () => {
    expect(glyphOf('hoe_1~2', data)).toEqual(glyphOf('hoe_1', data));
  });

  it('a seed, a crop and a building have their own shapes', () => {
    expect(glyphOf('dawn_radish_seed', data).glyph).toBe('sprout');
    expect(glyphOf('dawn_radish', data).glyph).toBe('bloom');
    expect(glyphOf('chest', data).glyph).toBe('house');
  });

  it('an unknown item gets the plain sack', () => {
    expect(glyphOf('no_such_item', data).glyph).toBe('sack');
  });
});
