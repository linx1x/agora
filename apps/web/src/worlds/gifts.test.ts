import { describe, expect, it } from 'vitest';
import { loadGameData } from '@agora/shared';
import { giftableStacks } from './gifts';

const data = loadGameData();

describe('what the Talk box offers to give (P17.26b)', () => {
  it('lists what a character accepts, keeps quality stacks, and leaves out tools and empty stacks', () => {
    const crop = data.items.find((i) => i.kind === 'crop')!.id;
    const seed = data.items.find((i) => i.kind === 'seed')!.id;
    const tool = data.items.find((i) => i.kind === 'tool')!.id;
    expect(giftableStacks({ [tool]: 1, [crop]: 2, [`${crop}~2`]: 1, [seed]: 0 })).toEqual([
      [crop, 2],
      [`${crop}~2`, 1],
    ]);
  });
});
