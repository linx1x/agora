/**
 * Placed props (P9.16, ADR-039): y-sorted images resting on a surface or on a stack, each with
 * a one-pixel contact shadow, and a warm glow under a lit lamp. Rebuilt after every edit
 * (props are few). Also answers "which prop is under this point" for build mode.
 */
import Phaser from 'phaser';
import {
  NONE,
  TILESET_NAME,
  TILE_DEFS,
  mapReader,
  propDef,
  resolveProps,
  type PlacedProp,
  type PropRest,
  type WorldMap,
} from '@agora/shared';
import { placedSprite } from './compose';
import { tileSource } from './BlendLayers';

const frameOf = new Map(TILE_DEFS.map((d, i) => [d.name, String(i)]));
const SHADOW_A = 0.25;

/** Where one prop is drawn. */
export interface PropBox {
  id: string;
  index: number;
  x0: number;
  x1: number;
  y0: number;
  baseY: number;
  depth: number;
}

/** Sprite boxes and depths of every prop, from the shared rest rules. */
export function layoutProps(
  map: WorldMap,
  props: readonly PlacedProp[] = map.props,
  rest: PropRest[] = resolveProps(mapReader(map), props),
): PropBox[] {
  const src = tileSource();
  const out: PropBox[] = [];
  props.forEach((p, i) => {
    const px = src.tile(p.t);
    const r = rest[i]!;
    const s = px ? placedSprite(px, p, r.lift) : null;
    // a rider sits just in front of what holds it, whatever its own base row
    const depth = r.on >= 0 ? out[r.on]!.depth + 0.01 : p.y + i * 1e-4;
    out.push({
      id: p.id,
      index: i,
      x0: s?.x0 ?? p.x - 4,
      x1: s?.x1 ?? p.x + 4,
      y0: s?.y0 ?? p.y - 8,
      baseY: s?.baseY ?? p.y,
      depth,
    });
  });
  return out;
}

export class PropsView {
  private objs: Phaser.GameObjects.GameObject[] = [];
  private imgOf = new Map<string, Phaser.GameObjects.Image>();
  boxes: PropBox[] = [];

  constructor(
    private scene: Phaser.Scene,
    private map: () => WorldMap,
  ) {
    this.sync();
  }

  sync() {
    for (const o of this.objs) o.destroy();
    this.objs = [];
    this.imgOf.clear();
    const m = this.map();
    const rest = resolveProps(mapReader(m), m.props);
    this.boxes = layoutProps(m, m.props, rest);
    const src = tileSource();
    const add = this.scene.add;
    m.props.forEach((p, i) => {
      const px = src.tile(p.t);
      if (!px) return;
      const b = this.boxes[i]!;
      const s = placedSprite(px, p, rest[i]!.lift);
      const floating = rest[i]!.on === NONE;
      // contact shadow on what it rests on: one row under it and one column to its right
      if (!floating) {
        this.objs.push(
          add
            .image(b.x0 + 1, b.baseY + 1, '__WHITE')
            .setOrigin(0, 0)
            .setDisplaySize(b.x1 - b.x0 + 1, 1)
            .setTint(0x000000)
            .setAlpha(SHADOW_A)
            .setDepth(b.depth - 0.002),
          add
            .image(b.x1 + 1, b.baseY - 1, '__WHITE')
            .setOrigin(0, 0)
            .setDisplaySize(1, 2)
            .setTint(0x000000)
            .setAlpha(SHADOW_A)
            .setDepth(b.depth - 0.002),
        );
      }
      if (propDef(p.t)?.light === 'lamp' && this.scene.textures.exists('glow'))
        this.objs.push(
          add
            .image(b.x0 + (p.f ? b.x1 - b.x0 - 4 : 4), b.baseY - 2, 'glow')
            .setDisplaySize(36, 20)
            .setTint(0xffc46b)
            .setAlpha(0.3)
            .setBlendMode(Phaser.BlendModes.ADD)
            .setDepth(b.depth - 0.001),
        );
      const img = add
        .image(s.ox, s.oy, TILESET_NAME, frameOf.get(p.t))
        .setOrigin(0, 0)
        .setFlipX(p.f)
        .setDepth(b.depth);
      this.objs.push(img);
      this.imgOf.set(p.id, img);
    });
  }

  /** Fade the props being moved (their ghosts show where they go). */
  dim(ids: ReadonlySet<string>) {
    for (const [id, img] of this.imgOf) img.setAlpha(ids.has(id) ? 0.35 : 1);
  }

  /** Topmost prop whose sprite covers the world point, or null. */
  hit(x: number, y: number, pad = 0): PropBox | null {
    let best: PropBox | null = null;
    for (const b of this.boxes)
      if (x >= b.x0 - pad && x <= b.x1 + pad && y >= b.y0 - pad && y <= b.baseY + pad)
        if (!best || b.depth > best.depth) best = b;
    return best;
  }

  get count() {
    return this.boxes.length;
  }

  destroy() {
    for (const o of this.objs) o.destroy();
    this.objs = [];
  }
}
