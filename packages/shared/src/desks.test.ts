import { describe, expect, it } from 'vitest';
import { DEFAULT_DECOR, podAllows, type DeskState } from './desks';

const desk = (access: DeskState['access'], owned = true): DeskState => ({
  id: 'jungle-1',
  ownerName: owned ? 'Alice' : null,
  ownerId: null,
  access,
  decor: DEFAULT_DECOR,
});

describe('podAllows', () => {
  it('unclaimed pods are open to everyone', () =>
    expect(podAllows(desk('closed', false), false, false)).toBe(true));
  it('owner always allowed', () => expect(podAllows(desk('closed'), true, false)).toBe(true));
  it('open lets anyone in', () => expect(podAllows(desk('open'), false, false)).toBe(true));
  it('knock needs admission', () => {
    expect(podAllows(desk('knock'), false, false)).toBe(false);
    expect(podAllows(desk('knock'), false, true)).toBe(true);
  });
  it('closed keeps visitors out even if admitted earlier', () =>
    expect(podAllows(desk('closed'), false, true)).toBe(false));
});
