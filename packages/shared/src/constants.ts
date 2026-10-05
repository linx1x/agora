/** World and media constants shared by client and server. Distances in tiles unless noted. */
export const TILE = 32;
/** Walking speed in tiles per second. */
export const SPEED_TPS = 4;
export const SPEED_PX = SPEED_TPS * TILE;
/** Client → server move rate and server snapshot rate (Hz). */
export const MOVE_SEND_HZ = 15;
export const TICK_HZ = 15;
/** Proximity media (ARCHITECTURE §5). */
export const FULL_R = 1.5;
export const CONNECT_R = 5;
export const DISCONNECT_R = 6;
/** Nearby chat radius on the open floor. */
export const NEARBY_CHAT_R = 6;
/** Max simultaneous video tiles shown. */
export const VIDEO_CAP = 9;
/** Feet hitbox in px, anchored at the avatar's feet (x = centre, y = bottom). */
export const FEET_W = 16;
export const FEET_H = 10;
/** Remote avatar interpolation delay (ms). */
export const INTERP_MS = 100;
export const MAX_CHAT_LEN = 1000;
export const MAX_NAME_LEN = 40;
export const HISTORY_SIZE = 200;
export const EMOTES = ['wave', 'thumbs', 'heart', 'laugh', 'hand', 'clap'] as const;
export type Emote = (typeof EMOTES)[number];
export const EMOTE_GLYPH: Record<Emote, string> = {
  wave: '👋',
  thumbs: '👍',
  heart: '❤️',
  laugh: '😂',
  hand: '✋',
  clap: '👏',
};
export const EMOTE_MS = 3000;
export const STATUSES = ['available', 'busy', 'dnd', 'away'] as const;
export type Status = (typeof STATUSES)[number];
export const DIRS = ['down', 'left', 'right', 'up'] as const;
export type Dir = (typeof DIRS)[number];
