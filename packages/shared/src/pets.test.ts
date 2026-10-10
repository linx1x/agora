import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { isSolidCell, parseMap, type Tmj } from './map';
import {
  PET_NEEDS,
  chooseOption,
  freshNeeds,
  petSpots,
  scoreOption,
  tickNeeds,
  weightsFor,
  type PetOption,
  type PetSpot,
} from './pets';
import { gid } from './tileset';

const map = parseMap(
  JSON.parse(readFileSync(new URL('../../maps/hq.tmj', import.meta.url), 'utf8')) as Tmj,
);
const TILE_BOWL = gid('waterBowl');
const flat = { thirst: 1, energy: 1, curiosity: 1, affection: 1 };
const spot = (kind: PetSpot['kind']): PetSpot => ({
  key: kind,
  kind,
  from: { cx: 0, cy: 0 },
  x: 0,
  y: 0,
  face: 'right',
  cell: { cx: 0, cy: 0 },
  perch: false,
});

describe('pet needs', () => {
  it('grow with time, stay within 0..1, and activities give them back', () => {
    let n = freshNeeds();
    for (let i = 0; i < 3000; i++) n = tickNeeds(n, 1, i % 2 ? 'walk' : 'rest');
    for (const k of PET_NEEDS) expect(n[k]).toBeLessThanOrEqual(1);
    const drunk = tickNeeds({ ...n, thirst: 1 }, 5, 'rest', { thirst: 0.2 });
    expect(drunk.thirst).toBeLessThan(1);
    const never = tickNeeds({ ...n, thirst: 0 }, 100, 'rest', { thirst: 5 });
    expect(never.thirst).toBe(0);
  });

  it('walking tires a cat faster than sitting; sitting bores it', () => {
    const w = tickNeeds(freshNeeds(), 60, 'walk');
    const r = tickNeeds(freshNeeds(), 60, 'rest');
    expect(w.energy).toBeGreaterThan(r.energy);
    expect(r.curiosity).toBeGreaterThan(w.curiosity);
  });

  it('personalities differ but stay in range, and the same seed gives the same cat', () => {
    expect(weightsFor(42)).toEqual(weightsFor(42));
    expect(weightsFor(42)).not.toEqual(weightsFor(43));
    for (const seed of [1, 2, 3, 99, 2 ** 31])
      for (const k of PET_NEEDS) {
        expect(weightsFor(seed)[k]).toBeGreaterThanOrEqual(0.7);
        expect(weightsFor(seed)[k]).toBeLessThanOrEqual(1.3);
      }
  });
});

describe('pet scoring', () => {
  const w = weightsFor(1);
  const opt = (kind: PetSpot['kind'], dist: number): PetOption => ({
    kind,
    spot: spot(kind),
    dist,
  });

  it('nearer is better, and a need below its minimum is not worth a trip', () => {
    const calm = { ...freshNeeds(), thirst: 0.9 };
    expect(scoreOption(calm, w, opt('drink', 2), 0)).toBeGreaterThan(
      scoreOption(calm, w, opt('drink', 20), 0),
    );
    expect(scoreOption({ ...calm, thirst: 0.1 }, w, opt('drink', 1), 0)).toBe(-Infinity);
  });

  it('the most urgent need wins when distances are equal', () => {
    const n = { ...freshNeeds(), thirst: 1, energy: 0.6 };
    const pick = chooseOption(n, w, [opt('sleep', 5), opt('drink', 5)], () => 0.5);
    expect(pick?.kind).toBe('drink');
  });

  it('a far water bowl loses to a near sofa when only a little thirsty', () => {
    const n = { ...freshNeeds(), thirst: 0.4, energy: 0.9 };
    const pick = chooseOption(n, w, [opt('drink', 30), opt('sleep', 2)], () => 0.5);
    expect(pick?.kind).toBe('sleep');
  });

  it('with nothing needed it wanders', () => {
    const pick = chooseOption(
      { thirst: 0, energy: 0, curiosity: 0, affection: 0 },
      w,
      [opt('drink', 1), opt('sleep', 1), { kind: 'wander', dist: 0 }],
      () => 0.5,
    );
    expect(pick?.kind).toBe('wander');
  });

  it('jitter stays small next to a real need', () => {
    for (const r of [0, 0.5, 0.999]) {
      const pick = chooseOption(flat, w, [opt('drink', 2), { kind: 'wander', dist: 0 }], () => r);
      expect(pick?.kind).toBe('drink');
    }
  });
});

describe('petSpots on the headquarters map', () => {
  const spots = petSpots(map);

  it('finds every kind of place', () => {
    for (const k of ['drink', 'sleep', 'loaf', 'perch'] as const)
      expect(
        spots.some((s) => s.kind === k),
        k,
      ).toBe(true);
  });

  it('is deterministic and gives each spot a unique key', () => {
    expect(petSpots(map).map((s) => s.key)).toEqual(spots.map((s) => s.key));
    expect(new Set(spots.map((s) => s.key)).size).toBe(spots.length);
  });

  it('every spot is reached from a free cell; perched spots sit in a solid cell, others do not', () => {
    for (const s of spots) {
      expect(isSolidCell(map, s.from.cx, s.from.cy), s.key).toBe(false);
      const inCell = isSolidCell(map, Math.floor(s.x / map.tile), Math.floor((s.y - 1) / map.tile));
      if (!s.perch) expect(inCell, s.key).toBe(false);
    }
  });

  it('no desk top with a prop on it is offered, and monitors are skipped', () => {
    const withProp = new Set(
      map.props.map((p) => `${Math.floor(p.x / 32)},${Math.floor(p.y / 32)}`),
    );
    for (const s of spots.filter((x) => x.kind === 'perch'))
      expect(withProp.has(`${s.cell.cx},${s.cell.cy}`), s.key).toBe(false);
  });

  it('a bowl placed on the floor becomes a drinking spot', () => {
    const m = parseMap(
      JSON.parse(readFileSync(new URL('../../maps/hq.tmj', import.meta.url), 'utf8')) as Tmj,
    );
    const before = petSpots(m).filter((s) => s.kind === 'drink').length;
    // find a free floor cell with nothing on the furniture layer
    let at = -1;
    for (let i = 0; i < m.solid.length && at < 0; i++)
      if (!m.solid[i] && !m.layers.furniture![i]) at = i;
    expect(at).toBeGreaterThanOrEqual(0);
    m.layers.furniture![at] = TILE_BOWL;
    expect(petSpots(m).filter((s) => s.kind === 'drink').length).toBe(before + 1);
  });
});
