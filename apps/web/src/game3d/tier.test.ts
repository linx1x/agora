import { describe, expect, it } from 'vitest';
import {
  OFF_PROBE_FPS,
  PHONE_PROBE_FPS,
  decideTier,
  postFx,
  startTier,
  sunShadows,
} from './tier';

const GPU = 'ANGLE (NVIDIA, NVIDIA GeForce RTX 3080 Direct3D11)';

describe('decideTier (P16.11)', () => {
  it('a desktop-class graphics card that probes fast is the desktop tier', () => {
    expect(decideTier({ coarse: false, gpu: GPU, probeFps: 60 })).toBe('desktop');
    expect(decideTier({ coarse: false, gpu: GPU, probeFps: PHONE_PROBE_FPS })).toBe('desktop');
  });

  it('a touch screen is a phone whatever it probes', () => {
    expect(decideTier({ coarse: true, gpu: 'Adreno (TM) 750', probeFps: 120 })).toBe('phone');
  });

  it('a slow probe on a desktop gets the phone look, just under the phone floor', () => {
    expect(decideTier({ coarse: false, gpu: GPU, probeFps: PHONE_PROBE_FPS - 1 })).toBe('phone');
    expect(decideTier({ coarse: false, gpu: GPU, probeFps: OFF_PROBE_FPS })).toBe('phone');
  });

  it('a software renderer or a probe too slow for any 2.5D look gets 2D', () => {
    expect(decideTier({ coarse: false, gpu: 'Google SwiftShader', probeFps: 60 })).toBe('off');
    expect(decideTier({ coarse: false, gpu: 'llvmpipe (LLVM 15)', probeFps: 90 })).toBe('off');
    expect(decideTier({ coarse: true, gpu: GPU, probeFps: 1 })).toBe('off');
    expect(decideTier({ coarse: false, gpu: GPU, probeFps: OFF_PROBE_FPS - 1 })).toBe('off');
  });

  it('the features follow the tier: shadows and post-processing are desktop only', () => {
    expect(sunShadows('desktop')).toBe(true);
    expect(sunShadows('phone')).toBe(false);
    expect(postFx('desktop')).toBe(true);
    expect(postFx('phone')).toBe(false);
  });

  it('a device starts on the phone tier when its pointer is coarse, else on desktop', () => {
    expect(startTier(true)).toBe('phone');
    expect(startTier(false)).toBe('desktop');
  });
});
