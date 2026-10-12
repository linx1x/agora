import { describe, expect, it } from 'vitest';
import { canDo } from './actions/permissions';
import {
  CONTRACT_OPEN_MAX,
  advance,
  contractFor,
  contractKinds,
  contractView,
  planPost,
  type Contract,
} from './contracts';

const base: Contract = {
  id: 'c1',
  worldId: 'w1',
  ownerId: 'owner',
  kind: 'chop',
  goal: 2,
  reward: 50,
  progress: {},
  state: 'open',
  winner: null,
  createdAt: 10,
  closedAt: null,
};

describe('world contracts (P17.28)', () => {
  it('posts only valid numbers, under the open limit, with the money in the account', () => {
    expect(planPost(100, 0, { kind: 'chop', goal: 5, reward: 50 })).toEqual({ ok: true });
    expect(planPost(100, 0, { kind: 'till', goal: 5, reward: 50 })).toEqual({ ok: false, reason: 'invalid' });
    expect(planPost(100, 0, { kind: 'chop', goal: 0, reward: 50 })).toEqual({ ok: false, reason: 'invalid' });
    expect(planPost(100, 0, { kind: 'chop', goal: 2.5, reward: 50 })).toEqual({ ok: false, reason: 'invalid' });
    expect(planPost(100, 0, { kind: 'chop', goal: 5, reward: 0 })).toEqual({ ok: false, reason: 'invalid' });
    expect(planPost(100, CONTRACT_OPEN_MAX, { kind: 'chop', goal: 5, reward: 50 })).toEqual({ ok: false, reason: 'limit' });
    expect(planPost(49, 0, { kind: 'chop', goal: 5, reward: 50 })).toEqual({ ok: false, reason: 'money' });
  });

  it('counts each worker apart; the first to the goal wins and closes it; the owner never counts', () => {
    let c = advance(base, 'owner', 1).contract;
    expect(c.progress).toEqual({});
    c = advance(c, 'ben', 2).contract;
    c = advance(c, 'chloe', 3).contract;
    const last = advance(c, 'chloe', 4);
    expect(last.done).toBe(true);
    expect(last.contract).toMatchObject({ state: 'done', winner: 'chloe', closedAt: 4, progress: { ben: 1, chloe: 2 } });
    // closed: nothing more counts
    expect(advance(last.contract, 'ben', 5)).toEqual({ contract: last.contract, done: false });
  });

  it('an action works on the oldest open contract of its kind', () => {
    const later = { ...base, id: 'c2', createdAt: 20 };
    const water = { ...base, id: 'c3', kind: 'water' as const, createdAt: 5 };
    expect(contractFor([later, base, water], 'chop')?.id).toBe('c1');
    expect(contractFor([later, base, water], 'mine')).toBeNull();
    expect(contractFor([{ ...base, state: 'cancelled' }], 'chop')).toBeNull();
  });

  it('an open contract opens its kind to visitors, and only a contract kind', () => {
    const world = { ownerId: 'owner', settings: {}, opened: contractKinds([base]) };
    expect(canDo({ ownerId: 'owner', settings: {} }, 'ben', 'chop')).toBe(false);
    expect(canDo(world, 'ben', 'chop')).toBe(true);
    expect(canDo(world, 'ben', 'mine')).toBe(false);
    expect(canDo({ ...world, opened: ['till'] }, 'ben', 'till')).toBe(false);
    expect(contractKinds([{ ...base, state: 'done' }])).toEqual([]);
  });

  it('a person sees their own progress and the best, never who', () => {
    const c = { ...base, goal: 9, progress: { ben: 3, chloe: 5 } };
    expect(contractView(c, 'ben')).toEqual({ id: 'c1', kind: 'chop', goal: 9, reward: 50, mine: 3, best: 5 });
    expect(JSON.stringify(contractView(c, 'ben'))).not.toContain('chloe');
  });
});
