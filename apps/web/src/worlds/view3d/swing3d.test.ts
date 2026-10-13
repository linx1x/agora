import { describe, expect, it, vi } from 'vitest';
import * as THREE from 'three';
import { AvatarMotionPlayer, motionDuration } from '../../game/avatarMotion';
import { playSwingSound } from '../tools/sound';
import { SwingFx, type SwingPlay } from './swing3d';

vi.mock('../tools/sound', () => ({ playSwingSound: vi.fn() }));

const play: SwingPlay = {
  bodyTool: true,
  eventDriven: true,
  feetX: 0,
  feetZ: 0,
  floor: 0,
  dir: 'right',
  tier: 1,
  speed: 1,
  target: { cx: 1, cy: 0, floor: 0 },
  own: true,
  reduced: false,
  sounds: true,
  tool: 'axe',
  duration: motionDuration('chop'),
};
const bursts = (scene: THREE.Scene) =>
  scene.children.filter((child) => child instanceof THREE.Points);

describe('body animation and tool effect clock', () => {
  it('plays contact sound and particles exactly on the body cue, once', () => {
    vi.mocked(playSwingSound).mockClear();
    const scene = new THREE.Scene(),
      fx = new SwingFx(scene),
      motion = new AvatarMotionPlayer();
    const effect = fx.play(play, 0);
    motion.play('me', 'chop', 0, { dir: 'right', onEvent: effect.cue, onCancel: effect.cancel });
    fx.update(150); // Independent effect updates must not invent an impact.
    motion.sample('me', 150, false, false);
    expect(bursts(scene)).toHaveLength(0);
    expect(playSwingSound).not.toHaveBeenCalled();
    expect(motion.sample('me', 166, false, false)?.frame).toBe(3);
    expect(bursts(scene)).toHaveLength(1);
    expect(playSwingSound).toHaveBeenCalledTimes(1);
    motion.sample('me', 200, false, false);
    fx.update(200);
    expect(playSwingSound).toHaveBeenCalledTimes(1);
    fx.update(2000);
    expect(scene.children).toHaveLength(0);
    fx.dispose();
  });
  it('a refusal or movement cancels contact before it can produce ghost effects', () => {
    vi.mocked(playSwingSound).mockClear();
    for (const moving of [true, false]) {
      const scene = new THREE.Scene(),
        fx = new SwingFx(scene),
        motion = new AvatarMotionPlayer();
      const effect = fx.play(play, 0);
      motion.play('me', 'chop', 0, { token: 5, onEvent: effect.cue, onCancel: effect.cancel });
      if (!moving) motion.cancel('me', 5);
      motion.sample('me', 500, moving, false);
      fx.update(1000);
      expect(scene.children).toHaveLength(0);
      fx.dispose();
    }
    expect(playSwingSound).not.toHaveBeenCalled();
  });
  it('reduced motion keeps one contact cue, and disposal invalidates retained handles', () => {
    vi.mocked(playSwingSound).mockClear();
    const scene = new THREE.Scene(),
      fx = new SwingFx(scene),
      motion = new AvatarMotionPlayer();
    const effect = fx.play({ ...play, reduced: true }, 0);
    motion.play('me', 'chop', 0, { onEvent: effect.cue, onCancel: effect.cancel });
    motion.sample('me', 210, false, true);
    expect(bursts(scene)).toHaveLength(1);
    fx.dispose();
    effect.cue({ kind: 'impact', clip: 'chop', at: 220 });
    expect(scene.children).toHaveLength(0);
    expect(playSwingSound).toHaveBeenCalledTimes(1);
  });
});
