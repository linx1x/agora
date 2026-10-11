import { describe, expect, it } from 'vitest';
import { loadGameData } from '../gamedata/load';
import { skillLevelOf, toolEnergy, toolOf, useTool } from './tools';
import { envOf, viewOf } from './fixtures';

const data = loadGameData();
const LEVELS = data.progression.levelXp;

describe('tools: levels, energy and the held tool (P17.21)', () => {
  it('a skill level is how many thresholds the xp has passed', () => {
    expect(skillLevelOf(0, LEVELS)).toBe(0);
    expect(skillLevelOf(LEVELS[0]! - 1, LEVELS)).toBe(0);
    expect(skillLevelOf(LEVELS[0]!, LEVELS)).toBe(1);
    expect(skillLevelOf(LEVELS[1]! - 1, LEVELS)).toBe(1);
    expect(skillLevelOf(LEVELS[1]!, LEVELS)).toBe(2);
    expect(skillLevelOf(1e9, LEVELS)).toBe(LEVELS.length);
  });

  it('energy per use is the base less 0.1 per level, rounded, and never below 1', () => {
    const hoe1 = toolOf(data, 'hoe_1')!;
    expect(toolEnergy(hoe1, 0)).toBe(2);
    expect(toolEnergy(hoe1, 5)).toBe(2); // 1.5 rounds up
    expect(toolEnergy(hoe1, 10)).toBe(1);
    expect(toolEnergy({ energy: 1 }, 10)).toBe(1);
  });

  it('an unknown item is not a tool', () => {
    expect(toolOf(data, 'dawn_radish_seed')).toBeUndefined();
    expect(toolOf(data, 'no_such_item')).toBeUndefined();
  });

  it('refuses with missing when nothing is in hand or the bag has none of it', () => {
    expect(useTool(viewOf(), { kind: 'till' }, data, 'hoe')).toEqual({ ok: false, reason: 'missing' });
    expect(useTool(viewOf(), { kind: 'till', item: 'hoe_1' }, data, 'hoe')).toEqual({ ok: false, reason: 'missing' });
  });

  it('refuses with tool when the item is not a tool of that kind', () => {
    const view = viewOf({ items: { can_1: 1 } });
    expect(useTool(view, { kind: 'till', item: 'can_1' }, data, 'hoe')).toEqual({ ok: false, reason: 'tool' });
    expect(useTool(view, { kind: 'till', item: 'dawn_radish_seed' }, data, 'hoe')).toEqual({ ok: false, reason: 'tool' });
  });

  it('refuses with energy only when the use would take the actor below zero', () => {
    const at2 = viewOf({ items: { hoe_1: 1 }, energy: 2 });
    const at1 = viewOf({ items: { hoe_1: 1 }, energy: 1 });
    expect(useTool(at2, { kind: 'till', item: 'hoe_1' }, data, 'hoe')).toMatchObject({ ok: true, cost: 2 });
    expect(useTool(at1, { kind: 'till', item: 'hoe_1' }, data, 'hoe')).toEqual({ ok: false, reason: 'energy' });
  });

  it('the skill discount applies to the tool its skill trains', () => {
    const view = viewOf({ items: { axe_1: 1 }, skills: { foraging: LEVELS[3]! } }); // foraging level 4
    expect(useTool(view, { kind: 'chop', item: 'axe_1' }, data, 'axe')).toMatchObject({ ok: true, cost: 3 });
    const farming = viewOf({ items: { hoe_1: 1 }, skills: { foraging: LEVELS[3]! } });
    expect(useTool(farming, { kind: 'till', item: 'hoe_1' }, data, 'hoe')).toMatchObject({ ok: true, cost: 2 });
  });

  it('the env is usable by the rules (the rng is seeded per call)', () => {
    expect(envOf(data, 1).rng()).toBe(envOf(data, 1).rng());
  });
});
