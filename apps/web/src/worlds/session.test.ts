import { describe, expect, it } from 'vitest';
import {
  CAVE_ARRIVAL,
  CAVE_EXIT,
  WORLDGEN,
  canStep,
  caveIdOf,
  feetCell,
  randomAvatar,
  worldGenParamsFor,
  worldSeedFor,
  worldTime,
  weatherForecast,
  type S2CMsg,
} from '@agora/shared';
import { store } from '../state/store';
import { WorldSession, type WorldChange } from './session';
import { vi } from 'vitest';

// the realtime client loads the UI's i18n at import (it needs a DOM); the world logic only uses
// its `on`, `send`, `sendMove` and `samples`, so the tests replace it
vi.mock('../net/client', () => ({
  world: { on: () => () => {}, send: () => {}, sendMove: () => {}, samples: new Map() },
}));

const SEED = worldSeedFor('dev-alice');

function welcome(over: Partial<Extract<S2CMsg, { t: 'world:welcome' }>> = {}): S2CMsg {
  return {
    t: 'world:welcome',
    owner: 'Alice Tremblay',
    worldId: 'w-alice',
    you: 'me',
    seed: SEED,
    genVersion: WORLDGEN.genVersion,
    params: WORLDGEN.params,
    people: [{ id: 'me', name: 'Alice', avatar: randomAvatar(() => 0.3), x: 16, y: 26, d: 'down' }],
    ...over,
  };
}

/** A session that has been welcomed, with the change log it emitted. */
function open(): { s: WorldSession; changes: WorldChange[] } {
  const s = new WorldSession();
  const changes: WorldChange[] = [];
  s.on((c) => changes.push(c));
  s.handle(welcome());
  return { s, changes };
}

describe('WorldSession (P17.14): what the client knows about its world', () => {
  it('uses the server forecast and clears it on cave welcome and exit', () => {
    const { s } = open();
    const weather = weatherForecast(SEED, 5);
    s.handle({ t: 'world:time', time: worldTime(0, 4 * 1_200_000), weather });
    expect(s.weather).toEqual(weather);
    s.handle(welcome({ worldId: caveIdOf('w-alice', 1, 1) }));
    expect(s.weather).toBeNull();
    s.handle({ t: 'world:time', time: worldTime(0, 4 * 1_200_000) });
    expect(s.weather).toBeNull();
    s.handle({ t: 'world:time', time: worldTime(0, 0), weather });
    s.stop();
    expect(s.weather).toBeNull();
  });
  it('is closed until the server welcomes it into a world, then rebuilds the terrain from the seed', () => {
    const s = new WorldSession();
    expect(s.active).toBe(false);
    s.handle(welcome());
    expect(s.active).toBe(true);
    expect(s.worldId).toBe('w-alice');
    expect(s.you).toBe('me');
    expect(s.terrain?.seed).toBe(SEED);
    expect(s.people.get('me')?.name).toBe('Alice');
    expect(store.get().worldId).toBe('w-alice');
  });

  it('applies the deltas in view over the generated terrain, and forgets them when they leave view', () => {
    const { s, changes } = open();
    const base = s.terrain!.cellAt(3, 3).block;
    s.handle({
      t: 'world:chunks',
      add: [{ cx: 0, cy: 0, rev: 2, delta: { '99': { block: 'stone', decor: '' } } }],
      drop: [],
    });
    // local index 99 is cell (3, 3) of chunk (0, 0): j * 32 + i
    expect(s.terrain!.cellAt(3, 3).block).toBe('stone');
    expect(changes).toContain('chunks');
    s.handle({ t: 'world:chunks', add: [], drop: [{ cx: 0, cy: 0 }] });
    expect(s.terrain!.cellAt(3, 3).block).toBe(base);
  });

  it('keeps people from world:join, world:pos and world:depart, and only them', () => {
    const { s, changes } = open();
    s.handle({
      t: 'world:join',
      person: { id: 'b', name: 'Benoît', avatar: randomAvatar(() => 0.6), x: 40, y: 50, d: 'left' },
    });
    expect(s.people.get('b')).toMatchObject({ x: 40, y: 50 });
    s.handle({ t: 'world:pos', id: 'b', x: 44, y: 50, d: 'right' });
    expect(s.people.get('b')).toMatchObject({ x: 44, d: 'right' });
    s.handle({ t: 'world:depart', id: 'b' });
    expect(s.people.has('b')).toBe(false);
    expect(changes.filter((c) => c === 'people')).toHaveLength(3);
  });

  it('takes the farm layer as plots set and removed, and the day it is for', () => {
    const { s, changes } = open();
    const plot = { tilled: true, wateredOn: 4, crop: null, sprinkler: null, fertilizer: null };
    s.handle({ t: 'world:farm', day: 4, plots: { '5,6': plot } });
    expect(s.plots.get('5,6')).toEqual(plot);
    expect(s.farmDay).toBe(4);
    s.handle({ t: 'world:farm', day: 5, plots: { '5,6': null } });
    expect(s.plots.has('5,6')).toBe(false);
    expect(s.farmDay).toBe(5);
    expect(changes).toContain('farm');
  });

  it('keeps the clock from world:time', () => {
    const { s } = open();
    const time = { day: 3, season: 'spring', year: 1, hour: 9, minute: 30, dayOfSeason: 3 };
    s.handle({ t: 'world:time', time } as S2CMsg);
    expect(s.time).toEqual(time);
  });

  it('counts each server correction once, with its serial', () => {
    const { s, changes } = open();
    s.handle({ t: 'world:correction', x: 10, y: 20, seq: 7, reason: 'collision' });
    const first = s.correction!;
    s.handle({ t: 'world:correction', x: 10, y: 20, seq: 8, reason: 'speed' });
    expect(s.correction!.serial).toBe(first.serial + 1);
    expect(changes.filter((c) => c === 'correction')).toHaveLength(2);
  });

  it('ends the world on world:exit, and on an office welcome after a dropped connection', () => {
    const a = open();
    a.s.handle({ t: 'world:exit' });
    expect(a.s.active).toBe(false);
    expect(a.s.terrain).toBeNull();
    expect(a.changes).toContain('exit');
    expect(store.get().worldId).toBeNull();

    const b = open();
    b.s.handle({ t: 'welcome' } as unknown as S2CMsg);
    expect(b.s.active).toBe(false);
  });

  it('a refused world portal says why, and does not open a world', () => {
    const { s } = open();
    s.handle({ t: 'portal:refused', id: 'desk:x', reason: 'no_permission' });
    expect(s.active).toBe(true);
  });

  it('starts the person on the feet cell the server placed them on', () => {
    const { s } = open();
    expect(feetCell(s.people.get('me')!.x, s.people.get('me')!.y)).toEqual({ cx: 0, cy: 0 });
  });
});

describe('WorldSession: a cave (P17.32)', () => {
  it('a cave welcome builds the cave from its id and the world seed: the same for everyone in it', () => {
    const session = new WorldSession();
    const seed = worldSeedFor('cave-session');
    session.handle({
      t: 'world:welcome',
      worldId: caveIdOf('w-cave', 20, 4),
      owner: '',
      you: 'p1',
      seed,
      genVersion: 1,
      params: worldGenParamsFor(WORLDGEN, 1),
      people: [],
    } as S2CMsg);
    expect(session.terrain!.cellAt(CAVE_EXIT.x, CAVE_EXIT.y).decor).toBe('cave_mouth');
    expect(session.terrain!.cellAt(0, 0).block).toBe('cave_rock');
    // the rock is three levels up: no step onto it from the floor, so the walker cannot pass it
    const floor = session.terrain!.cellAt(CAVE_ARRIVAL.x, CAVE_ARRIVAL.y);
    expect(canStep(floor, session.terrain!.cellAt(0, 0))).toBe(false);
  });
});


it('forwards accepted peer actions and matching refusal tokens, and stops after leaving', () => {
 const {s}=open();const listener=vi.fn();const off=s.onAction(listener);
 s.handle({t:'world:action',id:'peer',kind:'water',dir:'left',at:{x:2,y:3},tier:2,speed:1.2});
 expect(listener).toHaveBeenLastCalledWith(expect.objectContaining({id:'peer',kind:'water',tier:2}));
 s.handle({t:'world:refused',op:7,reason:'missing'});
 expect(listener).toHaveBeenLastCalledWith({id:'me',kind:null,token:7});
 s.stop();s.handle({t:'world:action',id:'peer',kind:'plant',dir:'up'});expect(listener).toHaveBeenCalledTimes(2);
 off();
});
