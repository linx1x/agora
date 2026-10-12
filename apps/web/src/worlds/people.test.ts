import { describe, expect, it } from 'vitest';
import { randomAvatar, type WorldPerson } from '@agora/shared';
import { worldPeopleRows } from './people';

const person = (id: string, name: string): WorldPerson => ({
  id,
  name,
  avatar: randomAvatar(),
  x: 0,
  y: 0,
  d: 'down',
});

describe('the People panel inside a world (P17.15b)', () => {
  it('lists the people of the world only, me first, then by name', () => {
    const rows = worldPeopleRows(
      [person('b', 'Benoît'), person('me', 'Alice'), person('c', 'Chloé')],
      'me',
    );
    expect(rows.map((r) => [r.name, r.you])).toEqual([
      ['Alice', true],
      ['Benoît', false],
      ['Chloé', false],
    ]);
  });

  it('adds me once when the world list does not carry me, and never twice', () => {
    const mine = { name: 'Alice', avatar: randomAvatar() };
    expect(worldPeopleRows([person('b', 'Benoît')], 'me', mine).map((r) => r.id)).toEqual([
      'me',
      'b',
    ]);
    expect(worldPeopleRows([person('me', 'Alice')], 'me', mine).map((r) => r.id)).toEqual(['me']);
  });
});
