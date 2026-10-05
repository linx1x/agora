/**
 * Props layer (P9.11, ADR-038): each prop is a y-sorted image resting on the surface under it,
 * like the desk pod decor. Rebuilt after every edit (props are few).
 */
import Phaser from 'phaser';
import { TILESET_NAME, TILE_DEFS, mapReader, type WorldMap } from '@agora/shared';
import { propPlacement } from './compose';
import { tileSource } from './BlendLayers';

const frameOf = new Map(TILE_DEFS.map((d, i) => [d.name, String(i)]));

export class PropsView {
  private imgs: Phaser.GameObjects.Image[] = [];

  constructor(
    private scene: Phaser.Scene,
    private map: () => WorldMap,
    private blended: () => boolean,
  ) {
    this.sync();
  }

  sync() {
    for (const i of this.imgs) i.destroy();
    this.imgs = [];
    const m = this.map();
    const data = m.layers.props;
    if (!data) return;
    const r = mapReader(m);
    const src = tileSource();
    const blended = this.blended();
    for (let i = 0; i < data.length; i++) {
      if (!data[i]) continue;
      const x = i % m.width;
      const y = (i - x) / m.width;
      const def = r.def('props', x, y);
      const px = def && src.tile(def.name);
      const p = px && propPlacement(r, px, x, y, blended);
      if (!def || !p) continue;
      this.imgs.push(
        this.scene.add
          .image(p.ox, p.oy, TILESET_NAME, frameOf.get(def.name))
          .setOrigin(0, 0)
          .setDepth(p.baseY),
      );
    }
  }

  get count() {
    return this.imgs.length;
  }

  destroy() {
    for (const i of this.imgs) i.destroy();
    this.imgs = [];
  }
}
