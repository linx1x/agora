/**
 * The office cat in the 2.5D view (P16.23, ADR-040/041, ADR-054). The server describes each cat in
 * `pet:state`; the browser decides nothing: a cat is a pixel card standing on the floor (or on the desk
 * it perched on), facing the fixed camera like the paper people, easing toward its last position.
 *
 * The art is the `pets` sheet of 32 px cells: per coat `walk` (side view, mirrored for left),
 * `walkUp`, `walkDown` and the poses `sit`, `loaf`, `sleep`, `drink`, `stretch` (`cat.<coat>.<anim>`).
 */
import * as THREE from 'three';
import type { PetState } from '@agora/shared';
import { art, type ArtSprite } from '../game/sprites';
import { upright } from './figureMath';

/** One art cell, px. */
export const PET_CELL = 32;
/** The cat's feet sit 2 px above the bottom of its cell (the old flat view's contact shadow). */
const FEET_PX = 30;
/** Card size in tiles: a 32 px cell is one tile wide, as on the flat map. */
const CARD_W = 1;
const CARD_H = upright(1);
/** Per second: the server sends about 15 updates a second; this smooths the gaps. */
const EASE = 14;
/** Farther than this (px) the cat jumps instead of gliding (a hop down, a long skip). */
const SNAP_PX = 96;
const SHADOW_W = 0.55;
const SHADOW_D = 0.22;
const SHADOW_OPACITY = 0.3;

/** The sprite name for what a cat is doing and which way it faces. */
export function petSprite(p: Pick<PetState, 'coat' | 'a' | 'd'>): string {
  if (p.a === 'walk') {
    if (p.d === 'up') return `cat.${p.coat}.walkUp`;
    if (p.d === 'down') return `cat.${p.coat}.walkDown`;
  }
  return `cat.${p.coat}.${p.a}`;
}

/**
 * Which frame of a sprite to show `ms` after the pose began. Loops cycle; `stretch` plays once and
 * holds its last frame (the server then sits the cat down). Reduced motion: nothing cycles, and a
 * stretch shows its end pose.
 */
export function petFrameIndex(
  spr: Pick<ArtSprite, 'frames' | 'fps'>,
  anim: PetState['a'],
  ms: number,
  reduced: boolean,
): number {
  if (spr.frames <= 1) return 0;
  if (reduced) return anim === 'stretch' ? spr.frames - 1 : 0;
  if (spr.fps <= 0) return 0;
  const n = Math.floor((Math.max(0, ms) / 1000) * spr.fps);
  return anim === 'stretch' ? Math.min(n, spr.frames - 1) : n % spr.frames;
}

/** Where a cat stands in the 3D scene (tiles), from its 2D point and the surface height under it (px). */
export function petTo3D(x: number, y: number, surfacePx: number): [number, number, number] {
  // as a prop on a desk top (props3d.propTo3D): lifted by the surface, and as far south as that top
  return [x / PET_CELL, surfacePx / PET_CELL, (y + surfacePx) / PET_CELL];
}

interface Cat {
  group: THREE.Group;
  card: THREE.Mesh;
  mat: THREE.MeshLambertMaterial;
  canvas: HTMLCanvasElement;
  tex: THREE.CanvasTexture;
  shadow: THREE.Mesh;
  goal: PetState;
  /** drawn 2D point, easing toward the goal */
  x: number;
  y: number;
  facing: 'left' | 'right';
  shown: string;
  since: number;
  frameKey: string;
}

export class PetFigures {
  private cats = new Map<string, Cat>();
  private shadowGeo: THREE.PlaneGeometry;
  private shadowTex: THREE.CanvasTexture;
  private cardGeo: THREE.PlaneGeometry;
  private disposed = false;

  constructor(
    private scene: THREE.Scene,
    /** surface height (px) under a 2D point: a desk top the cat perched on, else 0 */
    private surfaceAt: (x: number, y: number) => number,
  ) {
    this.cardGeo = new THREE.PlaneGeometry(CARD_W, CARD_H);
    // feet at the origin: the cell's bottom margin hangs below the floor point
    this.cardGeo.translate(0, CARD_H / 2 - upright((PET_CELL - FEET_PX) / PET_CELL), 0);
    this.shadowGeo = new THREE.PlaneGeometry(SHADOW_W, SHADOW_D);
    this.shadowGeo.rotateX(-Math.PI / 2);
    const cv = document.createElement('canvas');
    cv.width = cv.height = 32;
    const c = cv.getContext('2d')!;
    const g = c.createRadialGradient(16, 16, 0, 16, 16, 16);
    g.addColorStop(0, 'rgba(0,0,0,1)');
    g.addColorStop(1, 'rgba(0,0,0,0)');
    c.fillStyle = g;
    c.fillRect(0, 0, 32, 32);
    this.shadowTex = new THREE.CanvasTexture(cv);
  }

  /** The cats the server describes now: new ones appear, gone ones are removed. */
  sync(pets: readonly PetState[]): void {
    if (this.disposed) return;
    const ids = new Set(pets.map((p) => p.id));
    for (const p of pets) {
      let cat = this.cats.get(p.id);
      if (!cat) {
        cat = this.make(p);
        this.cats.set(p.id, cat);
      }
      cat.goal = p;
      if (p.d === 'left' || p.d === 'right') cat.facing = p.d;
    }
    for (const [id, cat] of this.cats) {
      if (ids.has(id)) continue;
      this.drop(cat);
      this.cats.delete(id);
    }
  }

  /** Every frame: ease, place on the floor or the desk top, pick the art frame. */
  update(now: number, dtMs: number, reduced: boolean): void {
    if (this.disposed) return;
    const k = Math.min(1, (dtMs / 1000) * EASE);
    for (const cat of this.cats.values()) {
      const { x, y } = cat.goal;
      if (Math.hypot(x - cat.x, y - cat.y) > SNAP_PX) {
        cat.x = x;
        cat.y = y;
      } else {
        cat.x += (x - cat.x) * k;
        cat.y += (y - cat.y) * k;
      }
      const [tx, ty, tz] = petTo3D(cat.x, cat.y, this.surfaceAt(x, y));
      cat.group.position.set(tx, ty, tz);
      cat.card.scale.x = cat.facing === 'left' ? -1 : 1;

      const name = petSprite(cat.goal);
      const spr = art[name];
      if (!spr) continue;
      if (name !== cat.shown) {
        cat.shown = name;
        cat.since = now;
      }
      const i = petFrameIndex(spr, cat.goal.a, now - cat.since, reduced);
      const key = `${name}#${i}`;
      if (key === cat.frameKey) continue;
      cat.frameKey = key;
      const c = cat.canvas.getContext('2d')!;
      c.clearRect(0, 0, PET_CELL, PET_CELL);
      c.drawImage(
        spr.img,
        spr.x + i * PET_CELL,
        spr.y,
        PET_CELL,
        PET_CELL,
        0,
        0,
        PET_CELL,
        PET_CELL,
      );
      cat.tex.needsUpdate = true;
    }
  }

  /** How many cats are drawn with art (the e2e `petsDrawn` read-out). */
  drawn(): number {
    let n = 0;
    for (const cat of this.cats.values()) if (cat.frameKey) n++;
    return n;
  }

  /** A cat's body as a world box (tiles), for the occlusion rule and picking. */
  box(
    id: string,
  ): { x0: number; x1: number; y0: number; y1: number; z0: number; z1: number } | null {
    const cat = this.cats.get(id);
    if (!cat) return null;
    const p = cat.group.position;
    return {
      x0: p.x - CARD_W / 2,
      x1: p.x + CARD_W / 2,
      y0: p.y,
      y1: p.y + CARD_H * 0.6,
      z0: p.z - 0.1,
      z1: p.z + 0.1,
    };
  }

  ids(): string[] {
    return [...this.cats.keys()];
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    for (const cat of this.cats.values()) this.drop(cat);
    this.cats.clear();
    this.cardGeo.dispose();
    this.shadowGeo.dispose();
    this.shadowTex.dispose();
  }

  private make(p: PetState): Cat {
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = PET_CELL;
    const tex = new THREE.CanvasTexture(canvas);
    // pixel art: nearest filtering, as the world's tiles
    tex.magFilter = THREE.NearestFilter;
    tex.minFilter = THREE.NearestFilter;
    tex.generateMipmaps = false;
    tex.colorSpace = THREE.SRGBColorSpace;
    const mat = new THREE.MeshLambertMaterial({ map: tex, transparent: true, alphaTest: 0.5 });
    const card = new THREE.Mesh(this.cardGeo, mat);
    const shadow = new THREE.Mesh(
      this.shadowGeo,
      new THREE.MeshBasicMaterial({
        map: this.shadowTex,
        transparent: true,
        opacity: SHADOW_OPACITY,
        depthWrite: false,
      }),
    );
    shadow.position.y = 0.012;
    const group = new THREE.Group();
    group.add(card, shadow);
    this.scene.add(group);
    return {
      group,
      card,
      mat,
      canvas,
      tex,
      shadow,
      goal: p,
      x: p.x,
      y: p.y,
      facing: p.d === 'left' ? 'left' : 'right',
      shown: '',
      since: 0,
      frameKey: '',
    };
  }

  private drop(cat: Cat): void {
    this.scene.remove(cat.group);
    cat.mat.dispose();
    cat.tex.dispose();
    (cat.shadow.material as THREE.Material).dispose();
  }
}
