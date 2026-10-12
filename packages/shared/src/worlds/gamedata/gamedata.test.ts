import { describe, expect, it } from 'vitest';
import animalsJson from '../../../data/worlds/animals.json';
import cropsJson from '../../../data/worlds/crops.json';
import fishJson from '../../../data/worlds/fish.json';
import giftsJson from '../../../data/worlds/npc-gifts.json';
import itemsJson from '../../../data/worlds/items.json';
import recipesJson from '../../../data/worlds/recipes.json';
import toolsJson from '../../../data/worlds/tools.json';
import progressionJson from '../../../data/worlds/progression.json';
import blocksJson from '../../../data/worlds/blocks.json';
import frJson from '../../../../../apps/web/src/i18n/fr.json';
import enJson from '../../../../../apps/web/src/i18n/en.json';
import {
  CropSchema,
  FishSchema,
  GiftProfileSchema,
  ItemSchema,
  SEASON_DAYS,
  ToolSchema,
} from './schema';
import { GameDataError, checkCrossRefs, loadGameData, parseGameData, type RawGameData } from './load';

const raw = (): RawGameData =>
  structuredClone({
    items: itemsJson,
    crops: cropsJson,
    tools: toolsJson,
    recipes: recipesJson,
    animals: animalsJson,
    fish: fishJson,
    gifts: giftsJson,
    progression: progressionJson,
  });

type Names = { worlds?: { item?: Record<string, string> } };
const namesOf = (dict: unknown): Record<string, string> => (dict as Names).worlds?.item ?? {};

describe('bundled world game data', () => {
  it('loads once and caches the result', () => {
    const first = loadGameData();
    expect(loadGameData()).toBe(first);
    expect(first.crops.length).toBeGreaterThanOrEqual(18);
    expect(first.itemsById.get('hoe_1')?.kind).toBe('tool');
  });

  it('has no cross-reference problems', () => {
    expect(checkCrossRefs(loadGameData())).toEqual([]);
  });

  it('has positive prices and values', () => {
    for (const item of loadGameData().items) {
      expect(item.buy === null || item.buy > 0, item.id).toBe(true);
      expect(item.value, item.id).toBeGreaterThan(0);
    }
  });

  it('fits every crop in one season', () => {
    for (const crop of loadGameData().crops) {
      const total = crop.stages.reduce((sum, days) => sum + days, 0);
      expect(total, crop.id).toBeLessThanOrEqual(SEASON_DAYS);
    }
  });

  it('has a fr-CA and an en name for every item, and no extra names', () => {
    const ids = loadGameData().items.map((item) => item.id);
    const fr = namesOf(frJson);
    const en = namesOf(enJson);
    for (const id of ids) {
      expect(fr[id], `fr ${id}`).toBeTruthy();
      expect(en[id], `en ${id}`).toBeTruthy();
    }
    const known = new Set(ids);
    for (const id of Object.keys(fr)) expect(known.has(id), `extra fr ${id}`).toBe(true);
    for (const id of Object.keys(en)) expect(known.has(id), `extra en ${id}`).toBe(true);
  });

  it('parses the same data twice to equal values', () => {
    expect(parseGameData(raw())).toEqual(parseGameData(raw()));
  });
});

describe('schemas', () => {
  it('rejects a food item without edibility and a non-food with it', () => {
    expect(ItemSchema.safeParse({ id: 'pie', kind: 'food', category: 'open', buy: null, value: 5 }).success).toBe(false);
    expect(
      ItemSchema.safeParse({ id: 'rock', kind: 'material', category: 'open', buy: null, value: 5, edibility: 3 }).success,
    ).toBe(false);
  });

  it('allows a sprinkler effect only on buildings', () => {
    const effect = { kind: 'sprinkler', radius: 1 };
    expect(ItemSchema.safeParse({ id: 'pot', kind: 'building', category: 'open', buy: null, value: 5, effect }).success).toBe(true);
    expect(ItemSchema.safeParse({ id: 'pot', kind: 'material', category: 'open', buy: null, value: 5, effect }).success).toBe(false);
  });

  it('rejects ids that are not lower_snake', () => {
    expect(ItemSchema.safeParse({ id: 'Bad-Id', kind: 'fish', category: 'open', buy: null, value: 5 }).success).toBe(false);
  });

  it('rejects crop stages longer than a season', () => {
    const crop = { id: 'x', item: 'x', seed: 'x_seed', seasons: ['spring'], stages: [10, 10, 9], regrowDays: null, yield: { min: 1, max: 1 } };
    expect(CropSchema.safeParse(crop).success).toBe(false);
    expect(CropSchema.safeParse({ ...crop, stages: [10, 10, 8] }).success).toBe(true);
  });

  it('rejects a fishing window that ends before it starts', () => {
    const fish = { id: 'f', habitat: 'lake', seasons: ['spring'], hours: { from: 18, to: 12 }, difficulty: 3, weight: 5, barSpeed: 1 };
    expect(FishSchema.safeParse(fish).success).toBe(false);
  });

  it('allows bar bonus only on rods', () => {
    const hoe = { id: 'hoe_1', tool: 'hoe', tier: 1, energy: 2, power: 1, speed: 1, radius: 0, barBonus: 8 };
    expect(ToolSchema.safeParse(hoe).success).toBe(false);
  });

  it('does not allow one item in two gift lists of the same npc', () => {
    const profile = { npc: 'zoe', love: ['honey_bread'], like: ['honey_bread'], dislike: [], hate: [] };
    expect(GiftProfileSchema.safeParse(profile).success).toBe(false);
  });
});

describe('cross-references', () => {
  it('reports a recipe input that does not exist', () => {
    const data = raw();
    (data.recipes as { recipes: { inputs: { item: string }[] }[] }).recipes[0]!.inputs[0]!.item = 'nope_item';
    expect(() => parseGameData(data)).toThrow(GameDataError);
    try {
      parseGameData(data);
    } catch (error) {
      expect((error as GameDataError).issues).toContain('recipes.fence.inputs: unknown item nope_item');
    }
  });

  it('reports a food item that no recipe cooks', () => {
    const game = loadGameData();
    const issues = checkCrossRefs({ ...game, recipes: game.recipes.filter((r) => r.id !== 'cloud_cake') });
    expect(issues).toContain('items: food cloud_cake has no recipe');
  });

  it('reports a tool item without a tool row', () => {
    const data = raw();
    const tools = data.tools as { tools: { id: string }[] };
    tools.tools = tools.tools.filter((t) => t.id !== 'hoe_1');
    try {
      parseGameData(data);
      expect.fail('should throw');
    } catch (error) {
      expect((error as GameDataError).issues).toContain('tools: item hoe_1 has no tool row');
    }
  });

  it('reports a crop whose seed is not a seed item', () => {
    const data = raw();
    const crops = data.crops as { crops: { seed: string }[] };
    crops.crops[0]!.seed = 'dawn_radish';
    expect(() => parseGameData(data)).toThrow(GameDataError);
  });

  it('collects problems from every file in one error', () => {
    const data = raw();
    (data.items as { items: unknown[] }).items = [{ id: 'X' }];
    (data.crops as { crops: { stages: number[] }[] }).crops[0]!.stages = [40];
    try {
      parseGameData(data);
      expect.fail('should throw');
    } catch (error) {
      const issues = (error as GameDataError).issues;
      expect(issues.some((line) => line.startsWith('items'))).toBe(true);
      expect(issues.some((line) => line.startsWith('crops'))).toBe(true);
    }
  });
});

describe('progression and harvest data (P17.20)', () => {
  it('grants a starter kit that only names items and fits the inventory slots', () => {
    const game = loadGameData();
    const kit = game.progression.starterKit;
    expect(Object.keys(kit.items).length).toBeLessThanOrEqual(36);
    for (const id of Object.keys(kit.items)) expect(game.itemsById.get(id)?.kind).toBeDefined();
    expect(kit.money).toBeGreaterThan(0);
  });

  it('reports a starter kit item that does not exist', () => {
    const data = raw();
    (data.progression as { progression: { starterKit: { items: Record<string, number> } } }).progression.starterKit.items.nope_item = 1;
    try {
      parseGameData(data);
      expect.fail('should throw');
    } catch (error) {
      expect((error as GameDataError).issues).toContain('progression.starterKit.items: unknown item nope_item');
    }
  });

  it('gives every block drop an item that exists, and every harvest a tool kind that exists', () => {
    const items = new Set(loadGameData().items.map((item) => item.id));
    const blocks = (blocksJson as { blocks: { id: string; harvest?: { tool: string; drops: { item: string }[] } }[] }).blocks;
    const tools = new Set(loadGameData().tools.map((tool) => tool.tool));
    for (const block of blocks) {
      if (!block.harvest) continue;
      for (const drop of block.harvest.drops) expect(items.has(drop.item), `${block.id} drops ${drop.item}`).toBe(true);
      if (block.harvest.tool !== 'hand' && block.harvest.tool !== 'shovel')
        expect(tools.has(block.harvest.tool as never), `${block.id} needs ${block.harvest.tool}`).toBe(true);
    }
  });
});
