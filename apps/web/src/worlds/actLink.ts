/**
 * The world's action queue, wired to the realtime link (P17.21b, ADR-053). The server's answers
 * (`world:acted`, `world:refused`) close the intents they are about; every entry into a world
 * (`world:welcome`, also after a reconnect) sends the unanswered intents of that world again with
 * their own keys, so the server applies each one once.
 */
import type { C2SMsg } from '@agora/shared';
import { world as link } from '../net/client';
import { ActQueue } from './inputActs';
import { worldSession } from './session';

/** A v4-style UUID. crypto.randomUUID is missing on plain http pages, so it is built from random bytes there. */
function newKey(): string {
  if (typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  const b = crypto.getRandomValues(new Uint8Array(16));
  b[6] = (b[6]! & 0x0f) | 0x40;
  b[8] = (b[8]! & 0x3f) | 0x80;
  const hex = Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

/** The one action queue of this browser tab. */
export const worldActs = new ActQueue({
  send: (m: C2SMsg) => link.send(m),
  newKey,
});

link.on((m) => {
  if (m.t === 'world:acted' || m.t === 'world:refused') worldActs.answer(m.op);
});

worldSession.on((change) => {
  if (change === 'welcome' && worldSession.worldId !== null) worldActs.resend(worldSession.worldId);
});
