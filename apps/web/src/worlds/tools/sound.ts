/**
 * The sound of a tool hit, shared by the world views (P17.21b, P17.21c, P17.21d): one short tone made
 * in code (Web Audio, no file), its pitch the tier's playback rate and its ring and click from
 * `swing.ts`. Silent when the player has sounds off, as the office chimes are (`settings.sounds`); the
 * caller passes that flag, so this file reads no store.
 */
import type { HitSound } from './swing';

/** The tone of a tier-1 hit, in hertz, before the tier's pitch. */
export const BLIP_HZ = 520;
/** The click sits this many times above the tone (a sharp partial). */
const CLICK_RATIO = 3;
/** The click dies in this many ms. */
const CLICK_MS = 22;
/** The tone's level at the start, and the click's at full click. */
const TONE_GAIN = 0.08;
const CLICK_GAIN = 0.05;
/** A tier-1 hit: the base tone, no click. */
export const PLAIN_HIT: HitSound = { pitch: 1, decayMs: 90, click: 0 };

/** The frequency of a hit at a playback rate (1 is the base pitch). */
export function blipFrequency(pitch: number): number {
  return BLIP_HZ * pitch;
}

let ctx: AudioContext | null = null;

/**
 * Plays one hit. `pitch` is the playback rate (the flat view passes its tier's rate); `hit` adds the
 * ring and the click of a higher tier (the 2.5D view passes `swingParams(...).hit`).
 */
export function playSwingSound(pitch: number, sounds: boolean, hit: HitSound = { ...PLAIN_HIT, pitch }): void {
  if (!sounds) return;
  try {
    ctx ??= new AudioContext();
    void ctx.resume();
    const t = ctx.currentTime + 0.01;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'triangle';
    osc.frequency.setValueAtTime(blipFrequency(pitch), t);
    gain.gain.setValueAtTime(TONE_GAIN, t);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + hit.decayMs / 1000);
    osc.connect(gain).connect(ctx.destination);
    osc.start(t);
    osc.stop(t + hit.decayMs / 1000 + 0.01);
    if (hit.click > 0) {
      const click = ctx.createOscillator();
      const clickGain = ctx.createGain();
      click.type = 'square';
      click.frequency.setValueAtTime(blipFrequency(pitch) * CLICK_RATIO, t);
      clickGain.gain.setValueAtTime(CLICK_GAIN * hit.click, t);
      clickGain.gain.exponentialRampToValueAtTime(0.0001, t + CLICK_MS / 1000);
      click.connect(clickGain).connect(ctx.destination);
      click.start(t);
      click.stop(t + CLICK_MS / 1000 + 0.01);
    }
  } catch {
    /* audio unavailable: the swing still plays */
  }
}
