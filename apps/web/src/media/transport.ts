/** The local media the manager owns; transports only send it. */
export interface LocalTracks {
  audio: MediaStreamTrack | null;
  /** null while audio-only (by choice or poor connection) */
  video: MediaStreamTrack | null;
  screen: MediaStreamTrack | null;
  screenAudio: MediaStreamTrack | null;
}

export interface TransportHost {
  local(): LocalTracks;
  audioOnly(): boolean;
  speakerId(): string | undefined;
  audioContext(): AudioContext | null;
  /** route a remote audio element to the chosen speaker */
  applySink(el: HTMLAudioElement): Promise<void>;
  /** hidden container for remote audio elements */
  holder: HTMLElement;
}

/**
 * How proximity media travels (ADR-031): LiveKit SFU, or peer-to-peer (ADR-009).
 * Both only ever connect people the server links (`peers`); the SFU transport also
 * gets its rooms from the server (`media:grant`).
 */
export interface MediaTransport {
  readonly kind: 'livekit' | 'p2p';
  /** can carry a shared screen (P7.1) */
  readonly screenShare: boolean;
  start(): void;
  stop(): void;
  /** links, nearest order, audio-only, video cap or peers' low-bandwidth flags changed */
  sync(): void;
  /** local tracks changed (mic, camera, screen, push-to-talk does not count) */
  applyTracks(): Promise<void>;
  /** speaker changed */
  setSpeaker(): Promise<void>;
  /** set volumes; returns who is speaking right now */
  levels(volumeOf: (id: string) => number): Record<string, boolean>;
  /** push-to-talk: the mic is open (key held, or no push-to-talk) or closed */
  micLive?(live: boolean): void;
  /** after a user gesture: let blocked audio play */
  unlock?(): void;
  /** one quality round: one "poor" flag per link (empty = nothing to judge) */
  quality(): Promise<boolean[]>;
}
