import { useSyncExternalStore } from 'react';
import type {
  Biome,
  DeskState,
  Avatar,
  ChatMsg,
  ClientConfig,
  PetState,
  PlayerProfile,
  PlatformRole,
  Status,
  WorldMap,
  Zone,
  NpcState,
  NpcMindView,
  NpcConsentState,
  NpcRefusal,
  OfficeRefusal,
  Taste,
  ActionKind,
  S2CMsg,
  VisitorRefusal,
  ContractRefusal,
  TradeRefusal,
  ContractView,
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

/** The answer to a gift (P17.26b), as the Talk box shows it. */
export interface GiftResultView {
  readonly key: string;
  readonly npcId: string;
  readonly ok: boolean;
  readonly reason?: OfficeRefusal;
  readonly taste?: Taste;
  readonly at: number;
}

export type Prompt =
  | { kind: 'sit' }
  | { kind: 'stand' }
  | { kind: 'claim'; deskId: string; moving: boolean }
  | { kind: 'knock'; deskId: string; owner: string }
  | { kind: 'closed'; deskId: string; owner: string }
  | { kind: 'teleport'; region: string; to: string }
  /** a character within talking range (P15.4): X opens the Talk box */
  | { kind: 'talk'; npcId: string; name: string }
  /** P17.26b: standing at the office shop board: X opens it */
  | { kind: 'shop' }
  /** P17.14: standing in a pod I may enter: X goes into the owner's world (`portal:enter`) */
  | { kind: 'world'; deskId: string; owner: string | null }
  /** P17.14: standing on the return pad of a world: X goes back to the office desk */
  | { kind: 'worldExit' }
  /** P17.32: standing on a cave mouth in a world: X goes into the cave `id` (`portal:enter`) */
  | { kind: 'cave'; id: string }
  /** P17.32: standing on the pad of a cave: X comes back out to its world */
  | { kind: 'caveExit' };

/** One line in a Talk box: mine (kept only in this browser) or a character's (P15.4). */
export interface NpcLogLine {
  id: string;
  npcId: string;
  from: 'me' | 'npc';
  /** a character's line meant for someone else who was near (shown as overheard) */
  to?: string;
  body: string;
  at: number;
  /** P15.8: the sites a web lookup quoted for this line */
  src?: string[];
}

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
  /** show characters' replies as speech bubbles over their heads (P15.4) */
  npcBubbles: boolean;
  /** hear the characters' voices (P15.6), off until asked for */
  npcVoices: boolean;
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
  npcBubbles: true,
  npcVoices: false,
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
  tool: 'paint' | 'erase' | 'pick' | 'select';
  group: BuildGroup;
  /** selected base per group */
  base: Record<BuildGroup, string>;
  /** tile theme; 'auto' = the theme of the area under the cursor */
  theme: Biome | 'auto';
  grid: boolean;
  collision: boolean;
  /** props snap to spots (P9.17); Alt inverts it while held */
  snap: boolean;
  /** new props are mirrored (P9.20) */
  flip: boolean;
}

/** What the Select tool holds (P9.17–P9.20), as the build panel shows it. */
export type BuildSel =
  | {
      kind: 'prop';
      id: string;
      t: string;
      x: number;
      y: number;
      z: number;
      f: boolean;
      turn: boolean;
    }
  | { kind: 'run'; t: string; axes: ('h' | 'v')[]; len: number }
  | { kind: 'cell'; t: string; turn: boolean };

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
    | 'worldTuning'
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
  /** the space's cats as the server last described them (ADR-040, flag `pets`) */
  pets: PetState[];
  /** the space's characters as the server last described them (ADR-042, flag `npcs`) */
  npcs: NpcState[];
  /** P15.3 brain view (development, space admins): needs and why, per character id */
  npcMinds: Record<string, NpcMindView>;
  /**
   * the 2.5D quality rung this session has reached (0 is the full look; a slow device steps down,
   * ADR-054). Not saved: the next visit starts at the full look again.
   */
  qualityLevel: number;
  /** whether the characters' decisions come from Clef right now (null: no brain view) */
  npcBrain: 'off' | 'up' | 'down' | null;
  /** P15.4: the character whose Talk box is open */
  talkTo: string | null;
  /** P15.4: does Talk need the AI notice, and did I accept it (null until the server says) */
  npcConsent: NpcConsentState | null;
  /** P15.4: the last lines said to and by characters (not stored anywhere) */
  npcLog: NpcLogLine[];
  /** P15.4: characters writing a reply right now, by id */
  npcTyping: Record<string, boolean>;
  /** P15.4: why the server refused my last message, to show once */
  npcRefused: { id: string; reason: NpcRefusal; at: number } | null;
  /** P15.5: what each character told me it remembers about me (undefined: not asked yet) */
  npcMemory: Record<string, string | null>;
  /** P17.26b: my hearts with each character (null until the server says; only with personal worlds on) */
  hearts: Record<string, number> | null;
  /** P17.26b: the answer to my last gift, to show once in the Talk box */
  giftResult: GiftResultView | null;
  /** P17.26b: the office shop board is open (standing at it) */
  officeShop: boolean;
  /** P17.26b: why the office board refused my last purchase (null: it did not) */
  officeShopRefused: OfficeRefusal | null;
  myDesk: string | null;
  /** P17.14: the personal world I am in (null: the office). GameView mounts the world view for it. */
  worldId: string | null;
  /** P17.27: the world I am in is my own */
  worldMine: boolean;
  /** P17.27: what I may do in the world I am visiting (null: my own world, or not said yet) */
  worldPerms: ActionKind[] | null;
  /** P17.27: my world's visitor matrix as the server last sent it (owner only) */
  worldVisitors: Extract<S2CMsg, { t: 'world:visitors' }> | null;
  /** P17.28: the open contracts of the world I am in, with my own progress */
  contracts: ContractView[];
  /** P17.28: the contracts panel is open */
  contractsOpen: boolean;
  /** P17.28: why my last post or cancel did nothing */
  contractRefused: ContractRefusal | null;
  /** P17.29: the trade I am in, as the server last described it */
  trade: Extract<S2CMsg, { t: 'trade:state' }> | null;
  /** P17.29: someone beside me asks to trade */
  tradeAsk: { id: string; from: string; name: string } | null;
  /** P17.29: why my last trade step did nothing */
  tradeRefused: TradeRefusal | null;
  /** P17.27: the visitors panel is open */
  visitorsOpen: boolean;
  /** P17.27: why my last change to the matrix did nothing */
  visitorsRefused: VisitorRefusal | null;
  /** FIX-1: the owner's display name of that world (the card says "Monde de <owner>"); '' when unknown */
  worldOwner: string;
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
  /** current Select-tool selection (P9.17) */
  buildSel: BuildSel | null;
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
  pets: [],
  npcs: [],
  npcMinds: {},
  qualityLevel: 0,
  npcBrain: null,
  talkTo: null,
  npcConsent: null,
  npcLog: [],
  npcTyping: {},
  npcRefused: null,
  npcMemory: {},
  hearts: null,
  giftResult: null,
  officeShop: false,
  officeShopRefused: null,
  myDesk: null,
  worldId: null,
  worldMine: false,
  worldPerms: null,
  worldVisitors: null,
  visitorsOpen: false,
  trade: null,
  tradeAsk: null,
  tradeRefused: null,
  contracts: [],
  contractsOpen: false,
  contractRefused: null,
  visitorsRefused: null,
  worldOwner: '',
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
    snap: true,
    flip: false,
  },
  buildSel: null,
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
