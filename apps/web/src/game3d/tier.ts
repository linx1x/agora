/**
 * Device tiers of the 2.5D view (ADR-052, P16.11). A desktop runs the full look: sun shadows, the
 * most point lights, the pixel-diorama post-processing. A phone runs the cheap look: no shadows, a
 * few lights, no post-processing. The tier comes from the input type (a touch screen is a phone),
 * then from a 3 s probe of the frame rate and the graphics card; a device with no real graphics
 * card, or one too slow to probe, gets the 2D view instead.
 *
 * The thresholds below are constants on purpose. The phone numbers are a first guess: they still
 * need Vincent's mid-range phone run ("Agora 2.5D Benchmark", P16.11).
 */

export type Tier = 'desktop' | 'phone';

/** Point lights in the scene at once (a fixed pool per tier, so shaders do not recompile). */
export const POINT_LIGHTS: Record<Tier, number> = { desktop: 8, phone: 3 };

/** The probe: the first `PROBE_MS` of frames after `PROBE_WARMUP_MS` (shader compiles skipped). */
export const PROBE_MS = 3000;
export const PROBE_WARMUP_MS = 600;
/** A desktop-class device probing under this many fps gets the phone look. */
export const PHONE_PROBE_FPS = 40;
/** A device probing under this many fps gets the 2D view (too slow for any 2.5D look). */
export const OFF_PROBE_FPS = 8;
/** Renderers that are software, not a graphics card: they get the 2D view. */
export const SOFTWARE_GPU = /swiftshader|llvmpipe|softpipe|software|basic render/i;

/** Is this renderer a software one (no graphics card)? */
export function isSoftwareGpu(gpu: string): boolean {
  return SOFTWARE_GPU.test(gpu);
}

/** Sun shadow map: on the desktop tier only. */
export function sunShadows(tier: Tier): boolean {
  return tier === 'desktop';
}

/** Tilt-shift and bloom: on the desktop tier only. */
export function postFx(tier: Tier): boolean {
  return tier === 'desktop';
}

/** The tier a device starts on before its probe: a coarse pointer (touch) is a phone. */
export function startTier(coarsePointer: boolean): Tier {
  return coarsePointer ? 'phone' : 'desktop';
}

/**
 * The tier after the probe: 'off' for a software renderer or a probe under `OFF_PROBE_FPS` (the
 * view falls back to 2D), 'phone' for a touch screen or a probe under `PHONE_PROBE_FPS`, else
 * 'desktop'.
 */
export function decideTier(input: {
  coarse: boolean;
  gpu: string;
  probeFps: number;
}): Tier | 'off' {
  if (isSoftwareGpu(input.gpu)) return 'off';
  if (input.probeFps < OFF_PROBE_FPS) return 'off';
  if (input.coarse || input.probeFps < PHONE_PROBE_FPS) return 'phone';
  return 'desktop';
}
