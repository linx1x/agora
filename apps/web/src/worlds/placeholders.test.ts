import { describe, expect, it } from 'vitest';
import { BLOCKS } from '@agora/shared';
import {
  LOOKS,
  OPAQUE_SHAPES,
  paletteOf,
  paletteColour,
  placeholderTiles,
  renderTile,
  resolveTile,
  TILE_PX,
} from './placeholders';

const alphaAt = (pixels: Uint8ClampedArray, x: number, y: number) => pixels[(y * TILE_PX + x) * 4 + 3];

describe('placeholder art (P17.13)', () => {
  it('every block in blocks.json has a look, and no look names a block that does not exist', () => {
    const ids = BLOCKS.list.map((b) => b.id).sort();
    expect(Object.keys(LOOKS).sort()).toEqual(ids);
  });

  it('every colour a look names exists in the palette of its biome', () => {
    for (const b of BLOCKS.list) {
      const look = LOOKS[b.id]!;
      const palette = paletteOf(b);
      expect(paletteColour(palette, look.top), `${b.id} top in ${palette}`).toMatch(/^#/);
      expect(paletteColour(palette, look.side), `${b.id} side in ${palette}`).toMatch(/^#/);
      if (look.accent) expect(paletteColour(palette, look.accent), `${b.id} accent in ${palette}`).toMatch(/^#/);
      if (look.glow) expect(paletteColour(palette, look.glow), `${b.id} glow in ${palette}`).toMatch(/^#/);
    }
  });

  it('every block renders a 32 px tile of the right size; solid tiles are opaque, decor is see-through', () => {
    const tiles = placeholderTiles();
    expect(tiles.size).toBe(BLOCKS.list.length);
    for (const b of BLOCKS.list) {
      const tile = tiles.get(b.id)!;
      expect(tile.size).toBe(TILE_PX);
      expect(tile.pixels.length).toBe(TILE_PX * TILE_PX * 4);
      const shape = LOOKS[b.id]!.shape;
      const corner = alphaAt(tile.pixels, 0, 0);
      if (OPAQUE_SHAPES.has(shape)) expect(corner, b.id).toBe(255);
      else expect(corner, b.id).toBe(0);
    }
  });

  it('a block always draws the same pixels, and two blocks with different ids differ', () => {
    const stone = BLOCKS.byId.get('stone')!;
    expect(renderTile(stone).pixels).toEqual(renderTile(stone).pixels);
    const sand = BLOCKS.byId.get('sand')!;
    expect(renderTile(stone).pixels).not.toEqual(renderTile(sand).pixels);
  });

  it('the resolver prefers a registry file for a sprite, and draws the placeholder otherwise', () => {
    const files = new Map([['worlds/shared/stone', '/assets/worlds/stone.png']]);
    expect(resolveTile('worlds/shared/stone', files)).toEqual({ kind: 'file', url: '/assets/worlds/stone.png' });
    expect(resolveTile('worlds/shared/sand', files)).toEqual({ kind: 'placeholder' });
    expect(resolveTile('worlds/shared/stone', new Map())).toEqual({ kind: 'placeholder' });
  });
});

describe('starter objects are drawn, not a fill (FIX-1)', () => {
  const tileOf = (id: string) => renderTile(BLOCKS.byId.get(id)!);
  /** how many distinct colours a tile has: a solid fill has one, a drawn object many */
  const colours = (pixels: Uint8ClampedArray) => {
    const seen = new Set<number>();
    for (let i = 0; i < pixels.length; i += 4) {
      if (pixels[i + 3] === 0) continue;
      seen.add((pixels[i]! << 16) | (pixels[i + 1]! << 8) | pixels[i + 2]!);
    }
    return seen.size;
  };

  it('the house, bin, pad, plot, bed, board and door each have several colours and a shape', () => {
    for (const id of ['wood_wall', 'door', 'bed', 'shipping_bin', 'shop_board', 'return_pad', 'tilled_soil', 'wood_floor']) {
      expect(colours(tileOf(id).pixels), id).toBeGreaterThan(4);
    }
  });

  it('the wall has a roof band on top of its planks; the door has a handle-lit panel in the wall', () => {
    const rgbAt = (pixels: Uint8ClampedArray, x: number, y: number): [number, number, number] => {
      const i = (y * TILE_PX + x) * 4;
      return [pixels[i]!, pixels[i + 1]!, pixels[i + 2]!];
    };
    const wall = tileOf('wood_wall').pixels;
    const [rr, rg] = rgbAt(wall, 0, 2);
    const [pr, pg] = rgbAt(wall, 1, 20);
    expect(alphaAt(wall, 0, 2)).toBe(255);
    // the roof (terracotta) is redder than the planks
    expect(rr - rg).toBeGreaterThan(pr - pg);
    const door = tileOf('door').pixels;
    const [hr, hg, hb] = rgbAt(door, 19, 21);
    const [qr, qg, qb] = rgbAt(door, 12, 21);
    expect(hr + hg + hb).toBeGreaterThan(qr + qg + qb);
  });

  it('the bin, bed and board are see-through around the object, the pad is a ring of light', () => {
    for (const id of ['shipping_bin', 'bed', 'shop_board']) expect(alphaAt(tileOf(id).pixels, 0, 31), id).toBe(0);
    const pad = tileOf('return_pad').pixels;
    const ringAt = (x: number, y: number) => pad[(y * TILE_PX + x) * 4 + 1]!;
    // the centre glows more than the stone at the corner
    expect(ringAt(16, 11)).toBeGreaterThan(ringAt(1, 1));
  });
});
