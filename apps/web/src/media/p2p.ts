import type { S2CMsg } from '@agora/shared';
import { world } from '../net/client';
import { store, type RemoteMedia } from '../state/store';
import { isPoor, sampleFrom, type LossCounters } from './quality';
import type { MediaTransport, TransportHost } from './transport';

interface Peer {
  id: string;
  pc: RTCPeerConnection;
  stream: MediaStream;
  audio: HTMLAudioElement;
  pendingIce: RTCIceCandidateInit[];
  offerer: boolean;
  analyser?: AnalyserNode;
  buf?: Uint8Array<ArrayBuffer>;
  restartTimer?: ReturnType<typeof setTimeout>;
  loss: LossCounters;
}

export const SPEAK_THRESHOLD = 0.035;

export function rms(a: AnalyserNode, buf: Uint8Array<ArrayBuffer>): number {
  a.getByteTimeDomainData(buf);
  let sum = 0;
  for (const v of buf) {
    const d = (v - 128) / 128;
    sum += d * d;
  }
  return Math.sqrt(sum / buf.length);
}

/**
 * Proximity media over peer-to-peer WebRTC (ADR-009), the fallback when no SFU is
 * configured. The server decides who is linked (`peers` message) and refuses
 * signalling between unlinked pairs; this class only connects to the people it is
 * told to, and hangs up as soon as a link disappears.
 */
export class P2PTransport implements MediaTransport {
  readonly kind = 'p2p';
  readonly screenShare = false;
  private peers = new Map<string, Peer>();
  private unsub?: () => void;
  private lastPeers = '';
  private lastVideo = '';

  constructor(private host: TransportHost) {}

  start() {
    this.unsub = world.on((m) => void this.onSignal(m));
    this.sync();
  }

  stop() {
    this.unsub?.();
    for (const id of [...this.peers.keys()]) this.hangup(id);
    this.lastPeers = this.lastVideo = '';
  }

  sync() {
    const s = store.get();
    const key = s.peers.join(',');
    if (key !== this.lastPeers) {
      this.lastPeers = key;
      this.syncPeers(s.peers);
    }
    // who must not get my video: everyone when audio-only, else peers asking for it
    const video = `${this.host.audioOnly()}|${s.peers.filter((id) => s.profiles[id]?.lowBw).join(',')}`;
    if (video !== this.lastVideo) {
      this.lastVideo = video;
      void this.applyTracks();
    }
  }

  async setSpeaker() {
    for (const p of this.peers.values()) await this.host.applySink(p.audio);
  }

  async applyTracks(only?: Peer) {
    const local = this.host.local();
    const list = only ? [only] : [...this.peers.values()];
    for (const p of list)
      for (const t of p.pc.getTransceivers()) {
        const kind = t.receiver.track?.kind;
        if (t.currentDirection === 'stopped' || !kind) continue;
        // no video to a peer whose connection is poor (audio-only is already in `local`)
        const noVideo = !!store.get().profiles[p.id]?.lowBw;
        const track = kind === 'audio' ? local.audio : noVideo ? null : local.video;
        try {
          await t.sender.replaceTrack(track);
          if (kind === 'video' && track) {
            const params = t.sender.getParameters();
            params.encodings = params.encodings?.length ? params.encodings : [{}];
            params.encodings[0]!.maxBitrate = 600_000;
            await t.sender.setParameters(params).catch(() => {});
          }
        } catch {
          /* peer closing */
        }
      }
  }

  async quality(): Promise<boolean[]> {
    const flags: boolean[] = [];
    for (const p of this.peers.values()) {
      if (p.pc.connectionState !== 'connected') continue;
      try {
        const report = await p.pc.getStats();
        flags.push(isPoor(sampleFrom(report.values() as Iterable<{ type: string }>, p.loss)));
      } catch {
        /* closed meanwhile */
      }
    }
    return flags;
  }

  levels(volumeOf: (id: string) => number) {
    const s = store.get();
    const out: Record<string, boolean> = {};
    for (const p of this.peers.values()) {
      p.audio.volume = Math.max(0, Math.min(1, volumeOf(p.id)));
      out[p.id] = !!(
        p.analyser &&
        p.buf &&
        s.profiles[p.id]?.mic &&
        rms(p.analyser, p.buf) > SPEAK_THRESHOLD
      );
    }
    return out;
  }

  private syncPeers(ids: string[]) {
    const me = store.get().me;
    if (!me) return;
    for (const id of [...this.peers.keys()]) if (!ids.includes(id)) this.hangup(id);
    for (const id of ids) if (!this.peers.has(id)) void this.dial(id, me < id);
  }

  private createPeer(id: string, offerer: boolean): Peer {
    const cfg = store.get().config;
    const pc = new RTCPeerConnection({ iceServers: cfg?.iceServers ?? [] });
    const audio = document.createElement('audio');
    audio.autoplay = true;
    this.host.holder.appendChild(audio);
    const peer: Peer = {
      id,
      pc,
      stream: new MediaStream(),
      audio,
      pendingIce: [],
      offerer,
      loss: { lost: 0, received: 0 },
    };
    void this.host.applySink(audio);
    pc.onicecandidate = (e) => {
      if (e.candidate)
        world.send({ t: 'rtc', to: id, data: { kind: 'ice', candidate: e.candidate.toJSON() } });
    };
    pc.ontrack = (e) => {
      peer.stream.addTrack(e.track);
      e.track.onunmute = () => this.publishRemote();
      e.track.onended = () => this.publishRemote();
      if (e.track.kind === 'audio') {
        audio.srcObject = new MediaStream(peer.stream.getAudioTracks());
        void audio.play().catch(() => {});
        const ctx = this.host.audioContext();
        if (ctx) {
          const a = ctx.createAnalyser();
          a.fftSize = 512;
          ctx.createMediaStreamSource(new MediaStream([e.track])).connect(a);
          peer.analyser = a;
          peer.buf = new Uint8Array(a.fftSize);
        }
      }
      this.publishRemote();
    };
    pc.onconnectionstatechange = () => {
      if (pc.connectionState === 'failed' && peer.offerer) {
        clearTimeout(peer.restartTimer);
        peer.restartTimer = setTimeout(() => {
          if (this.peers.get(id) === peer) {
            this.hangup(id);
            if (store.get().peers.includes(id)) void this.dial(id, true);
          }
        }, 1500);
      }
    };
    this.peers.set(id, peer);
    return peer;
  }

  private async dial(id: string, offerer: boolean) {
    const peer = this.createPeer(id, offerer);
    if (!offerer) return; // wait for their offer
    peer.pc.addTransceiver('audio', { direction: 'sendrecv' });
    peer.pc.addTransceiver('video', { direction: 'sendrecv' });
    try {
      await this.applyTracks(peer);
      const offer = await peer.pc.createOffer();
      await peer.pc.setLocalDescription(offer);
      world.send({ t: 'rtc', to: id, data: { kind: 'offer', sdp: offer.sdp } });
    } catch {
      /* hung up while dialling (the link went away) */
    }
  }

  private async onSignal(m: S2CMsg) {
    if (m.t !== 'rtc') return;
    const { from, data } = m;
    let peer = this.peers.get(from);
    try {
      if (data.kind === 'offer') {
        if (!store.get().peers.includes(from)) return;
        if (!peer || peer.offerer) {
          if (peer) this.hangup(from);
          peer = this.createPeer(from, false);
        }
        await peer.pc.setRemoteDescription({ type: 'offer', sdp: data.sdp });
        for (const t of peer.pc.getTransceivers()) t.direction = 'sendrecv';
        await this.applyTracks(peer);
        const answer = await peer.pc.createAnswer();
        await peer.pc.setLocalDescription(answer);
        world.send({ t: 'rtc', to: from, data: { kind: 'answer', sdp: answer.sdp } });
        await this.flushIce(peer);
      } else if (data.kind === 'answer' && peer) {
        await peer.pc.setRemoteDescription({ type: 'answer', sdp: data.sdp });
        await this.flushIce(peer);
      } else if (data.kind === 'ice' && peer && data.candidate) {
        const c = data.candidate as RTCIceCandidateInit;
        if (peer.pc.remoteDescription) await peer.pc.addIceCandidate(c).catch(() => {});
        else peer.pendingIce.push(c);
      }
    } catch (err) {
      console.warn('[agora] signalling error', err);
    }
  }

  private async flushIce(p: Peer) {
    for (const c of p.pendingIce.splice(0)) await p.pc.addIceCandidate(c).catch(() => {});
  }

  private hangup(id: string) {
    const p = this.peers.get(id);
    if (!p) return;
    clearTimeout(p.restartTimer);
    p.pc.ontrack = null;
    p.pc.onicecandidate = null;
    p.pc.close();
    p.audio.srcObject = null;
    p.audio.remove();
    this.peers.delete(id);
    this.publishRemote();
  }

  private publishRemote() {
    const prev = store.get().remote;
    const remote: Record<string, RemoteMedia> = {};
    for (const p of this.peers.values()) {
      const v = p.stream.getVideoTracks().find((t) => t.readyState === 'live');
      remote[p.id] = {
        id: p.id,
        stream: p.stream,
        hasVideo: !!v,
        speaking: prev[p.id]?.speaking ?? false,
      };
    }
    store.set({ remote });
  }
}
