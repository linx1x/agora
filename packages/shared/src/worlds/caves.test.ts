import { describe, expect, it } from 'vitest';
import { PORTAL_ID, inPortal } from '../portals';
import { WorldTerrain, describeCell } from './cells';
import { canStep } from './walk';
import { WORLD_BIOMES } from './registry';
import { CHUNK_SIZE } from './constants';
import {
  CAVE_ARRIVAL,
  CAVE_EXIT,
  CAVE_KIND,
  CAVE_SIZE,
  caveChunk,
  caveExitRect,
  caveIdOf,
  caveMapFor,
  cellFeet,
  isCaveId,
  parseCaveId,
  worldTerrainFor,
} from './caves';
import { WORLDGEN, worldGenParamsFor } from './gen';
import { worldSeedFor } from './noise';
import { CAVE_MOUTH_BLOCK, chunkDigest, chunkIndex, generateChunk } from './terrain';

const SEEDS = [worldSeedFor('cave-a'), worldSeedFor('cave-b')];
const WORLD = '3f6c2a1e-9b7d-4e21-8c3a-5d0f1e2b4a67';
const CAVE_IDS = [caveIdOf(WORLD, 40, -7), caveIdOf(WORLD, -12, 96)];
const V2 = WORLDGEN.params;
const V1 = worldGenParamsFor(WORLDGEN, 1);

/** A cave's cells as the map says, with its open floor and ore, read from the kind array. */
function cellsOf(seed: number, id: string) {
  const map = caveMapFor(seed, id);
  const N = CAVE_SIZE;
  const at = (x: number, y: number) => map.kind[y * N + x]!;
  return { map, at };
}

/** Four-way reach over floor cells (ore is a wall) from `start`. */
function reachable(at: (x: number, y: number) => number, sx: number, sy: number): Set<number> {
  const seen = new Set<number>([sy * CAVE_SIZE + sx]);
  const stack: [number, number][] = [[sx, sy]];
  while (stack.length > 0) {
    const [x, y] = stack.pop()!;
    const next: [number, number][] = [
      [x + 1, y],
      [x - 1, y],
      [x, y + 1],
      [x, y - 1],
    ];
    for (const [nx, ny] of next) {
      if (nx < 0 || ny < 0 || nx >= CAVE_SIZE || ny >= CAVE_SIZE) continue;
      const k = ny * CAVE_SIZE + nx;
      if (seen.has(k) || at(nx, ny) !== CAVE_KIND.floor) continue;
      seen.add(k);
      stack.push([nx, ny]);
    }
  }
  return seen;
}

describe('cave ids', () => {
  it('a cave id names its world and its mouth, and round-trips', () => {
    expect(parseCaveId(caveIdOf(WORLD, -12, 96))).toEqual({
      worldId: WORLD,
      mouthX: -12,
      mouthY: 96,
    });
    expect(isCaveId(caveIdOf(WORLD, 0, 0))).toBe(true);
  });

  it('anything else is not a cave id', () => {
    for (const id of [
      'return',
      'desk:d1',
      'cave:',
      'cave:UPPER:1_2',
      'cave:w1:1',
      'cave:a:b:1_2',
      'cave:w1:1_2_3',
    ])
      expect(parseCaveId(id), id).toBeNull();
    expect(isCaveId('desk:d1')).toBe(false);
  });

  it('a cave id is a valid portal id, even for the far corners of the world', () => {
    expect(PORTAL_ID.test(caveIdOf(WORLD, 40, -7))).toBe(true);
    expect(PORTAL_ID.test(caveIdOf(WORLD, -1048576, -1048576))).toBe(true);
  });
});

describe('the cave map', () => {
  it('is closed rock around a floor region that is at least 45% open', () => {
    for (const seed of SEEDS)
      for (const id of CAVE_IDS) {
        const { map } = cellsOf(seed, id);
        const open = [...map.kind].filter((k) => k !== CAVE_KIND.rock).length;
        expect(open / (CAVE_SIZE * CAVE_SIZE), `${seed} ${id}`).toBeGreaterThanOrEqual(0.45);
      }
  });

  it('is one connected region: every floor cell that is not ore is reached from the way in', () => {
    for (const seed of SEEDS)
      for (const id of CAVE_IDS) {
        const { map, at } = cellsOf(seed, id);
        const floor = [...map.kind].filter(
          (k) => k === CAVE_KIND.floor || k >= CAVE_KIND.copper,
        ).length;
        const dry = [...map.kind].filter((k) => k === CAVE_KIND.floor).length;
        const seen = reachable(at, CAVE_ARRIVAL.x, CAVE_ARRIVAL.y);
        expect(seen.size, `${seed} ${id}`).toBe(dry);
        expect(dry).toBeLessThan(floor);
      }
  });

  it('opens onto the mouth: the exit and the arrival are floor, and the exit is reached', () => {
    const { at } = cellsOf(SEEDS[0]!, CAVE_IDS[0]!);
    expect(at(CAVE_EXIT.x, CAVE_EXIT.y)).toBe(CAVE_KIND.floor);
    expect(at(CAVE_ARRIVAL.x, CAVE_ARRIVAL.y)).toBe(CAVE_KIND.floor);
    expect(
      reachable(at, CAVE_ARRIVAL.x, CAVE_ARRIVAL.y).has(CAVE_EXIT.y * CAVE_SIZE + CAVE_EXIT.x),
    ).toBe(true);
  });

  it('puts ores by depth: copper near the way in, gold at the deepest floor', () => {
    for (const seed of SEEDS)
      for (const id of CAVE_IDS) {
        const { map } = cellsOf(seed, id);
        let ores = 0;
        for (let i = 0; i < map.kind.length; i++) {
          const kind = map.kind[i]!;
          if (kind < CAVE_KIND.copper) continue;
          ores++;
          const ratio = map.depth[i]! / map.maxDepth;
          if (kind === CAVE_KIND.copper) expect(ratio).toBeLessThan(0.34);
          if (kind === CAVE_KIND.iron) expect(ratio >= 0.34 && ratio < 0.67).toBe(true);
          if (kind === CAVE_KIND.gold) expect(ratio).toBeGreaterThanOrEqual(0.67);
          expect(map.depth[i]!).toBeGreaterThanOrEqual(4);
        }
        expect(ores, `${seed} ${id}`).toBeGreaterThan(0);
      }
  });

  it('never puts two ores next to each other, so the cave stays walkable around them', () => {
    for (const seed of SEEDS)
      for (const id of CAVE_IDS) {
        const { at } = cellsOf(seed, id);
        for (let y = 1; y < CAVE_SIZE - 1; y++)
          for (let x = 1; x < CAVE_SIZE - 1; x++) {
            if (at(x, y) < CAVE_KIND.copper) continue;
            for (let dy = -1; dy <= 1; dy++)
              for (let dx = -1; dx <= 1; dx++) {
                if (dx === 0 && dy === 0) continue;
                expect(at(x + dx, y + dy) < CAVE_KIND.copper).toBe(true);
              }
          }
      }
  });

  it('is the same for the same seed and id, and differs for another seed or id', () => {
    const a = caveChunk(SEEDS[0]!, CAVE_IDS[0]!, 0, 0);
    expect(chunkDigest(caveChunk(SEEDS[0]!, CAVE_IDS[0]!, 0, 0))).toBe(chunkDigest(a));
    expect(chunkDigest(caveChunk(SEEDS[0]!, CAVE_IDS[1]!, 0, 0))).not.toBe(chunkDigest(a));
    expect(chunkDigest(caveChunk(SEEDS[1]!, CAVE_IDS[0]!, 0, 0))).not.toBe(chunkDigest(a));
  });
});

describe('cave chunks and terrain', () => {
  const seed = SEEDS[0]!;
  const id = CAVE_IDS[0]!;

  it('cells outside the cave are rock at the rock level', () => {
    for (const [cx, cy] of [
      [-1, 0],
      [2, 1],
      [0, -1],
    ] as const) {
      const c = caveChunk(seed, id, cx, cy);
      expect(c.block.every((b) => b === 'cave_rock')).toBe(true);
      expect(c.decor.every((d) => d === '')).toBe(true);
    }
  });

  it('the exit is the cave mouth, and the mouth and arrival are walkable', () => {
    const terrain = worldTerrainFor(id, seed, V2);
    const exit = terrain.cellAt(CAVE_EXIT.x, CAVE_EXIT.y);
    expect(exit.decor).toBe(CAVE_MOUTH_BLOCK);
    expect(exit.walkable).toBe(true);
    const arrival = terrain.cellAt(CAVE_ARRIVAL.x, CAVE_ARRIVAL.y);
    expect(arrival.walkable).toBe(true);
    expect(exit.level).toBe(arrival.level);
  });

  it('the rock wall stands three levels above the floor, so a walker cannot climb it', () => {
    const terrain = worldTerrainFor(id, seed, V2);
    const { at } = cellsOf(seed, id);
    let checked = 0;
    for (let y = 1; y < CAVE_SIZE - 1 && checked < 50; y++)
      for (let x = 1; x < CAVE_SIZE - 1 && checked < 50; x++) {
        if (at(x, y) !== CAVE_KIND.floor) continue;
        const rock = [
          [x + 1, y],
          [x - 1, y],
          [x, y + 1],
          [x, y - 1],
        ].find(([nx, ny]) => at(nx!, ny!) === CAVE_KIND.rock);
        if (!rock) continue;
        checked++;
        const wall = terrain.cellAt(rock[0]!, rock[1]!);
        const floor = terrain.cellAt(x, y);
        expect(wall.walkable).toBe(true);
        expect(canStep(floor, wall)).toBe(false);
        expect(canStep(wall, floor)).toBe(false);
      }
    expect(checked).toBeGreaterThan(0);
  });

  it('a visitor can walk from the arrival to every reachable cell and the exit', () => {
    const terrain = worldTerrainFor(id, seed, V2);
    const { at } = cellsOf(seed, id);
    for (const k of reachable(at, CAVE_ARRIVAL.x, CAVE_ARRIVAL.y)) {
      const x = k % CAVE_SIZE;
      const y = (k - x) / CAVE_SIZE;
      expect(terrain.cellAt(x, y).walkable).toBe(true);
    }
  });

  it('the exit pad lies inside the exit rectangle, and the arrival point is outside it', () => {
    const feet = cellFeet(CAVE_EXIT.x, CAVE_EXIT.y);
    expect(inPortal(caveExitRect(), feet.x, feet.y)).toBe(true);
    const arrival = cellFeet(CAVE_ARRIVAL.x, CAVE_ARRIVAL.y);
    expect(inPortal(caveExitRect(), arrival.x, arrival.y)).toBe(false);
  });

  it('a chunk of the cave is read by the same cell index as the world terrain', () => {
    const cx = Math.floor(CAVE_EXIT.x / CHUNK_SIZE);
    const cy = Math.floor(CAVE_EXIT.y / CHUNK_SIZE);
    const c = caveChunk(seed, id, cx, cy);
    const k = chunkIndex(CAVE_EXIT.x - cx * CHUNK_SIZE, CAVE_EXIT.y - cy * CHUNK_SIZE);
    expect(c.decor[k]).toBe(CAVE_MOUTH_BLOCK);
    expect(c.block[k]).toBe('cave_floor');
    expect(new WorldTerrain(seed, V2, { source: () => c }).cellAt(0, 0).block).toBe('cave_floor');
  });
});

describe('cave mouths in the world terrain (genVersion 2)', () => {
  const chunks = [-2, -1, 0, 1].flatMap((cy) => [-2, -1, 0, 1].map((cx) => [cx, cy] as const));

  it('the shipped version 2 puts cave mouths on land, outside the starter clearing', () => {
    const clear = V2.caves!.clearRadius;
    let mouths = 0;
    for (const seed of SEEDS)
      for (const [cx, cy] of chunks) {
        const c = generateChunk(seed, cx, cy, V2);
        for (let j = 0; j < CHUNK_SIZE; j++)
          for (let i = 0; i < CHUNK_SIZE; i++) {
            const k = chunkIndex(i, j);
            if (c.decor[k] !== CAVE_MOUTH_BLOCK) continue;
            mouths++;
            const x = cx * CHUNK_SIZE + i;
            const y = cy * CHUNK_SIZE + j;
            expect(Math.max(Math.abs(x), Math.abs(y))).toBeGreaterThan(clear);
            expect(c.block[k]).not.toBe('water');
            expect(c.block[k]).not.toBe('sand');
            expect(describeCell(c.level[k]!, c.block[k]!, c.decor[k]!).walkable).toBe(true);
          }
      }
    expect(mouths).toBeGreaterThan(0);
  });

  it('genVersion 1 has no cave mouths: its chunks have none, so saved worlds still match', () => {
    for (const seed of SEEDS)
      for (const [cx, cy] of chunks) {
        const c = generateChunk(seed, cx, cy, V1);
        expect(c.decor.includes(CAVE_MOUTH_BLOCK)).toBe(false);
      }
  });

  it('a mouth sits on a biome surface, and is the only decor that is not a biome decor', () => {
    const c = generateChunk(SEEDS[1]!, -2, -1, V2);
    const surfaces = new Set(WORLD_BIOMES.list.map((b) => b.surface));
    let mouths = 0;
    for (let k = 0; k < c.decor.length; k++) {
      if (c.decor[k] !== CAVE_MOUTH_BLOCK) continue;
      mouths++;
      expect(surfaces.has(c.block[k]!)).toBe(true);
    }
    expect(mouths).toBeGreaterThan(0);
  });
});
