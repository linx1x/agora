import { describe, expect, it } from 'vitest';
import { BLOCKS } from '@agora/shared';
import { LOOKS, paletteOf, paletteColour, placeholderTiles, renderTile, resolveTile, TILE_PX } from './placeholders';

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
      if (shape === 'ground' || shape === 'box') expect(corner, b.id).toBe(255);
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
