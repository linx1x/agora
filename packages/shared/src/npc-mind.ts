/**
 * A character's mind (P15.3, ADR-042, ADR-044): needs that run down and get restored, a schedule
 * that pulls, traits, goals and surroundings, all scored as pure functions. Every few seconds the
 * server scores what a character could do next; Clef-flash picks among the 4 best (`nextQuestion`)
 * and the top score wins when Clef is unsure or off. Nothing here talks to a model, a clock or a
 * socket: tests drive it with a seeded random source.
 */
import type { Status } from './constants';
import {
  NPC_NEEDS,
  parseHHMM,
  type NpcBlock,
  type NpcActivity,
  type NpcGoal,
  type NpcNeed,
  type NpcNeeds,
  type NpcPersona,
  type ScheduleActivity,
} from './npcs';

// ───────────────────────────────────────────── timing
/** How often a character free to choose asks itself what to do next (real ms). */
export const NPC_DECIDE_EVERY_MS = 5000;
/** A choice holds at least this long in real time, whatever the dev clock speed (no flicker). */
export const NPC_COMMIT_FLOOR_MS = 15_000;
/** How many of the best-scored activities Clef chooses among. */
export const NPC_CANDIDATES = 4;
/** A person who comes this close (tiles) may be approached. */
export const NPC_APPROACH_TILES = 6;
/** Never walk up to (or wave at) the same person twice within this time (real ms). */
export const NPC_APPROACH_COOLDOWN_MS = 10 * 60_000;
/** After deciding to leave someone alone, do not ask again about them for this long (real ms). */
export const NPC_APPROACH_RETHINK_MS = 60_000;
/** Going to greet someone: only people within this many tiles, in the same wing. */
export const NPC_GREET_TILES = 12;
/** Someone who joined within this time is a newcomer, worth a greeting (real ms). */
export const NPC_NEWCOMER_MS = 5 * 60_000;
/** Distance (tiles) a character stops at when it walks up to someone. */
export const NPC_WALK_UP_TILES = 2;
/** People within this many tiles of someone make a group: they are probably talking. */
export const NPC_GROUP_TILES = 3;

/**
 * How long (game minutes) a character keeps to what it chose before it reconsiders. Activities
 * at a place count from arrival; `greet` ends with the wave.
 */
export const ACTIVITY_MINUTES: Record<NpcActivity, [number, number]> = {
  desk: [15, 25],
  lounge: [10, 20],
  coffee: [4, 8],
  tea: [6, 10],
  water: [8, 15],
  tour: [15, 25],
  wander: [4, 8],
  break: [3, 6],
  greet: [1, 1],
  friend: [4, 8],
};

// ───────────────────────────────────────────── random
/** A small seeded random source (mulberry32), so scoring and tests are reproducible. */
export function seededRng(seed: number): () => number {
  let a = seed >>> 0 || 0x9e3779b9;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const clamp = (v: number, lo = 0, hi = 100) => Math.min(hi, Math.max(lo, v));
const trait = (p: { traits: Record<string, number> }, k: string, d = 0.5) => p.traits[k] ?? d;

/** Daily spread of arrival and departure (game minutes, ±). */
export const NPC_DAY_SHIFT = 10;

/**
 * The day's schedule: arrive and leave move by up to ±10 minutes, from a seed that changes each
 * day (so a character is not a clock), everything else stays as written. Pure.
 */
export function shiftSchedule(schedule: NpcBlock[], seed: number): NpcBlock[] {
  const rng = seededRng(seed);
  const shift = (at: string) => {
    const m = Math.min(
      1439,
      Math.max(0, parseHHMM(at) + Math.round((rng() - 0.5) * 2 * NPC_DAY_SHIFT)),
    );
    return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
  };
  return schedule.map((b) =>
    'at' in b && (b.do === 'arrive' || b.do === 'leave') ? { ...b, at: shift(b.at) } : b,
  );
}

// ───────────────────────────────────────────── needs
/** How much each need runs down per game minute, before the persona's `needRates`. */
export const NEED_DRAIN: NpcNeeds = { energy: 0.1, social: 0.15, focus: 0.3, caffeine: 0.3 };

/**
 * What an activity gives back per game minute while the character is at it (on top of the
 * drain). Walking somewhere counts as wandering. `greet` gives its social boost at the wave.
 */
export const ACTIVITY_EFFECT: Record<NpcActivity, Partial<NpcNeeds>> = {
  desk: { focus: 1.2, social: -0.05, energy: -0.05 },
  coffee: { caffeine: 8, social: 0.6, energy: 0.3 },
  tea: { caffeine: 4, energy: 0.6, focus: 0.3 },
  lounge: { energy: 0.6, social: 0.5 },
  water: { energy: 0.5, focus: 0.4 },
  tour: { social: 0.4 },
  wander: {},
  break: { energy: 0.4, focus: 0.5 },
  greet: {},
  friend: { social: 1 },
};
/** Social boost of one greeting. */
export const GREET_SOCIAL = 15;

/** A character's needs on arrival: a night owl comes in tired; a little different every day. */
export function startNeeds(p: Pick<NpcPersona, 'traits'>, rng: () => number): NpcNeeds {
  const owl = trait(p, 'nightOwl', 0.3);
  const j = () => (rng() - 0.5) * 10;
  return {
    energy: clamp(90 - 25 * owl + j()),
    social: clamp(60 + j()),
    focus: clamp(80 + j()),
    caffeine: clamp(70 - 20 * owl + j()),
  };
}

/** Drain multiplier of a need for this persona: extroverts get lonely faster, focused people restless. */
export function drainRate(p: Pick<NpcPersona, 'traits' | 'needRates'>, n: NpcNeed): number {
  const base =
    n === 'social' ? 0.5 + trait(p, 'extrovert') : n === 'focus' ? 0.5 + trait(p, 'focus') : 1;
  return base * (p.needRates[n] ?? 1);
}

/**
 * Needs after `minutes` of game time spent at `activity` (null = walking or waiting). The drain
 * always applies; focus only drains away from the desk. Pure.
 */
export function driftNeeds(
  needs: NpcNeeds,
  activity: NpcActivity | null,
  minutes: number,
  p: Pick<NpcPersona, 'traits' | 'needRates'>,
): NpcNeeds {
  if (minutes <= 0) return needs;
  const eff = activity ? ACTIVITY_EFFECT[activity] : {};
  const out = { ...needs };
  for (const n of NPC_NEEDS) {
    const drain = n === 'focus' && activity === 'desk' ? 0 : NEED_DRAIN[n] * drainRate(p, n);
    out[n] = clamp(needs[n] + ((eff[n] ?? 0) - drain) * minutes);
  }
  return out;
}

/** 0 when satisfied, 1 when empty; squared, so a need only weighs once it gets low. */
export const urgency = (v: number) => ((100 - clamp(v)) / 100) ** 2;

/** Which needs make an activity attractive, and how much. */
export const NEED_WEIGHTS: Record<NpcActivity, Partial<NpcNeeds>> = {
  desk: { focus: 1 },
  coffee: { caffeine: 2, social: 0.3 },
  tea: { caffeine: 0.9, energy: 0.5 },
  lounge: { energy: 0.9, social: 0.5 },
  water: { energy: 0.6, focus: 0.3 },
  tour: { social: 0.6 },
  wander: {},
  break: { energy: 0.5, focus: 0.4 },
  greet: { social: 0.9 },
  friend: { social: 0.9 },
};

// ───────────────────────────────────────────── goals
export interface GoalView {
  text: string;
  pushes: NpcActivity[];
  weight: number;
}

/** A goal from the file: a plain sentence pushes nothing (it is for the brain's words). */
export function goalView(g: NpcGoal): GoalView {
  return typeof g === 'string' ? { text: g, pushes: [], weight: 0 } : g;
}

// ───────────────────────────────────────────── scoring
/** What a character knows when it chooses. */
export interface MindInput {
  persona: Pick<NpcPersona, 'traits' | 'goals' | 'schedulePull'>;
  needs: NpcNeeds;
  /** game minute of the day */
  minute: number;
  /** what the schedule asks for now (`wander` in free time) */
  scheduled: ScheduleActivity;
  /** what it is doing now, if anything */
  current: NpcActivity | null;
  /** per goal (index in `persona.goals`), how many times today it was pushed forward */
  goalProgress: Record<number, number>;
  /** game minute each activity was last done today */
  recent: Partial<Record<NpcActivity, number>>;
  /** someone it may go and greet (nearby, available, not greeted lately) */
  greet: { newcomer: boolean } | null;
  /** a friend character in the same wing, and how close they are (0–1) */
  friend: { affinity: number } | null;
  /** people within 5 tiles */
  crowd: number;
  /** activities with nowhere to go on this map right now */
  unavailable: ReadonlySet<NpcActivity>;
}

export interface Scored {
  activity: NpcActivity;
  score: number;
  /** what made the score, for the brain view and the decision log */
  parts: Partial<Record<ScorePart, number>>;
}
export type ScorePart =
  'schedule' | 'needs' | 'traits' | 'goals' | 'people' | 'inertia' | 'repeat' | 'jitter';

/**
 * The parts a fitted weight can scale (P15.3b); random jitter never is. A part's value in
 * `Scored.parts` and in the decision log is always the raw one, so a log can be fitted again.
 */
export const WEIGHT_PARTS = [
  'schedule',
  'needs',
  'traits',
  'goals',
  'people',
  'inertia',
  'repeat',
] as const;
export type WeightPart = (typeof WEIGHT_PARTS)[number];
export type ScoreWeights = Partial<Record<WeightPart, number>>;

/** Pull of the activity the schedule asks for (× the persona's `schedulePull`). */
export const SCHEDULE_PULL = 1;
/** In free time the schedule only nudges toward wandering. */
export const FREE_TIME_PULL = 0.35;
/** Bonus for keeping on with the current activity, so close scores do not flip back and forth. */
export const INERTIA = 0.15;
/** Penalty for doing a break-like activity again within `REPEAT_MINUTES`. */
export const REPEAT_PENALTY = 0.35;
export const REPEAT_MINUTES = 30;
/** Random spread added to each score (± half). */
export const JITTER = 0.1;

/** The activities a character weighs. */
export const CHOOSABLE: readonly NpcActivity[] = [
  'desk',
  'coffee',
  'lounge',
  'tea',
  'water',
  'tour',
  'wander',
  'break',
  'greet',
  'friend',
];

/**
 * Score every activity a character could do next. Higher is better; impossible ones (no target,
 * no place) are left out. Sorted best first. Pure: the same input and random source give the
 * same answer.
 */
export function scoreActivities(
  m: MindInput,
  rng: () => number,
  weights: ScoreWeights = {},
): Scored[] {
  const p = m.persona;
  const e = trait(p, 'extrovert');
  const f = trait(p, 'focus');
  const owl = trait(p, 'nightOwl', 0.3);
  const goals = p.goals.map(goalView);
  // a tea drinker (trait `tea`, 0–1) gets its caffeine from tea rather than coffee
  const tea = trait(p, 'tea', 0);
  const brew = (a: NpcActivity) =>
    a === 'coffee' ? 1 - 0.6 * tea : a === 'tea' ? 1 + 1.3 * tea : 1;
  const out: Scored[] = [];
  for (const a of CHOOSABLE) {
    if (m.unavailable.has(a)) continue;
    if (a === 'greet' && !m.greet) continue;
    if (a === 'friend' && !m.friend) continue;
    const parts: Scored['parts'] = {};
    if (a === m.scheduled)
      parts.schedule = (a === 'wander' ? FREE_TIME_PULL : SCHEDULE_PULL) * p.schedulePull;
    let needs = 0;
    for (const [n, w] of Object.entries(NEED_WEIGHTS[a]) as [NpcNeed, number][])
      needs += w * urgency(m.needs[n]) * (n === 'caffeine' ? brew(a) : 1);
    if (needs) parts.needs = needs;
    let tr = 0;
    if (a === 'greet') tr += 0.4 * e + 0.1;
    if (a === 'friend') tr += 0.3 * e;
    if (a === 'lounge' || a === 'tour') tr += 0.15 * e;
    if (a === 'desk') tr += 0.2 * f + 0.1 * (1 - e);
    if (a === 'water') tr += 0.15 * (1 - e);
    if (m.minute < 600 && a === 'desk') tr -= 0.25 * owl;
    if (m.minute < 600 && a === 'coffee') tr += 0.2 * owl * (1 - tea);
    if (tr) parts.traits = tr;
    let g = 0;
    goals.forEach((goal, i) => {
      if (goal.pushes.includes(a)) g += goal.weight / (1 + (m.goalProgress[i] ?? 0));
    });
    if (g) parts.goals = g;
    let people = 0;
    if (a === 'greet' && m.greet?.newcomer) people += 0.4;
    if (a === 'friend' && m.friend) people += 0.4 * m.friend.affinity;
    const crowd = Math.min(m.crowd, 5);
    if (a === 'lounge' || a === 'coffee' || a === 'tour' || a === 'greet')
      people += 0.03 * e * crowd - 0.06 * (1 - e) * crowd;
    if (people) parts.people = people;
    if (a === m.current) parts.inertia = INERTIA;
    const last = m.recent[a];
    if (
      last !== undefined &&
      a !== 'desk' &&
      a !== m.scheduled &&
      a !== m.current &&
      m.minute - last < REPEAT_MINUTES &&
      m.minute >= last
    )
      parts.repeat = -REPEAT_PENALTY;
    parts.jitter = (rng() - 0.5) * JITTER;
    const score = (Object.entries(parts) as [ScorePart, number][]).reduce(
      (s, [k, v]) => s + (v ?? 0) * (k === 'jitter' ? 1 : (weights[k] ?? 1)),
      0,
    );
    out.push({ activity: a, score, parts });
  }
  return out.sort((x, y) => y.score - x.score);
}

// ───────────────────────────────────────────── approaching people
/** A person as a character sees them. Only people on the open floor are ever passed in. */
export interface NpcPerson {
  /** stable per account, never sent anywhere */
  key: string;
  /** first name only */
  name: string;
  x: number;
  y: number;
  status: Status;
  sitting: boolean;
  /** when they joined (real ms) */
  joinedAt: number;
  /** other people within `NPC_GROUP_TILES` of them */
  group: number;
}

/** May a character go up to this person at all? Available only: never Busy, DND or Away. */
export const approachable = (p: Pick<NpcPerson, 'status'>) => p.status === 'available';

/** Who a character keeps its distance from (Busy and Do Not Disturb). */
export const leaveAlone = (p: Pick<NpcPerson, 'status'>) =>
  p.status === 'busy' || p.status === 'dnd';

/** The rule a character uses when Clef cannot say: a status other than available, or a group. */
export const busyGuess = (p: Pick<NpcPerson, 'status' | 'group'>) =>
  p.status !== 'available' || p.group >= 2;

export const APPROACH_CHOICES = ['ignore', 'wave', 'walk_up'] as const;
export type ApproachChoice = (typeof APPROACH_CHOICES)[number];

/**
 * Scores for what to do when an available person comes near (the fallback when Clef is off).
 * Outgoing characters walk up, calm ones at their desk let people be.
 */
export function scoreApproach(
  m: { persona: Pick<NpcPersona, 'traits' | 'goals'>; needs: NpcNeeds; atDesk: boolean },
  rng: () => number,
): Record<ApproachChoice, number> {
  const e = trait(m.persona, 'extrovert');
  const f = trait(m.persona, 'focus');
  const greets = m.persona.goals.map(goalView).some((g) => g.pushes.includes('greet'));
  const j = () => (rng() - 0.5) * JITTER;
  return {
    walk_up:
      0.15 +
      0.5 * e +
      0.5 * urgency(m.needs.social) +
      (greets ? 0.2 : 0) -
      (m.atDesk ? 0.35 * f : 0) +
      j(),
    wave: 0.5 + j(),
    ignore: 0.3 + (m.atDesk ? 0.3 * f : 0) + 0.2 * (1 - e) + j(),
  };
}

export const best = <K extends string>(scores: Record<K, number>): K =>
  (Object.entries(scores) as [K, number][]).sort((a, b) => b[1] - a[1])[0]![0];

// ───────────────────────────────────────────── Clef questions
/** A Clef question (Jev API): yes/no, pick one, or an ordered scale. */
export type DecideQuestion =
  | { type: 'noul'; instructions: string }
  | { type: 'choice'; instructions?: string; criteria: Record<string, string> }
  | { type: 'score'; instructions?: string; criteria: string[] };

/** One answer from `decide()`: the top option, its probability and every option's. */
export interface DecideAnswer {
  top: string;
  p: number;
  probs: Record<string, number>;
}

/** Plain-English descriptions for Clef (its documented language); the state carries the details. */
export const ACTIVITY_TEXT: Record<NpcActivity, string> = {
  desk: 'Work at its desk.',
  coffee: 'Walk to the kitchen for a coffee.',
  lounge: 'Relax in the lounge.',
  tea: 'Make tea in the Zen garden.',
  water: 'Take a walk by the water.',
  tour: 'Tour another wing of the office.',
  wander: 'Wander around nearby.',
  break: 'Take a short break by a window or a plant.',
  greet: 'Go and greet the person nearby (see state.greet).',
  friend: 'Go and join its friend (see state.friend).',
};

/** The "what next" question over the best candidates; option ids are activity names. */
export function nextQuestion(cands: Scored[], scheduled: ScheduleActivity): DecideQuestion {
  const criteria: Record<string, string> = {};
  for (const c of cands)
    criteria[c.activity] =
      ACTIVITY_TEXT[c.activity] +
      (c.activity === scheduled ? ' Its schedule asks for this now.' : '');
  return {
    type: 'choice',
    instructions:
      'Which activity should the character do next? Respect its schedule unless a need is strong, and stay in character.',
    criteria,
  };
}

export const APPROACH_QUESTION: DecideQuestion = {
  type: 'choice',
  instructions:
    'A person came near the character (see state.person). What should the character do, given its personality and what it is doing?',
  criteria: {
    ignore: 'Leave them be and carry on.',
    wave: 'Wave from where it is.',
    walk_up: 'Walk up to them and say hi.',
  },
};

export const BUSY_QUESTION: DecideQuestion = {
  type: 'noul',
  instructions:
    'Is the person in state.person busy right now (status, talking in a group, just sat down to work), so the character should leave them alone?',
};

/**
 * The safe-default rule (ADR-042): an answer counts only when its top option reaches `minP`;
 * otherwise the decision's own default applies.
 */
export function pickAnswer<T extends string>(
  a: DecideAnswer | undefined,
  minP: number,
  allowed: readonly T[],
  fallback: T,
): { value: T; sure: boolean } {
  if (a && a.p >= minP && (allowed as readonly string[]).includes(a.top))
    return { value: a.top as T, sure: true };
  return { value: fallback, sure: false };
}

const hhmm = (minute: number) => {
  const m = Math.floor(((minute % 1440) + 1440) % 1440);
  return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
};

/**
 * The compact situation Clef reads (ADR-042): persona summary, needs, time, place, what it is
 * doing, the schedule, and who is near by first name and status. Only Clef on the local machine
 * reads it; the decision log keeps a copy without names (`anonymize`).
 */
export function clefState(s: {
  persona: Pick<NpcPersona, 'name' | 'role' | 'personality' | 'traits' | 'goals'>;
  minute: number;
  needs: NpcNeeds;
  scheduled: ScheduleActivity;
  doing: NpcActivity | null;
  place: string;
  near: { name: string; bot?: boolean; status?: Status; tiles: number }[];
  greet?: { name: string; newcomer: boolean; tiles: number } | null;
  friend?: { name: string; affinity: number } | null;
  person?: {
    name: string;
    status: Status;
    tiles: number;
    sitting: boolean;
    group: number;
    newcomer: boolean;
  } | null;
}) {
  const r = (v: number) => Math.round(v);
  return {
    npc: {
      name: s.persona.name,
      role: s.persona.role.slice(0, 120),
      personality: s.persona.personality.slice(0, 240),
      traits: s.persona.traits,
      goals: s.persona.goals.map((g) => goalView(g).text.slice(0, 100)),
    },
    time: hhmm(s.minute),
    schedule: s.scheduled,
    doing: s.doing ?? 'nothing',
    place: s.place,
    needs: Object.fromEntries(NPC_NEEDS.map((n) => [n, r(s.needs[n])])),
    near: s.near.slice(0, 6).map((n) => ({ ...n, tiles: r(n.tiles) })),
    ...(s.greet ? { greet: { ...s.greet, tiles: r(s.greet.tiles) } } : {}),
    ...(s.friend ? { friend: s.friend } : {}),
    ...(s.person ? { person: { ...s.person, tiles: r(s.person.tiles) } } : {}),
  };
}

/**
 * The same state with every person's name replaced by `person 1`, `person 2`…, for the local
 * decision log (characters keep their names: they are not people).
 */
export function anonymize<T>(state: T, people: string[]): T {
  const names = [...new Set(people)].filter(Boolean);
  if (!names.length) return state;
  const swap = (v: unknown): unknown => {
    if (typeof v === 'string') {
      const i = names.indexOf(v);
      return i >= 0 ? `person ${i + 1}` : v;
    }
    if (Array.isArray(v)) return v.map(swap);
    if (v && typeof v === 'object')
      return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, swap(x)]));
    return v;
  };
  return swap(state) as T;
}

/** What browsers with the brain view (dev, admins) see of one character. Nothing about people. */
export interface NpcMindView {
  id: string;
  needs: NpcNeeds;
  act: NpcActivity;
  /** today's mood (P15.5), absent when social life is off */
  mood?: 'steady' | 'focused' | 'social' | 'relaxed';
  /** game minute the current choice holds until */
  until: number;
  /** the last "what next" decision */
  next?: {
    via: 'clef' | 'score';
    /** Clef's probability for its answer (when via clef or when Clef was unsure) */
    p?: number;
    chosen: NpcActivity;
    top: { a: NpcActivity; s: number }[];
    at: number;
  };
  /** the last approach decision, without who it was about */
  approach?: {
    via: 'clef' | 'score';
    p?: number;
    choice: ApproachChoice;
    busy: boolean;
    at: number;
  };
}
