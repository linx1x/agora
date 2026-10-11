import { describe, expect, it } from 'vitest';
import { WORLDGEN, feetCell, randomAvatar, worldSeedFor, type S2CMsg } from '@agora/shared';
import { WorldSession } from './session';
import { WorldWalker, cellFeet } from './walker';
import { vi } from 'vitest';

// the realtime client loads the UI's i18n at import (it needs a DOM); the world logic only uses
// its `on`, `send`, `sendMove` and `samples`, so the tests replace it
vi.mock('../net/client', () => ({
  world: { on: () => () => {}, send: () => {}, sendMove: () => {}, samples: new Map() },
}));

/** Chunk (0, 0) flattened to level 2 meadow in cells 0..9 x 0..9: a plain to walk on. */
function plainSession(): WorldSession {
  const s = new WorldSession();
  s.handle({
    t: 'world:welcome',
    owner: 'Alice Tremblay',
    worldId: 'w-walk',
    you: 'me',
    seed: worldSeedFor('walker'),
    genVersion: WORLDGEN.genVersion,
    params: WORLDGEN.params,
    people: [{ id: 'me', name: 'Alice', avatar: randomAvatar(() => 0.2), x: 144, y: 154, d: 'down' }],
  } as S2CMsg);
  const delta: Record<string, { level: number; block: string; decor: string }> = {};
  for (let j = 0; j < 10; j++)
    for (let i = 0; i < 10; i++) delta[String(j * 32 + i)] = { level: 2, block: 'meadow_grass', decor: '' };
  s.handle({ t: 'world:chunks', add: [{ cx: 0, cy: 0, rev: 1, delta }], drop: [] });
  return s;
}

describe('WorldWalker (P17.14): prediction, routes and corrections', () => {
  it('walks with the keys and turns to face the way it goes', () => {
    const s = plainSession();
    const w = new WorldWalker(s);
    w.place(144, 154);
    w.step(50, [1, 0]);
    expect(w.x).toBeGreaterThan(144);
    expect(w.d).toBe('right');
    expect(w.moving).toBe(true);
    w.step(50, [0, 0]);
    expect(w.moving).toBe(false);
  });

  it('routes to a clicked cell and stops there', () => {
    const s = plainSession();
    const w = new WorldWalker(s);
    w.place(144, 154);
    expect(w.goTo({ cx: 7, cy: 4 })).toBe(true);
    expect(w.path.length).toBeGreaterThan(0);
    for (let i = 0; i < 400 && w.path.length > 0; i++) w.step(16, [0, 0]);
    expect(w.path).toHaveLength(0);
    expect(feetCell(w.x, w.y)).toEqual({ cx: 7, cy: 4 });
    expect(w.x).toBeCloseTo(cellFeet({ cx: 7, cy: 4 }).x, -1);
  });

  it('refuses a route to a cell it cannot reach, and keeps its place', () => {
    const s = plainSession();
    const w = new WorldWalker(s);
    w.place(144, 154);
    // a cell far outside the flattened plain is generated terrain: a route may or may not exist,
    // so only the walker's own rule is checked: a null route is refused without moving
    const before = { x: w.x, y: w.y };
    const reached = w.goTo({ cx: 100000, cy: 100000 });
    expect(reached).toBe(false);
    expect({ x: w.x, y: w.y }).toEqual(before);
  });

  it('takes the server\'s correction once and stands where the server says', () => {
    const s = plainSession();
    const w = new WorldWalker(s);
    w.place(144, 154);
    s.handle({ t: 'world:correction', x: 60, y: 70, seq: 3, reason: 'collision' });
    w.step(16, [0, 0]);
    expect({ x: w.x, y: w.y }).toEqual({ x: 60, y: 70 });
    w.place(100, 100);
    w.step(16, [0, 0]);
    expect(w.x).toBe(100);
  });

  it('does not move at all while the world is closed', () => {
    const w = new WorldWalker(new WorldSession());
    w.place(5, 5);
    w.step(50, [1, 1]);
    expect({ x: w.x, y: w.y }).toEqual({ x: 5, y: 5 });
    expect(w.goTo({ cx: 1, cy: 1 })).toBe(false);
  });
});
