/** One bounded, padded GPU atlas, populated immediately with fallbacks and then approved art. */
import { TILE_PX } from '../placeholders';
import { SIDE_PX, allBlockFrames, cropFrameSet, sprinklerPixels, type Rgba } from '../blockArt';
import {
  ANIMAL_KINDS,
  MARK_KINDS,
  animalPixels,
  animalSprite,
  markPixels,
  markSprite,
} from '../farmArt';
import { loadApprovedWorldArt, type SpriteMetrics } from '../art/approvedArt';
import { canvas as makeCanvas } from '../art/pixels';
import type { UvRect } from './geometry';

export interface WorldAtlas {
  readonly ready: Promise<void>;
  readonly canvas: HTMLCanvasElement;
  readonly artworkReady: boolean;
  /** True only when pixels changed and the GPU texture needs an upload. */
  update(seconds: number, reducedMotion?: boolean): boolean;
  uv(name: string): UvRect | undefined;
}
interface Frame {
  name: string;
  w: number;
  h: number;
  px: Rgba;
}
const CELL = 128,
  PAD = 2,
  PITCH = CELL + PAD * 2,
  WIDTH = 2048,
  COLS = Math.floor(WIDTH / PITCH);
export function buildWorldAtlas(): WorldAtlas {
  const blocks = [...allBlockFrames()],
    frames: Frame[] = [];
  for (const [id, f] of blocks)
    for (const kind of ['top', 'side', 'decor'] as const)
      frames.push({
        name: `${kind}:${id}`,
        w: TILE_PX,
        h: kind === 'side' ? SIDE_PX : TILE_PX,
        px: f[kind],
      });
  frames.push({
    name: 'decor:bed:horizontal',
    w: TILE_PX,
    h: TILE_PX,
    px: blocks.find(([id]) => id === 'bed')![1].decor,
  });
  for (const [name, px] of cropFrameSet()) frames.push({ name, w: TILE_PX, h: TILE_PX, px });
  frames.push({ name: 'sprinkler', w: TILE_PX, h: TILE_PX, px: sprinklerPixels() });
  for (const kind of ANIMAL_KINDS)
    frames.push({ name: animalSprite(kind), w: TILE_PX, h: TILE_PX, px: animalPixels(kind) });
  for (const kind of MARK_KINDS)
    frames.push({ name: markSprite(kind), w: TILE_PX, h: TILE_PX, px: markPixels(kind) });
  const soil = blocks.find(([id]) => id === 'tilled_soil')![1].top;
  for (let stage = 0; stage < 5; stage++)
    frames.push({ name: `top:tilled_soil:${stage}`, w: TILE_PX, h: TILE_PX, px: soil });
  const height = 2 ** Math.ceil(Math.log2(Math.ceil(frames.length / COLS) * PITCH));
  const canvas = makeCanvas(WIDTH, height),
    ctx = canvas.getContext('2d')!;
  ctx.imageSmoothingEnabled = false;
  const at = new Map<string, { x: number; y: number }>(),
    metrics = new Map<string, SpriteMetrics>();
  const paint = (name: string, source: HTMLCanvasElement) => {
    const r = at.get(name);
    if (!r) return;
    ctx.clearRect(r.x - PAD, r.y - PAD, PITCH, PITCH);
    ctx.drawImage(source, r.x, r.y, CELL, CELL);
    if (name.startsWith('top:') || name.startsWith('side:')) {
      ctx.drawImage(canvas, r.x, r.y, 1, CELL, r.x - PAD, r.y, PAD, CELL);
      ctx.drawImage(canvas, r.x + CELL - 1, r.y, 1, CELL, r.x + CELL, r.y, PAD, CELL);
      ctx.drawImage(canvas, r.x - PAD, r.y, PITCH, 1, r.x - PAD, r.y - PAD, PITCH, PAD);
      ctx.drawImage(canvas, r.x - PAD, r.y + CELL - 1, PITCH, 1, r.x - PAD, r.y + CELL, PITCH, PAD);
    }
  };
  frames.forEach((f, i) => {
    at.set(f.name, { x: (i % COLS) * PITCH + PAD, y: Math.floor(i / COLS) * PITCH + PAD });
    const source = makeCanvas(f.w, f.h);
    source.getContext('2d')!.putImageData(new ImageData(f.px, f.w, f.h), 0, 0);
    paint(f.name, source);
  });
  const animations = new Map<string, HTMLCanvasElement[]>();
  let artworkReady = false,
    lastFrame = -1;
  const ready = loadApprovedWorldArt()
    .then((art) => {
      for (const [id, source] of art.decor) paint(`decor:${id}`, source);
      for (const [id, source] of art.crops) paint(id, source);
      for (const [id, source] of art.terrain) {
        paint(`top:${id}`, source);
        if (at.has(`side:${id}`)) paint(`side:${id}`, source);
      }
      for (const [kind, sources] of art.animals)
        if (at.has(animalSprite(kind))) {
          paint(animalSprite(kind), sources[0]!);
          animations.set(animalSprite(kind), sources);
        }
      animations.set('decor:torch', art.torches);
      for (const [id, m] of art.metrics) metrics.set(id, m);
      artworkReady = true;
    })
    .catch((error) =>
      console.warn(
        'Approved world artwork unavailable; retaining the playable fallback atlas.',
        error,
      ),
    );
  return {
    canvas,
    ready,
    get artworkReady() {
      return artworkReady;
    },
    update(seconds, reducedMotion = false) {
      if (!artworkReady) return false;
      const frame = reducedMotion ? 0 : Math.floor(seconds * 4) % 4;
      if (frame === lastFrame) return false;
      lastFrame = frame;
      for (const [name, sources] of animations) paint(name, sources[frame % sources.length]!);
      return true;
    },
    uv(name) {
      const r = at.get(name);
      if (!r) return undefined;
      return {
        u0: (r.x + 0.5) / WIDTH,
        u1: (r.x + CELL - 0.5) / WIDTH,
        vt: 1 - (r.y + 0.5) / height,
        vb: 1 - (r.y + CELL - 0.5) / height,
        ...metrics.get(name),
      };
    },
  };
}
