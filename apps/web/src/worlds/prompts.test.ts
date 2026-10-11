import { describe, expect, it } from 'vitest';
import {
  CAVE_EXIT,
  WORLDGEN,
  WORLD_CELL_PX,
  WorldTerrain,
  caveExitRect,
  caveIdOf,
  cellFeet,
  worldGenParamsFor,
  worldSeedFor,
} from '@agora/shared';
import { worldPromptAt, portalOfPrompt } from './prompts';
import { RETURN_RECT } from './starter';

const WORLD = 'w-prompt';
const MOUTH = { x: 20, y: 4 };
// a world whose only decor is a cave mouth: the terrain is an overlay, not the generator
const terrain = new WorldTerrain(worldSeedFor('prompts'), worldGenParamsFor(WORLDGEN, 1), {
  overlay: (x, y) => (x === MOUTH.x && y === MOUTH.y ? { decor: 'cave_mouth' } : undefined),
});
const at = (cx: number, cy: number) => cellFeet(cx, cy);

describe('worldPromptAt (P17.14, P17.32)', () => {
  it('no prompt outside a world', () => {
    expect(worldPromptAt(null, terrain, at(MOUTH.x, MOUTH.y))).toBeNull();
  });

  it('a cave mouth under the feet offers the cave, with its id', () => {
    expect(worldPromptAt(WORLD, terrain, at(MOUTH.x, MOUTH.y))).toEqual({
      kind: 'cave',
      id: caveIdOf(WORLD, MOUTH.x, MOUTH.y),
    });
    expect(worldPromptAt(WORLD, terrain, at(MOUTH.x + 1, MOUTH.y))).toBeNull();
  });

  it('the world return pad still offers the way back to the office', () => {
    expect(worldPromptAt(WORLD, terrain, { x: RETURN_RECT.x + 1, y: RETURN_RECT.y + 1 })).toEqual({
      kind: 'worldExit',
    });
  });

  it('in a cave the pad offers the way back to the world, and nothing else does', () => {
    const cave = caveIdOf(WORLD, MOUTH.x, MOUTH.y);
    const exit = cellFeet(CAVE_EXIT.x, CAVE_EXIT.y);
    expect(worldPromptAt(cave, null, exit)).toEqual({ kind: 'caveExit' });
    expect(
      worldPromptAt(cave, null, { x: caveExitRect().x - WORLD_CELL_PX, y: exit.y }),
    ).toBeNull();
  });
});

describe('portalOfPrompt', () => {
  it('the pads send the return portal, a cave mouth sends its own id, and other prompts send nothing', () => {
    expect(portalOfPrompt({ kind: 'worldExit' })).toBe('return');
    expect(portalOfPrompt({ kind: 'caveExit' })).toBe('return');
    expect(portalOfPrompt({ kind: 'cave', id: 'cave:w:1_2' })).toBe('cave:w:1_2');
    expect(portalOfPrompt({ kind: 'sit' })).toBeNull();
    expect(portalOfPrompt(null)).toBeNull();
  });
});
