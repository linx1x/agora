/** Tiny synthesized chimes (no audio assets, nothing leaves the page). */
import { store } from '../state/store';

let ctx: AudioContext | null = null;

export function chime(kind: 'visitor' | 'knock' | 'callover') {
  const s = store.get();
  if (!s.settings.sounds || s.status === 'dnd') return;
  try {
    ctx ??= new AudioContext();
    void ctx.resume();
    const notes =
      kind === 'knock' ? [392, 392] : kind === 'callover' ? [523, 659, 784] : [659, 880];
    const t0 = ctx.currentTime + 0.01;
    notes.forEach((f, i) => {
      const o = ctx!.createOscillator();
      const g = ctx!.createGain();
      o.type = kind === 'knock' ? 'triangle' : 'sine';
      o.frequency.value = f;
      const t = t0 + i * (kind === 'knock' ? 0.18 : 0.12);
      g.gain.setValueAtTime(0, t);
      g.gain.linearRampToValueAtTime(0.12, t + 0.015);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 0.35);
      o.connect(g).connect(ctx!.destination);
      o.start(t);
      o.stop(t + 0.4);
    });
  } catch {
    /* audio unavailable */
  }
}
