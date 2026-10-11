import { describe, expect, it } from 'vitest';
import { loadGameData } from '@agora/shared';
import { offerFromDraft, tradeableStacks } from './tradeMath';

const data = loadGameData();

describe('the trade panel (P17.29)', () => {
  it('offers only open and limited stacks the bag holds', () => {
    const crop = data.items.find((i) => i.category === 'open' && i.kind === 'crop')!.id;
    const tool = data.items.find((i) => i.category === 'restricted')!.id;
    expect(tradeableStacks({ [tool]: 1, [crop]: 3, [`${crop}~2`]: 0 })).toEqual([[crop, 3]]);
  });

  it('a draft keeps only positive quantities', () => {
    expect(offerFromDraft({ a: 2, b: 0 }, 5)).toEqual({ items: { a: 2 }, money: 5 });
  });
});
