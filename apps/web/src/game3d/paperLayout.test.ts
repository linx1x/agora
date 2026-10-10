import { describe, expect, it } from 'vitest';
import {
  PAPER_H,
  PAPER_W,
  paperCell,
  paperCellSize,
  paperScale,
  paperSheetBytes,
  paperSheetSize,
} from './paperLayout';

describe('paper avatar layout (P16.7)', () => {
  it('uses 1× or 2× by device pixel ratio, never more', () => {
    expect(paperScale(1)).toBe(1);
    expect(paperScale(1.25)).toBe(1);
    expect(paperScale(1.5)).toBe(2);
    expect(paperScale(3)).toBe(2);
    expect(paperScale(4)).toBe(2);
    expect(paperScale(NaN)).toBe(1);
  });

  it('cells hold a 64×96 figure plus the cut-out margin', () => {
    const { cw, ch } = paperCellSize(1);
    expect(cw).toBeGreaterThan(PAPER_W);
    expect(ch).toBeGreaterThan(PAPER_H);
    expect(paperCellSize(2)).toEqual({ cw: cw * 2, ch: ch * 2 });
    expect(paperSheetSize(1)).toEqual({ width: cw * 4, height: ch * 6 });
  });

  it('keeps the 2D sheet grid: walk rows per direction, crouch row 4, sit row 5', () => {
    expect(paperCell('down', 'walk', 0)).toEqual({ col: 0, row: 0 });
    expect(paperCell('left', 'walk', 3)).toEqual({ col: 3, row: 1 });
    expect(paperCell('up', 'walk', 5)).toEqual({ col: 1, row: 3 });
    expect(paperCell('right', 'crouch', 2)).toEqual({ col: 2, row: 4 });
    expect(paperCell('up', 'sit')).toEqual({ col: 3, row: 5 });
  });

  it('stays near the 2.4 MB per person budget at 2× (ADR-052)', () => {
    expect(paperSheetBytes(2)).toBeLessThan(3 * 1024 * 1024);
    expect(paperSheetBytes(1)).toBe(paperSheetBytes(2) / 4);
  });
});
