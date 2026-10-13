import { describe, expect, it, vi } from 'vitest';
import { ACTION_KINDS, EMOTES } from '@agora/shared';
import {
  ACTION_MOTIONS,
  AvatarMotionPlayer,
  actionFacing,
  motionDuration,
  motionFrameAt,
  motionPose,
  motionSequence,
  motionEventsBetween,
} from './avatarMotion';

describe('avatar action animation', () => {
  it('covers every gameplay action and social gesture with changing joint poses', () => {
    expect(Object.keys(ACTION_MOTIONS).sort()).toEqual([...ACTION_KINDS].sort());
    for (const clip of [
      ...ACTION_KINDS,
      ...EMOTES,
      'idle',
      'talk',
      'sitDown',
      'standUp',
    ] as const) {
      const poses = Array.from({ length: 6 }, (_, frame) => motionPose({ clip, frame }));
      expect(new Set(poses.map((p) => JSON.stringify(p))).size, clip).toBeGreaterThan(1);
      expect(motionDuration(clip)).toBeGreaterThan(0);
    }
  });
  it('uses directional contact boundaries, scaling poses and effects together', () => {
    for (const dir of ['right', 'left', 'up', 'down'] as const) {
      for (const clip of ['till', 'chop', 'mine', 'water', 'raise', 'lower', 'remove'] as const) {
        const duration = motionDuration(clip) * 0.73;
        const impact = motionEventsBetween(clip, -1, duration, duration, dir).find(
          (event) => event.kind === 'impact',
        )!;
        expect(impact.elapsed).toBeLessThan(duration * 0.5);
        expect(motionFrameAt(clip, impact.elapsed - 0.01, duration, false, dir)).toBe(2);
        expect(motionFrameAt(clip, impact.elapsed + 0.01, duration, false, dir)).toBe(3);
      }
    }
    const contact = (dir: 'right' | 'down') =>
      motionEventsBetween('chop', 0, 500, 500, dir)[1]!.elapsed;
    expect(contact('down')).toBeGreaterThan(contact('right'));
  });
  it('uses a still pose for reduced motion', () => {
    expect(motionFrameAt('chop', 0, 480, true)).toBe(3);
    expect(motionFrameAt('idle', 3500, 3600, true)).toBe(0);
    expect(motionFrameAt('talk', 400, 720, true)).toBe(0);
  });
  it('aims contact poses into the facing plane while preserving mirrored side poses', () => {
    const motion = { clip: 'chop', frame: 3 } as const;
    const front = motionPose(motion, 'down'),
      back = motionPose(motion, 'up');
    const side = motionPose(motion, 'right');
    expect(front.toolAngle).not.toBe(side.toolAngle);
    expect(back.toolAngle).not.toBe(side.toolAngle);
    expect(front.right).not.toBe(back.right);
    expect(motionPose(motion, 'left')).toEqual(side);
  });
  it('delivers every crossed cue once even when frames are skipped, including the final boundary', () => {
    const p = new AvatarMotionPlayer();
    const onEvent = vi.fn();
    p.play('me', 'craft', 100, { onEvent });
    p.sample('me', 1100, false, false);
    expect(onEvent.mock.calls.map(([event]) => event.kind)).toEqual(['impact', 'impact', 'impact']);
    p.sample('me', 1100, false, false);
    p.sample('me', 900, false, false); // A stale timestamp cannot replay an event.
    expect(onEvent).toHaveBeenCalledTimes(3);
    p.sample('me', 3000, false, false);
    expect(onEvent.mock.calls.map(([event]) => event.kind)).toEqual([
      'impact',
      'impact',
      'impact',
      'finish',
    ]);
    p.sample('me', 4000, false, false);
    expect(onEvent).toHaveBeenCalledTimes(4);
  });
  it('cancels pending effects on movement, replacement and departure, but ignores a stale refusal', () => {
    const p = new AvatarMotionPlayer();
    const onCancel = vi.fn(),
      onEvent = vi.fn();
    p.play('me', 'chop', 0, { token: 1, onCancel, onEvent });
    p.cancel('me', 0);
    expect(onCancel).not.toHaveBeenCalled();
    p.sample('me', 400, true, false);
    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(onEvent).not.toHaveBeenCalled();
    p.play('me', 'chop', 500, { onCancel, onEvent });
    p.play('me', 'water', 510, { onCancel, onEvent });
    expect(onCancel).toHaveBeenCalledTimes(2);
    p.keep(new Set());
    expect(onCancel).toHaveBeenCalledTimes(3);
    expect(onEvent).not.toHaveBeenCalled();
  });
  it('speech and social gestures cannot replace an active gameplay action', () => {
    const p = new AvatarMotionPlayer();
    p.play('me', 'chop', 100);
    expect(p.play('me', 'talk', 110)).toBe(false);
    expect(p.play('me', 'wave', 120)).toBe(false);
    expect(p.sample('me', 130, false, false)?.clip).toBe('chop');
    expect(p.play('me', 'talk', 1000)).toBe(true);
  });
  it('each sequence has valid durations and pose indices; eating and crafting repeat poses', () => {
    for (const clip of [...ACTION_KINDS, ...EMOTES] as const)
      for (const s of motionSequence(clip)) {
        expect(s.ms).toBeGreaterThan(0);
        expect(s.pose).toBeGreaterThanOrEqual(0);
        expect(s.pose).toBeLessThan(6);
      }
    expect(motionSequence('craft').length).toBeGreaterThan(6);
    expect(motionSequence('eat').length).toBeGreaterThan(6);
    expect(motionPose({ clip: 'harvest', frame: 2 }).prop).toBeUndefined();
    expect(motionPose({ clip: 'harvest', frame: 3 }).prop).toBe('crop');
  });
  it('a late refusal cannot cancel a newer action; actions end and movement interrupts them', () => {
    const p = new AvatarMotionPlayer();
    p.play('me', 'plant', 100, { token: 1 });
    p.play('me', 'water', 200, { token: 2 });
    p.cancel('me', 1);
    expect(p.sample('me', 210, false, false)?.clip).toBe('water');
    p.cancel('me', 2);
    expect(p.sample('me', 220, false, false)).toBeNull();
    p.play('me', 'craft', 300);
    expect(p.sample('me', 1600, false, false)).toBeNull();
    p.play('me', 'sleep', 1700);
    expect(p.sample('me', 1800, true, false)).toBeNull();
    expect(p.sample('me', 1810, false, false)).toBeNull();
  });
  it('loops speech until its deadline and releases departed figures', () => {
    const p = new AvatarMotionPlayer();
    p.play('npc', 'talk', 0, { duration: 3000 });
    expect(p.sample('npc', 800, false, false)?.frame).toBe(
      p.sample('npc', 80, false, false)?.frame,
    );
    p.keep(new Set());
    expect(p.sample('npc', 900, false, false)).toBeNull();
    p.play('npc', 'wave', 1000);
    p.clear();
    expect(p.sample('npc', 1100, false, false)).toBeNull();
  });
  it('faces the clicked target, preserving facing for actions on the occupied cell', () => {
    expect(actionFacing(16, 26, { x: 1, y: 0 }, 32, 'down')).toBe('right');
    expect(actionFacing(16, 26, { x: -1, y: 0 }, 32, 'down')).toBe('left');
    expect(actionFacing(16, 26, { x: 0, y: 1 }, 32, 'left')).toBe('down');
    expect(actionFacing(16, 26, { x: 0, y: -1 }, 32, 'left')).toBe('up');
    expect(actionFacing(16, 26, { x: 0, y: 0 }, 32, 'right')).toBe('right');
  });
});
