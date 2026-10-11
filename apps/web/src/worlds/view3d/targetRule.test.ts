import { describe, expect, it } from 'vitest';
import { inReach, WORLD_CELL_PX } from '@agora/shared';
import { faceCell } from '../inputActs';
import { TARGET_HOLD_MS } from '../tools/swing';
import { cellKey, liveSwings, targetCells, type OwnSwing } from './targetRule';

/** Feet at the middle of cell (cx, cy), in world pixels. */
const at = (cx: number, cy: number) => ({
  feetX: (cx + 0.5) * WORLD_CELL_PX,
  feetY: (cy + 0.5) * WORLD_CELL_PX,
});

describe('targetCells: the decor I work on never fades (P17.21d)', () => {
  it('the faced cell in reach stays solid, whichever way I face it', () => {
    const f = at(10, 10);
    expect([...targetCells({ now: 0, ...f, dir: 'down', swings: [] })]).toEqual([cellKey(10, 11)]);
    expect([...targetCells({ now: 0, ...f, dir: 'up', swings: [] })]).toEqual([cellKey(10, 9)]);
    expect([...targetCells({ now: 0, ...f, dir: 'left', swings: [] })]).toEqual([cellKey(9, 10)]);
    expect([...targetCells({ now: 0, ...f, dir: 'right', swings: [] })]).toEqual([cellKey(11, 10)]);
  });

  it('a swing keeps its cell exempt for the swing and the hold after it, then lets it go', () => {
    const swing: OwnSwing = { cell: { x: 4, y: 4 }, endAt: 1000 };
    const f = at(0, 0);
    const exempt = (now: number) =>
      targetCells({ now, ...f, dir: 'up', swings: [swing] }).has(cellKey(4, 4));
    expect(exempt(0)).toBe(true);
    expect(exempt(1000)).toBe(true);
    expect(exempt(1000 + TARGET_HOLD_MS - 1)).toBe(true);
    expect(exempt(1000 + TARGET_HOLD_MS)).toBe(false);
  });

  it('the cell of a swing that is far away (out of my reach) is still exempt while the swing runs', () => {
    // a click on a cell across the room is a swing at that cell (the view passes the cell it lands on)
    const swing: OwnSwing = { cell: { x: 30, y: 2 }, endAt: 500 };
    expect(targetCells({ now: 100, ...at(0, 0), dir: 'down', swings: [swing] }).has(cellKey(30, 2))).toBe(true);
  });

  it('the faced cell is exempt exactly when my feet reach it (a click\'s reach, not a wider one)', () => {
    for (const dir of ['up', 'down', 'left', 'right'] as const)
      for (const fx of [0.01, 0.5, 0.99])
        for (const fy of [0.01, 0.5, 0.99]) {
          const feetX = fx * WORLD_CELL_PX;
          const feetY = fy * WORLD_CELL_PX;
          const faced = faceCell(feetX, feetY, dir);
          const out = targetCells({ now: 0, feetX, feetY, dir, swings: [] });
          expect(out.has(cellKey(faced.x, faced.y))).toBe(inReach(feetX, feetY, faced));
        }
    // from the middle of my cell the faced cell is always in reach
    expect(targetCells({ now: 0, ...at(0, 0), dir: 'up', swings: [] }).has(cellKey(0, -1))).toBe(true);
    // and the cell two steps away is never exempt by facing alone
    expect(targetCells({ now: 0, ...at(0, 0), dir: 'right', swings: [] }).has(cellKey(2, 0))).toBe(false);
  });

  it('keeps only the swings still in their hold', () => {
    const swings: OwnSwing[] = [
      { cell: { x: 1, y: 1 }, endAt: 100 },
      { cell: { x: 2, y: 2 }, endAt: 900 },
    ];
    expect(liveSwings(swings, 100 + TARGET_HOLD_MS + 1).map((s) => s.cell.x)).toEqual([2]);
    expect(liveSwings(swings, 0)).toHaveLength(2);
  });
});
