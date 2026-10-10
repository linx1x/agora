import { falloff, distTiles } from '@agora/shared';
import { world } from '../net/client';
import { store } from '../state/store';
import { rendered } from '../game/controller';
import { isTyping } from '../game/input';
import { QualityTracker, isPoor, type QualitySample } from './quality';
import { LiveKitTransport } from './livekit';
import { P2PTransport, SPEAK_THRESHOLD, rms } from './p2p';
import type { LocalTracks, MediaTransport, TransportHost } from './transport';

const DEVICES_KEY = 'agora.devices';
const QUALITY_MS = 3000;
/** after "turn video back on", don't switch to audio-only again for this long */
const QUALITY_SNOOZE_MS = 120_000;

/**
 * Local media (devices, mic, camera, screen, push-to-talk, levels, quality) and the
 * transport that carries it: LiveKit SFU or peer-to-peer (ADR-031, ADR-009), chosen
 * by the server's `config.mediaBackend`. Transports only connect people the server
 * links (`peers`).
 */
export class MediaManager {
  private audioTrack: MediaStreamTrack | null = null;
  private videoTrack: MediaStreamTrack | null = null;
  private screenTrack: MediaStreamTrack | null = null;
  private screenAudioTrack: MediaStreamTrack | null = null;
  private ctx: AudioContext | null = null;
  private localAnalyser?: { a: AnalyserNode; buf: Uint8Array<ArrayBuffer> };
  private loop?: ReturnType<typeof setInterval>;
  private holder: HTMLDivElement;
  private unsub: (() => void)[] = [];
  private transport: MediaTransport | null = null;
  micDeviceId: string | undefined;
  camDeviceId: string | undefined;
  speakerDeviceId: string | undefined;
  private pttHeld = false;
  private quality = new QualityTracker();
  private qualityTimer?: ReturnType<typeof setInterval>;
  private snoozeUntil = 0;
  private host: TransportHost;

  constructor() {
    this.holder = document.createElement('div');
    this.holder.hidden = true;
    document.body.appendChild(this.holder);
    try {
      const d = JSON.parse(localStorage.getItem(DEVICES_KEY) ?? '{}') as Record<string, string>;
      this.micDeviceId = d.mic || undefined;
      this.camDeviceId = d.cam || undefined;
      this.speakerDeviceId = d.speaker || undefined;
    } catch {
      /* no saved devices */
    }
    this.host = {
      local: (): LocalTracks => ({
        audio: this.audioTrack,
        video: this.audioOnly ? null : this.videoTrack,
        screen: this.audioOnly ? null : this.screenTrack,
        screenAudio: this.screenAudioTrack,
      }),
      audioOnly: () => this.audioOnly,
      speakerId: () => this.speakerDeviceId,
      audioContext: () => this.ctx,
      applySink: (el) => this.applySink(el),
      holder: this.holder,
    };
  }

  /** Remember device choices for next time (pre-join check and Settings). */
  saveDevices() {
    try {
      localStorage.setItem(
        DEVICES_KEY,
        JSON.stringify({
          mic: this.micDeviceId ?? '',
          cam: this.camDeviceId ?? '',
          speaker: this.speakerDeviceId ?? '',
        }),
      );
    } catch {
      /* private mode */
    }
  }

  /** Audio-only by choice or because the connection is poor: no video in or out. */
  get audioOnly() {
    const s = store.get();
    return s.settings.audioOnly || s.autoAudioOnly;
  }

  /** The transport in use ('livekit' | 'p2p'), null before the server said. */
  get backend() {
    return this.transport?.kind ?? null;
  }

  /** Screen sharing is possible here (SFU backend, flag on, browser support). */
  get canShareScreen() {
    return (
      !!this.transport?.screenShare &&
      store.get().config?.flags.screenShare !== false &&
      !!navigator.mediaDevices?.getDisplayMedia
    );
  }

  // ── transport
  private useTransport(kind: 'livekit' | 'p2p' | undefined) {
    if (!kind || kind === this.transport?.kind) return;
    this.transport?.stop();
    this.transport =
      kind === 'livekit' ? new LiveKitTransport(this.host) : new P2PTransport(this.host);
    this.transport.start();
    void this.transport.applyTracks();
  }

  // ── push-to-talk (P3.8)
  private pttOn() {
    return store.get().settings.pushToTalk;
  }

  /** The mic track only carries sound while the key is held (PTT) or always (no PTT). */
  private applyPtt() {
    const live = !this.pttOn() || this.pttHeld;
    if (this.audioTrack) this.audioTrack.enabled = live;
    this.transport?.micLive?.(live);
    const talking = this.pttOn() && this.pttHeld && !!this.audioTrack;
    if (store.get().talking !== talking) store.set({ talking });
  }

  private onPttKey = (e: KeyboardEvent) => {
    const s = store.get();
    if (!s.settings.pushToTalk || e.code !== s.settings.pttKey) return;
    const down = e.type === 'keydown';
    // typing, dialogs and build mode (Space pans there) keep the key for themselves
    if (down && (isTyping() || s.dialog || s.build || e.repeat)) return;
    if (!down && !this.pttHeld) return;
    e.preventDefault();
    this.pttHeld = down;
    this.applyPtt();
  };

  private onBlur = () => {
    if (!this.pttHeld) return;
    this.pttHeld = false;
    this.applyPtt();
  };

  /** UI and tests: press or release the push-to-talk key. */
  setTalking(held: boolean) {
    this.pttHeld = held && this.pttOn();
    this.applyPtt();
  }

  // ── connection quality (P3.9)
  private async sampleQuality() {
    if (this.audioOnly || Date.now() < this.snoozeUntil || !this.transport) return;
    this.judgePoor(await this.transport.quality());
  }

  /** Test hook and P2P samples: one round of link measurements. */
  judge(samples: QualitySample[]) {
    this.judgePoor(samples.map(isPoor));
  }

  /**
   * One round of "poor" flags (one per link). When most links are poor for two
   * rounds, the problem is likely our own connection: switch to audio-only.
   */
  private judgePoor(flags: boolean[]) {
    if (!flags.length || this.audioOnly) return;
    const poor = flags.filter(Boolean).length;
    if (this.quality.push(poor * 2 >= flags.length) !== 'poor') return;
    this.quality = new QualityTracker();
    store.set({ autoAudioOnly: true }); // the HUD banner explains it and offers to undo
  }

  /** "Turn video back on" after an automatic switch. */
  restoreVideo() {
    this.snoozeUntil = Date.now() + QUALITY_SNOOZE_MS;
    store.set({ autoAudioOnly: false });
  }

  start() {
    if (!this.holder.isConnected) document.body.appendChild(this.holder);
    let lastStatus = store.get().status;
    let lastPtt = '';
    let lastAudioOnly: boolean | null = null;
    let lastSync = '';
    this.unsub.push(
      store.subscribe(() => {
        const s = store.get();
        this.useTransport(s.config?.mediaBackend);
        const ptt = `${s.settings.pushToTalk}:${s.settings.pttKey}`;
        if (ptt !== lastPtt) {
          const first = !lastPtt;
          lastPtt = ptt;
          this.pttHeld = false;
          this.applyPtt();
          if (!first) this.publishState();
        }
        if (this.audioOnly !== lastAudioOnly) {
          const first = lastAudioOnly === null;
          lastAudioOnly = this.audioOnly;
          void this.transport?.applyTracks();
          if (!first) this.publishState();
        }
        // links, who is nearest, video cap and peers' bandwidth flags drive subscriptions
        const key = `${s.peers.join(',')}|${s.nearest.join(',')}|${s.config?.videoCap}|${lastAudioOnly}|${s.peers.filter((id) => s.profiles[id]?.lowBw).join(',')}`;
        if (key !== lastSync) {
          lastSync = key;
          this.transport?.sync();
        }
        if (s.status !== lastStatus) {
          lastStatus = s.status;
          if (s.status === 'dnd') {
            void this.setMic(false);
            void this.setCam(false);
            void this.setScreen(false);
          }
        }
      }),
    );
    this.loop = setInterval(() => this.updateLevels(), 120);
    this.qualityTimer = setInterval(() => void this.sampleQuality(), QUALITY_MS);
    window.addEventListener('keydown', this.onPttKey, true);
    window.addEventListener('keyup', this.onPttKey, true);
    window.addEventListener('blur', this.onBlur);
  }

  stop() {
    this.unsub.forEach((u) => u());
    this.unsub = [];
    clearInterval(this.loop);
    clearInterval(this.qualityTimer);
    window.removeEventListener('keydown', this.onPttKey, true);
    window.removeEventListener('keyup', this.onPttKey, true);
    window.removeEventListener('blur', this.onBlur);
    this.pttHeld = false;
    this.transport?.stop();
    this.transport = null;
    for (const t of [this.audioTrack, this.videoTrack, this.screenTrack, this.screenAudioTrack])
      t?.stop();
    this.audioTrack = this.videoTrack = this.screenTrack = this.screenAudioTrack = null;
    store.set({ screen: false, screenStream: null });
    this.holder.remove();
  }

  /** Must be called from a user gesture at least once (autoplay + AudioContext). */
  unlockAudio() {
    if (!this.ctx) {
      try {
        this.ctx = new AudioContext();
      } catch {
        this.ctx = null;
      }
    }
    void this.ctx?.resume();
    this.transport?.unlock?.();
  }

  private localStream(): MediaStream | null {
    const tracks = [this.audioTrack, this.videoTrack].filter((t): t is MediaStreamTrack => !!t);
    return tracks.length ? new MediaStream(tracks) : null;
  }

  private publishState() {
    const mic = !!this.audioTrack;
    const cam = !!this.videoTrack;
    const screen = !!this.screenTrack;
    store.set({
      mic,
      cam,
      screen,
      localStream: this.localStream(),
      screenStream: this.screenTrack ? new MediaStream([this.screenTrack]) : null,
    });
    world.send({
      t: 'media',
      mic,
      cam,
      ptt: mic && this.pttOn(),
      lowBw: this.audioOnly,
      screen: screen && !this.audioOnly,
    });
  }

  /** Re-announce my media state (after a reconnect the server starts from "off"). */
  announce() {
    this.publishState();
  }

  private mediaError(err: unknown) {
    const name = (err as { name?: string })?.name;
    const code = !window.isSecureContext
      ? 'insecure'
      : name === 'NotAllowedError' || name === 'SecurityError'
        ? 'denied'
        : name === 'NotFoundError' || name === 'OverconstrainedError'
          ? 'notFound'
          : name === 'NotReadableError'
            ? 'busy'
            : 'unknown';
    store.set({ mediaError: code });
  }

  async setMic(on: boolean) {
    this.unlockAudio();
    if (on === !!this.audioTrack) return;
    if (on) {
      try {
        const s = await navigator.mediaDevices.getUserMedia({
          audio: {
            deviceId: this.micDeviceId ? { exact: this.micDeviceId } : undefined,
            echoCancellation: true,
            noiseSuppression: true,
            autoGainControl: true,
          },
        });
        this.audioTrack = s.getAudioTracks()[0] ?? null;
        store.set({ mediaError: null });
      } catch (err) {
        this.mediaError(err);
        return;
      }
      if (this.ctx && this.audioTrack) {
        const a = this.ctx.createAnalyser();
        a.fftSize = 512;
        this.ctx.createMediaStreamSource(new MediaStream([this.audioTrack])).connect(a);
        this.localAnalyser = { a, buf: new Uint8Array(a.fftSize) };
      }
      this.applyPtt();
    } else {
      this.audioTrack?.stop();
      this.audioTrack = null;
      this.localAnalyser = undefined;
      this.applyPtt();
    }
    await this.transport?.applyTracks();
    this.publishState();
  }

  async setCam(on: boolean) {
    if (on === !!this.videoTrack) return;
    if (on) {
      try {
        const s = await navigator.mediaDevices.getUserMedia({
          video: {
            deviceId: this.camDeviceId ? { exact: this.camDeviceId } : undefined,
            width: { ideal: 640 },
            height: { ideal: 360 },
            frameRate: { ideal: 24, max: 30 },
          },
        });
        this.videoTrack = s.getVideoTracks()[0] ?? null;
        store.set({ mediaError: null });
      } catch (err) {
        this.mediaError(err);
        return;
      }
    } else {
      this.videoTrack?.stop();
      this.videoTrack = null;
    }
    await this.transport?.applyTracks();
    this.publishState();
  }

  /** Share a screen or window with the people I am linked to (P7.1, SFU only). */
  async setScreen(on: boolean) {
    if (on === !!this.screenTrack) return;
    if (on) {
      if (!this.canShareScreen) return;
      try {
        const s = await navigator.mediaDevices.getDisplayMedia({
          video: { frameRate: { ideal: 15, max: 30 } },
          audio: true,
        });
        this.screenTrack = s.getVideoTracks()[0] ?? null;
        this.screenAudioTrack = s.getAudioTracks()[0] ?? null;
        // the browser's own "Stop sharing" button ends the track
        if (this.screenTrack) this.screenTrack.onended = () => void this.setScreen(false);
      } catch (err) {
        // closing the picker is not an error worth a banner
        if ((err as { name?: string })?.name !== 'NotAllowedError') this.mediaError(err);
        return;
      }
    } else {
      this.screenTrack?.stop();
      this.screenAudioTrack?.stop();
      this.screenTrack = this.screenAudioTrack = null;
    }
    await this.transport?.applyTracks();
    this.publishState();
  }

  /** Switch device while live. */
  async switchDevice(kind: 'mic' | 'cam', deviceId: string) {
    if (kind === 'mic') this.micDeviceId = deviceId || undefined;
    else this.camDeviceId = deviceId || undefined;
    this.saveDevices();
    if (kind === 'mic') {
      if (this.audioTrack) {
        await this.setMic(false);
        await this.setMic(true);
      }
    } else {
      if (this.videoTrack) {
        await this.setCam(false);
        await this.setCam(true);
      }
    }
  }

  async setSpeaker(deviceId: string) {
    this.speakerDeviceId = deviceId || undefined;
    this.saveDevices();
    await this.transport?.setSpeaker();
  }

  async applySink(el: HTMLAudioElement) {
    const withSink = el as HTMLAudioElement & { setSinkId?: (id: string) => Promise<void> };
    if (this.speakerDeviceId && withSink.setSinkId)
      await withSink.setSinkId(this.speakerDeviceId).catch(() => {});
  }

  /** Volume falloff by distance (open floor) or full volume (same room or pod); speaking rings. */
  private updateLevels() {
    const s = store.get();
    const me = s.me ? rendered.get(s.me) : undefined;
    const kind = s.myZone?.kind;
    const fullRoom = kind === 'private' || kind === 'desk';
    const speaking =
      this.transport?.levels((id) => {
        if (fullRoom) return 1;
        const them = rendered.get(id);
        return me && them ? falloff(distTiles(me, them), 1.5, s.config?.connectR ?? 5) : 0;
      }) ?? {};
    let changed = false;
    const remote = { ...s.remote };
    for (const [id, r] of Object.entries(remote)) {
      const now = !!speaking[id] && !!s.profiles[id]?.mic;
      if (r.speaking !== now) {
        remote[id] = { ...r, speaking: now };
        changed = true;
      }
    }
    const self = !!(
      this.localAnalyser &&
      this.audioTrack?.enabled &&
      rms(this.localAnalyser.a, this.localAnalyser.buf) > SPEAK_THRESHOLD
    );
    if (changed || self !== s.speakingSelf) store.set({ remote, speakingSelf: self });
  }

  /** e2e hook: the transport's own view (rooms, subscriptions). */
  get debugTransport() {
    return this.transport;
  }
}

export const media = new MediaManager();
