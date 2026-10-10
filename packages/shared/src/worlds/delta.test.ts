import { describe, expect, it } from 'vitest';
import { WORLDGEN } from './gen';
import { BLOCKS } from './registry';
import { worldSeedFor } from './noise';
import { WorldTerrain } from './cells';
import { ChunkDeltaSchema, applyDelta, deltaCells, deltaIdProblems, deltaOverlay, type ChunkDelta } from './delta';
import { chunkDigest, generateChunk } from './terrain';

const P = WORLDGEN.params;
const SEED = worldSeedFor('golden-1');

describe('ChunkDeltaSchema', () => {
  it('accepts patches on valid cell indices', () => {
    const ok = ChunkDeltaSchema.safeParse({ '0': { block: 'meadow_dirt' }, '1023': { level: 7, decor: '' } });
    expect(ok.success).toBe(true);
  });

  it('rejects an index outside the chunk, a bad level and a bad id', () => {
    expect(ChunkDeltaSchema.safeParse({ '1024': { level: 1 } }).success).toBe(false);
    expect(ChunkDeltaSchema.safeParse({ '-1': { level: 1 } }).success).toBe(false);
    expect(ChunkDeltaSchema.safeParse({ '3': { level: 8 } }).success).toBe(false);
    expect(ChunkDeltaSchema.safeParse({ '3': { block: 'Bad Id' } }).success).toBe(false);
    expect(ChunkDeltaSchema.safeParse({ '3': { colour: 'red' } }).success).toBe(false);
  });
});

describe('applyDelta', () => {
  it('changes only the patched cells and leaves the base chunk untouched', () => {
    const base = generateChunk(SEED, 0, 0, P);
    const before = chunkDigest(base);
    const delta: ChunkDelta = { '5': { block: 'tilled_soil', decor: '' }, '40': { level: 0 } };
    const next = applyDelta(base, delta);
    expect(next.block[5]).toBe('tilled_soil');
    expect(next.decor[5]).toBe('');
    expect(next.level[40]).toBe(0);
    expect(next.block[6]).toBe(base.block[6]);
    expect(chunkDigest(base)).toBe(before);
    expect(next).not.toBe(base);
  });

  it('counts patched cells', () => {
    expect(deltaCells({ '1': {}, '2': { level: 3 } })).toBe(2);
    expect(deltaCells({})).toBe(0);
  });
});

describe('deltaIdProblems', () => {
  it('flags unknown ids, decor written as ground and ground written as decor', () => {
    const problems = deltaIdProblems(
      { '1': { block: 'no_such' }, '2': { block: 'oak_tree' }, '3': { decor: 'meadow_grass' }, '4': { decor: 'flower' } },
      BLOCKS,
    );
    expect(problems).toEqual([
      '1.block: unknown block "no_such"',
      '2.block: "oak_tree" is decor',
      '3.decor: "meadow_grass" is ground',
    ]);
  });
});

describe('deltaOverlay', () => {
  it('shows stored edits in WorldTerrain without changing the cached base chunk', () => {
    const deltas = new Map<string, ChunkDelta>([['0,0', { '33': { block: 'tilled_soil', decor: '' } }]]);
    const overlay = deltaOverlay((cx, cy) => deltas.get(`${cx},${cy}`));
    const edited = new WorldTerrain(SEED, P, { overlay });
    const plain = new WorldTerrain(SEED, P);
    // local index 33 is column 1, row 1 of chunk (0, 0)
    expect(edited.cellAt(1, 1).block).toBe('tilled_soil');
    expect(plain.cellAt(1, 1).block).not.toBe('tilled_soil');
    expect(edited.cellAt(2, 2).block).toBe(plain.cellAt(2, 2).block);
    expect(chunkDigest(edited.chunkAt(0, 0))).toBe(chunkDigest(plain.chunkAt(0, 0)));
  });

  it('handles negative chunks and returns nothing for untouched cells', () => {
    const delta: ChunkDelta = { '0': { level: 6 } };
    const overlay = deltaOverlay((cx, cy) => (cx === -1 && cy === -1 ? delta : undefined));
    // cell (-32, -32) is local (0, 0) of chunk (-1, -1)
    expect(overlay(-32, -32)).toEqual({ level: 6 });
    expect(overlay(-31, -32)).toBeUndefined();
    expect(overlay(0, 0)).toBeUndefined();
  });
});
