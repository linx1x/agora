import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  ACTIVITY,
  TICK_HZ,
  TILE,
  cellPos,
  collides,
  parseMap,
  petSpots,
  zoneAt,
  type PetSpot,
  type Tmj,
} from '@agora/shared';
import { OfficeCat, type PetHost } from './pets';

const load = () =>
  parseMap(
    JSON.parse(
      readFileSync(new URL('../../../../packages/maps/hq.tmj', import.meta.url), 'utf8'),
    ) as Tmj,
  );
const STEP = 1000 / TICK_HZ;

function seeded(seed: number) {
  let s = seed >>> 0 || 1;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 2 ** 32;
  };
}

function setup(seed: number, open: (x: number, y: number) => boolean = () => true) {
  const map = load();
  const h = { rev: 1 };
  const host: PetHost = { map: () => map, rev: () => h.rev, podOpen: open };
  const cat = new OfficeCat(host, seeded(seed));
  let now = 1000;
  const run = (seconds: number, each: () => void = () => {}) => {
    for (let i = 0; i < seconds * TICK_HZ; i++) {
      now += STEP;
      cat.tick(now);
      each();
    }
  };
  return { map, host, cat, h, run, now: () => now };
}

const near = (spot: PetSpot, x: number, y: number) => Math.hypot(spot.x - x, spot.y - y) < 1.5;

describe('office cat needs (ADR-041)', () => {
  it('a thirsty cat walks to water and drinks', () => {
    let drank = 0;
    for (const seed of [1, 2, 3, 4]) {
      const { map, cat, run } = setup(seed);
      cat.needs.thirst = 1;
      const spots = petSpots(map).filter((s) => s.kind === 'drink');
      let at = false;
      run(120, () => {
        if (cat.state.a === 'drink' && spots.some((s) => near(s, cat.state.x, cat.state.y)))
          at = true;
      });
      if (at) drank++;
      expect(cat.needs.thirst, `seed ${seed}`).toBeLessThan(0.9);
    }
    expect(drank).toBe(4);
  });

  it('a tired cat sleeps on a sofa, inside the solid cell, and gets down again', () => {
    const { map, cat, run } = setup(5);
    cat.needs.energy = 1;
    const sleeps = petSpots(map).filter((s) => s.kind === 'sleep');
    let slept = false;
    let perchedSeen = false;
    run(180, () => {
      if (cat.state.a === 'sleep')
        slept = sleeps.some((s) => near(s, cat.state.x, cat.state.y)) || slept;
      if (cat.perched) perchedSeen = true;
    });
    expect(slept).toBe(true);
    expect(perchedSeen).toBe(true);
    // the nap is long (25–50 s); when it is over the cat hops down and stretches on the floor
    let stretched = false;
    run(120, () => {
      if (cat.state.a === 'stretch' && !stretched) {
        stretched = true;
        expect(cat.perched).toBe(false);
        expect(collides(map, cat.state.x, cat.state.y)).toBe(false);
      }
    });
    expect(stretched).toBe(true);
    expect(cat.needs.energy).toBeLessThan(0.9);
  });

  it('with nothing needed it wanders and explores: it keeps moving and visits many cells', () => {
    const { cat, run } = setup(7);
    const cells = new Set<string>();
    run(300, () =>
      cells.add(`${Math.floor(cat.state.x / TILE)},${Math.floor(cat.state.y / TILE)}`),
    );
    expect(cells.size).toBeGreaterThan(40);
  });

  it('a perched cat never moves faster than a walking one', () => {
    const { cat, run } = setup(5);
    cat.needs.energy = 1;
    let last = { x: cat.state.x, y: cat.state.y };
    let max = 0;
    run(120, () => {
      max = Math.max(max, Math.hypot(cat.state.x - last.x, cat.state.y - last.y));
      last = { x: cat.state.x, y: cat.state.y };
    });
    expect(max).toBeLessThanOrEqual((4 * TILE * 0.6) / TICK_HZ + 0.5);
  });

  it('is put back on the floor within one tick when its sofa is removed', () => {
    const { map, cat, h, run, now } = setup(5);
    cat.needs.energy = 1;
    let guard = 0;
    run(180, () => {
      if (!cat.perched && guard++ > 100_000) throw new Error('unreachable');
    });
    // find a moment when it sleeps perched
    for (let i = 0; i < 400 && !(cat.perched && cat.state.a === 'sleep'); i++) run(1);
    expect(cat.perched).toBe(true);
    const cx = Math.floor(cat.state.x / TILE);
    const cy = Math.floor((cat.state.y - 1) / TILE);
    // the sofa is deleted by a builder: the cell becomes free floor
    map.layers.furniture![cy * map.width + cx] = 0;
    map.solid[cy * map.width + cx] = 0;
    h.rev++;
    const t = now() + STEP;
    cat.tick(t);
    expect(cat.perched).toBe(false);
    expect(collides(map, cat.state.x, cat.state.y)).toBe(false);
  });

  it('never goes to a spot inside a pod it may not enter', () => {
    const { map } = setup(1);
    const spot = map.desks.find((d) => d.id === 'jungle-1')!;
    const locked = (x: number, y: number) => zoneAt(map, x, y)?.id !== 'jungle-1';
    const inPod = petSpots(map).filter((s) => zoneAt(map, s.x, s.y)?.id === 'jungle-1');
    expect(inPod.length, 'the pod has desk tops to perch on').toBeGreaterThan(0);
    let controlHits = 0;
    let lockedHits = 0;
    for (let seed = 1; seed <= 30; seed++) {
      for (const open of [true, false]) {
        const s = setup(seed, open ? () => true : locked);
        s.cat.needs.curiosity = 1;
        Object.assign(s.cat.state, cellPos(s.map, spot.entrance));
        s.run(60, () => {
          if (zoneAt(s.map, s.cat.state.x, s.cat.state.y)?.id === 'jungle-1') {
            if (open) controlHits++;
            else lockedHits++;
          }
        });
      }
    }
    expect(controlHits, 'control: an open pod is visited').toBeGreaterThan(0);
    expect(lockedHits).toBe(0);
  });

  it('activities give relief and last as long as the table says', () => {
    for (const k of ['drink', 'sleep', 'loaf', 'perch'] as const) {
      const a = ACTIVITY[k];
      expect(a.seconds[0]).toBeGreaterThan(0);
      expect(a.seconds[1]).toBeGreaterThanOrEqual(a.seconds[0]);
      expect(Object.values(a.relief).every((v) => v! > 0)).toBe(true);
    }
  });
});
