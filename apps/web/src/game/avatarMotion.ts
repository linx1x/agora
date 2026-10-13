/** Cosmetic motion only: action results and movement remain server controlled. */
import type { ActionKind, Dir, Emote } from '@agora/shared';

export type AvatarClip = ActionKind | Emote | 'idle' | 'talk' | 'sitDown' | 'standUp';
export interface AvatarMotion {
  clip: AvatarClip;
  frame: number;
  tier?: number;
}
export const MOTION_FRAMES = 6;
export const ACTION_MOTIONS = {
  till: 'dig',
  water: 'pour',
  plant: 'plant',
  harvest: 'gather',
  fertilize: 'scatter',
  place: 'carry',
  chop: 'chop',
  mine: 'strike',
  eat: 'eat',
  sleep: 'rest',
  raise: 'dig',
  lower: 'dig',
  remove: 'strike',
  open: 'reach',
  stash: 'carry',
  take: 'gather',
  buy: 'receive',
  ship: 'carry',
  feed: 'scatter',
  collect: 'gather',
  craft: 'craft',
} as const satisfies Record<ActionKind, string>;

export type MotionCue = 'swish' | 'impact' | 'release' | 'finish';
export interface MotionStep {
  readonly pose: number;
  readonly ms: number;
  readonly enter?: MotionCue;
  readonly exit?: MotionCue;
}
export interface MotionEvent {
  readonly kind: MotionCue;
  readonly clip: AvatarClip;
  /** Absolute presentation time, even when a render skips the boundary. */
  readonly at: number;
}
const step = (pose: number, ms: number, enter?: MotionCue, exit?: MotionCue): MotionStep => ({
  pose,
  ms,
  enter,
  exit,
});
const sequences = {
  dig: [
    step(0, 40),
    step(1, 110),
    step(2, 40, 'swish'),
    step(3, 145, 'impact'),
    step(4, 95),
    step(5, 70),
  ],
  chop: [
    step(0, 35),
    step(1, 95),
    step(2, 35, 'swish'),
    step(3, 155, 'impact'),
    step(4, 110),
    step(5, 70),
  ],
  strike: [
    step(0, 35),
    step(1, 80),
    step(2, 30, 'swish'),
    step(3, 135, 'impact'),
    step(4, 105),
    step(5, 75),
  ],
  pour: [step(0, 55), step(1, 100), step(2, 80), step(3, 310, 'impact'), step(4, 95), step(5, 80)],
  plant: [
    step(0, 60),
    step(1, 130),
    step(2, 110),
    step(3, 140, 'release'),
    step(4, 110),
    step(5, 90),
  ],
  gather: [
    step(0, 60),
    step(1, 100),
    step(2, 150),
    step(3, 120, 'release'),
    step(4, 160),
    step(5, 110),
  ],
  scatter: [
    step(0, 60),
    step(1, 130),
    step(2, 75),
    step(3, 150, 'release'),
    step(4, 110),
    step(5, 85),
  ],
  carry: [
    step(0, 80),
    step(1, 140),
    step(2, 120),
    step(3, 170, 'release'),
    step(4, 110),
    step(5, 90),
  ],
  receive: [
    step(0, 70),
    step(1, 110),
    step(2, 130),
    step(3, 180, 'release'),
    step(4, 160),
    step(5, 100),
  ],
  reach: [
    step(0, 60),
    step(1, 100),
    step(2, 110),
    step(3, 150, 'release'),
    step(4, 90),
    step(5, 90),
  ],
  eat: [
    step(0, 100),
    step(1, 180),
    step(2, 160),
    step(3, 180),
    step(2, 130),
    step(3, 180),
    step(4, 180),
    step(5, 120),
  ],
  rest: [step(0, 120), step(1, 200), step(2, 250), step(3, 1100), step(4, 320), step(5, 210)],
  craft: [
    step(0, 90),
    step(1, 170),
    step(2, 150, 'impact'),
    step(3, 180),
    step(4, 180, 'impact'),
    step(3, 150),
    step(4, 200, 'impact'),
    step(5, 120),
  ],
  idle: [step(0, 900), step(1, 900), step(2, 900), step(3, 610), step(4, 150), step(5, 140)],
  talk: [step(0, 130), step(1, 110), step(2, 140), step(3, 100), step(4, 120), step(5, 120)],
  wave: [
    step(0, 100),
    step(1, 220),
    step(2, 180),
    step(3, 180),
    step(2, 180),
    step(4, 220),
    step(5, 160),
  ],
  clap: [
    step(0, 130),
    step(1, 150),
    step(2, 130, 'impact'),
    step(3, 160),
    step(4, 150, 'impact'),
    step(3, 160),
    step(4, 150, 'impact'),
    step(5, 180),
  ],
  heart: [step(0, 140), step(1, 160), step(2, 200), step(3, 450), step(4, 300), step(5, 200)],
  laugh: [
    step(0, 100),
    step(1, 180),
    step(2, 160),
    step(3, 180),
    step(2, 160),
    step(4, 200),
    step(5, 170),
  ],
  thumbs: [step(0, 110), step(1, 160), step(2, 180), step(3, 600), step(4, 220), step(5, 160)],
  hand: [step(0, 100), step(1, 150), step(2, 150), step(3, 650), step(4, 220), step(5, 150)],
  sitDown: [step(0, 20), step(1, 25), step(2, 30), step(3, 35), step(4, 30), step(5, 20)],
  standUp: [step(0, 20), step(1, 25), step(2, 30), step(3, 35), step(4, 30), step(5, 20)],
} as const;

/** Original pose sequences; a pose can repeat and each boundary can carry a presentation cue. */
export function motionSequence(clip: AvatarClip, dir: Dir = 'down'): readonly MotionStep[] {
  const family = clip in ACTION_MOTIONS ? ACTION_MOTIONS[clip as ActionKind] : clip;
  const sequence = sequences[family as keyof typeof sequences];
  // Facing the viewer needs a little more anticipation; keep the overall action duration.
  return dir === 'down' && ['dig', 'chop', 'strike'].includes(family)
    ? sequence.map((s, i) => ({ ...s, ms: s.ms + (i === 1 ? 40 : i === 3 ? -40 : 0) }))
    : sequence;
}

export function motionDuration(clip: AvatarClip, dir: Dir = 'down'): number {
  return motionSequence(clip, dir).reduce((sum, s) => sum + s.ms, 0);
}

/** Timing comes from the clip; scaling its duration also scales every presentation event. */
export function motionFrameAt(
  clip: AvatarClip,
  elapsed: number,
  duration = motionDuration(clip),
  reduced = false,
  dir: Dir = 'down',
): number {
  if (reduced) return clip === 'idle' || clip === 'talk' ? 0 : 3;
  let t = (Math.max(0, elapsed) / Math.max(1, duration)) * motionDuration(clip, dir);
  const sequence = motionSequence(clip, dir);
  for (const s of sequence) {
    if (t < s.ms) return s.pose;
    t -= s.ms;
  }
  return sequence[sequence.length - 1]!.pose;
}

/** Enumerates crossed boundaries rather than inspecting only the currently visible pose. */
export function motionEventsBetween(
  clip: AvatarClip,
  from: number,
  to: number,
  duration = motionDuration(clip),
  dir: Dir = 'down',
): Array<{ kind: MotionCue; elapsed: number }> {
  const events: Array<{ kind: MotionCue; elapsed: number }> = [];
  const scale = duration / motionDuration(clip, dir);
  let elapsed = 0;
  const add = (kind?: MotionCue) => {
    if (kind && elapsed > from && elapsed <= to) events.push({ kind, elapsed });
  };
  for (const s of motionSequence(clip, dir)) {
    add(s.enter);
    elapsed += s.ms * scale;
    add(s.exit);
  }
  elapsed = duration;
  add('finish');
  return events;
}

export function actionFacing(
  x: number,
  y: number,
  at: { x: number; y: number },
  cell: number,
  fallback: Dir,
): Dir {
  if (Math.floor(x / cell) === at.x && Math.floor(y / cell) === at.y) return fallback;
  const dx = (at.x + 0.5) * cell - x,
    dy = (at.y + 0.5) * cell - y;
  if (Math.abs(dx) < 1 && Math.abs(dy) < 1) return fallback;
  return Math.abs(dx) > Math.abs(dy) ? (dx < 0 ? 'left' : 'right') : dy < 0 ? 'up' : 'down';
}

export interface MotionPose {
  drop: number;
  lean: number;
  left: number;
  right: number;
  elbow: number;
  blink: boolean;
  mouth: boolean;
  /** Authored body anchors, in the 64×96 design grid; feet remain planted. */
  bend: number;
  torsoScale: number;
  headX: number;
  headY: number;
  nod: number;
  knee: number;
  stance: number;
  toolAngle: number;
  tool?: 'hoe' | 'can' | 'axe' | 'pick' | 'shovel';
  prop?: 'seeds' | 'crop' | 'parcel' | 'food' | 'coin' | 'hammer' | 'heart';
}
/** Angles are arm rotations from hanging down. All clothes follow the same joints. */
export function motionPose(motion?: AvatarMotion, dir: Dir = 'right'): MotionPose {
  const p: MotionPose = {
    drop: 0,
    lean: 0,
    left: 0,
    right: 0,
    elbow: 0,
    blink: false,
    mouth: false,
    bend: 0,
    torsoScale: 1,
    headX: 0,
    headY: 0,
    nod: 0,
    knee: 0,
    stance: 0,
    toolAngle: 0,
  };
  if (!motion) return p;
  const f = Math.max(0, Math.min(5, motion.frame)),
    clip = motion.clip;
  const pulse = [0, 0.3, 0.7, 1, 0.4, 0][f]!;
  const active = f > 0 && f < 5;
  const family = clip in ACTION_MOTIONS ? ACTION_MOTIONS[clip as ActionKind] : clip;
  // Each family changes the silhouette, not just the angle of a held object.
  const bodies: Partial<Record<typeof family, readonly number[]>> = {
    chop: [0, -0.12, -0.2, 0.28, 0.16, 0],
    strike: [0, -0.08, -0.14, 0.34, 0.2, 0],
    dig: [0, -0.05, -0.12, 0.25, 0.3, 0],
    pour: [0, 0.06, 0.12, 0.16, 0.08, 0],
    gather: [0, 0.16, 0.35, 0.3, 0.08, 0],
    plant: [0, 0.14, 0.29, 0.33, 0.17, 0],
    scatter: [0, -0.08, -0.05, 0.14, 0.12, 0],
    carry: [0, -0.08, 0.05, 0.19, 0.1, 0],
    reach: [0, 0.05, 0.13, 0.17, 0.07, 0],
    receive: [0, 0.04, 0.08, -0.06, -0.04, 0],
    eat: [0, -0.04, -0.08, -0.03, 0.03, 0],
    rest: [0, 0.06, 0.16, 0.24, 0.12, 0],
    craft: [0, -0.08, 0.2, -0.1, 0.2, 0],
  };
  p.bend = bodies[family]?.[f] ?? 0;
  p.torsoScale = 1 - Math.max(0, p.bend) * 0.25;
  p.headX = Math.round(p.bend * 5);
  p.headY = Math.round(Math.max(0, p.bend) * 5);
  p.nod = p.bend * 0.4;
  p.knee = Math.round(Math.max(0, p.bend) * 15);
  p.stance = ['dig', 'chop', 'strike'].includes(family) && active ? 3 : 0;
  if (clip === 'sitDown' || clip === 'standUp') {
    p.drop = (clip === 'sitDown' ? [0, 2, 4, 7, 9, 9] : [9, 7, 5, 3, 1, 0])[f]!;
    p.left = -0.25 * pulse;
    p.right = 0.25 * pulse;
    p.knee = p.drop * 0.7;
    return p;
  }
  if (clip === 'idle') {
    p.drop = f === 1 || f === 2 ? -1 : 0;
    p.blink = f === 5;
    return p;
  }
  if (clip === 'talk') {
    p.mouth = f === 1 || f === 3;
    p.right = -0.25 * pulse;
    p.lean = pulse;
    p.nod = f === 1 || f === 3 ? 0.04 : 0;
    return p;
  }
  if (clip === 'wave' || clip === 'hand' || clip === 'thumbs') {
    p.right =
      -(clip === 'thumbs' ? 1.3 : 2.4) + (clip === 'wave' && (f === 2 || f === 4) ? 0.4 : 0);
    if (f === 0 || f === 5) p.right = -0.3;
    p.elbow = active ? -1 : 0;
    return p;
  }
  if (clip === 'clap') {
    p.left = active ? -(f % 2 ? 0.3 : 0.8) : 0;
    p.right = -p.left;
    p.elbow = active ? -(f % 2 ? 0.3 : 0.6) : 0;
    return p;
  }
  if (clip === 'heart') {
    p.left = -0.9 * pulse;
    p.right = 0.9 * pulse;
    p.prop = active ? 'heart' : undefined;
    return p;
  }
  if (clip === 'laugh') {
    p.drop = f % 2 ? -2 : 0;
    p.left = -0.5;
    p.right = 0.5;
    p.blink = active;
    p.mouth = active;
    p.nod = f % 2 ? -0.05 : 0.05;
    return p;
  }
  const kind = ACTION_MOTIONS[clip];
  if (kind === 'chop' || kind === 'strike' || kind === 'dig') {
    p.tool =
      clip === 'chop'
        ? 'axe'
        : clip === 'till'
          ? 'hoe'
          : clip === 'raise' || clip === 'lower'
            ? 'shovel'
            : 'pick';
    p.right = (
      kind === 'dig'
        ? [-0.2, -1.65, -2.1, -0.8, -1.4, 0]
        : kind === 'strike'
          ? [-0.2, -2.1, -2.65, -0.8, -0.65, 0]
          : [-0.3, -2.3, -2.7, -0.8, -0.55, 0]
    )[f]!;
    p.left = [0, -0.65, -0.95, -0.9, -0.5, 0][f]!;
    p.elbow = [0, -0.25, -0.45, 0.15, -0.1, 0][f]!;
    p.drop = (kind === 'dig' ? [0, 0, -1, 5, 6, 0] : [0, -1, -2, 5, 2, 0])[f]!;
    p.lean = [0, -1, -2, 2, 1, 0][f]!;
    p.toolAngle = (
      kind === 'chop'
        ? [-0.1, -0.55, -0.8, 1.4, 1.2, 0.1]
        : kind === 'dig'
          ? [-0.1, -0.4, -0.65, 2.35, 1.5, 0.1]
          : [-0.1, -0.5, -0.8, 2.5, 1.9, 0.1]
    )[f]!;
  } else if (kind === 'pour') {
    p.tool = 'can';
    p.right = [0, -0.6, -1, -1, -0.65, 0][f]!;
    p.left = [0, -0.3, -0.5, -0.5, -0.3, 0][f]!;
    p.toolAngle = [0, 0.05, 0.2, 0.6, 0.2, 0][f]!;
    p.drop = pulse;
    p.lean = pulse * 2;
  } else if (kind === 'plant' || kind === 'gather' || kind === 'scatter') {
    p.drop = Math.round(pulse * (kind === 'scatter' ? 3 : 10));
    p.lean = 3 * pulse;
    p.right = -0.7 * pulse;
    p.left = 0.25 * pulse;
    p.prop =
      kind === 'gather' ? (f === 3 || f === 4 ? 'crop' : undefined) : active ? 'seeds' : undefined;
  } else if (kind === 'carry' || kind === 'receive' || kind === 'reach') {
    p.left = -0.65 * pulse;
    p.right = 0.65 * pulse;
    p.drop = Math.round(3 * pulse);
    p.prop =
      active && (kind !== 'carry' || f < 3) && (kind !== 'receive' || f >= 3)
        ? kind === 'receive'
          ? 'coin'
          : kind === 'carry'
            ? 'parcel'
            : undefined
        : undefined;
  } else if (kind === 'eat') {
    p.right = [0, 0.9, 1.4, 1.4, 1, 0][f]!;
    p.elbow = [0, -0.4, -1.6, -1.6, -0.4, 0][f]!;
    p.prop = active ? 'food' : undefined;
    p.mouth = f === 2 || f === 3;
  } else if (kind === 'rest') {
    p.drop = Math.round(12 * pulse);
    p.lean = 5 * pulse;
    p.left = -0.5 * pulse;
    p.right = 0.5 * pulse;
    p.blink = active;
  } else if (kind === 'craft') {
    p.right = [0, -1.8, -0.6, -1.8, -0.6, 0][f]!;
    p.left = -0.5 * pulse;
    p.prop = active ? 'hammer' : undefined;
    p.lean = pulse;
  }
  if (p.tool && (f === 3 || f === 4) && (dir === 'down' || dir === 'up')) {
    // Contact moves into the facing plane instead of reusing the side-view arc.
    p.right = dir === 'up' ? 2.85 : 0.6;
    p.elbow = dir === 'up' ? -0.2 : 0.15;
    p.toolAngle = p.tool === 'can' ? 0.75 : dir === 'up' ? -0.25 : 3;
  }
  return p;
}

export interface MotionOptions {
  duration?: number;
  dir?: Dir;
  token?: number;
  tier?: number;
  onEvent?: (event: MotionEvent) => void;
  onCancel?: () => void;
}
interface Playing extends MotionOptions {
  clip: AvatarClip;
  start: number;
  duration: number;
  previous: number;
}
const priority = (clip: AvatarClip) =>
  clip in ACTION_MOTIONS ? 2 : clip === 'talk' || clip === 'idle' ? 0 : 1;
/** One-shot state shared by office/world figures, with matching cancellation and bounded lifetime. */
export class AvatarMotionPlayer {
  private readonly active = new Map<string, Playing>();
  play(id: string, clip: AvatarClip, now: number, options: MotionOptions = {}): boolean {
    const current = this.active.get(id);
    if (
      current &&
      now < current.start + current.duration &&
      priority(current.clip) > priority(clip)
    )
      return false;
    this.cancel(id);
    this.active.set(id, {
      ...options,
      clip,
      start: now,
      previous: -1,
      duration: Math.max(1, options.duration ?? motionDuration(clip, options.dir)),
    });
    return true;
  }
  cancel(id: string, token?: number): void {
    const current = this.active.get(id);
    if (current && (token === undefined || current.token === token)) {
      this.active.delete(id);
      current.onCancel?.();
    }
  }
  sample(
    id: string,
    now: number,
    moving: boolean,
    reduced: boolean,
  ): (AvatarMotion & { dir?: Dir }) | null {
    const p = this.active.get(id);
    if (!p) return null;
    // Locomotion wins: cancel before delivering any not-yet-presented contact effects.
    if (moving) {
      this.cancel(id);
      return null;
    }
    const elapsed = Math.max(p.previous, now - p.start);
    for (const event of motionEventsBetween(p.clip, p.previous, elapsed, p.duration, p.dir)) {
      p.onEvent?.({ kind: event.kind, clip: p.clip, at: p.start + event.elapsed });
      if (this.active.get(id) !== p) return null;
    }
    p.previous = elapsed;
    if (elapsed >= p.duration) {
      this.active.delete(id);
      return null;
    }
    return {
      clip: p.clip,
      frame: motionFrameAt(
        p.clip,
        p.clip === 'talk' ? (now - p.start) % motionDuration('talk') : now - p.start,
        p.clip === 'talk' ? motionDuration('talk') : p.duration,
        reduced,
        p.dir,
      ),
      tier: p.tier,
      dir: p.dir,
    };
  }
  keep(ids: ReadonlySet<string>): void {
    for (const id of this.active.keys()) if (!ids.has(id)) this.cancel(id);
  }
  clear(): void {
    for (const id of this.active.keys()) this.cancel(id);
  }
}
