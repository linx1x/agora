import { distTiles, falloff } from '@agora/shared';
import { rendered } from '../game/controller';
import { store } from '../state/store';
import { media } from './MediaManager';

/** At most this many clips waiting; a newer one is dropped (the text is on screen anyway). */
const MAX_QUEUE = 2;
let queue: { url: string; volume: number }[] = [];
let playing = false;

function next() {
  const item = queue.shift();
  if (!item) {
    playing = false;
    return;
  }
  playing = true;
  const audio = new Audio(item.url);
  audio.volume = item.volume;
  const done = () => {
    URL.revokeObjectURL(item.url);
    next();
  };
  audio.addEventListener('ended', done, { once: true });
  audio.addEventListener('error', done, { once: true });
  void media.applySink(audio).then(() => audio.play().catch(done));
}

/**
 * A character's voice (`npc:voice`, P15.6). The server only sends it to people who asked for voices
 * and are in reach; the volume follows the same falloff as people's voices, by how far the character
 * stands now. Off with the setting, whatever arrives.
 */
export function playNpcVoice(m: { id: string; data: string }) {
  const s = store.get();
  if (!s.settings.npcVoices) return;
  const npc = s.npcs.find((n) => n.id === m.id);
  const me = s.me ? rendered.get(s.me) : undefined;
  const kind = s.myZone?.kind;
  const volume =
    kind === 'private' || kind === 'desk' || !npc || !me
      ? 1
      : falloff(distTiles(me, npc), 1.5, s.config?.connectR ?? 5);
  if (volume < 0.02) return;
  if (queue.length >= MAX_QUEUE) return;
  try {
    const bin = atob(m.data);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    queue.push({ url: URL.createObjectURL(new Blob([bytes], { type: 'audio/ogg' })), volume });
  } catch {
    return;
  }
  if (!playing) next();
}

/** Stop everything (the person turned voices off, or left). */
export function stopNpcVoices() {
  for (const q of queue) URL.revokeObjectURL(q.url);
  queue = [];
}
