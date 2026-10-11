/**
 * The 2.5D world view's texture (P17.15): the block tops, cliff sides, decor and crop frames of the
 * flat view (view2d/art.ts), packed into one canvas, one row per kind, so the whole world is one
 * material. Browser only (it draws to a canvas). The frames are the same pixels as the flat view. The
 * last row holds the farm's animals and state marks (P17.21c, farmArt.ts), which the flat view does not draw.
 */
import { TILE_PX } from '../placeholders';
import { SIDE_PX, allBlockFrames, cropFrameSet, sprinklerPixels, type Rgba } from '../view2d/art';
import { ANIMAL_KINDS, MARK_KINDS, animalPixels, animalSprite, markPixels, markSprite } from '../farmArt';
import type { UvRect } from './geometry';

export interface WorldAtlas {
  readonly canvas: HTMLCanvasElement;
  /** the sprite's place by name (`top:<block>`, `side:<block>`, `decor:<block>`, a crop, `sprinkler`) */
  uv(name: string): UvRect | undefined;
}

interface Frame {
  readonly name: string;
  readonly w: number;
  readonly h: number;
  readonly px: Rgba;
}

/**
 * Pack the frames into rows and return the canvas with a lookup. A canvas is read with its first row
 * at the top, and a three.js canvas texture is flipped, so a frame's top edge has the larger `v`.
 */
export function buildWorldAtlas(): WorldAtlas {
  const blocks = [...allBlockFrames()];
  const crops = [...cropFrameSet()].map(([name, px]) => ({ name, w: TILE_PX, h: TILE_PX, px }));
  const rows: Frame[][] = [
    blocks.map(([id, f]) => ({ name: `top:${id}`, w: TILE_PX, h: TILE_PX, px: f.top })),
    blocks.map(([id, f]) => ({ name: `side:${id}`, w: TILE_PX, h: SIDE_PX, px: f.side })),
    blocks.map(([id, f]) => ({ name: `decor:${id}`, w: TILE_PX, h: TILE_PX, px: f.decor })),
    [...crops, { name: 'sprinkler', w: TILE_PX, h: TILE_PX, px: sprinklerPixels() }],
    [
      ...ANIMAL_KINDS.map((k) => ({ name: animalSprite(k), w: TILE_PX, h: TILE_PX, px: animalPixels(k) })),
      ...MARK_KINDS.map((m) => ({ name: markSprite(m), w: TILE_PX, h: TILE_PX, px: markPixels(m) })),
    ],
  ];
  const width = Math.max(...rows.map((r) => r.length)) * TILE_PX;
  const height = rows.reduce((sum, r) => sum + Math.max(...r.map((f) => f.h)), 0);

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('2D canvas unavailable');

  const at = new Map<string, { x: number; y: number; w: number; h: number }>();
  let y = 0;
  for (const row of rows) {
    const rowH = Math.max(...row.map((f) => f.h));
    row.forEach((f, i) => {
      const x = i * TILE_PX;
      ctx.putImageData(new ImageData(f.px, f.w, f.h), x, y);
      at.set(f.name, { x, y, w: f.w, h: f.h });
    });
    y += rowH;
  }

  return {
    canvas,
    uv(name) {
      const r = at.get(name);
      if (!r) return undefined;
      return {
        u0: (r.x + 0.5) / width,
        u1: (r.x + r.w - 0.5) / width,
        vt: 1 - (r.y + 0.5) / height,
        vb: 1 - (r.y + r.h - 0.5) / height,
      };
    },
  };
}
