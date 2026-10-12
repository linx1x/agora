import {
  ConnectionQuality,
  LocalAudioTrack,
  ConnectionState,
  Room,
  RoomEvent,
  Track,
  type RemoteTrack,
  type RemoteTrackPublication,
} from 'livekit-client';
import type { S2CMsg } from '@agora/shared';
import { world } from '../net/client';
import { store, type Attach, type RemoteMedia } from '../state/store';
import type { LocalTracks, MediaTransport, TransportHost } from './transport';

type Grant = Extract<S2CMsg, { t: 'media:grant' }>;

/** Which local track goes out under which LiveKit source. */
const SOURCES: [keyof LocalTracks, Track.Source][] = [
  ['audio', Track.Source.Microphone],
  ['video', Track.Source.Camera],
  ['screen', Track.Source.ScreenShare],
  ['screenAudio', Track.Source.ScreenShareAudio],
];

interface Slot {
  room: Room;
  name: string;
  connected: boolean;
  /** we disconnected on purpose: no retry */
  closing: boolean;
}

const EMPTY = new MediaStream();

/**
 * Proximity media through a LiveKit SFU (ADR-031). The server gives this client
 * tokens for the floor room of the space and, while it places me there, for the
 * room of my private room or desk pod (`media:grant`), and says where I may
 * publish. Who I hear and see is still the server's link set (`peers`):
 * - I subscribe only to linked people (nearest `videoCap` with video);
 * - my own tracks may only be subscribed by people I am linked to (subscription
 *   permissions enforced by the SFU), so a modified client cannot listen in from
 *   across the floor;
 * - zone rooms are server-enforced: no token without being inside, removed on exit.
 */
export class LiveKitTransport implements MediaTransport {
  readonly kind = 'livekit';
  readonly screenShare = true;
  private floor?: Slot;
  private zone?: Slot;
  private grant?: Grant;
  private unsub?: () => void;
  private chain: Promise<void> = Promise.resolve();
  private audioEls = new Map<RemoteTrack, { el: HTMLMediaElement; id: string }>();
  private attachers = new WeakMap<RemoteTrack, Attach>();
  private streams = new WeakMap<RemoteTrack, MediaStream>();
  private retryTimer?: ReturnType<typeof setTimeout>;
  private retries = 0;
  private subKey = '';
  private permKey = '';
  private stopped = true;

  constructor(private host: TransportHost) {}

  start() {
    this.stopped = false;
    this.unsub = world.on((m) => {
      if (m.t === 'media:grant') this.onGrant(m);
    });
    this.setState();
  }

  stop() {
    this.stopped = true;
    this.unsub?.();
    clearTimeout(this.retryTimer);
    this.close(this.floor);
    this.close(this.zone);
    this.floor = this.zone = undefined;
    this.grant = undefined;
    for (const { el } of this.audioEls.values()) el.remove();
    this.audioEls.clear();
    this.subKey = this.permKey = '';
    store.set({ remote: {}, sfu: 'off' });
  }

  // ───────────────────────────────────────────── rooms
  private onGrant(g: Grant) {
    if (this.stopped) return;
    this.grant = g;
    // no floor grant inside a personal world (P17.11): the floor room is left, not joined
    if (!g.floor) {
      this.close(this.floor);
      this.floor = undefined;
    } else if (!this.floor || this.floor.name !== g.floor.room) {
      this.close(this.floor);
      this.floor = this.open(g.url, g.floor.room, g.floor.token);
    }
    if (!g.zone) {
      this.close(this.zone);
      this.zone = undefined;
    } else if (!this.zone || this.zone.name !== g.zone.room) {
      this.close(this.zone);
      this.zone = this.open(g.url, g.zone.room, g.zone.token);
    }
    void this.applyTracks();
    this.publishRemote();
    this.setState();
  }

  private open(url: string, name: string, token: string): Slot {
    const room = new Room({
      adaptiveStream: true,
      dynacast: true,
      stopLocalTrackOnUnpublish: false,
      disconnectOnPageLeave: true,
      publishDefaults: { simulcast: true, dtx: true, red: true },
    });
    const slot: Slot = { room, name, connected: false, closing: false };
    const changed = () => {
      this.sync(true);
      this.publishRemote();
    };
    room
      .on(RoomEvent.ParticipantConnected, changed)
      .on(RoomEvent.ParticipantDisconnected, changed)
      .on(RoomEvent.TrackPublished, changed)
      .on(RoomEvent.TrackUnpublished, changed)
      .on(RoomEvent.TrackMuted, () => this.publishRemote())
      .on(RoomEvent.TrackUnmuted, () => this.publishRemote())
      .on(RoomEvent.TrackSubscribed, (track, _pub, p) => {
        if (track.kind === Track.Kind.Audio) {
          const el = track.attach();
          this.host.holder.appendChild(el);
          void this.host.applySink(el as HTMLAudioElement);
          this.audioEls.set(track, { el, id: p.identity });
        }
        this.publishRemote();
      })
      .on(RoomEvent.TrackUnsubscribed, (track) => {
        const a = this.audioEls.get(track);
        if (a) {
          track.detach(a.el);
          a.el.remove();
          this.audioEls.delete(track);
        }
        this.publishRemote();
      })
      .on(RoomEvent.ConnectionStateChanged, () => this.setState())
      .on(RoomEvent.Disconnected, () => {
        slot.connected = false;
        this.dropped(slot);
      });
    room
      .connect(url, token, { autoSubscribe: false })
      .then(() => {
        if (slot.closing) return;
        slot.connected = true;
        this.retries = 0;
        this.permKey = this.subKey = ''; // apply to the new room too
        this.sync(true);
        void this.applyTracks();
        this.publishRemote();
        this.setState();
      })
      .catch((err: unknown) => {
        if (slot.closing) return;
        console.warn('[agora] media server unreachable', err);
        this.dropped(slot);
      });
    return slot;
  }

  private close(slot?: Slot) {
    if (!slot) return;
    slot.closing = true;
    slot.connected = false;
    void slot.room.disconnect(false);
  }

  /** Lost a room we still need: ask the server for fresh tokens, with backoff. */
  private dropped(slot: Slot) {
    if (slot.closing || this.stopped) return;
    if (this.floor === slot) this.floor = undefined;
    else if (this.zone === slot) this.zone = undefined;
    else return;
    slot.closing = true;
    this.publishRemote();
    this.setState();
    clearTimeout(this.retryTimer);
    const delay = Math.min(30_000, 1000 * 2 ** this.retries++);
    this.retryTimer = setTimeout(() => world.send({ t: 'media:token' }), delay);
  }

  private setState() {
    if (this.stopped) return;
    const f = this.floor;
    const sfu =
      f?.connected && f.room.state === ConnectionState.Connected
        ? 'connected'
        : !f && this.grant
          ? 'lost'
          : 'connecting';
    if (store.get().sfu !== sfu) store.set({ sfu });
  }

  private slots(): Slot[] {
    return [this.floor, this.zone].filter((s): s is Slot => !!s?.connected);
  }

  /** Browsers block audio until a user gesture: retry playback after one. */
  unlock() {
    for (const s of this.slots()) void s.room.startAudio().catch(() => {});
  }

  // ───────────────────────────────────────────── publishing
  applyTracks(): Promise<void> {
    this.chain = this.chain.then(() => this.publish()).catch((err) => console.warn(err));
    return this.chain;
  }

  private async publish() {
    const local = this.host.local();
    const where = this.grant?.publish;
    const target = where === 'zone' ? this.zone : where === 'floor' ? this.floor : undefined;
    // take tracks out of rooms I may no longer publish to before adding them anywhere
    const order = this.slots().sort((a, b) => Number(a === target) - Number(b === target));
    for (const slot of order) {
      const lp = slot.room.localParticipant;
      for (const [key, source] of SOURCES) {
        const want = slot === target ? local[key] : null;
        const pub = lp.getTrackPublication(source);
        if ((pub?.track?.mediaStreamTrack ?? null) === want) continue;
        if (pub?.track) await lp.unpublishTrack(pub.track, false);
        if (!want || !slot.connected) continue;
        if (key === 'audio') {
          // wrap the mic so push-to-talk can mute it before anything is sent
          const mic = new LocalAudioTrack(want, undefined, true);
          if (!want.enabled) await mic.mute();
          await lp.publishTrack(mic, { source, name: source });
        } else
          await lp.publishTrack(want, {
            source,
            name: source,
            simulcast: key === 'video' || key === 'screen',
          });
      }
    }
  }

  /** Push-to-talk through the SDK's mute, so the SDK and listeners agree on the state. */
  micLive(live: boolean) {
    this.chain = this.chain
      .then(async () => {
        for (const slot of this.slots()) {
          const t = slot.room.localParticipant.getTrackPublication(Track.Source.Microphone)?.track;
          if (t && t.isMuted === live) await (live ? t.unmute() : t.mute());
        }
      })
      .catch((err) => console.warn(err));
  }

  // ───────────────────────────────────────────── subscribing
  /** Subscribe to linked people only; only linked people may subscribe to me. */
  sync(force = false) {
    const s = store.get();
    const linked = [...s.peers];
    const rank = (id: string) => {
      const i = s.nearest.indexOf(id);
      return i < 0 ? Infinity : i;
    };
    const audioOnly = this.host.audioOnly();
    const withVideo = new Set(
      [...linked].sort((a, b) => rank(a) - rank(b)).slice(0, s.config?.videoCap ?? 9),
    );
    const permKey = linked.join(',');
    if (force || permKey !== this.permKey) {
      this.permKey = permKey;
      for (const slot of this.slots())
        slot.room.localParticipant.setTrackSubscriptionPermissions(
          false,
          linked.map((id) => ({ participantIdentity: id, allowAll: true })),
        );
    }
    const subKey = `${permKey}|${[...withVideo].join(',')}|${audioOnly}`;
    if (!force && subKey === this.subKey) return;
    this.subKey = subKey;
    const set = new Set(linked);
    for (const slot of this.slots())
      for (const p of slot.room.remoteParticipants.values())
        for (const pub of p.trackPublications.values()) {
          let want = set.has(p.identity);
          if (want && pub.kind === Track.Kind.Video)
            want =
              !audioOnly && (pub.source === Track.Source.ScreenShare || withVideo.has(p.identity));
          if (pub.isSubscribed !== want) pub.setSubscribed(want);
        }
    this.publishRemote();
  }

  private attacher(track: RemoteTrack): Attach {
    let a = this.attachers.get(track);
    if (!a) {
      a = (el) => {
        track.attach(el);
        return () => void track.detach(el);
      };
      this.attachers.set(track, a);
    }
    return a;
  }

  private streamOf(track: RemoteTrack): MediaStream {
    let s = this.streams.get(track);
    if (!s) {
      s = new MediaStream([track.mediaStreamTrack]);
      this.streams.set(track, s);
    }
    return s;
  }

  private publishRemote() {
    const s = store.get();
    const linked = new Set(s.peers);
    const prev = s.remote;
    const remote: Record<string, RemoteMedia> = {};
    const live = (pub?: RemoteTrackPublication) =>
      pub?.isSubscribed && !pub.isMuted ? pub.track : undefined;
    for (const slot of this.slots())
      for (const p of slot.room.remoteParticipants.values()) {
        const id = p.identity;
        if (!linked.has(id)) continue;
        const mic = live(p.getTrackPublication(Track.Source.Microphone));
        const cam = live(p.getTrackPublication(Track.Source.Camera));
        const screen = live(p.getTrackPublication(Track.Source.ScreenShare));
        if (!mic && !cam && !screen && !remote[id]) continue;
        remote[id] = {
          id,
          stream: cam ? this.streamOf(cam) : (remote[id]?.stream ?? EMPTY),
          hasVideo: !!cam || !!remote[id]?.hasVideo,
          speaking: prev[id]?.speaking ?? false,
          attach: cam ? this.attacher(cam) : remote[id]?.attach,
          screen: screen ? { attach: this.attacher(screen) } : remote[id]?.screen,
        };
      }
    store.set({ remote });
  }

  // ───────────────────────────────────────────── levels, speaker, quality
  levels(volumeOf: (id: string) => number) {
    for (const [track, { id }] of this.audioEls)
      (track as RemoteTrack & { setVolume?: (v: number) => void }).setVolume?.(
        Math.max(0, Math.min(1, volumeOf(id))),
      );
    const out: Record<string, boolean> = {};
    for (const slot of this.slots())
      for (const p of slot.room.remoteParticipants.values())
        if (p.isSpeaking) out[p.identity] = true;
    return out;
  }

  async setSpeaker() {
    for (const { el } of this.audioEls.values()) await this.host.applySink(el as HTMLAudioElement);
  }

  async quality(): Promise<boolean[]> {
    const where = this.grant?.publish === 'zone' ? this.zone : this.floor;
    if (!where?.connected || !store.get().peers.length) return [];
    const q = where.room.localParticipant.connectionQuality;
    if (q === ConnectionQuality.Unknown) return [];
    return [q === ConnectionQuality.Poor || q === ConnectionQuality.Lost];
  }
}
