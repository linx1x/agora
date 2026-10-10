import { describe, expect, it } from 'vitest';
import { TILT } from './camera';
import {
  FIG_H,
  FIG_TOP,
  FIG_W,
  FLIP_MS,
  PAD_BOTTOM,
  QUAD_H,
  QUAD_W,
  SEAT_DZ,
  SEAT_DZ_UP,
  SEAT_H,
  cellUv,
  flipAt,
  frameCell,
  frameName,
  isFlip,
  seatPlacement,
  upright,
  walkFrame,
} from './figureMath';
import { paperCellSize } from './paperLayout';

const COS = Math.cos((TILT * Math.PI) / 180);
const POSE_MS = 160;

describe('figure size (P16.8)', () => {
  it('uses TILT in degrees and divides the foreshortening out of heights', () => {
    expect(TILT).toBe(35);
    expect(upright(1)).toBeCloseTo(1 / COS, 10);
    expect(upright(0)).toBe(0);
    expect(upright(2)).toBeCloseTo(2 * upright(1), 10);
  });

  it('keeps the figure at about 1.4 tiles and the art at 64:96', () => {
    expect(FIG_H).toBeCloseTo(1.4, 10);
    expect(FIG_W / FIG_H).toBeCloseTo(64 / 96, 10);
  });

  it('maps the whole cell: the quad keeps the cell ratio once the tilt is undone', () => {
    const { cw, ch } = paperCellSize(1);
    // on screen the height is foreshortened by cos(TILT), the width is not
    expect((QUAD_H * COS) / QUAD_W).toBeCloseTo(ch / cw, 10);
    // the cut-out margin is the same on each side of the figure
    expect(QUAD_H).toBeCloseTo(PAD_BOTTOM + FIG_TOP + PAD_BOTTOM, 10);
  });
});

describe('flip (ADR-052)', () => {
  it('is a flip only between left and right', () => {
    expect(isFlip('left', 'right')).toBe(true);
    expect(isFlip('right', 'left')).toBe(true);
    expect(isFlip('up', 'down')).toBe(false);
    expect(isFlip('left', 'up')).toBe(false);
    expect(isFlip('down', 'right')).toBe(false);
    expect(isFlip('left', 'left')).toBe(false);
  });

  it('has no flip without a start: full width, the given direction', () => {
    expect(flipAt(null, 500, false, 'up')).toEqual({ scaleX: 1, dir: 'up', done: true });
  });

  it('under reduced motion turns at once to the new direction', () => {
    const s = { from: 'left' as const, to: 'right' as const, t0: 1000 };
    expect(flipAt(s, 1000, true)).toEqual({ scaleX: 1, dir: 'right', done: true });
    expect(flipAt(s, 1050, true)).toEqual({ scaleX: 1, dir: 'right', done: true });
  });

  it('starts at full width showing the old direction', () => {
    const s = { from: 'left' as const, to: 'right' as const, t0: 1000 };
    expect(flipAt(s, 1000, false)).toEqual({ scaleX: 1, dir: 'left', done: false });
    // before t0 the flip has not begun
    expect(flipAt(s, 900, false)).toEqual({ scaleX: 1, dir: 'left', done: false });
  });

  it('narrows to a line at the midpoint, then widens showing the new direction', () => {
    const s = { from: 'right' as const, to: 'left' as const, t0: 1000 };
    const quarter = flipAt(s, 1000 + FLIP_MS / 4, false);
    expect(quarter.dir).toBe('right');
    expect(quarter.scaleX).toBeCloseTo(0.5, 10);
    const mid = flipAt(s, 1000 + FLIP_MS / 2, false);
    expect(mid.dir).toBe('left');
    expect(mid.scaleX).toBeLessThan(0.01);
    expect(mid.scaleX).toBeGreaterThanOrEqual(0.001);
    const threeQuarters = flipAt(s, 1000 + (3 * FLIP_MS) / 4, false);
    expect(threeQuarters.dir).toBe('left');
    expect(threeQuarters.scaleX).toBeCloseTo(0.5, 10);
  });

  it('ends at full width facing the new direction, and says so', () => {
    const s = { from: 'left' as const, to: 'right' as const, t0: 1000 };
    expect(flipAt(s, 1000 + FLIP_MS, false)).toEqual({ scaleX: 1, dir: 'right', done: true });
    expect(flipAt(s, 5000, false)).toEqual({ scaleX: 1, dir: 'right', done: true });
  });

  it('never returns a zero-width card, and stays within 0..1 across the flip', () => {
    const s = { from: 'left' as const, to: 'right' as const, t0: 0 };
    for (let t = 0; t <= FLIP_MS + 10; t += 1) {
      const { scaleX } = flipAt(s, t, false);
      expect(scaleX).toBeGreaterThanOrEqual(0.001);
      expect(scaleX).toBeLessThanOrEqual(1);
    }
  });
});

describe('seat (ADR-019)', () => {
  it('keeps a standing or crouching figure on the floor', () => {
    expect(seatPlacement('stand', 'down', false)).toEqual({ lift: 0, dz: 0 });
    expect(seatPlacement('stand', 'up', false)).toEqual({ lift: 0, dz: 0 });
    // a crouch plays while the pose changes, even for a sitter
    expect(seatPlacement('sit', 'left', true)).toEqual({ lift: 0, dz: 0 });
    expect(seatPlacement('stand', 'right', true)).toEqual({ lift: 0, dz: 0 });
  });

  it('lifts a seated figure onto the seat and in front of the chair card', () => {
    expect(SEAT_H).toBeCloseTo(0.28, 10);
    expect(SEAT_DZ).toBeCloseTo(0.42, 10);
    for (const dir of ['down', 'left', 'right'] as const) {
      expect(seatPlacement('sit', dir, false)).toEqual({ lift: SEAT_H, dz: SEAT_DZ });
    }
  });

  it('keeps the chair back in front of a figure seated facing up', () => {
    expect(SEAT_DZ_UP).toBeCloseTo(-0.05, 10);
    expect(seatPlacement('sit', 'up', false)).toEqual({ lift: SEAT_H, dz: SEAT_DZ_UP });
  });
});

describe('frame name (as the 2D view)', () => {
  it('walks through the 2D sequence 1, 0, 3, 2 every 130 ms while moving', () => {
    expect(frameName('down', 'stand', true, 0, -1e9, POSE_MS)).toBe('down-1');
    expect(frameName('down', 'stand', true, 130, -1e9, POSE_MS)).toBe('down-0');
    expect(frameName('down', 'stand', true, 260, -1e9, POSE_MS)).toBe('down-3');
    expect(frameName('down', 'stand', true, 390, -1e9, POSE_MS)).toBe('down-2');
    // then it wraps
    expect(frameName('down', 'stand', true, 520, -1e9, POSE_MS)).toBe('down-1');
  });

  it('stands still on frame 0 when not moving', () => {
    for (const now of [0, 130, 260, 999]) {
      expect(frameName('left', 'stand', false, now, -1e9, POSE_MS)).toBe('left-0');
    }
  });

  it('uses the walk frame for every direction', () => {
    expect(frameName('up', 'stand', true, 130, -1e9, POSE_MS)).toBe('up-0');
    expect(frameName('right', 'stand', true, 260, -1e9, POSE_MS)).toBe('right-3');
  });

  it('plays crouch for POSE_MS after a pose change, even while walking', () => {
    expect(frameName('right', 'stand', true, 1000, 950, POSE_MS)).toBe('crouch-right');
    expect(frameName('right', 'sit', false, 1000, 950, POSE_MS)).toBe('crouch-right');
    // at the end of the transition the pose shows
    expect(frameName('right', 'stand', true, 1110, 950, POSE_MS)).toBe('right-1');
  });

  it('shows the seated frame while seated', () => {
    expect(frameName('up', 'sit', false, 1000, 0, POSE_MS)).toBe('sit-up');
    expect(frameName('down', 'sit', true, 1000, 0, POSE_MS)).toBe('sit-down');
  });

  it('wraps the walk step for times before zero without an undefined frame', () => {
    expect(walkFrame(true, -130)).toBe(2);
    expect(walkFrame(true, -1)).toBe(2);
    expect(walkFrame(false, -130)).toBe(0);
  });
});

describe('frame cell', () => {
  it('points at the cell of the same frame name', () => {
    expect(frameCell('right', 'stand', true, 130, -1e9, POSE_MS)).toEqual({ col: 0, row: 2 });
    expect(frameCell('up', 'stand', true, 260, -1e9, POSE_MS)).toEqual({ col: 3, row: 3 });
    expect(frameCell('down', 'stand', false, 260, -1e9, POSE_MS)).toEqual({ col: 0, row: 0 });
  });

  it('uses the crouch row (4) and the sit row (5), one column per direction', () => {
    expect(frameCell('up', 'stand', true, 1000, 950, POSE_MS)).toEqual({ col: 3, row: 4 });
    expect(frameCell('left', 'sit', false, 1000, 0, POSE_MS)).toEqual({ col: 1, row: 5 });
  });
});

describe('sheet UV', () => {
  it('maps the top-left cell to the top-left of the sheet (v runs bottom-up)', () => {
    const uv = cellUv(0, 0, 1);
    expect(uv.offsetX).toBe(0);
    expect(uv.offsetY).toBeCloseTo(5 / 6, 10);
    expect(uv.repeatX).toBeCloseTo(1 / 4, 10);
    expect(uv.repeatY).toBeCloseTo(1 / 6, 10);
  });

  it('maps the bottom-right cell to the bottom-right of the sheet', () => {
    const uv = cellUv(3, 5, 1);
    expect(uv.offsetX).toBeCloseTo(3 / 4, 10);
    expect(uv.offsetY).toBeCloseTo(0, 10);
  });

  it('maps the crouch row of the third column', () => {
    const uv = cellUv(2, 4, 2);
    expect(uv.offsetX).toBeCloseTo(2 / 4, 10);
    expect(uv.offsetY).toBeCloseTo(1 / 6, 10);
  });

  it('is the same at 1× and 2× (the sheet is laid out in whole cells)', () => {
    for (let col = 0; col < 4; col++)
      for (let row = 0; row < 6; row++) {
        const a = cellUv(col, row, 1);
        const b = cellUv(col, row, 2);
        expect(b.offsetX).toBeCloseTo(a.offsetX, 10);
        expect(b.offsetY).toBeCloseTo(a.offsetY, 10);
        expect(b.repeatX).toBeCloseTo(a.repeatX, 10);
        expect(b.repeatY).toBeCloseTo(a.repeatY, 10);
      }
  });

  it('keeps every cell inside the sheet', () => {
    for (let col = 0; col < 4; col++)
      for (let row = 0; row < 6; row++) {
        const uv = cellUv(col, row, 1);
        expect(uv.offsetX).toBeGreaterThanOrEqual(0);
        expect(uv.offsetX + uv.repeatX).toBeLessThanOrEqual(1 + 1e-9);
        expect(uv.offsetY).toBeGreaterThanOrEqual(-1e-9);
        expect(uv.offsetY + uv.repeatY).toBeLessThanOrEqual(1 + 1e-9);
      }
  });
});
