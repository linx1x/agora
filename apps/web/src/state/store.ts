import { useSyncExternalStore } from 'react';
import type {
  Biome,
  DeskState,
  Avatar,
  ChatMsg,
  ClientConfig,
  PlayerProfile,
  PlatformRole,
  Status,
  WorldMap,
  Zone,
} from '@agora/shared';

export type ConnState =
  | 'idle'
  | 'connecting'
  | 'online'
  | 'reconnecting'
  | 'lost'
  | 'full'
  /** this space does not exist or I may not enter it (see `denied`) */
  | 'denied';

/** Show a remote video in an element; returns the undo. Lets the SFU see tile size and visibility. */
export type Attach = (el: HTMLVideoElement) => () => void;

export interface RemoteMedia {
  id: string;
  stream: MediaStream;
  hasVideo: boolean;
  speaking: boolean;
  /** SFU backend: attach the camera through the SDK (adaptive stream) instead of `stream` */
  attach?: Attach;
  /** their shared screen, when I receive it (P7.1) */
  screen?: { attach: Attach };
}

/** SFU connection (ADR-031); 'off' with the peer-to-peer backend. */
export type SfuState = 'off' | 'connecting' | 'connected' | 'lost';

export type Prompt =
  | { kind: 'sit' }
  | { kind: 'stand' }
  | { kind: 'claim'; deskId: string; moving: boolean }
  | { kind: 'knock'; deskId: string; owner: string }
  | { kind: 'closed'; deskId: string; owner: string }
  | { kind: 'teleport'; region: string; to: string };

export interface Settings {
  lighting: boolean;
  sounds: boolean;
  autoSit: boolean;
  /** show the device check before entering a space (P3.2) */
  precheck: boolean;
  /** push-to-talk (P3.8): mic sends only while `pttKey` is held */
  pushToTalk: boolean;
  /** KeyboardEvent.code of the push-to-talk key */
  pttKey: string;
  /** never send or receive video (P3.9) */
  audioOnly: boolean;
  /** show the virtual joystick on touch screens (P8.2) */
  joystick: boolean;
}

export const DEFAULT_SETTINGS: Settings = {
  lighting: true,
  sounds: true,
  autoSit: true,
  precheck: true,
  pushToTalk: false,
  pttKey: 'Space',
  audioOnly: false,
  joystick: true,
};

const loadSettings = (): Settings => {
  const d: Settings = { ...DEFAULT_SETTINGS };
  try {
    return {
      ...d,
      ...(JSON.parse(localStorage.getItem('agora.settings') ?? '{}') as Partial<Settings>),
    };
  } catch {
    return d;
  }
};
export function saveSettings(s: Settings) {
  try {
    localStorage.setItem('agora.settings', JSON.stringify(s));
  } catch {
    /* ignore */
  }
}

/** Build mode UI state (ADR-021). */
export type BuildGroup = 'objects' | 'props' | 'floor' | 'walls' | 'overhead';
export interface BuildState {
  tool: 'paint' | 'erase' | 'pick';
  group: BuildGroup;
  /** selected base per group */
  base: Record<BuildGroup, string>;
  /** tile theme; 'auto' = the theme of the area under the cursor */
  theme: Biome | 'auto';
  grid: boolean;
  collision: boolean;
}

export interface AppState {
  conn: ConnState;
  me: string | null;
  myName: string;
  myAvatar: Avatar | null;
  config: ClientConfig | null;
  map: WorldMap | null;
  profiles: Record<string, PlayerProfile>;
  /** id → area zone id (refreshed ~2 Hz for the presence panel) */
  areas: Record<string, string | null>;
  myZone: Zone | null;
  chat: ChatMsg[];
  unread: { nearby: number; everyone: number };
  peers: string[];
  remote: Record<string, RemoteMedia>;
  localStream: MediaStream | null;
  mic: boolean;
  cam: boolean;
  /** sharing my screen (P7.1) */
  screen: boolean;
  screenStream: MediaStream | null;
  sfu: SfuState;
  speakingSelf: boolean;
  mediaError: string | null;
  status: Status;
  statusMsg: string;
  /** ids sorted by distance, nearest first (refreshed ~2 Hz) */
  nearest: string[];
  toast: { key: string; vars?: Record<string, string> } | null;
  panel: 'people' | 'chat';
  panelOpen: boolean;
  dialog:
    | null
    | 'avatar'
    | 'credits'
    | 'privacy'
    | 'shortcuts'
    | 'settings'
    | 'desk'
    | 'buildReset'
    | 'spaces'
    | 'spaceSettings'
    | 'account'
    | 'people';
  /** current space (P2.3) */
  space: string;
  spaceName: string;
  denied: 'not_found' | 'forbidden' | null;
  /** platform admin (ADMIN_IDS / ADMIN_CODE) */
  admin: boolean;
  /** platform role (ADR-032) */
  role: PlatformRole;
  /** the name the owner put on my invite (passkey mode) */
  invitedName: string | null;
  /** invite-only accounts with passkeys (AUTH_MODE=passkey) */
  passkeyMode: boolean;
  /** this browser keeps its identity (access-code mode, ADR-028) */
  remembered: boolean;
  /** my account id (shown in Settings for ADMIN_IDS / BUILDER_IDS) */
  uid: string;
  /** push-to-talk key held right now */
  talking: boolean;
  /** switched to audio-only because the connection is poor (P3.9) */
  autoAudioOnly: boolean;
  desks: DeskState[];
  myDesk: string | null;
  admitted: string[];
  prompt: Prompt | null;
  knocks: { from: string; name: string; deskId: string }[];
  callover: { from: string; name: string } | null;
  settings: Settings;
  /** null = fit to window */
  zoom: number | null;
  minimap: boolean;
  /** navigation request from the UI (people list, minimap, desk button) */
  navRequest:
    | { kind: 'person'; id: string }
    | { kind: 'desk' }
    | { kind: 'point'; x: number; y: number }
    /** act on the current prompt, like the X key (touch action button, P8.2) */
    | { kind: 'act' }
    | null;
  /** my region id (hub / biome) */
  myRegion: string | null;
  chatTab: 'nearby' | 'everyone';
  locate: string | null;
  /** may use build mode (from the server welcome) */
  builder: boolean;
  /** BUILDER_CODE is configured on the server (Settings shows the unlock field) */
  builderCodeAvailable: boolean;
  /** ADMIN_CODE is configured on the server */
  adminCodeAvailable: boolean;
  /** build mode on (null = off) */
  build: BuildState | null;
  /** theme of the area under the build cursor */
  cursorBiome: Biome;
  /** last build mode options, restored when it is turned on again */
  buildPrefs: BuildState;
  /** live map revision (bumped by every applied edit) */
  mapRev: number;
  /** bumped when the whole map is replaced: the world view remounts */
  mapGen: number;
  undoCount: number;
  redoCount: number;
}

const initial: AppState = {
  conn: 'idle',
  me: null,
  myName: '',
  myAvatar: null,
  config: null,
  map: null,
  profiles: {},
  areas: {},
  myZone: null,
  chat: [],
  unread: { nearby: 0, everyone: 0 },
  peers: [],
  remote: {},
  localStream: null,
  mic: false,
  cam: false,
  screen: false,
  screenStream: null,
  sfu: 'off',
  speakingSelf: false,
  mediaError: null,
  status: 'available',
  statusMsg: '',
  nearest: [],
  toast: null,
  panel: 'people',
  panelOpen: true,
  dialog: null,
  space: 'hq',
  spaceName: '',
  denied: null,
  admin: false,
  role: 'member',
  invitedName: null,
  passkeyMode: false,
  remembered: false,
  uid: '',
  talking: false,
  autoAudioOnly: false,
  chatTab: 'nearby',
  locate: null,
  desks: [],
  myDesk: null,
  admitted: [],
  prompt: null,
  knocks: [],
  callover: null,
  settings: loadSettings(),
  zoom: null,
  minimap: true,
  navRequest: null,
  myRegion: null,
  builder: false,
  builderCodeAvailable: false,
  adminCodeAvailable: false,
  build: null,
  cursorBiome: 'hub',
  buildPrefs: {
    tool: 'paint',
    group: 'objects',
    base: {
      objects: 'plantA',
      props: 'prop.lampOn',
      floor: 'floor',
      walls: 'wallTop',
      overhead: 'hanging',
    },
    theme: 'auto',
    grid: true,
    collision: false,
  },
  mapRev: 0,
  mapGen: 0,
  undoCount: 0,
  redoCount: 0,
};

let state = initial;
const listeners = new Set<() => void>();

export const store = {
  get: () => state,
  set(patch: Partial<AppState> | ((s: AppState) => Partial<AppState>)) {
    const p = typeof patch === 'function' ? patch(state) : patch;
    state = { ...state, ...p };
    for (const l of listeners) l();
  },
  subscribe(l: () => void) {
    listeners.add(l);
    return () => listeners.delete(l);
  },
  reset() {
    state = { ...initial };
    for (const l of listeners) l();
  },
};

export function useStore<T>(sel: (s: AppState) => T): T {
  return useSyncExternalStore(store.subscribe, () => sel(state));
}

let toastTimer: ReturnType<typeof setTimeout> | undefined;
export function toast(key: string, vars?: Record<string, string>, ms = 3500) {
  store.set({ toast: { key, vars } });
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => store.set({ toast: null }), ms);
}
