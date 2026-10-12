import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { inPortal } from '../portals';
import { WORLDGEN } from './gen';
import { deltaOverlay, type ChunkDelta } from './delta';
import { feetCell, findWorldPath, worldCollides, type GridCell } from './walk';
import { WorldTerrain } from './cells';
import { worldSeedFor } from './noise';
import { chunkIndex } from './terrain';
import { chunkKey } from './view';
import {
  parseStarter,
  mergeDeltas,
  RETURN_PORTAL_ID,
  returnTrigger,
  starterPatches,
} from './starter';
import { CHUNK_SIZE } from './constants';

const RAW = JSON.parse(
  readFileSync(new URL('../../../maps/worlds/starter.json', import.meta.url), 'utf8'),
) as Record<string, unknown>;
const starter = parseStarter(RAW);
const patches = starterPatches(starter);
const SEED = worldSeedFor('starter-1');
const world = new WorldTerrain(SEED, WORLDGEN.params, {
  overlay: deltaOverlay((cx, cy) => patches.get(chunkKey(cx, cy))),
});

/** The stamp's patch of world cell (x, y), if any. */
function patchAt(x: number, y: number) {
  const cx = Math.floor(x / CHUNK_SIZE);
  const cy = Math.floor(y / CHUNK_SIZE);
  return patches.get(chunkKey(cx, cy))?.[
    String(chunkIndex(x - cx * CHUNK_SIZE, y - cy * CHUNK_SIZE))
  ];
}

/** Break one field of a copy of the shipped starter. */
function changed(edit: (s: Record<string, unknown>) => void): unknown {
  const copy = structuredClone(RAW);
  edit(copy);
  return copy;
}
const rowsOf = (s: Record<string, unknown>) => s.rows as string[];

describe('parseStarter', () => {
  it('the shipped starter parses, and every block it names is in the registry', () => {
    expect(starter.flatten).toEqual({ radius: 12, level: 2, block: 'meadow_dirt' });
    expect(starter.rows).toHaveLength(25);
    expect(starter.ret).toEqual({ x: -1, y: 3 });
  });

  it('refuses a ragged drawing, a character outside the legend, and a drawing outside the flatten square', () => {
    expect(() => parseStarter(changed((s) => (rowsOf(s)[3] = `${rowsOf(s)[3]}.`)))).toThrow(
      /columns/,
    );
    expect(() =>
      parseStarter(
        changed((s) => {
          const rows = rowsOf(s);
          rows[12] = `?${rows[12]!.slice(1)}`;
        }),
      ),
    ).toThrow(/not in the legend/);
    expect(() =>
      parseStarter(changed((s) => (s.flatten = { radius: 4, level: 2, block: 'meadow_dirt' }))),
    ).toThrow(/outside the flatten square/);
  });

  it('refuses an even-sized drawing and an unknown block', () => {
    expect(() => parseStarter(changed((s) => rowsOf(s).pop()))).toThrow(/odd size/);
    expect(() =>
      parseStarter(
        changed((s) => {
          const legend = s.legend as Record<string, { block: string }>;
          legend.r = { block: 'no_such' };
        }),
      ),
    ).toThrow(/unknown block/);
  });
});

describe('starterPatches', () => {
  it('flattens every cell of the square to one level, and patches nothing outside it', () => {
    for (let y = -12; y <= 12; y++)
      for (let x = -12; x <= 12; x++) expect(patchAt(x, y)?.level, `(${x}, ${y})`).toBe(2);
    expect(patchAt(13, 0)).toBeUndefined();
    expect(patchAt(-13, 0)).toBeUndefined();
    expect(patchAt(0, -13)).toBeUndefined();
  });

  it('draws the house, the farm plot, the bin, the board and the return pad as the legend says', () => {
    expect(patchAt(-5, -5)).toEqual({ level: 2, block: 'wood_floor', decor: 'bed' });
    expect(patchAt(-4, -2)).toEqual({ level: 2, block: 'wood_floor', decor: 'door' }); // the door (walkable)
    expect(patchAt(-6, -4)).toEqual({ level: 2, block: 'wood_floor', decor: 'wood_wall' });
    expect(patchAt(6, 0)).toEqual({ level: 2, block: 'tilled_soil', decor: '' });
    expect(patchAt(0, 1)).toEqual({ level: 2, block: 'meadow_dirt', decor: 'shipping_bin' });
    expect(patchAt(-1, -2)).toEqual({ level: 2, block: 'meadow_dirt', decor: 'shop_board' });
    expect(patchAt(-1, 3)).toEqual({ level: 2, block: 'return_pad', decor: '' });
    expect(patchAt(0, 0)).toEqual({ level: 2, block: 'meadow_dirt', decor: '' });
  });

  it('the farm plot is 8 by 8 tilled cells', () => {
    let tilled = 0;
    for (let y = -12; y <= 12; y++)
      for (let x = -12; x <= 12; x++) if (patchAt(x, y)?.block === 'tilled_soil') tilled++;
    expect(tilled).toBe(64);
  });
});

describe('the stamp is reachable from the return pad', () => {
  const pad = { cx: starter.ret.x, cy: starter.ret.y };

  it('the origin is free ground and the return pad is walkable, inside its trigger', () => {
    expect(worldCollides(world, 16, 26)).toBe(false);
    const feet = { x: pad.cx * 32 + 16, y: pad.cy * 32 + 26 };
    expect(worldCollides(world, feet.x, feet.y)).toBe(false);
    expect(inPortal(returnTrigger(starter), feet.x, feet.y)).toBe(true);
  });

  it.each([
    ['the origin', { cx: 0, cy: 0 }],
    ['inside the house, by the bed', { cx: -4, cy: -4 }],
    ['inside the house, by the door', { cx: -4, cy: -3 }],
    ['the middle of the farm plot', { cx: 6, cy: 0 }],
    ['the far corner of the farm plot', { cx: 10, cy: -4 }],
  ] satisfies [string, GridCell][])('a walkable route leads from the pad to %s', (_name, goal) => {
    const path = findWorldPath(world, feetCell(pad.cx * 32 + 16, pad.cy * 32 + 26), goal);
    expect(path).not.toBeNull();
    expect(path!.at(-1)).toEqual(goal);
  });

  it('the return portal is the return pad, under its own id', () => {
    expect(RETURN_PORTAL_ID).toBe('return');
    expect(returnTrigger(starter)).toEqual({ x: -32, y: 96, w: 32, h: 32 });
  });
});

describe('mergeDeltas', () => {
  it('stored edits win cell by cell, the rest of the stamp stays, and the base is not changed', () => {
    const base = patches.get('0,0');
    const origin = String(chunkIndex(0, 0)); // a flattened cell
    const next = String(chunkIndex(1, 0)); // also flattened, not edited
    const over: ChunkDelta = { [origin]: { block: 'tilled_soil' } };
    const merged = mergeDeltas(base, over);
    expect(merged[origin]).toEqual({ level: 2, block: 'tilled_soil', decor: '' });
    expect(merged[next]).toEqual(base?.[next]);
    expect(base?.[origin]?.block).toBe('meadow_dirt');
    expect(mergeDeltas(base, undefined)).toEqual(base);
  });
});
