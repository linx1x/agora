/**
 * P16.8 (ADR-052): people and characters in the 2.5D view as paper cut-outs (P16.7 art).
 *
 * Each figure is a vertical card (a quad that maps the whole sheet cell, cut-out margin included)
 * standing on its floor point, with a blob shadow on the floor and a speaking ring around the
 * feet. Frames come from `figureMath.ts` (the same names and walk cycle as the 2D view). A left↔right
 * turn plays a 120 ms card flip; with reduced motion the figure turns at once. A seated figure is
 * lifted onto the chair's seat, its shadow stays on the floor.
 *
 * Sheets are shared by look: one CanvasTexture per (avatar look, scale), ref-counted over the
 * figures that use it. Each figure samples its own clone of that texture, with its own offset and
 * repeat, so the sheet image is uploaded once. The shared geometry and textures are ref-counted over
 * the `PaperFigures` instances and freed when the last one is disposed.
 */
import * as THREE from 'three';
import { TILE, avatarKey, type Avatar, type Dir } from '@agora/shared';
import { POSE_MS } from '../game/controller';
import { TILT } from './camera';
import {
  FIG_TOP,
  FIG_W,
  PAD_BOTTOM,
  QUAD_H,
  QUAD_W,
  cellUv,
  flipAt,
  frameCell,
  frameName,
  isFlip,
  seatPlacement,
  type FlipStart,
} from './figureMath';
import type { Box3 } from './occlusionMath';
import { makePaperSheet, paperMotionFrame } from './paperAvatar';
import {
  AvatarMotionPlayer,
  motionDuration,
  motionFrameAt,
  type AvatarClip,
  type MotionOptions,
} from '../game/avatarMotion';
import { paperCellSize } from './paperLayout';
import type { PaperScale } from './paperLayout';

/** What the view knows about a body this frame (world px, as the controller gives it). */
export interface FigurePose {
  x: number;
  y: number;
  dir: Dir;
  moving: boolean;
  pose: 'stand' | 'sit';
  /** when the pose last changed (performance.now ms); a crouch frame plays for POSE_MS after */
  poseAt: number;
  /** height of the floor under the feet, tiles (a raised cell of a personal world); 0 in the office */
  elev?: number;
}

/** Test and overlay read-out of one figure. */
export interface FigureInfo {
  /** the frame name the 2D view would use: `<dir>-<walk>`, `sit-<dir>`, `crouch-<dir>` */
  frame: string;
  /** current horizontal scale of the card: 1 normally, passes through 0 during a flip */
  scaleX: number;
  /** card flips started on this figure since it was made (a deterministic hook for tests) */
  flips: number;
  /** height of the figure's feet above the floor, in tiles (seat height when seated) */
  lift: number;
  dir: Dir;
}

/** Blob shadow: ~0.8 × 0.35 tiles on the floor, at this opacity (× the figure's alpha). */
const SHADOW_W = 0.8;
const SHADOW_D = 0.35;
const SHADOW_OPACITY = 0.35;
/** the shadow sits just above the floor so it does not z-fight with it */
const SHADOW_Y = 0.015;
/** speaking ring: radius in tiles, thickness, and the amber of the 2D view */
const RING_R = 0.42;
const RING_T = 0.05;
const RING_Y = 0.02;
const RING_COLOR = 0xf2a900;

/** Resources shared by every figure, ref-counted over the PaperFigures instances. */
interface Shared {
  card: THREE.PlaneGeometry;
  shadowGeo: THREE.PlaneGeometry;
  shadowTex: THREE.CanvasTexture;
  ringGeo: THREE.RingGeometry;
  ringMat: THREE.MeshBasicMaterial;
}

let shared: Shared | null = null;
let sharedUsers = 0;

function makeShared(): Shared {
  // the card: the whole cell, its bottom edge (the cut-out margin) below the feet, so the feet are at the origin
  const card = new THREE.PlaneGeometry(QUAD_W, QUAD_H);
  card.translate(0, QUAD_H / 2 - PAD_BOTTOM, 0);

  // the blob shadow lies flat on the floor (PlaneGeometry faces +z; tip it to face up)
  const shadowGeo = new THREE.PlaneGeometry(SHADOW_W, SHADOW_D);
  shadowGeo.rotateX(-Math.PI / 2);

  // the ring is a circle on the floor, squashed by sin(TILT) so it reads as a flat disc at this tilt
  const ringGeo = new THREE.RingGeometry(RING_R - RING_T, RING_R + RING_T, 40);
  ringGeo.scale(1, Math.sin((TILT * Math.PI) / 180), 1);
  ringGeo.rotateX(-Math.PI / 2);
  const ringMat = new THREE.MeshBasicMaterial({
    color: RING_COLOR,
    transparent: true,
    depthWrite: false,
  });

  // a radial falloff, stretched by the plane into a soft ellipse
  const cv = document.createElement('canvas');
  cv.width = 64;
  cv.height = 64;
  const c = cv.getContext('2d')!;
  const g = c.createRadialGradient(32, 32, 0, 32, 32, 32);
  g.addColorStop(0, 'rgba(0,0,0,1)');
  g.addColorStop(0.55, 'rgba(0,0,0,0.6)');
  g.addColorStop(1, 'rgba(0,0,0,0)');
  c.fillStyle = g;
  c.fillRect(0, 0, 64, 64);
  const shadowTex = new THREE.CanvasTexture(cv);
  shadowTex.generateMipmaps = false;
  shadowTex.minFilter = THREE.LinearFilter;
  shadowTex.magFilter = THREE.LinearFilter;

  return { card, shadowGeo, shadowTex, ringGeo, ringMat };
}

function getShared(): Shared {
  if (!shared) shared = makeShared();
  return shared;
}

function releaseShared(): void {
  sharedUsers -= 1;
  if (sharedUsers > 0 || !shared) return;
  shared.card.dispose();
  shared.shadowGeo.dispose();
  shared.shadowTex.dispose();
  shared.ringGeo.dispose();
  shared.ringMat.dispose();
  shared = null;
  motionCanvases.clear();
  motionPixels = 0;
}

// CPU artwork is shared; each figure retains its own reusable GPU texture. Both limits
// apply so changing outfits cannot accumulate every possible wardrobe combination.
const motionCanvases = new Map<string, HTMLCanvasElement>();
const MAX_MOTION_PIXELS = 4 * 1024 * 1024;
const MAX_MOTION_CANVASES = 128;
let motionPixels = 0;
function motionCanvas(key: string, render: () => HTMLCanvasElement): HTMLCanvasElement {
  const hit = motionCanvases.get(key);
  if (hit) {
    motionCanvases.delete(key);
    motionCanvases.set(key, hit);
    return hit;
  }
  const canvas = render();
  motionCanvases.set(key, canvas);
  motionPixels += canvas.width * canvas.height;
  while (motionPixels > MAX_MOTION_PIXELS || motionCanvases.size > MAX_MOTION_CANVASES) {
    const oldest = motionCanvases.keys().next().value!;
    const image = motionCanvases.get(oldest)!;
    motionPixels -= image.width * image.height;
    motionCanvases.delete(oldest);
  }
  return canvas;
}

/** One CanvasTexture of a whole sheet per (look, scale), shared by every figure of that look. */
interface SheetEntry {
  master: THREE.CanvasTexture;
  refs: number;
}
const sheets = new Map<string, SheetEntry>();

function sheetKey(avatar: Avatar, scale: PaperScale): string {
  return `${avatarKey(avatar)}|${scale}`;
}

function acquireSheet(
  avatar: Avatar,
  scale: PaperScale,
): { key: string; master: THREE.CanvasTexture } {
  const key = sheetKey(avatar, scale);
  let e = sheets.get(key);
  if (!e) {
    const master = new THREE.CanvasTexture(makePaperSheet(avatar, scale));
    // Keep the wardrobe pixel grid crisp, matching the world artwork.
    master.colorSpace = THREE.SRGBColorSpace;
    master.magFilter = THREE.NearestFilter;
    master.minFilter = THREE.NearestFilter;
    master.generateMipmaps = false;
    e = { master, refs: 0 };
    sheets.set(key, e);
  }
  e.refs += 1;
  return { key, master: e.master };
}

function releaseSheet(key: string): void {
  const e = sheets.get(key);
  if (!e) return;
  e.refs -= 1;
  if (e.refs <= 0) {
    e.master.dispose();
    sheets.delete(key);
  }
}

/** One person or character on screen. */
interface Figure {
  /** the sheet key of its look: a change of look rebuilds the figure */
  look: string;
  group: THREE.Group;
  card: THREE.Mesh;
  mat: THREE.MeshLambertMaterial;
  /** this figure's clone of the shared sheet (own offset and repeat) */
  tex: THREE.CanvasTexture;
  shadow: THREE.Mesh;
  shadowMat: THREE.MeshBasicMaterial;
  ring: THREE.Mesh;
  alpha: number;
  speaking: boolean;
  motionTexture?: THREE.CanvasTexture;
  motionKey?: string;
  /** the last direction the server or controller gave */
  target: Dir;
  /** a turn in progress, or null */
  flip: FlipStart | null;
  flips: number;
  info: FigureInfo;
}

/** A set of figures (one for people, one for characters) sharing sheets by avatar look. */
export class PaperFigures {
  private readonly scene: THREE.Scene;
  private readonly scale: PaperScale;
  private readonly figs = new Map<string, Figure>();
  private readonly reducedQuery: MediaQueryList | null;
  private disposed = false;
  private readonly motions = new AvatarMotionPlayer();

  playAction(id: string, clip: AvatarClip, now: number, options: MotionOptions = {}): boolean {
    return !this.disposed && this.motions.play(id, clip, now, options);
  }

  cancelAction(id: string, token?: number): void {
    this.motions.cancel(id, token);
  }

  constructor(scene: THREE.Scene, scale: PaperScale) {
    this.scene = scene;
    this.scale = scale;
    this.reducedQuery =
      typeof window !== 'undefined' && typeof window.matchMedia === 'function'
        ? window.matchMedia('(prefers-reduced-motion: reduce)')
        : null;
    sharedUsers += 1;
    getShared();
  }

  /** Create or update `id`'s figure and pick its frame. */
  place(id: string, avatar: Avatar, p: FigurePose, now: number): void {
    if (this.disposed) return;
    let f = this.figs.get(id);
    if (f && f.look !== sheetKey(avatar, this.scale)) {
      this.drop(f);
      this.figs.delete(id);
      f = undefined;
    }
    if (!f) {
      f = this.make(avatar, p.dir);
      this.figs.set(id, f);
    }
    const reduced = this.reducedQuery?.matches ?? false;
    const action = this.motions.sample(id, now, p.moving, reduced);
    const facing = action?.dir ?? p.dir;

    // a turn: left↔right plays the card flip, any other change is at once. A turn that comes
    // while a flip runs starts from the side on screen at that moment.
    if (facing !== f.target) {
      const shown = flipAt(f.flip, now, reduced, f.target).dir;
      f.flip = !reduced && isFlip(shown, facing) ? { from: shown, to: facing, t0: now } : null;
      if (f.flip) f.flips += 1;
      f.target = facing;
    }
    const flip = flipAt(f.flip, now, reduced, facing);
    if (flip.done) f.flip = null;

    // the seat and the frame use the side on screen, so the lift and the art agree
    const transitioning = p.poseAt > 0 && now - p.poseAt < POSE_MS;
    let { lift, dz } = seatPlacement(p.pose, flip.dir, transitioning);
    if (transitioning && !reduced) {
      const seat = seatPlacement('sit', flip.dir, false);
      const k = Math.max(0, Math.min(1, (now - p.poseAt) / POSE_MS));
      lift = seat.lift * (p.pose === 'sit' ? k : 1 - k);
      dz = seat.dz * (p.pose === 'sit' ? k : 1 - k);
    }
    let frame = frameName(flip.dir, p.pose, p.moving, now, p.poseAt, POSE_MS);
    const cell = frameCell(flip.dir, p.pose, p.moving, now, p.poseAt, POSE_MS);
    const uv = cellUv(cell.col, cell.row, this.scale);
    f.tex.offset.set(uv.offsetX, uv.offsetY);
    f.tex.repeat.set(uv.repeatX, uv.repeatY);

    let scaleX = 1,
      scaleY = 1;
    const clip = f.speaking ? 'talk' : 'idle';
    const phase =
      (now + Array.from(id).reduce((n, ch) => n + ch.charCodeAt(0) * 97, 0)) % motionDuration(clip);
    const transition =
      transitioning && !reduced
        ? {
            clip: p.pose === 'sit' ? ('sitDown' as const) : ('standUp' as const),
            frame: motionFrameAt(p.pose === 'sit' ? 'sitDown' : 'standUp', now - p.poseAt, POSE_MS),
          }
        : null;
    const motion =
      transition ??
      action ??
      (!p.moving && !transitioning && !reduced
        ? { clip, frame: motionFrameAt(clip, phase) }
        : null);
    if (motion) {
      const motionKey = `${flip.dir}|${p.pose}|${motion.clip}|${motion.frame}|${'tier' in motion ? motion.tier : 0}`;
      if (f.motionKey !== motionKey) {
        const canvas = motionCanvas(`${f.look}|${motionKey}`, () =>
          paperMotionFrame(
            avatar,
            flip.dir,
            p.pose === 'sit' && !transition ? 'sit' : 'walk',
            motion,
            this.scale,
          ),
        );
        if (!f.motionTexture) {
          // Never draw into a cached canvas when this figure advances to its next pose.
          const target = document.createElement('canvas');
          target.width = canvas.width;
          target.height = canvas.height;
          f.motionTexture = new THREE.CanvasTexture(target);
          f.motionTexture.colorSpace = THREE.SRGBColorSpace;
          f.motionTexture.magFilter = THREE.NearestFilter;
          f.motionTexture.minFilter = THREE.NearestFilter;
          f.motionTexture.generateMipmaps = false;
        }
        const target = f.motionTexture.image as HTMLCanvasElement;
        const ctx = target.getContext('2d')!;
        ctx.clearRect(0, 0, target.width, target.height);
        ctx.drawImage(canvas, 0, 0);
        f.motionTexture.needsUpdate = true;
        f.motionKey = motionKey;
      }
      const { cw, ch } = paperCellSize(this.scale);
      const canvas = f.motionTexture!.image as HTMLCanvasElement;
      scaleX = canvas.width / cw;
      scaleY = canvas.height / ch;
      f.mat.map = f.motionTexture!;
      if (action) frame = `${action.clip}-${flip.dir}-${action.frame}`;
    } else f.mat.map = f.tex;

    // the floor point moves; the card is lifted onto the seat; the shadow stays on the floor
    f.group.position.set(p.x / TILE, p.elev ?? 0, p.y / TILE + dz);
    f.card.position.y = lift + PAD_BOTTOM * (scaleY - 1);
    // the shadow and the ring stay under the seat (the floor point), not under the shifted card
    f.shadow.position.z = -dz;
    f.ring.position.z = -dz;
    f.card.scale.set(flip.scaleX * scaleX, scaleY, 1);
    f.info = { frame, scaleX: flip.scaleX, flips: f.flips, lift, dir: flip.dir };
  }

  /** 1 normal, 0.6 away, 0.35 offline (as 2D). */
  setAlpha(id: string, alpha: number): void {
    const f = this.figs.get(id);
    if (!f) return;
    f.alpha = alpha;
    f.mat.opacity = alpha;
    f.shadowMat.opacity = SHADOW_OPACITY * alpha;
  }

  /** The speaking ring on the floor around the feet. */
  setSpeaking(id: string, on: boolean): void {
    const f = this.figs.get(id);
    if (f) {
      f.ring.visible = on;
      f.speaking = on;
    }
  }

  info(id: string): FigureInfo | null {
    const f = this.figs.get(id);
    return f ? { ...f.info } : null;
  }

  /** World point (tiles: x, height, z) just above the head, for screen-space overlays. */
  headPoint(id: string): [number, number, number] | null {
    const f = this.figs.get(id);
    if (!f) return null;
    // the top of the figure's art: the cut-out margin above the head is not counted
    // the art leaves ~5 % of the figure empty above the hair (P16.7 drawing box), so names sit
    // on the head as in 2D rather than floating above it
    return [
      f.group.position.x,
      f.group.position.y + f.info.lift + FIG_TOP * 0.95,
      f.group.position.z,
    ];
  }

  /** The body as a world box (tiles): its width, from the feet (or the seat) up to the top. */
  box(id: string): Box3 | null {
    const f = this.figs.get(id);
    if (!f) return null;
    const x = f.group.position.x;
    const z = f.group.position.z;
    const y0 = f.group.position.y + f.info.lift;
    return {
      x0: x - FIG_W / 2,
      x1: x + FIG_W / 2,
      y0,
      y1: y0 + FIG_TOP,
      z0: z - 0.15,
      z1: z + 0.15,
    };
  }

  /** Remove every figure whose id is not in `ids`. */
  keep(ids: Set<string>): void {
    this.motions.keep(ids);
    for (const [id, f] of this.figs) {
      if (ids.has(id)) continue;
      this.drop(f);
      this.figs.delete(id);
    }
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    for (const f of this.figs.values()) this.drop(f);
    this.figs.clear();
    this.motions.clear();
    releaseShared();
  }

  private make(avatar: Avatar, dir: Dir): Figure {
    const sh = getShared();
    const { key, master } = acquireSheet(avatar, this.scale);
    // a clone shares the image source, so the sheet is uploaded once for all its figures
    const tex = master.clone();
    tex.needsUpdate = true;

    // lit by the world's lights (P16.10): a figure darkens at night like the walls do
    const mat = new THREE.MeshLambertMaterial({
      map: tex,
      transparent: true,
      alphaTest: 0.5,
      depthWrite: true,
    });
    const card = new THREE.Mesh(sh.card, mat);
    card.receiveShadow = true;

    const shadowMat = new THREE.MeshBasicMaterial({
      map: sh.shadowTex,
      transparent: true,
      opacity: SHADOW_OPACITY,
      depthWrite: false,
    });
    const shadow = new THREE.Mesh(sh.shadowGeo, shadowMat);
    shadow.position.y = SHADOW_Y;

    const ring = new THREE.Mesh(sh.ringGeo, sh.ringMat);
    ring.position.y = RING_Y;
    ring.visible = false;

    const group = new THREE.Group();
    group.add(card, shadow, ring);
    this.scene.add(group);

    return {
      look: key,
      group,
      card,
      mat,
      tex,
      shadow,
      shadowMat,
      ring,
      alpha: 1,
      speaking: false,
      target: dir,
      flip: null,
      flips: 0,
      info: { frame: '', scaleX: 1, flips: 0, lift: 0, dir },
    };
  }

  private drop(f: Figure): void {
    this.scene.remove(f.group);
    f.mat.dispose();
    f.shadowMat.dispose();
    // the clone goes before the sheet, which is freed with its last figure
    f.tex.dispose();
    f.motionTexture?.dispose();
    releaseSheet(f.look);
  }
}
