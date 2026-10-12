import { describe, expect, it } from 'vitest';
import { LEVEL_MAX, type PlotState } from '@agora/shared';
import {
  CELL,
  CROP_FRAMES,
  LEVEL_PX,
  RANK,
  RIPE_FRAME,
  cellBaseY,
  cellWindow,
  cropFrame,
  depthOf,
  farmVisual,
  inWindow,
  pickCell,
  sideStrip,
  topY,
} from './cellMath';

describe('level lift (P17.14, ADR-053)', () => {
  it('lifts a cell 12 px per level, so level 0 sits on its row', () => {
    expect(LEVEL_PX).toBe(12);
    expect(topY(5, 0)).toBe(5 * CELL);
    expect(topY(5, 1)).toBe(5 * CELL - 12);
    expect(topY(5, 4)).toBe(5 * CELL - 48);
  });

  it('draws a darker strip under a raised cell that stands above the cell to its south', () => {
    // level 3 over level 1: the strip runs from the cell's bottom edge down to the south top
    const s = sideStrip(5, 3, 1);
    expect(s).toEqual({ y: topY(5, 3) + CELL, h: 24, shade: 'steep' });
    // the strip's bottom is exactly the top of the lower cell to the south
    expect(s!.y + s!.h).toBe(topY(6, 1));
  });

  it('shades a cliff of two or more levels steeper than a step', () => {
    expect(sideStrip(5, 2, 0)?.shade).toBe('steep');
    expect(sideStrip(5, 1, 0)?.shade).toBe('step');
    expect(sideStrip(5, 1, 0)?.h).toBe(12);
  });

  it('draws no strip when the south cell is level or higher', () => {
    expect(sideStrip(5, 2, 2)).toBeNull();
    expect(sideStrip(5, 2, 3)).toBeNull();
  });

  it('caps a strip at the tallest step (seven levels, 84 px)', () => {
    expect(sideStrip(5, LEVEL_MAX, 0)?.h).toBe(LEVEL_PX * LEVEL_MAX);
  });
});

describe('depth order (P17.14: by base y, then level, then rank)', () => {
  it('draws a lower row over a higher one, whatever the levels', () => {
    expect(depthOf(cellBaseY(4), LEVEL_MAX, RANK.avatar)).toBeLessThan(
      depthOf(cellBaseY(5), 0, RANK.strip),
    );
  });

  it('breaks a tie in base y by level, and a tie in level by rank', () => {
    const y = cellBaseY(3);
    expect(depthOf(y, 1, RANK.avatar)).toBeGreaterThan(depthOf(y, 0, RANK.avatar));
    expect(depthOf(y, 2, RANK.strip)).toBeLessThan(depthOf(y, 2, RANK.top));
    expect(depthOf(y, 2, RANK.top)).toBeLessThan(depthOf(y, 2, RANK.decor));
  });

  it('puts a walker standing on a raised cell over that cell, and one behind it under', () => {
    const cell = 6;
    const raisedTop = depthOf(cellBaseY(cell), 2, RANK.top);
    const onTop = depthOf(cell * CELL + 26, 2, RANK.avatar); // feet inside the raised cell
    const behind = depthOf((cell - 1) * CELL + 26, 0, RANK.avatar); // feet in the row north of it
    expect(onTop).toBeGreaterThan(raisedTop);
    expect(behind).toBeLessThan(raisedTop);
  });

  it('keeps depths exact across the whole world range', () => {
    const far = 1 << 20;
    const a = depthOf(far * CELL, 7, RANK.avatar);
    const b = depthOf(far * CELL + 1, 0, RANK.strip);
    expect(Number.isSafeInteger(a)).toBe(true);
    expect(a).toBeLessThan(b);
  });
});

describe('cell window (what the camera can see)', () => {
  it('covers the view with margins: more rows above, for raised tops and tree crowns', () => {
    const w = cellWindow({ left: 0, top: 0, right: 640, bottom: 320 });
    expect(w).toEqual({ x0: -1, y0: -4, x1: 21, y1: 11 });
    expect(inWindow(w, 0, 0)).toBe(true);
    expect(inWindow(w, 22, 0)).toBe(false);
  });

  it('floors negative positions toward minus infinity', () => {
    const w = cellWindow(
      { left: -33, top: -1, right: 10, bottom: 10 },
      { up: 0, side: 0, down: 0 },
    );
    expect(w.x0).toBe(-2);
    expect(w.y0).toBe(-1);
  });
});

describe('pickCell (a click lands on the cell drawn under it)', () => {
  const flat = () => 0;

  it('is the cell under the pointer on flat ground', () => {
    expect(pickCell(40, 70, flat)).toEqual({ cx: 1, cy: 2 });
  });

  it('is the raised cell when its lifted top covers the point', () => {
    // row 2 is level 3, so its top is lifted 36 px and covers y 28..60: y 40 is on that top,
    // over row 1, which it draws above
    const levelAt = (cx: number, cy: number) => (cx === 1 && cy === 2 ? 3 : 0);
    expect(pickCell(40, 40, levelAt)).toEqual({ cx: 1, cy: 2 });
    expect(pickCell(40, 100, levelAt)).toEqual({ cx: 1, cy: 3 });
  });
});

describe('farm layer (P17.14: tilled, watered, crop stage, sprinkler)', () => {
  const plot = (over: Partial<PlotState> = {}): PlotState => ({
    tilled: true,
    wateredOn: 0,
    crop: null,
    sprinkler: null,
    fertilizer: null,
    ...over,
  });

  it('shows nothing for a plot that is not tilled, planted or sprinkled', () => {
    expect(farmVisual(undefined, 3)).toBeNull();
    expect(farmVisual(plot({ tilled: false }), 3)).toBeNull();
  });

  it('shows the watered tint only on the day it was watered', () => {
    expect(farmVisual(plot({ wateredOn: 3 }), 3)?.watered).toBe(true);
    expect(farmVisual(plot({ wateredOn: 2 }), 3)?.watered).toBe(false);
  });

  it('draws the crop stage: sprouts 0-3 grow, then ripe is its own frame', () => {
    const crop = (stage: number, ripe = false) => ({
      crop: 'dawn_radish',
      stage,
      daysInStage: 0,
      ripe,
      regrowLeft: null,
      stages: [1, 1, 1, 1],
      fertilizer: null,
    });
    expect(farmVisual(plot({ crop: crop(0) }), 1)?.crop).toBe(0);
    expect(farmVisual(plot({ crop: crop(2) }), 1)?.crop).toBe(2);
    expect(farmVisual(plot({ crop: crop(9) }), 1)?.crop).toBe(3);
    expect(farmVisual(plot({ crop: crop(2, true) }), 1)?.crop).toBe(RIPE_FRAME);
    expect(cropFrame(0, false)).toBeLessThan(CROP_FRAMES);
  });

  it('shows a sprinkler even on untilled ground', () => {
    expect(farmVisual(plot({ tilled: false, sprinkler: 'sprinkler_basic' }), 1)).toEqual({
      soil: false,
      watered: false,
      crop: null,
      sprinkler: true,
    });
  });
});
