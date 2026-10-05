/**
 * Animated tiles (ADR-023). Phaser tilemap layers are static, so frame 0 of every animated tile
 * stays baked in the tileset (still image, reduced motion, Tiled export) and a lightweight Image
 * sits on top of each such cell and steps through the frames. Rebuilt when build mode edits tiles.
 */
import Phaser from 'phaser';
import { TILE, type WorldMap } from '@agora/shared';
import { animatedTiles, makeAnimCanvas } from './tiles';

const TEX = 'tileanim';
type LayerMap = Record<string, Phaser.Tilemaps.TilemapLayer | null>;

export class TileAnimator {
  private list = animatedTiles();
  private byGid = new Map<number, { row: number; frames: number; fps: number }>();
  private items: {
    img: Phaser.GameObjects.Image;
    row: number;
    frames: number;
    fps: number;
    shown: number;
  }[] = [];

  constructor(
    private scene: Phaser.Scene,
    private layers: LayerMap,
    private map: WorldMap,
  ) {
    if (!this.list.length) return;
    if (!scene.textures.exists(TEX)) {
      const tex = scene.textures.addCanvas(TEX, makeAnimCanvas(this.list))!;
      this.list.forEach((l, row) => {
        for (let f = 0; f < l.frames; f++)
          tex.add(`${row}:${f}`, 0, f * TILE, row * TILE, TILE, TILE);
      });
    }
    this.list.forEach((l, row) =>
      this.byGid.set(l.index + 1, { row, frames: l.frames, fps: l.fps }),
    );
    this.sync();
  }

  /** Re-scan the map and rebuild the overlays (call after tile edits). */
  sync() {
    if (!this.byGid.size) return;
    for (const it of this.items) it.img.destroy();
    this.items = [];
    for (const name of ['floor', 'walls', 'furniture'] as const) {
      const layer = this.layers[name];
      const data = this.map.layers[name];
      if (!layer || !data) continue;
      for (let i = 0; i < data.length; i++) {
        const a = this.byGid.get((data[i] ?? 0) & 0x1fffffff);
        if (!a) continue;
        const x = i % this.map.width;
        const y = (i - x) / this.map.width;
        const img = this.scene.add
          .image(x * TILE, y * TILE, TEX, `${a.row}:0`)
          .setOrigin(0, 0)
          .setDepth(layer.depth + 1);
        this.items.push({ img, ...a, shown: 0 });
      }
    }
  }

  update(nowMs: number) {
    for (const it of this.items) {
      const f = Math.floor((nowMs / 1000) * it.fps) % it.frames;
      if (f !== it.shown) {
        it.shown = f;
        it.img.setFrame(`${it.row}:${f}`);
      }
    }
  }
}
