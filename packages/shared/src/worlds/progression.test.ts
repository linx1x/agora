import { describe, expect, it } from 'vitest';
import { checkCrossRefs, loadGameData } from './gamedata/load';
import { SKILLS, type Progression } from './gamedata/schema';
import { noChanges, type ActionChanges, type ActionRequest } from './actions/kinds';
import {
  XP_SOURCE_OF,
  badgeFrom,
  isUnlocked,
  levelOfXp,
  progressionStep,
  unlockOf,
  xpFor,
} from './progression';

const data = loadGameData();
const P = data.progression;
const LEVEL = P.levelXp;
const AT = { x: 0, y: 0 };
const withXp = (xp: Record<string, number>): ActionChanges => ({ ...noChanges(), xp });

describe('levels of an xp total (P17.31)', () => {
  it('a level is reached at its threshold, and never passes the last one', () => {
    expect(levelOfXp(0)).toBe(0);
    expect(levelOfXp(LEVEL[0]! - 1)).toBe(0);
    expect(levelOfXp(LEVEL[0]!)).toBe(1);
    expect(levelOfXp(LEVEL[1]! - 1)).toBe(1);
    expect(levelOfXp(LEVEL[1]!)).toBe(2);
    expect(levelOfXp(LEVEL[9]! - 1)).toBe(9);
    expect(levelOfXp(LEVEL[9]!)).toBe(10);
    expect(levelOfXp(10 ** 9)).toBe(10);
  });
});

describe('the xp of each action (P17.31)', () => {
  it('every skill is earned by some source, so no skill is out of reach', () => {
    const earned = new Set(Object.values(P.xp).map((grant) => grant.skill));
    expect([...earned].sort()).toEqual([...SKILLS].sort());
  });

  it('the actions that earn xp map to their source, and the others earn none', () => {
    expect(XP_SOURCE_OF).toEqual({ harvest: 'harvest', chop: 'chop', mine: 'mine' });
    for (const kind of ['till', 'water', 'plant', 'fertilize', 'place', 'eat', 'sleep'] as const) {
      expect(XP_SOURCE_OF[kind]).toBeUndefined();
    }
  });

  it('xpFor reads the table row of its source', () => {
    expect(xpFor('harvest', P)).toEqual({ skill: 'farming', amount: 8 });
    expect(xpFor('catch', P)).toEqual({ skill: 'fishing', amount: 6 });
    expect(xpFor('kill', P)).toEqual({ skill: 'combat', amount: 5 });
  });
});

describe('unlocks (P17.31)', () => {
  it('a tier-2 tool opens at level 1 and a tier-3 tool at level 3, on the skill the tool trains', () => {
    expect(unlockOf(P, 'pick_2')).toEqual({ item: 'pick_2', skill: 'mining', level: 1 });
    expect(unlockOf(P, 'rod_3')).toEqual({ item: 'rod_3', skill: 'fishing', level: 3 });
    expect(unlockOf(P, 'pick_1')).toBeUndefined();
  });

  it('is open only when the person own xp in that skill has reached the level', () => {
    const pick3 = unlockOf(P, 'pick_3')!;
    expect(isUnlocked({}, pick3, P)).toBe(false);
    expect(isUnlocked({ mining: LEVEL[1]! - 1 }, pick3, P)).toBe(false);
    expect(isUnlocked({ mining: LEVEL[2]! }, pick3, P)).toBe(true);
    // a level in another skill opens nothing
    expect(isUnlocked({ farming: 10 ** 6, foraging: 10 ** 6 }, pick3, P)).toBe(false);
  });
});

describe('the progression hook (P17.31)', () => {
  const till = (item?: string): ActionRequest => ({ kind: 'till', at: AT, item });
  const harvest: ActionRequest = { kind: 'harvest', at: AT };

  it('refuses a tier-2 tool the person has not unlocked, as locked', () => {
    expect(progressionStep(data, till('hoe_2'), {}, noChanges())).toEqual({
      ok: false,
      reason: 'locked',
    });
    expect(progressionStep(data, till('hoe_2'), { farming: LEVEL[0]! - 1 }, noChanges())).toEqual({
      ok: false,
      reason: 'locked',
    });
  });

  it('lets the tool through once its own skill has reached the level', () => {
    const step = progressionStep(data, till('hoe_2'), { farming: LEVEL[0]! }, noChanges());
    expect(step.ok).toBe(true);
  });

  it('does not let a level in another skill open a tool', () => {
    expect(
      progressionStep(
        data,
        { kind: 'chop', at: AT, item: 'axe_2' },
        { farming: 10 ** 6 },
        noChanges(),
      ),
    ).toEqual({
      ok: false,
      reason: 'locked',
    });
  });

  it('lets starter tools and actions without an item through', () => {
    expect(progressionStep(data, till('hoe_1'), {}, noChanges()).ok).toBe(true);
    expect(progressionStep(data, { kind: 'sleep' }, {}, noChanges()).ok).toBe(true);
  });

  it('replaces the xp a rule wrote with the figure of the table', () => {
    const step = progressionStep(data, harvest, {}, withXp({ farming: 999 }));
    expect(step).toEqual({ ok: true, changes: withXp({ farming: P.xp.harvest.amount }) });
  });

  it('gives an action that earned no xp none, and an action with no source none whatever the rule wrote', () => {
    expect(progressionStep(data, harvest, {}, noChanges())).toEqual({
      ok: true,
      changes: noChanges(),
    });
    expect(progressionStep(data, till('hoe_1'), {}, withXp({ mining: 50 }))).toEqual({
      ok: true,
      changes: noChanges(),
    });
  });

  it('keeps every other change of the plan as it was', () => {
    const changes: ActionChanges = { items: { stone: 2 }, money: 5, energy: -3, xp: { mining: 4 } };
    const step = progressionStep(data, { kind: 'mine', at: AT, item: 'pick_1' }, {}, changes);
    expect(step).toEqual({
      ok: true,
      changes: { items: { stone: 2 }, money: 5, energy: -3, xp: { mining: P.xp.mine.amount } },
    });
  });
});

describe('the badge (P17.31)', () => {
  it('shows nothing when no skill is chosen', () => {
    expect(badgeFrom({ farming: 10 ** 6 }, null, P)).toBeUndefined();
    expect(badgeFrom({ farming: 10 ** 6 }, undefined, P)).toBeUndefined();
  });

  it('shows nothing for a chosen skill the person has not reached level 1 in', () => {
    expect(badgeFrom({ farming: LEVEL[0]! - 1 }, 'farming', P)).toBeUndefined();
    expect(badgeFrom({ farming: 10 ** 6 }, 'mining', P)).toBeUndefined();
  });

  it('shows the level the own xp has earned, and no higher', () => {
    expect(badgeFrom({ mining: LEVEL[1]! }, 'mining', P)).toEqual({ skill: 'mining', level: 2 });
    expect(badgeFrom({ mining: LEVEL[1]! - 1 }, 'mining', P)).toEqual({
      skill: 'mining',
      level: 1,
    });
  });
});

describe('the unlock table is checked with the rest of the data (P17.31)', () => {
  const check = (progression: Partial<Progression>) =>
    checkCrossRefs({ ...data, progression: { ...P, ...progression } });

  it('the shipped data is consistent', () => {
    expect(checkCrossRefs(data)).toEqual([]);
  });

  it('a tool above tier 1 without an unlock is an error', () => {
    const without = P.unlocks.filter((u) => u.item !== 'axe_2');
    expect(check({ unlocks: without })).toEqual([
      'progression.unlocks: tool axe_2 (tier 2) has no unlock',
    ]);
  });

  it('an unlock must name a tool, on the skill that tool trains, once', () => {
    const seed = data.items.find((i) => i.kind === 'seed')!.id;
    expect(
      check({ unlocks: [...P.unlocks, { item: seed, skill: 'farming', level: 1 }] }),
    ).toContain(`progression.unlocks.${seed}: is seed, expected tool`);
    expect(
      check({
        unlocks: P.unlocks.map((u) =>
          u.item === 'hoe_2' ? { ...u, skill: 'mining' as const } : u,
        ),
      }),
    ).toEqual(['progression.unlocks.hoe_2: a hoe trains farming, not mining']);
    expect(check({ unlocks: [...P.unlocks, P.unlocks[0]!] })).toEqual([
      'progression.unlocks.hoe_2: unlocked twice',
    ]);
  });
});
