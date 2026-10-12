import { describe, expect, it } from 'vitest';
import { permsToShow, toggled } from './visitorsMath';

describe('the visitors panel (P17.27)', () => {
  it('turns one kind on or off and keeps the stable order, never a closed kind', () => {
    expect(toggled(['take'], 'harvest', true)).toEqual(['harvest', 'take']);
    expect(toggled(['harvest', 'take'], 'harvest', false)).toEqual(['take']);
    expect(toggled([], 'till', true)).toEqual([]);
  });

  it('tells a visitor what they may do, without eating', () => {
    expect(permsToShow(['water', 'eat', 'harvest'])).toEqual(['water', 'harvest']);
  });
});
