/**
 * The flat view's textures (P17.14): the block frames and the crop frames packed into one canvas
 * per kind, one row each, so Phaser loads four textures. Browser only (it draws to a canvas).
 */
import type Phaser from 'phaser';
import { TILE_PX } from '../placeholders';
import { SIDE_PX, allBlockFrames, cropFrameSet, sprinklerPixels, type Rgba } from './art';

export const TEX = { top: 'world.top', side: 'world.side', decor: 'world.decor', crop: 'world.crop' } as const;

/** Pack frames into one row and register them with Phaser (a single texture per kind). */
function addRow(
  textures: Phaser.Textures.TextureManager,
  key: string,
  frames: readonly { name: string; w: number; h: number; px: Rgba }[],
): void {
  if (textures.exists(key)) return;
  const width = frames.reduce((sum, f) => sum + f.w, 0);
  const height = Math.max(...frames.map((f) => f.h));
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('2D canvas unavailable');
  // draw first, then register: a canvas texture is uploaded to the GPU when it is added, so pixels
  // drawn afterwards never reach the screen (the cells stayed invisible)
  let x = 0;
  const at: number[] = [];
  for (const f of frames) {
    ctx.putImageData(new ImageData(f.px, f.w, f.h), x, 0);
    at.push(x);
    x += f.w;
  }
  const tex = textures.addCanvas(key, canvas);
  if (!tex) throw new Error(`texture ${key} not created`);
  frames.forEach((f, i) => tex.add(f.name, 0, at[i]!, 0, f.w, f.h));
}

/** Register the world's textures once per game. */
export function addWorldTextures(textures: Phaser.Textures.TextureManager): void {
  const blocks = [...allBlockFrames()];
  addRow(
    textures,
    TEX.top,
    blocks.map(([id, f]) => ({ name: `top:${id}`, w: TILE_PX, h: TILE_PX, px: f.top })),
  );
  addRow(
    textures,
    TEX.side,
    blocks.map(([id, f]) => ({ name: `side:${id}`, w: TILE_PX, h: SIDE_PX, px: f.side })),
  );
  addRow(
    textures,
    TEX.decor,
    blocks.map(([id, f]) => ({ name: `decor:${id}`, w: TILE_PX, h: TILE_PX, px: f.decor })),
  );
  const crops = [...cropFrameSet()].map(([name, px]) => ({ name, w: TILE_PX, h: TILE_PX, px }));
  addRow(textures, TEX.crop, [...crops, { name: 'sprinkler', w: TILE_PX, h: TILE_PX, px: sprinklerPixels() }]);
}
