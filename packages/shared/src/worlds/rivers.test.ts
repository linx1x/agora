import { describe, expect, it } from 'vitest';
import { elevationAt, levelOf, seedsOf } from './fields';
import { WORLDGEN } from './gen';
import { worldSeedFor } from './noise';
import { generateChunk } from './terrain';
import {
  NO_RIVER,
  RIVER_FLOW,
  RIVER_LAKE,
  RIVER_REGION_CELLS,
  buildRiverRegion,
  riverAt,
  riverRegion,
} from './rivers';

const P = WORLDGEN.params;
const SEED = worldSeedFor('golden-1');
const SEEDS = seedsOf(SEED);
const SIZE = RIVER_REGION_CELLS;
const NEIGHBOURS: readonly (readonly [number, number])[] = [
  [1, 0],
  [1, 1],
  [0, 1],
  [-1, 1],
  [-1, 0],
  [-1, -1],
  [0, -1],
  [1, -1],
];

/** The lowest neighbour strictly below (x, y), in the same order the trace uses; null at a minimum. */
function lowerNeighbour(x: number, y: number): [number, number] | null {
  let best = elevationAt(SEEDS, x, y, P);
  let next: [number, number] | null = null;
  for (const [dx, dy] of NEIGHBOURS) {
    const e = elevationAt(SEEDS, x + dx, y + dy, P);
    if (e < best) {
      best = e;
      next = [dx, dy];
    }
  }
  return next ? [x + next[0], y + next[1]] : null;
}

describe('buildRiverRegion', () => {
  it('is repeatable', () => {
    const a = buildRiverRegion(SEED, 0, 0, P);
    const b = buildRiverRegion(SEED, 0, 0, P);
    expect(Array.from(a.cells)).toEqual(Array.from(b.cells));
  });

  // Reference values from this module, reproduced exactly by an independent Python port.
  it('matches the reference region digests and counts', () => {
    const digest = (rx: number, ry: number) => {
      const region = buildRiverRegion(SEED, rx, ry, P);
      const count = (v: number) => region.cells.reduce((n, c) => n + (c === v ? 1 : 0), 0);
      return { flow: count(RIVER_FLOW), lake: count(RIVER_LAKE) };
    };
    expect(digest(0, 0)).toEqual({ flow: 179, lake: 405 });
    expect(digest(-1, 2)).toEqual({ flow: 253, lake: 488 });
    expect(Array.from(buildRiverRegion(SEED, 0, 0, P).cells).join(',').length).toBeGreaterThan(0);
  });

  it('has rivers in most regions of a sample', () => {
    let withRivers = 0;
    for (let rx = -1; rx <= 1; rx++) {
      for (let ry = -1; ry <= 1; ry++) {
        if (buildRiverRegion(SEED, rx, ry, P).cells.some((c) => c === RIVER_FLOW)) withRivers++;
      }
    }
    expect(withRivers).toBeGreaterThanOrEqual(6);
  });

  it('builds a region in well under 100 ms (logged)', () => {
    const started = performance.now();
    buildRiverRegion(SEED, 3, -4, P);
    const ms = performance.now() - started;
    console.info(`river region build: ${ms.toFixed(1)} ms`);
    expect(ms).toBeLessThan(100);
  });
});

describe('rivers flow to the sea or a lake', () => {
  it('follows every river cell downhill into the sea or a lake, across region borders', () => {
    const regions = [
      [0, 0],
      [1, 0],
      [0, 1],
    ] as const;
    let checked = 0;
    for (const [rx, ry] of regions) {
      const region = buildRiverRegion(SEED, rx, ry, P);
      for (let k = 0; k < region.cells.length; k++) {
        if (region.cells[k] !== RIVER_FLOW) continue;
        let x = rx * SIZE + (k % SIZE);
        let y = ry * SIZE + Math.floor(k / SIZE);
        let reached = false;
        for (let step = 0; step < 400 && !reached; step++) {
          checked++;
          if (elevationAt(SEEDS, x, y, P) < P.seaElevation) {
            reached = true;
            break;
          }
          if (riverAt(SEED, x, y, P) === RIVER_LAKE) {
            reached = true;
            break;
          }
          const next = lowerNeighbour(x, y);
          if (!next) throw new Error(`river cell ${x},${y} has no way down and is not a lake`);
          const [nx, ny] = next;
          const onRiverOrSea =
            riverAt(SEED, nx, ny, P) !== NO_RIVER || elevationAt(SEEDS, nx, ny, P) < P.seaElevation;
          if (!onRiverOrSea) throw new Error(`river at ${x},${y} runs into dry land at ${nx},${ny}`);
          x = nx;
          y = ny;
        }
        expect(reached, `river from region ${rx},${ry} cell ${k} never reached water`).toBe(true);
      }
    }
    expect(checked).toBeGreaterThan(1000);
  });

  it('continues across region borders: rivers leave one region and enter its neighbour', () => {
    let crossings = 0;
    for (let rx = -1; rx <= 1; rx++) {
      for (let ry = -1; ry <= 1; ry++) {
        const x0 = rx * SIZE;
        const y0 = ry * SIZE;
        for (let j = 0; j < SIZE; j++) {
          for (const x of [x0 + SIZE - 1, x0]) {
            const y = y0 + j;
            if (riverAt(SEED, x, y, P) !== RIVER_FLOW) continue;
            const next = lowerNeighbour(x, y);
            if (next && Math.floor(next[0] / SIZE) !== rx && riverAt(SEED, next[0], next[1], P) !== NO_RIVER) {
              crossings++;
            }
          }
        }
      }
    }
    expect(crossings).toBeGreaterThan(0);
  });

  it('lakes are land at or above sea level', () => {
    const region = buildRiverRegion(SEED, 0, 0, P);
    for (let k = 0; k < region.cells.length; k++) {
      if (region.cells[k] !== RIVER_LAKE) continue;
      const x = k % SIZE;
      const y = Math.floor(k / SIZE);
      expect(elevationAt(SEEDS, x, y, P)).toBeGreaterThanOrEqual(P.seaElevation);
    }
  });
});

describe('river cells in chunks', () => {
  it('are water at or above sea level in generated chunks', () => {
    const chunk = generateChunk(SEED, 0, 0, P);
    const seaLevel = levelOf(P.seaElevation);
    let rivers = 0;
    for (let j = 0; j < 32; j++) {
      for (let i = 0; i < 32; i++) {
        const k = j * 32 + i;
        if (riverAt(SEED, i, j, P) === NO_RIVER) continue;
        rivers++;
        expect(chunk.block[k]).toBe('water');
        expect(chunk.level[k]).toBeGreaterThanOrEqual(seaLevel);
      }
    }
    expect(rivers).toBeGreaterThan(0);
  });

  it('riverRegion is cached and riverAt reads the right cell for negative coordinates', () => {
    expect(riverRegion(SEED, -1, -1, P)).toBe(riverRegion(SEED, -1, -1, P));
    const region = riverRegion(SEED, -1, -1, P);
    expect(riverAt(SEED, -1, -1, P)).toBe(region.cells[(SIZE - 1) * SIZE + (SIZE - 1)] ?? 0);
  });
});
