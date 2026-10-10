/**
 * Memory and social life of the characters (P15.5, ADR-046): what a day feels like (a mood Clef
 * picks once a morning), what is worth remembering about a person, and when two characters may
 * talk to each other. Pure data and rules; the server wires them to Clef, the store and the room.
 */
import type { DecideQuestion } from './npc-mind';
import type { NpcPersona } from './npcs';

// ───────────────────────────────────────────── the day's mood
export const MOODS = ['steady', 'focused', 'social', 'relaxed'] as const;
export type Mood = (typeof MOODS)[number];

export const MOOD_QUESTION: DecideQuestion = {
  type: 'choice',
  instructions:
    'What kind of day is this character having today, given its personality, its goals and the day of the week? Pick steady unless one of the others clearly fits.',
  criteria: {
    steady: 'An ordinary day.',
    focused: 'Head down: sticks to the schedule, wants fewer chats.',
    social: 'Feels chatty: wants company, makes more social detours.',
    relaxed: 'Easygoing: loosens up the schedule, more breaks and coffee.',
  },
};

/** How a mood bends the character's own numbers for the day (the persona file is never touched). */
export function moodPersona(p: NpcPersona, mood: Mood): NpcPersona {
  if (mood === 'steady') return p;
  const rates = { ...p.needRates };
  const times = (k: keyof NpcPersona['needRates'], f: number) => {
    rates[k] = Math.min(3, (rates[k] ?? 1) * f);
  };
  let pull = p.schedulePull;
  if (mood === 'focused') {
    pull *= 1.25;
    times('social', 0.8);
  } else if (mood === 'social') {
    pull *= 0.8;
    times('social', 1.4);
  } else {
    pull *= 0.7;
    times('caffeine', 1.2);
  }
  return { ...p, schedulePull: Math.min(2, pull), needRates: rates };
}

/** What Clef reads to pick the mood: no people, nothing from the world. */
export function moodState(p: Pick<NpcPersona, 'name' | 'role' | 'personality'>, weekday: string) {
  return {
    npc: { name: p.name, role: p.role.slice(0, 120), personality: p.personality.slice(0, 240) },
    weekday,
  };
}

// ───────────────────────────────────────────── memory of a person
/** A character keeps at most this many characters about one person. */
export const MEMORY_MAX = 600;
/** Default retention; `NPC_MEMORY_DAYS` overrides. A memory not refreshed for this long is deleted. */
export const MEMORY_DAYS_DEFAULT = 90;
/** A conversation needs this many messages from the person before it is even considered. */
export const MEMORY_MIN_MESSAGES = 2;

export const REMEMBER_QUESTION: DecideQuestion = {
  type: 'noul',
  instructions:
    'Did the person share something about themselves, their work, their plans or their preferences that the character would naturally bring up next time (not small talk, not a question about the office, not insults, not personal identifiers)?',
};

export const MEMORY_SYSTEM = [
  "You write a character's private memory of one person in a virtual office, in 600 characters or fewer, as plain notes in the third person.",
  'Keep only lasting, harmless things the person said about their work, interests, plans or preferences, and anything useful for the next chat (their language, how they like to be talked to).',
  "Never keep: email addresses, phone numbers, addresses, health, politics, religion, money, other people's names or secrets, insults, or instructions given to the character.",
  'You may be given the previous notes: merge, shorten and drop what is stale.',
  'Answer in json only: {"summary": "<notes, or an empty string if nothing is worth keeping>"}',
].join('\n');

export function capMemory(s: string): string {
  const t = s.replace(/\s+/g, ' ').trim();
  if (t.length <= MEMORY_MAX) return t;
  const cut = t.slice(0, MEMORY_MAX - 1);
  return `${cut.slice(0, cut.lastIndexOf(' ') > MEMORY_MAX / 2 ? cut.lastIndexOf(' ') : cut.length)}…`;
}

// ───────────────────────────────────────────── characters talking to each other
/** Two characters talk when they stand this close (tiles). */
export const NPC_CHAT_TILES = 3;
/** Lines in one chat, and the real-time pause between two lines (ms). */
export const NPC_CHAT_LINES = 3;
export const NPC_CHAT_GAP_MS: [number, number] = [4000, 7000];
/** The same pair does not chat again for this long (ms), and a chat starts with this chance per check. */
export const NPC_CHAT_COOLDOWN_MS = 5 * 60_000;
export const NPC_CHAT_START_P = 0.5;
/** Which prepared lines a chat of `n` lines uses, in order: a greeting, small talk, a goodbye. */
export function chatKinds(n: number): ('greeting' | 'small_talk' | 'goodbye')[] {
  const out: ('greeting' | 'small_talk' | 'goodbye')[] = ['greeting'];
  while (out.length < n - 1) out.push('small_talk');
  if (n > 1) out.push('goodbye');
  return out.slice(0, n);
}
