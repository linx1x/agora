/**
 * Draws the pets the server describes in `pet:state` (ADR-040). Browsers decide nothing: a cat is
 * a sprite that eases toward the last position it was sent. The art is one sheet (`pets.png`) of
 * 32 px cells; each coat has `walk` (side view, mirrored for left), `walkUp`, `walkDown`, and the
 * poses `sit`, `loaf`, `sleep`, `drink`, `stretch` (see `cat.<coat>.<anim>` in pets.json).
 */
import Phaser from 'phaser';
import type { PetState } from '@agora/shared';
import { store } from '../state/store';
import { art, type ArtSprite } from './sprites';

const TEXTURE = 'pets.sheet';
const CELL = 32;
/** The cat's feet sit a little above the bottom of its 32 px cell (2 px contact shadow). */
const FEET_Y = 30;
/** Per second; the server sends about 15 updates a second, this smooths the gaps. */
const EASE = 14;
const SNAP_PX = 96;

const reducedMotion = () =>
  window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;

/** The sprite name for what a cat is doing and which way it faces. */
export function petSprite(p: Pick<PetState, 'coat' | 'a' | 'd'>): string {
  if (p.a === 'walk') {
    if (p.d === 'up') return `cat.${p.coat}.walkUp`;
    if (p.d === 'down') return `cat.${p.coat}.walkDown`;
  }
  return `cat.${p.coat}.${p.a}`;
}

/** Index of frame `i` of a sprite in a sheet cut into 32 px cells. */
export function petFrame(s: Pick<ArtSprite, 'x' | 'y'>, sheetCols: number, i: number): number {
  return (s.y / CELL) * sheetCols + s.x / CELL + i;
}

interface View {
  sprite: Phaser.GameObjects.Sprite;
  goal: PetState;
  facing: 'left' | 'right';
  /** what was last shown, so a one-shot animation restarts only when the pose changes */
  shown: string;
  since: number;
}

export class PetsView {
  private views = new Map<string, View>();
  private off: () => void;
  private cols = 16;

  constructor(private scene: Phaser.Scene) {
    this.ensureTexture();
    // pet:state lands in the store (it can arrive before this scene exists)
    let last = store.get().pets;
    this.sync(last);
    this.off = store.subscribe(() => {
      const pets = store.get().pets;
      if (pets === last) return;
      last = pets;
      this.sync(pets);
    });
  }

  /** The art sheet is loaded before the scene starts; without it there are simply no cats. */
  private ensureTexture(): boolean {
    if (this.scene.textures.exists(TEXTURE)) return true;
    const any = art['cat.ginger.sit'];
    if (!any) return false;
    this.scene.textures.addSpriteSheet(TEXTURE, any.img, {
      frameWidth: CELL,
      frameHeight: CELL,
    });
    this.cols = Math.floor(any.img.width / CELL);
    return true;
  }

  private sync(pets: PetState[]) {
    const ids = new Set(pets.map((p) => p.id));
    for (const p of pets) this.apply(p);
    for (const id of [...this.views.keys()]) if (!ids.has(id)) this.remove(id);
  }

  private apply(p: PetState) {
    let v = this.views.get(p.id);
    if (!v) {
      if (!this.ensureTexture()) return;
      // origin on the feet so depth (y) sorts the cat with avatars and furniture
      const sprite = this.scene.add.sprite(p.x, p.y, TEXTURE, 0).setOrigin(0.5, FEET_Y / CELL);
      v = { sprite, goal: p, facing: 'right', shown: '', since: 0 };
      this.views.set(p.id, v);
      sprite.setPosition(p.x, p.y);
    }
    v.goal = p;
    if (p.d === 'left' || p.d === 'right') v.facing = p.d;
  }

  /** Called every frame by the scene. */
  update(now: number, dtMs: number) {
    const k = Math.min(1, (dtMs / 1000) * EASE);
    const still = reducedMotion();
    for (const v of this.views.values()) {
      const s = v.sprite;
      const { x, y } = v.goal;
      if (Math.hypot(x - s.x, y - s.y) > SNAP_PX) s.setPosition(x, y);
      else s.setPosition(s.x + (x - s.x) * k, s.y + (y - s.y) * k);
      s.setDepth(s.y);
      s.setFlipX(v.facing === 'left');

      const name = petSprite(v.goal);
      const spr = art[name];
      if (!spr) continue;
      if (name !== v.shown) {
        v.shown = name;
        v.since = now;
      }
      // reduced motion: the cat still moves and changes pose, but nothing cycles
      let i = 0;
      if (!still && spr.frames > 1 && spr.fps > 0) {
        const n = Math.floor(((now - v.since) / 1000) * spr.fps);
        // stretch plays once and holds its last frame; the server then sits the cat down
        i = v.goal.a === 'stretch' ? Math.min(n, spr.frames - 1) : n % spr.frames;
      } else if (still && v.goal.a === 'stretch') i = spr.frames - 1;
      s.setFrame(petFrame(spr, this.cols, i));
    }
  }

  private remove(id: string) {
    this.views.get(id)?.sprite.destroy();
    this.views.delete(id);
  }

  destroy() {
    this.off();
    for (const id of [...this.views.keys()]) this.remove(id);
  }
}
