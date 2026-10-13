/**
 * A tool swing in the 2.5D world view (P17.21c, P17.21d, ADR-053): the tool card as a billboard at the
 * person's hand (its three frames per facing, with the arc it has swept and the tier mark), sparks at
 * the target cell on the impact, a camera shake for my own hit (none under reduced motion) and the
 * tier's sound. The frames and the timing are the flat view's (`tools/swingArt.ts`, `tools/swing.ts`),
 * so both views swing alike; the card is larger here (`CARD_TILES`) so the swing reads at the default
 * zoom. The tier changes the card's sprite and the numbers, never the animation. Visual only: the server has already decided the action. Browser only.
 */
import * as THREE from 'three';
import { TILE, type Dir } from '@agora/shared';
import { pixelTexture } from '../../game3d/meshes';
import type { Cam } from '../../game3d/camera';
import { playSwingSound } from '../tools/sound';
import { swingCardCanvas } from '../tools/swingArt';
import {
  AFTER_MS,
  CARD_TILES,
  FADE_MS,
  HAND_PX,
  IMPACT_AT,
  SHAKE_MS,
  SPARK_MS,
  SPARK_STILL_MS,
  frameIndexAt,
  swingParams,
  type Facing,
  type TierFeel,
} from '../tools/swing';
import { screenShift } from './math3d';
import type { MotionEvent } from '../../game/avatarMotion';

/** The sparks lie this far above the top of the target cell (tiles). */
const SPARK_LIFT = 0.04;
/** The card stands this far towards the viewer (tiles). */
const NEAR = 0.15;
/** drawn after the people and the walls: a swing and its sparks are never hidden by the person swinging */
const OVER_FIGURE = 20;
/** the sparks lie over the card: the card is big, and the impact is at its foot */
const OVER_CARD = OVER_FIGURE + 1;
const HAND = HAND_PX / TILE;
/** The card's width in tiles (the canvas is FRAME_PX square, so the art is drawn at this scale). */
const CARD = CARD_TILES;

/** One swing to play: where the person stands, what they swing at, and the settings. */
export interface SwingPlay {
  /** Body animation owns all contact cues when supplied. */
  readonly eventDriven?: boolean;
  readonly duration?: number;
  /** The avatar now carries its own tool; retain sound and target effects only. */
  readonly bodyTool?: boolean;
  /** Held tool family; omitted callers keep the original generic swing. */
  readonly tool?: string;
  /** the feet, in tiles (x east, z south) */
  readonly feetX: number;
  readonly feetZ: number;
  /** the height of the floor under the feet, in tiles */
  readonly floor: number;
  readonly dir: Dir;
  readonly tier: number;
  /** the tool's playback speed (1 is base speed) */
  readonly speed: number;
  /** the cell the swing lands on, and its top's height (tiles) */
  readonly target: { readonly cx: number; readonly cy: number; readonly floor: number };
  /** my own swing: it shakes the view (the others' do not) */
  readonly own: boolean;
  readonly reduced: boolean;
  readonly sounds: boolean;
}

export interface SwingHandle {
  cue(event: MotionEvent): void;
  cancel(): void;
}

interface Active {
  readonly play: SwingPlay;
  readonly sprite: THREE.Sprite;
  /** this swing's own material, so it can fade out without fading the others */
  readonly mat: THREE.SpriteMaterial;
  readonly facing: Facing;
  readonly start: number;
  readonly duration: number;
  readonly feel: TierFeel;
  readonly shakePx: number;
  readonly trail: boolean;
  frame: number;
  impacted: boolean;
}

interface Burst {
  readonly water: boolean;
  readonly points: THREE.Points;
  readonly geo: THREE.BufferGeometry;
  readonly mat: THREE.PointsMaterial;
  /** each spark's unit direction on the ground (x, z) */
  readonly dirs: Float32Array;
  readonly origin: { readonly x: number; readonly y: number; readonly z: number };
  readonly reach: number;
  readonly start: number;
  readonly life: number;
  readonly still: boolean;
}

export class SwingFx {
  private readonly active: Active[] = [];
  private readonly bursts: Burst[] = [];
  private readonly textures = new Map<string, THREE.CanvasTexture>();
  private shaking: { start: number; px: number } | null = null;

  constructor(private readonly scene: THREE.Scene) {}

  /** Plays a swing now, starting at `now`: the card at the hand, the sound. The impact comes in `update`. */
  play(p: SwingPlay, now: number): SwingHandle {
    const params = swingParams({ tier: p.tier, speed: p.speed }, p.dir, p.reduced);
    const trail = !p.reduced;
    const mat = new THREE.SpriteMaterial({
      map: p.bodyTool ? null : this.texture(p.tier, p.dir, 0, trail, p.tool),
      transparent: true,
      alphaTest: 0.5,
      depthWrite: false,
      depthTest: false,
    });
    const sprite = new THREE.Sprite(mat);
    sprite.center.set(0.5, 0.5);
    sprite.visible = !p.bodyTool;
    sprite.scale.set(CARD, CARD, 1);
    sprite.position.set(p.feetX, p.floor + HAND, p.feetZ + NEAR);
    sprite.renderOrder = OVER_FIGURE;
    this.scene.add(sprite);
    const active: Active = {
      play: p,
      sprite,
      mat,
      facing: p.dir,
      start: now,
      duration: p.duration ?? params.durationMs,
      feel: params.feel,
      shakePx: p.tool === 'can' ? 0 : params.shakePx,
      trail,
      frame: 0,
      impacted: false,
    };
    this.active.push(active);
    return {
      cue: (event) => {
        if (event.kind === 'impact' && this.active.includes(active)) this.impact(active, event.at);
      },
      cancel: () => this.cancel(active),
    };
  }

  private impact(s: Active, now: number): void {
    if (s.impacted) return;
    s.impacted = true;
    this.spark(s, now);
    if (s.play.tool === 'can')
      playSwingSound(0.65, s.play.sounds, { pitch: 0.65, decayMs: 45, click: 0 });
    else playSwingSound(s.feel.pitch, s.play.sounds, s.feel);
    if (s.play.own && !s.play.reduced && s.shakePx > 0)
      this.shaking = { start: now, px: s.shakePx };
  }

  private cancel(s: Active): void {
    const index = this.active.indexOf(s);
    if (index < 0) return;
    this.scene.remove(s.sprite);
    s.mat.dispose();
    this.active.splice(index, 1);
  }

  /** Moves the swing on: its frames, its impact (sparks, and the shake for my own), its fade and its end. */
  update(now: number): void {
    for (let i = this.active.length - 1; i >= 0; i--) {
      const s = this.active[i]!;
      const elapsed = now - s.start;
      const f = frameIndexAt(elapsed, s.duration);
      if (f !== s.frame && !s.play.bodyTool) {
        s.frame = f;
        s.mat.map = this.texture(s.play.tier, s.facing, f, s.trail, s.play.tool);
      }
      if (!s.play.eventDriven && !s.impacted && elapsed >= s.duration * IMPACT_AT)
        this.impact(s, now);
      // the card holds for AFTER_MS, then fades (reduced motion: it is simply gone)
      const end = s.duration + AFTER_MS;
      if (elapsed >= end) {
        const k = s.play.reduced ? 1 : (elapsed - end) / FADE_MS;
        if (k >= 1) {
          this.scene.remove(s.sprite);
          s.mat.dispose();
          this.active.splice(i, 1);
          continue;
        }
        s.mat.opacity = 1 - k;
      }
    }
    for (let i = this.bursts.length - 1; i >= 0; i--) {
      const b = this.bursts[i]!;
      const t = (now - b.start) / b.life;
      if (t >= 1) {
        this.dropBurst(b);
        this.bursts.splice(i, 1);
        continue;
      }
      if (!b.still) {
        const pos = b.geo.getAttribute('position') as THREE.BufferAttribute;
        const r = b.reach * t;
        for (let k = 0; k < pos.count; k++) {
          pos.setXYZ(
            k,
            b.origin.x + b.dirs[k * 2]! * r,
            b.origin.y + (b.water ? 0.32 * (1 - t) : 0),
            b.origin.z + b.dirs[k * 2 + 1]! * r,
          );
        }
        pos.needsUpdate = true;
        b.mat.opacity = 1 - t;
      }
    }
  }

  /**
   * The camera's shift for this frame, in tiles (world x, y, z): a shake that dies away over its
   * time. Zero when nothing shakes. The eye and the target move together, so the view slides.
   */
  shake(cam: Cam, now: number): [number, number, number] {
    const sh = this.shaking;
    if (!sh) return [0, 0, 0];
    const t = (now - sh.start) / SHAKE_MS;
    if (t >= 1) {
      this.shaking = null;
      return [0, 0, 0];
    }
    const amp = sh.px * (1 - t);
    const [x, y, z] = screenShift(
      cam,
      (Math.random() * 2 - 1) * amp,
      (Math.random() * 2 - 1) * amp,
    );
    return [x, y, z];
  }

  /**
   * The sparks of an impact: a burst at the target cell's top, the tier's count, size, colours and
   * blending (diamond sparks glow). Reduced motion: they flash in place.
   */
  private spark(s: Active, now: number): void {
    const { target, reduced } = s.play;
    const feel = s.feel;
    const water = s.play.tool === 'can';
    const soil = s.play.tool === 'hoe' || s.play.tool === 'shovel';
    const n = water ? 9 : feel.sparkCount;
    const positions = new Float32Array(n * 3);
    const colors = new Float32Array(n * 3);
    const dirs = new Float32Array(n * 2);
    const origin = { x: target.cx + 0.5, y: target.floor + SPARK_LIFT, z: target.cy + 0.5 };
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2 + s.play.tier * 0.3;
      dirs[i * 2] = Math.cos(a);
      dirs[i * 2 + 1] = Math.sin(a);
      positions.set([origin.x, origin.y, origin.z], i * 3);
      const palette = water
        ? ['#92ddef', '#d5f7ff', '#439ac7']
        : soil
          ? ['#85643b', '#ba935f', '#dac499']
          : feel.sparks;
      const c = new THREE.Color(palette[i % palette.length]!);
      colors.set([c.r, c.g, c.b], i * 3);
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    const mat = new THREE.PointsMaterial({
      // the screen size of the square: the flat view's (wood 5 px, iron 8 px, diamond 12 px)
      size: water ? 4 : feel.sparkPx,
      sizeAttenuation: false,
      vertexColors: true,
      transparent: true,
      depthWrite: false,
      depthTest: false,
      blending: !water && !soil && feel.bright ? THREE.AdditiveBlending : THREE.NormalBlending,
    });
    const points = new THREE.Points(geo, mat);
    points.renderOrder = OVER_CARD;
    this.scene.add(points);
    this.bursts.push({
      water,
      points,
      geo,
      mat,
      dirs,
      origin,
      reach: water ? 0.36 : feel.sparkReachPx / TILE,
      start: now,
      life: reduced ? SPARK_STILL_MS : water ? 430 : SPARK_MS,
      still: reduced,
    });
  }

  /** The card's texture for a tier, facing and frame (made once; shared by every swing). */
  private texture(
    tier: number,
    facing: Facing,
    n: number,
    trail: boolean,
    tool?: string,
  ): THREE.CanvasTexture {
    const key = `${tier}-${facing}-${n}-${trail ? 1 : 0}-${tool ?? 'generic'}`;
    let t = this.textures.get(key);
    if (!t) {
      t = pixelTexture(swingCardCanvas(tier, facing, n, trail, tool));
      this.textures.set(key, t);
    }
    return t;
  }

  private dropBurst(b: Burst): void {
    this.scene.remove(b.points);
    b.geo.dispose();
    b.mat.dispose();
  }

  /** Removes what is on screen and frees the textures (the next swing makes them again). */
  dispose(): void {
    for (const s of this.active) {
      this.scene.remove(s.sprite);
      s.mat.dispose();
    }
    this.active.length = 0;
    for (const b of this.bursts) this.dropBurst(b);
    this.bursts.length = 0;
    this.shaking = null;
    for (const t of this.textures.values()) t.dispose();
    this.textures.clear();
  }
}
