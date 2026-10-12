import { describe, expect, it } from 'vitest';
import { BLOCKS } from '@agora/shared';
import { placeholderTiles, TILE_PX, renderTile } from './placeholders';
import { CROP_HUES, SIDE_PX, allBlockFrames, cropFrameName, cropFrameSet, cropPixels, cropVariant, sidePixels, sprinklerPixels, topPixels } from './blockArt';
import { RIPE_FRAME } from './cellMath';

const tile = (id: string) => renderTile(BLOCKS.byId.get(id)!);
const px = (data: Uint8ClampedArray, w: number, x: number, y: number) => {
  const i = (y * w + x) * 4;
  return [data[i], data[i + 1], data[i + 2], data[i + 3]];
};

describe('block frames (P17.14)', () => {
  it('takes the top face from the first 24 rows of the placeholder tile', () => {
    const t = tile('meadow_grass');
    const top = topPixels(t);
    expect(top.length).toBe(TILE_PX * TILE_PX * 4);
    for (let y = 0; y < 24; y++)
      for (let x = 0; x < TILE_PX; x++) expect(px(top, TILE_PX, x, y)).toEqual(px(t.pixels, TILE_PX, x, y));
  });

  it('repeats the face above the side band in the bottom rows, so no side shows on a flat top', () => {
    const t = tile('meadow_grass');
    const top = topPixels(t);
    for (let y = 24; y < TILE_PX; y++) expect(px(top, TILE_PX, 5, y)).toEqual(px(t.pixels, TILE_PX, 5, y - 8));
  });

  it('makes a side strip as tall as seven levels and repeats the side band down it', () => {
    const t = tile('stone');
    const side = sidePixels(t);
    expect(side.length).toBe(TILE_PX * SIDE_PX * 4);
    expect(SIDE_PX).toBe(84);
    // rows repeat every eight rows (the height of the side band)
    expect(px(side, TILE_PX, 3, 0)).toEqual(px(side, TILE_PX, 3, 8));
    expect(px(side, TILE_PX, 3, 17)).toEqual(px(side, TILE_PX, 3, 1));
  });

  it('gives every block of blocks.json a top, a side and a decor frame, from the same placeholders', () => {
    const frames = allBlockFrames();
    expect(frames.size).toBe(BLOCKS.list.length);
    const tiles = placeholderTiles();
    for (const b of BLOCKS.list) {
      const f = frames.get(b.id)!;
      expect(f.decor).toEqual(tiles.get(b.id)!.pixels);
    }
  });
});

describe('crop and sprinkler frames (P17.14, code placeholders)', () => {
  it('grows a sprout taller at each stage, and the ripe plant differs from every growth frame', () => {
    const fruit = CROP_HUES[0]!;
    const frames = [0, 1, 2, 3, RIPE_FRAME].map((f) => cropPixels(f, fruit));
    // the stem top moves up with the stage: the topmost drawn row of column 16 gets smaller
    const topRow = (data: Uint8ClampedArray) => {
      for (let y = 0; y < TILE_PX; y++) if (px(data, TILE_PX, 16, y)[3]) return y;
      return TILE_PX;
    };
    expect(topRow(frames[0]!)).toBeGreaterThan(topRow(frames[1]!));
    expect(topRow(frames[3]!)).toBeGreaterThan(topRow(frames[RIPE_FRAME]!));
    for (let i = 0; i < frames.length; i++)
      for (let j = i + 1; j < frames.length; j++) expect(frames[i]).not.toEqual(frames[j]);
  });

  it('gives each crop a fruit colour from its id, the same every time', () => {
    expect(cropVariant('dawn_radish')).toBe(cropVariant('dawn_radish'));
    expect(cropFrameName('dawn_radish', 2)).toBe(`crop:${cropVariant('dawn_radish')}:2`);
    const set = cropFrameSet();
    expect(set.size).toBe(CROP_HUES.length * 5);
    expect(set.has(cropFrameName('dawn_radish', RIPE_FRAME))).toBe(true);
  });

  it('draws the sprinkler on its own frame', () => {
    const s = sprinklerPixels();
    expect(s.length).toBe(TILE_PX * TILE_PX * 4);
    expect(px(s, TILE_PX, 16, 25)[3]).toBe(255);
    expect(px(s, TILE_PX, 0, 0)[3]).toBe(0);
  });

  it('is deterministic: the same block always draws the same cliff', () => {
    expect(sidePixels(tile('taiga_snow'))).toEqual(sidePixels(tile('taiga_snow')));
  });
});
