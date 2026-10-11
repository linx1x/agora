/**
 * The sound of a tool hit, shared by the world views (P17.21b, P17.21c): one short tone made in code
 * (Web Audio, no file), its pitch the tier's playback rate from `swing.ts`. Silent when the player
 * has sounds off, as the office chimes are (`settings.sounds`); the caller passes that flag, so this
 * file reads no store.
 */

/** The tone of a tier-1 hit, in hertz, before the tier's pitch. */
export const BLIP_HZ = 520;

/** The frequency of a hit at a playback rate (1 is the base pitch). */
export function blipFrequency(pitch: number): number {
  return BLIP_HZ * pitch;
}

let ctx: AudioContext | null = null;

export function playSwingSound(pitch: number, sounds: boolean): void {
  if (!sounds) return;
  try {
    ctx ??= new AudioContext();
    void ctx.resume();
    const t = ctx.currentTime + 0.01;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'triangle';
    osc.frequency.setValueAtTime(blipFrequency(pitch), t);
    gain.gain.setValueAtTime(0.08, t);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.09);
    osc.connect(gain).connect(ctx.destination);
    osc.start(t);
    osc.stop(t + 0.1);
  } catch {
    /* audio unavailable: the swing still plays */
  }
}
