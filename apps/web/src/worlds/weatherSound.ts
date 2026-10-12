import { rainWaters, type WeatherKind } from '@agora/shared';

/** Quiet procedural rain. Starts only after a gesture; uses the existing Sounds preference. */
export class WeatherSound {
  private ctx: AudioContext | null = null;
  private source: AudioBufferSourceNode | null = null;
  private gain: GainNode | null = null;
  private wanted = 0;
  private appliedGain = -1;
  private readonly unlock = () => {
    if (this.wanted === 0) return;
    try {
      if (!this.ctx) {
        const ctx = (this.ctx = new AudioContext());
        const buffer = ctx.createBuffer(1, ctx.sampleRate * 3, ctx.sampleRate);
        const data = buffer.getChannelData(0);
        for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
        const source = (this.source = ctx.createBufferSource());
        source.buffer = buffer;
        source.loop = true;
        const filter = ctx.createBiquadFilter();
        filter.type = 'lowpass';
        filter.frequency.value = 1300;
        this.gain = ctx.createGain();
        this.gain.gain.value = 0;
        source.connect(filter).connect(this.gain).connect(ctx.destination);
        source.start();
      }
      void this.ctx.resume().catch(() => {});
    } catch {
      /* Audio is optional. */
    }
  };

  constructor() {
    window.addEventListener('pointerdown', this.unlock);
    window.addEventListener('keydown', this.unlock);
    document.addEventListener('visibilitychange', this.visibility);
  }

  private readonly visibility = () => {
    if (document.hidden && this.ctx && this.gain) {
      this.gain.gain.setTargetAtTime(0, this.ctx.currentTime, 0.1);
      this.appliedGain = 0;
    }
  };

  update(kind: WeatherKind | null, enabled: boolean): void {
    this.wanted =
      enabled && !document.hidden && kind && rainWaters(kind)
        ? kind === 'thunderstorm'
          ? 0.055
          : 0.035
        : 0;
    if (this.ctx && this.gain && this.appliedGain !== this.wanted) {
      this.gain.gain.setTargetAtTime(this.wanted, this.ctx.currentTime, 0.8);
      this.appliedGain = this.wanted;
    }
  }

  dispose(): void {
    window.removeEventListener('pointerdown', this.unlock);
    window.removeEventListener('keydown', this.unlock);
    document.removeEventListener('visibilitychange', this.visibility);
    this.source?.stop();
    if (this.ctx) void this.ctx.close().catch(() => {});
  }
}
