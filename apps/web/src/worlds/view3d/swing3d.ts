/**
 * A tool swing in the 2.5D world view (P17.21c, ADR-053): the swing's frames as a billboard at the
 * person's hand, the tier mark beside it, sparks at the target cell on the impact, a camera shake
 * for my own hit (none under reduced motion) and the tier's sound. The frames, the marks, the timing
 * and the sizes are the flat view's (`tools/swingArt.ts`, `tools/swing.ts`), so both views swing
 * alike. Visual only: the server has already decided the action. Browser only (it draws canvases).
 */
import * as THREE from 'three';
import { TILE, type Dir } from '@agora/shared';
import { pixelTexture } from '../../game3d/meshes';
import type { Cam } from '../../game3d/camera';
import { playSwingSound } from '../tools/sound';
import { FRAME_PX, swingFrameCanvas, tierMarkCanvas } from '../tools/swingArt';
import { OVERLAY_GRID } from '../tools/overlay';
import {
  HAND_PX,
  IMPACT_AT,
  frameIndexAt,
  sparkCount,
  swingParams,
  type Facing,
} from '../tools/swing';
import { screenShift } from './math3d';

/** The arc and the mark stay this long after the swing (the flat view's 60 ms). */
const AFTER_MS = 60;
/** The sparks fly for this long; under reduced motion they flash in place for `STILL_MS`. */
const SPARK_MS = 260;
const STILL_MS = 160;
/** A shake lasts this long; it is 2 px a tier each way at the start (the flat view's shake). */
const SHAKE_MS = 180;
/** The swing stands this far towards the viewer, so the figure's card does not hide it (tiles). */
const NEAR = 0.15;
/** The sparks lie this far above the top of the target cell (tiles). */
const SPARK_LIFT = 0.04;
const SPARK_COLORS = [0xffe08a, 0xfff4c2] as const;
/** The spark ring's radius at the start, in pixels, grows with the tier (the flat view's 6 + 2 a tier). */
const SPARK_REACH_PX = 6;
const HAND = HAND_PX / TILE;
const ARC = FRAME_PX / TILE;
const MARK = OVERLAY_GRID / TILE;
/** The mark sits this far right of and above the hand (the flat view's +6, -6 px). */
const MARK_OFFSET = 6 / TILE;

/** One swing to play: where the person stands, what they swing at, and the settings. */
export interface SwingPlay {
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

interface Active {
  readonly play: SwingPlay;
  readonly arc: THREE.Sprite;
  readonly mark: THREE.Sprite;
  readonly facing: Facing;
  readonly start: number;
  readonly duration: number;
  readonly sparkPx: number;
  readonly shakePx: number;
  readonly sparkCount: number;
  frame: number;
  impacted: boolean;
}

interface Burst {
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
  private readonly frameMats = new Map<string, THREE.SpriteMaterial>();
  private readonly markMats = new Map<number, THREE.SpriteMaterial>();
  private shaking: { start: number; px: number } | null = null;

  constructor(private readonly scene: THREE.Scene) {}

  /** Plays a swing now: the arc and the mark at the hand, the sound. The impact comes in `update`. */
  play(p: SwingPlay, now: number): void {
    const params = swingParams({ tier: p.tier, speed: p.speed }, p.dir, p.reduced);
    const facing = p.dir;
    const hand: [number, number, number] = [p.feetX, p.floor + HAND, p.feetZ + NEAR];
    const arc = new THREE.Sprite(this.frameMat(facing, 0));
    arc.center.set(0.5, 0.5);
    arc.scale.set(ARC, ARC, 1);
    arc.position.set(...hand);
    const mark = new THREE.Sprite(this.markMat(p.tier));
    mark.center.set(0.5, 0.5);
    mark.scale.set(MARK, MARK, 1);
    mark.position.set(hand[0] + MARK_OFFSET, hand[1] + MARK_OFFSET, hand[2]);
    this.scene.add(arc, mark);
    this.active.push({
      play: p,
      arc,
      mark,
      facing,
      start: now,
      duration: params.durationMs,
      sparkPx: params.sparkPx,
      shakePx: params.shakePx,
      sparkCount: sparkCount(p.tier),
      frame: 0,
      impacted: false,
    });
    playSwingSound(params.pitch, p.sounds);
  }

  /** Moves the swing on: its frames, its impact (sparks, and the shake for my own), and its end. */
  update(now: number): void {
    for (let i = this.active.length - 1; i >= 0; i--) {
      const s = this.active[i]!;
      const elapsed = now - s.start;
      const f = frameIndexAt(elapsed, s.duration);
      if (f !== s.frame) {
        s.frame = f;
        s.arc.material = this.frameMat(s.facing, f);
      }
      if (!s.impacted && elapsed >= s.duration * IMPACT_AT) {
        s.impacted = true;
        this.spark(s, now);
        if (s.play.own && !s.play.reduced) this.shaking = { start: now, px: s.shakePx };
      }
      if (elapsed >= s.duration + AFTER_MS) {
        this.scene.remove(s.arc, s.mark);
        this.active.splice(i, 1);
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
          pos.setXYZ(k, b.origin.x + b.dirs[k * 2]! * r, b.origin.y, b.origin.z + b.dirs[k * 2 + 1]! * r);
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
    const amp = 2 * sh.px * (1 - t);
    const [x, y, z] = screenShift(cam, (Math.random() * 2 - 1) * amp, (Math.random() * 2 - 1) * amp);
    return [x, y, z];
  }

  /** The sparks of an impact: a burst at the target cell's top, `sparkCount` squares of the tier's size. */
  private spark(s: Active, now: number): void {
    const { target, tier, reduced } = s.play;
    const n = s.sparkCount;
    const positions = new Float32Array(n * 3);
    const colors = new Float32Array(n * 3);
    const dirs = new Float32Array(n * 2);
    const origin = { x: target.cx + 0.5, y: target.floor + SPARK_LIFT, z: target.cy + 0.5 };
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2 + tier * 0.3;
      dirs[i * 2] = Math.cos(a);
      dirs[i * 2 + 1] = Math.sin(a);
      positions.set([origin.x, origin.y, origin.z], i * 3);
      const c = new THREE.Color(SPARK_COLORS[i % SPARK_COLORS.length]!);
      colors.set([c.r, c.g, c.b], i * 3);
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    const mat = new THREE.PointsMaterial({
      size: s.sparkPx,
      sizeAttenuation: false,
      vertexColors: true,
      transparent: true,
      depthWrite: false,
    });
    const points = new THREE.Points(geo, mat);
    this.scene.add(points);
    this.bursts.push({
      points,
      geo,
      mat,
      dirs,
      origin,
      reach: (SPARK_REACH_PX + 2 * tier) / TILE,
      start: now,
      life: reduced ? STILL_MS : SPARK_MS,
      still: reduced,
    });
  }

  private frameMat(facing: Facing, n: number): THREE.SpriteMaterial {
    const key = `${facing}-${n}`;
    let m = this.frameMats.get(key);
    if (!m) {
      m = new THREE.SpriteMaterial({
        map: pixelTexture(swingFrameCanvas(facing, n)),
        transparent: true,
        alphaTest: 0.5,
        depthWrite: false,
      });
      this.frameMats.set(key, m);
    }
    return m;
  }

  private markMat(tier: number): THREE.SpriteMaterial {
    let m = this.markMats.get(tier);
    if (!m) {
      m = new THREE.SpriteMaterial({
        map: pixelTexture(tierMarkCanvas(tier)),
        transparent: true,
        alphaTest: 0.5,
        depthWrite: false,
      });
      this.markMats.set(tier, m);
    }
    return m;
  }

  private dropBurst(b: Burst): void {
    this.scene.remove(b.points);
    b.geo.dispose();
    b.mat.dispose();
  }

  /** Removes what is on screen. The frame and mark materials are kept for the next swing. */
  dispose(): void {
    for (const s of this.active) this.scene.remove(s.arc, s.mark);
    this.active.length = 0;
    for (const b of this.bursts) this.dropBurst(b);
    this.bursts.length = 0;
    this.shaking = null;
    for (const m of [...this.frameMats.values(), ...this.markMats.values()]) {
      m.map?.dispose();
      m.dispose();
    }
    this.frameMats.clear();
    this.markMats.clear();
  }
}
