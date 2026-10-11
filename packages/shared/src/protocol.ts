import { z } from 'zod';
import { AvatarSchema, type Avatar } from './avatar';
import {
  DIRS,
  EMOTES,
  MAX_CHAT_LEN,
  MAX_NAME_LEN,
  STATUSES,
  type Dir,
  type Emote,
  type Status,
} from './constants';
import type { Flags } from './flags';
import type { PetState } from './pets';
import type { NpcState } from './npcs';
import type { NpcMindView } from './npc-mind';
import { NPC_TALK_MAX_LEN, type NpcConsentState, type NpcEmote, type NpcRefusal } from './npc-talk';
import { DESK_ACCESS, DeskDecorSchema, type DeskState } from './desks';
import { MAX_EDIT_CELLS, MapChangeSchema, type EditRefusal, type MapChange } from './edit';
import { PORTAL_ID, type PortalRefusal } from './portals';
import type { WorldGenParams } from './worlds/gen';
import type { ChunkDelta } from './worlds/delta';
import type { WorldTime } from './worlds/clock';
import type { PlotState } from './worlds/gamedata/state';

/** Client → server messages, all validated with zod on the server. */
export const C2S = z.discriminatedUnion('t', [
  z.object({
    t: z.literal('move'),
    x: z.number().finite(),
    y: z.number().finite(),
    dir: z.enum(DIRS),
    moving: z.boolean(),
    /** sitting is only accepted on a chair tile */
    pose: z.enum(['stand', 'sit']).default('stand'),
    seq: z.number().int().nonnegative(),
  }),
  /** Teleport from a portal pad to another region (hub or biome). */
  z.object({ t: z.literal('teleport'), to: z.string().min(1).max(32) }),
  /** P17.8 (ADR-053): step through a portal by id. The server decides from its own position. */
  z.object({ t: z.literal('portal:enter'), id: z.string().regex(PORTAL_ID) }),
  /** P17.9: walk back out of the world to the office, to your desk. */
  z.object({ t: z.literal('world:leave') }),
  z.object({ t: z.literal('desk:claim'), deskId: z.string().min(1).max(32) }),
  z.object({ t: z.literal('desk:release') }),
  z.object({
    t: z.literal('desk:update'),
    access: z.enum(DESK_ACCESS).optional(),
    decor: DeskDecorSchema.optional(),
  }),
  z.object({ t: z.literal('knock'), deskId: z.string().min(1).max(32) }),
  z.object({
    t: z.literal('knock:answer'),
    visitor: z.string().min(1).max(64),
    accept: z.boolean(),
  }),
  z.object({ t: z.literal('callover'), to: z.string().min(1).max(64) }),
  z.object({ t: z.literal('emote'), emote: z.enum(EMOTES) }),
  z.object({ t: z.literal('hand'), up: z.boolean() }),
  z.object({
    t: z.literal('status'),
    status: z.enum(STATUSES),
    msg: z.string().max(80).default(''),
  }),
  z.object({
    t: z.literal('chat'),
    scope: z.enum(['nearby', 'everyone']),
    body: z.string().trim().min(1).max(MAX_CHAT_LEN),
  }),
  z.object({
    t: z.literal('profile'),
    name: z.string().trim().min(1).max(MAX_NAME_LEN),
    avatar: AvatarSchema,
  }),
  z.object({
    t: z.literal('media'),
    mic: z.boolean(),
    cam: z.boolean(),
    /** push-to-talk armed: the mic only sends while the key is held (P3.8) */
    ptt: z.boolean().default(false),
    /** poor connection or audio-only chosen: peers stop sending video to me (P3.9) */
    lowBw: z.boolean().default(false),
    /** sharing my screen (P7.1, SFU backend only) */
    screen: z.boolean().default(false),
  }),
  /**
   * SFU backend (ADR-031): ask again for media-room tokens, e.g. after the SFU
   * connection dropped for good. The server answers with `media:grant` for the rooms
   * it currently places me in, never others.
   */
  z.object({ t: z.literal('media:token') }),
  z.object({
    t: z.literal('rtc'),
    to: z.string().min(1).max(64),
    /** Opaque WebRTC signalling payload (SDP or ICE candidate), size-capped. */
    data: z.object({
      kind: z.enum(['offer', 'answer', 'ice']),
      sdp: z.string().max(20000).optional(),
      candidate: z.unknown().optional(),
    }),
  }),
  z.object({ t: z.literal('ping'), at: z.number() }),
  /** Leaving on purpose (tab closed, other space): free the seat now instead of holding it. */
  z.object({ t: z.literal('leave') }),
  /** Build mode (builders only): one stroke = one op, validated by planEdit. */
  z.object({
    t: z.literal('map:edit'),
    op: z.number().int().nonnegative(),
    cells: z.array(MapChangeSchema).min(1).max(MAX_EDIT_CELLS),
  }),
  /** Build mode: replace the live map with the generated hq.tmj. */
  z.object({ t: z.literal('map:reset') }),
  /**
   * P15.4 (ADR-045): a Talk-box message to a character within talking range. Only these reach the
   * brain; nearby chat between people never does.
   */
  z.object({
    t: z.literal('npc:talk'),
    npcId: z.string().min(1).max(40),
    body: z.string().trim().min(1).max(NPC_TALK_MAX_LEN),
  }),
  /** P15.4: accept (or refuse) the AI notice for the current provider */
  z.object({ t: z.literal('npc:consent'), accept: z.boolean() }),
  /** P15.5 (ADR-046): what does this character remember about me? */
  z.object({ t: z.literal('npc:recall'), npcId: z.string().min(1).max(40) }),
  /** P15.5: forget me, every character at once */
  z.object({ t: z.literal('npc:forget') }),
  /** P15.6: do I want to hear characters' voices? Only people who said yes are sent clips. */
  z.object({ t: z.literal('npc:voice'), on: z.boolean() }),
]);
export type C2SMsg = z.infer<typeof C2S>;
/** What clients send (defaults such as `pose` may be omitted). */
export type C2SIn = z.input<typeof C2S>;

export interface PlayerProfile {
  id: string;
  name: string;
  avatar: Avatar;
  status: Status;
  statusMsg: string;
  hand: boolean;
  mic: boolean;
  cam: boolean;
  /** push-to-talk: mic open only while a key is held */
  ptt: boolean;
  /** asks peers not to send video (poor connection or audio-only) */
  lowBw: boolean;
  /** sharing their screen (P7.1) */
  screen: boolean;
  /** false while the seat is held for a reconnecting client */
  online: boolean;
}
/** Compact dynamic state sent every tick. */
export interface PlayerPos {
  id: string;
  x: number;
  y: number;
  d: Dir;
  m: boolean;
  /** zone id at the avatar's feet (most specific), or null */
  z: string | null;
  /** pose: 's' = sitting (omitted when standing) */
  p?: 'stand' | 'sit';
}

/** A person in a personal world (P17.9): who, and where they stand (world pixels). */
export interface WorldPerson {
  id: string;
  name: string;
  avatar: Avatar;
  x: number;
  y: number;
  d: Dir;
}

export interface ChatMsg {
  id: string;
  scope: 'nearby' | 'everyone';
  from: string;
  name: string;
  body: string;
  at: number;
  zoneId: string | null;
}

/** Media transport (ADR-031): LiveKit SFU, or the peer-to-peer fallback (ADR-009). */
export type MediaBackend = 'livekit' | 'p2p';

/** A token for one SFU room, minted by the server for this person only. */
export interface MediaRoomGrant {
  room: string;
  token: string;
}

export interface ClientConfig {
  mediaBackend: MediaBackend;
  iceServers: { urls: string | string[]; username?: string; credential?: string }[];
  connectR: number;
  disconnectR: number;
  videoCap: number;
  flags: Flags;
}

export type S2CMsg =
  | {
      t: 'welcome';
      you: string;
      profiles: PlayerProfile[];
      positions: PlayerPos[];
      history: ChatMsg[];
      config: ClientConfig;
      map: string;
      /** current space name (P2.3) */
      spaceName: string;
      desks: DeskState[];
      /** desk owned by this user, if any */
      myDesk: string | null;
      /** live map revision; refetch /api/maps/hq when it differs from yours */
      mapRev: number;
      /** may use build mode */
      builder: boolean;
    }
  | { t: 'map:edit'; rev: number; by: string; op: number; changes: MapChange[] }
  | { t: 'map:refused'; op: number; reason: EditRefusal; cell?: { cx: number; cy: number } }
  | { t: 'map:reload'; rev: number }
  /** space settings changed (radii, video cap) */
  | { t: 'config'; config: ClientConfig }
  /** space renamed */
  | { t: 'space'; name: string }
  | { t: 'state'; positions: PlayerPos[]; at: number }
  | { t: 'profile'; profile: PlayerProfile }
  | { t: 'leave'; id: string }
  | {
      t: 'correction';
      x: number;
      y: number;
      seq: number;
      reason?: 'invalid' | 'blocked' | 'teleport' | 'spawn';
    }
  | { t: 'desks'; desks: DeskState[] }
  | { t: 'knock'; from: string; name: string; deskId: string }
  | {
      t: 'knock:result';
      deskId: string;
      result: 'accepted' | 'declined' | 'away' | 'busy' | 'pending';
    }
  | { t: 'callover'; from: string; name: string }
  | { t: 'visitor'; id: string; name: string; deskId: string }
  | { t: 'chat'; msg: ChatMsg }
  | { t: 'emote'; id: string; emote: Emote }
  | { t: 'peers'; peers: string[] }
  | { t: 'myDesk'; deskId: string | null }
  | { t: 'admitted'; deskIds: string[] }
  /** P17.8: the portal was entered; only the person who asked receives this (never broadcast) */
  | { t: 'portal:go'; id: string; worldId: string; spawn: { x: number; y: number } }
  /** P17.8: the portal was not entered, and why */
  | { t: 'portal:refused'; id: string; reason: PortalRefusal }
  /** P17.9: you are in a world. Its seed and generator (the client regenerates the terrain) and who is here. */
  | {
      t: 'world:welcome';
      worldId: string;
      you: string;
      seed: number;
      genVersion: number;
      params: WorldGenParams;
      people: WorldPerson[];
    }
  /** P17.9: chunks that came into your view (with their stored edits; rev 0 when never edited) and left it */
  | {
      t: 'world:chunks';
      add: { cx: number; cy: number; rev: number; delta: ChunkDelta }[];
      drop: { cx: number; cy: number }[];
    }
  /** P17.9: a person in your world moved (sent to everyone in that world, you included) */
  | { t: 'world:pos'; id: string; x: number; y: number; d: Dir }
  | { t: 'world:join'; person: WorldPerson }
  | { t: 'world:depart'; id: string }
  /** P17.9: the server refused your move; `x`, `y` is where you really stand */
  | {
      t: 'world:correction';
      x: number;
      y: number;
      seq: number;
      reason: 'bounds' | 'speed' | 'collision' | 'step';
    }
  /** P17.9: you are back in the office, at your desk */
  | { t: 'world:exit' }
  /**
   * P17.20–22 (ADR-053 wave 2 contract): the farm layer for cells in your view. Plots are keyed by
   * world cell "cx,cy" (cells, not px) as in `WorldSimState.plots`; `null` removes a plot. Sent with
   * the chunks that come into view and whenever a plot changes (to everyone in range). The farm
   * layer is the authority for tilled / watered / crop / sprinkler; chunk deltas keep terrain, blocks
   * and decor only.
   */
  | { t: 'world:farm'; day: number; plots: Record<string, PlotState | null> }
  /** P17.19/P17.23: the world clock, sent on welcome and every 10 game minutes */
  | { t: 'world:time'; time: WorldTime }
  /**
   * SFU backend (ADR-031): the media rooms the server places me in, with fresh
   * tokens (used when (re)connecting; a live connection is kept). `zone` null =
   * leave any zone room; `publish` = the only room I may send my microphone,
   * camera and screen to.
   */
  | {
      t: 'media:grant';
      url: string;
      /** null inside a personal world (P17.11): the world's room is then the only media room */
      floor: MediaRoomGrant | null;
      zone: MediaRoomGrant | null;
      publish: 'floor' | 'zone' | 'none';
    }
  | { t: 'rtc'; from: string; data: Extract<C2SMsg, { t: 'rtc' }>['data'] }
  /** ADR-040: every pet in the space, sent whenever one of them changed (flag `pets`) */
  | { t: 'pet:state'; pets: PetState[] }
  /** ADR-042: the characters present in the space, sent whenever one of them changed (flag `npcs`) */
  | { t: 'npc:state'; npcs: NpcState[] }
  /** P15.3: a character gestured; sent only to the people a nearby-chat line from it would reach */
  | { t: 'npc:emote'; id: string; emote: NpcEmote }
  /**
   * P15.4: a character said something to `to` (a player id). Sent to exactly the people a
   * nearby-chat line from the character would reach, never `broadcast()`.
   */
  | {
      t: 'npc:say';
      id: string;
      to: string;
      mid: string;
      body: string;
      at: number;
      /** P15.8: the sites a web lookup quoted for this line */
      src?: string[];
    }
  /** P15.4: the character is thinking of an answer (the "…" bubble); same recipients as npc:say */
  | { t: 'npc:typing'; id: string; on: boolean }
  /** P15.4: your Talk message was not taken */
  | { t: 'npc:refused'; id: string; reason: NpcRefusal }
  /** P15.4: whether Talk needs the AI notice and whether you accepted it */
  | { t: 'npc:consent'; consent: NpcConsentState }
  /** P15.5: the character's notes about the person asking (null: nothing kept), answering `npc:recall` */
  | { t: 'npc:memory'; id: string; summary: string | null }
  /** P15.5: every note about me was deleted */
  | { t: 'npc:forgot' }
  /**
   * P15.6: the voice for an `npc:say` line (same `mid`), only to people who asked for voices and
   * are still within reach of the character; Ogg Opus, base64.
   */
  | { t: 'npc:voice'; id: string; mid: string; data: string; ms: number }
  /** P15.3: the brain view (development, space admins): needs and why, nothing about people */
  | { t: 'npc:mind'; brain: 'off' | 'up' | 'down'; minds: NpcMindView[] }
  | { t: 'pong'; at: number }
  | { t: 'error'; code: string };
