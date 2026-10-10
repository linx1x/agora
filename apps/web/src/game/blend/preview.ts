/**
 * Build-mode preview for blended tiles (P9.12). Shows the planned edit exactly as it will be
 * drawn: the server's own plan (`planEdit`, so tree tops, wall faces and props that leave
 * with their desk are included) is applied to a "what if" reader, and every cell whose look
 * changes is composed with the same functions the live map uses. Live tiles under changed
 * furniture cells are hidden while the preview shows; neighbours that change get a dashed
 * outline so the builder sees what will join.
 */
import Phaser from 'phaser';
import {
  BLEND_RADIUS,
  furnitureKey,
  groundKey,
  mapReader,
  type CellChange,
  type TileReader,
  type WorldMap,
} from '@agora/shared';
import { T } from './compose';
import type { BlendLayers } from './BlendLayers';

/** Largest area previewed at once, in cells (a long stroke previews around the cursor). */
const WIN = 16;
const TEX = { g: 'blend-preview-g', f: 'blend-preview-f' } as const;

export class BlendPreview {
  private tex: Record<'g' | 'f', Phaser.Textures.CanvasTexture>;
  private img: Record<'g' | 'f', Phaser.GameObjects.Image>;
  private outline: Phaser.GameObjects.Graphics;
  /** cells the last preview changed (global index), for tests and the hint */
  changed: number[] = [];

  constructor(
    private scene: Phaser.Scene,
    private outlineDepth: number,
  ) {
    const mk = (kind: 'g' | 'f') => {
      if (scene.textures.exists(TEX[kind])) scene.textures.remove(TEX[kind]);
      return scene.textures.createCanvas(TEX[kind], WIN * T, WIN * T)!;
    };
    this.tex = { g: mk('g'), f: mk('f') };
    this.img = {
      g: scene.add.image(0, 0, TEX.g).setOrigin(0, 0).setVisible(false),
      f: scene.add.image(0, 0, TEX.f).setOrigin(0, 0).setVisible(false),
    };
    this.outline = scene.add.graphics().setDepth(outlineDepth);
  }

  destroy() {
    this.img.g.destroy();
    this.img.f.destroy();
    this.outline.destroy();
    for (const k of Object.values(TEX))
      if (this.scene.textures.exists(k)) this.scene.textures.remove(k);
  }

  hide(blend: BlendLayers | null) {
    this.img.g.setVisible(false);
    this.img.f.setVisible(false);
    this.outline.clear();
    this.changed = [];
    blend?.unmask();
  }

  /**
   * Preview `changes` (an accepted plan) around `focus`. `skip` cells (the stroke itself)
   * get no dashed outline: the cursor already marks them.
   */
  show(
    blend: BlendLayers,
    map: WorldMap,
    changes: CellChange[],
    focus: { cx: number; cy: number },
    skip: Set<number>,
  ) {
    const over = new Map<string, string | null>(changes.map((c) => [`${c.l}:${c.x}:${c.y}`, c.t]));
    const live = mapReader(map);
    const hyp = mapReader(map, over);
    const W = map.width;
    // the window of cells we can show, centred on the focus
    const x0 = Math.max(0, Math.min(map.width - WIN, focus.cx - WIN / 2));
    const y0 = Math.max(0, Math.min(map.height - WIN, focus.cy - WIN / 2));
    const near = new Set<number>();
    for (const c of changes)
      for (let dy = -BLEND_RADIUS; dy <= BLEND_RADIUS; dy++)
        for (let dx = -BLEND_RADIUS; dx <= BLEND_RADIUS; dx++) {
          const x = c.x + dx;
          const y = c.y + dy;
          if (x < x0 || y < y0 || x >= x0 + WIN || y >= y0 + WIN) continue;
          if (x >= map.width || y >= map.height) continue;
          near.add(y * W + x);
        }
    const changedG: number[] = [];
    const changedF: number[] = [];
    const differs = (
      r1: TileReader,
      r2: TileReader,
      l: 'floor' | 'furniture',
      x: number,
      y: number,
    ) => r1.def(l, x, y)?.name !== r2.def(l, x, y)?.name;
    for (const i of near) {
      const x = i % W;
      const y = (i - x) / W;
      if (groundKey(live, x, y) !== groundKey(hyp, x, y) || differs(live, hyp, 'floor', x, y))
        changedG.push(i);
      if (
        furnitureKey(live, x, y) !== furnitureKey(hyp, x, y) ||
        differs(live, hyp, 'furniture', x, y)
      )
        changedF.push(i);
    }
    this.draw('g', blend, hyp, changedG, x0, y0, W);
    this.draw('f', blend, hyp, changedF, x0, y0, W);
    blend.mask(changedF);
    // dashed outline on neighbours whose look changes
    const g = this.outline;
    g.clear();
    this.changed = [...new Set([...changedG, ...changedF])];
    g.lineStyle(1, 0xffd877, 0.95);
    for (const i of this.changed) {
      if (skip.has(i)) continue;
      const x = (i % W) * T;
      const y = Math.floor(i / W) * T;
      dashedRect(g, x + 1.5, y + 1.5, T - 3, T - 3);
    }
  }

  private draw(
    kind: 'g' | 'f',
    blend: BlendLayers,
    hyp: TileReader,
    cells: number[],
    x0: number,
    y0: number,
    W: number,
  ) {
    const img = this.img[kind];
    if (!cells.length) {
      img.setVisible(false);
      return;
    }
    const tex = this.tex[kind];
    const ctx = tex.getContext();
    ctx.clearRect(0, 0, WIN * T, WIN * T);
    for (const i of cells) {
      const x = i % W;
      const y = (i - x) / W;
      const key =
        (kind === 'g' ? groundKey(hyp, x, y) : furnitureKey(hyp, x, y)) ??
        `plain|${kind}|${hyp.def(kind === 'g' ? 'floor' : 'furniture', x, y)?.name ?? ''}`;
      const px = blend.pixelsFor(kind, key, hyp, x, y);
      ctx.putImageData(new ImageData(new Uint8ClampedArray(px), T, T), (x - x0) * T, (y - y0) * T);
    }
    tex.refresh();
    img
      .setPosition(x0 * T, y0 * T)
      .setDepth(blend.depthOf(kind) + 0.05)
      .setVisible(true);
  }
}

function dashedRect(g: Phaser.GameObjects.Graphics, x: number, y: number, w: number, h: number) {
  const dash = 3;
  const gap = 2;
  const line = (ax: number, ay: number, bx: number, by: number) => {
    const len = Math.hypot(bx - ax, by - ay);
    for (let s = 0; s < len; s += dash + gap) {
      const e = Math.min(len, s + dash);
      g.lineBetween(
        ax + ((bx - ax) * s) / len,
        ay + ((by - ay) * s) / len,
        ax + ((bx - ax) * e) / len,
        ay + ((by - ay) * e) / len,
      );
    }
  };
  line(x, y, x + w, y);
  line(x + w, y, x + w, y + h);
  line(x + w, y + h, x, y + h);
  line(x, y + h, x, y);
}
