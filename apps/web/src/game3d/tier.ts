/**
 * Device tiers of the 2.5D view (ADR-052). A desktop runs the full look: sun shadows, the most
 * point lights, the pixel-diorama post-processing. A phone runs the cheap look: no shadows, a few
 * lights, no post-processing. P16.11 decides the tier from GPU info and a frame-time probe; until
 * then the input type decides, so a touch screen is a phone.
 *
 * The phone numbers are a first guess: they still need Vincent's mid-range phone run (P16.11).
 */

export type Tier = 'desktop' | 'phone';

/** Point lights in the scene at once (a fixed pool per tier, so shaders do not recompile). */
export const POINT_LIGHTS: Record<Tier, number> = { desktop: 8, phone: 3 };

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
