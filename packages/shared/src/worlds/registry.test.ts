import { describe, expect, it } from 'vitest';
import {
  BLOCKS,
  SPRITE_KEY,
  WorldDataError,
  getBlock,
  parseBlockRegistry,
  resolveSprite,
} from './registry';

function row(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 'test_block',
    layer: 'decor',
    sprite: 'worlds/shared/test_block',
    solid: true,
    liquid: false,
    height: 1,
    ...overrides,
  };
}

function file(...blocks: Record<string, unknown>[]): unknown {
  return { version: 1, blocks };
}

describe('shipped block registry', () => {
  it('loads blocks.json with unique ids and well-formed sprite keys', () => {
    expect(BLOCKS.list.length).toBeGreaterThanOrEqual(20);
    expect(BLOCKS.byId.size).toBe(BLOCKS.list.length);
    for (const block of BLOCKS.list) {
      expect(block.sprite).toMatch(SPRITE_KEY);
    }
  });

  it('covers the four biomes with ground and decor', () => {
    for (const biome of ['meadow', 'jungle', 'desert', 'taiga']) {
      const ground = BLOCKS.list.filter((b) => b.layer === 'ground' && b.biomes.includes(biome));
      expect(ground.length, `ground blocks for ${biome}`).toBeGreaterThanOrEqual(2);
    }
    expect(BLOCKS.list.some((b) => b.liquid && b.id === 'water')).toBe(true);
  });

  it('every block resolves to a file when one exists, else to the code placeholder', () => {
    const files = new Set(BLOCKS.list.map((b) => b.sprite));
    for (const block of BLOCKS.list) {
      expect(resolveSprite(block.sprite, new Set()).kind).toBe('placeholder');
      expect(resolveSprite(block.sprite, files)).toEqual({ kind: 'file', key: block.sprite });
    }
  });

  it('harvestable blocks are decor with a positive hit count', () => {
    const harvestable = BLOCKS.list.filter((b) => b.harvest);
    expect(harvestable.length).toBeGreaterThan(0);
    for (const block of harvestable) {
      expect(block.layer).toBe('decor');
      expect(block.harvest?.hits).toBeGreaterThan(0);
    }
  });

  it('getBlock returns the row or undefined', () => {
    expect(getBlock(BLOCKS, 'water')?.liquid).toBe(true);
    expect(getBlock(BLOCKS, 'no_such_block')).toBeUndefined();
  });
});

describe('parseBlockRegistry errors', () => {
  it('accepts a minimal valid file and applies defaults', () => {
    const reg = parseBlockRegistry(file(row()));
    const block = getBlock(reg, 'test_block');
    expect(block?.states).toEqual([]);
    expect(block?.biomes).toEqual([]);
    expect(block?.light).toBe(0);
    expect(block?.placeable).toBe(false);
  });

  function messageOf(raw: unknown): string {
    try {
      parseBlockRegistry(raw, 'blocks.json');
    } catch (err) {
      expect(err).toBeInstanceOf(WorldDataError);
      return (err as Error).message;
    }
    throw new Error('expected a WorldDataError');
  }

  it('names the file and path of a bad height', () => {
    const message = messageOf(file(row(), row({ id: 'tall', height: 8 })));
    expect(message).toMatch(/^blocks\.json: blocks\.1\.height: /);
  });

  it('rejects a sprite that is a file path rather than a key', () => {
    const message = messageOf(file(row({ sprite: 'assets/worlds/x.png' })));
    expect(message).toContain('blocks.0.sprite');
  });

  it('rejects duplicate ids', () => {
    const message = messageOf(file(row(), row()));
    expect(message).toContain('duplicate id "test_block"');
  });

  it('rejects a liquid that is also solid', () => {
    const message = messageOf(file(row({ layer: 'ground', solid: true, liquid: true, height: 0 })));
    expect(message).toContain('a liquid cannot also be solid');
  });

  it('rejects ground blocks with a height above 0', () => {
    expect(messageOf(file(row({ layer: 'ground', solid: false, height: 2 })))).toContain(
      'ground blocks have height 0',
    );
  });

  it('rejects a harvest tier out of range, an unknown tool and min > max drops', () => {
    const base = (harvest: unknown) => file(row({ harvest }));
    expect(messageOf(base({ tool: 'axe', minTier: 4, hits: 1, drops: [] }))).toContain(
      'blocks.0.harvest.minTier',
    );
    expect(messageOf(base({ tool: 'laser', minTier: 0, hits: 1, drops: [] }))).toContain(
      'blocks.0.harvest.tool',
    );
    expect(
      messageOf(base({ tool: 'axe', minTier: 0, hits: 1, drops: [{ item: 'wood', min: 3, max: 1 }] })),
    ).toContain('min must be <= max');
  });

  it('rejects unknown keys so typos do not pass silently', () => {
    expect(messageOf(file(row({ solidd: true })))).toContain('blocks.0');
  });

  it('rejects a file without blocks', () => {
    expect(messageOf({ version: 1, blocks: [] })).toContain('blocks');
  });
});
