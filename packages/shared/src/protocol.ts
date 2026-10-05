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
import { DESK_ACCESS, DeskDecorSchema, type DeskState } from './desks';
import { CellChangeSchema, MAX_EDIT_CELLS, type CellChange, type EditRefusal } from './edit';

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
    cells: z.array(CellChangeSchema).min(1).max(MAX_EDIT_CELLS),
  }),
  /** Build mode: replace the live map with the generated hq.tmj. */
  z.object({ t: z.literal('map:reset') }),
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
  | { t: 'map:edit'; rev: number; by: string; op: number; changes: CellChange[] }
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
  /**
   * SFU backend (ADR-031): the media rooms the server places me in, with fresh
   * tokens (used when (re)connecting; a live connection is kept). `zone` null =
   * leave any zone room; `publish` = the only room I may send my microphone,
   * camera and screen to.
   */
  | {
      t: 'media:grant';
      url: string;
      floor: MediaRoomGrant;
      zone: MediaRoomGrant | null;
      publish: 'floor' | 'zone' | 'none';
    }
  | { t: 'rtc'; from: string; data: Extract<C2SMsg, { t: 'rtc' }>['data'] }
  | { t: 'pong'; at: number }
  | { t: 'error'; code: string };
