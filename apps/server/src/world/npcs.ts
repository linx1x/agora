import {
  ACTIVITY_MINUTES,
  APPROACH_CHOICES,
  APPROACH_QUESTION,
  BUSY_QUESTION,
  GREET_SOCIAL,
  MOODS,
  MOOD_QUESTION,
  NPC_CHAT_COOLDOWN_MS,
  NPC_CHAT_GAP_MS,
  NPC_CHAT_LINES,
  NPC_CHAT_START_P,
  NPC_CHAT_TILES,
  NPC_APPROACH_COOLDOWN_MS,
  NPC_APPROACH_RETHINK_MS,
  NPC_APPROACH_TILES,
  NPC_AVOID_TILES,
  NPC_CANDIDATES,
  NPC_COMMIT_FLOOR_MS,
  NPC_DECIDE_EVERY_MS,
  NPC_GREET_TILES,
  NPC_NEWCOMER_MS,
  NPC_PATH_NODES,
  NPC_SPEED_PX,
  NPC_TALK_HOLD_MS,
  NPC_WALK_UP_TILES,
  TILE,
  anonymize,
  approachable,
  best,
  busyGuess,
  cellOf,
  cellPos,
  clefState,
  defaultSpawn,
  chatKinds,
  driftNeeds,
  fillSlots,
  findPath,
  goalView,
  hashString,
  leaveAlone,
  moodPersona,
  moodState,
  nearestWalkable,
  npcAudience,
  npcChatHasAudience,
  nextQuestion,
  npcAllowedAt,
  npcNearestAllowed,
  npcSpots,
  pickAnswer,
  pickLine,
  pickSpot,
  planWander,
  portalFor,
  regionAt,
  regionSpawn,
  scheduleAt,
  scoreActivities,
  scoreApproach,
  seededRng,
  shiftSchedule,
  startNeeds,
  stepAlong,
  type ApproachChoice,
  type Cell,
  type DecideAnswer,
  type DecideQuestion,
  type Dir,
  type Mood,
  type ScoreWeights,
  type LineBank,
  type Placed,
  type NpcActivity,
  type NpcBlock,
  type NpcMindView,
  type NpcNeeds,
  type NpcEmote,
  type NpcPerson,
  type NpcPersona,
  type NpcSpot,
  type NpcState,
  type Scored,
  type ScheduleActivity,
  type WorldMap,
} from '@agora/shared';
import type { Brain } from '../npc-brain/decide';
import type { MemoryKeeper } from '../npc-brain/memory';
import type { VoiceClient } from '../npc-brain/voice';
import type { TalkEngine } from '../npc-brain/talk';
import type { DecisionLog, DecisionRecord } from '../npc-brain/log';

/** What the characters need to know about the room they live in. */
export interface NpcHost {
  map(): WorldMap;
  /** Bumped by every accepted map edit; spots are searched again when it changes. */
  rev(): number;
  /** Spot keys (`seat:cx,cy`) where a person is sitting right now. */
  takenByPeople(): Set<string>;
  /**
   * Connected people on the open floor. Anyone in a private room, desk pod or quiet zone is
   * left out: characters do not see them, approach them or tell Clef about them.
   */
  people(): NpcPerson[];
}

/** Brain settings shared by the characters of one space. */
export interface NpcBrainLink {
  brain: Brain;
  log?: DecisionLog;
  /** the space id, for the decision log */
  space: string;
}

/**
 * Talking (P15.4, ADR-045): the engine that turns a Talk-box message into a reply, and the AI
 * notice for the cloud model behind it. Absent = the characters do not talk.
 */
export interface NpcTalkLink {
  engine: TalkEngine;
  /** P15.6: spoken replies (flag `npcVoice`); absent = no voices */
  voice?: Pick<VoiceClient, 'speak'>;
  /** P15.5: notes about people (flag `npcMemory`); absent = characters keep nothing */
  memory?: Pick<MemoryKeeper, 'recall' | 'forget'>;
  /** what the notice says; `needed` is false when no model outside the machine is configured */
  notice: { needed: boolean; provider: string; country: string; version: string; web?: boolean };
  consent: {
    /** did this person accept the current notice? */
    has(uid: string): Promise<boolean>;
    set(uid: string, accept: boolean): Promise<void>;
  };
}

/**
 * Social life (P15.5, ADR-046): moods picked by Clef each morning, a character's day kept across
 * restarts, and characters chatting with each other from prepared lines, only while a person is
 * within earshot of the speaker. Absent = none of it.
 */
export interface NpcSocialLink {
  /** the prepared lines of a character (by persona id) */
  bank(id: string): LineBank;
  state: {
    get(npcId: string): Promise<string | null>;
    set(npcId: string, json: string): Promise<void>;
  };
}

/** What a character keeps between restarts. */
export interface NpcSaved {
  day: string;
  mood: Mood;
  needs: NpcNeeds;
}

/** A line one character says to another, for the room to deliver to whoever is in earshot. */
export interface NpcSay {
  from: string;
  to: string;
  x: number;
  y: number;
  body: string;
}

/** Something a character did that people nearby should see (sent per recipient by the room). */
export interface NpcEvent {
  npcId: string;
  x: number;
  y: number;
  emote: NpcEmote;
}

/** A gap between ticks longer than this means the room slept (nobody connected). */
const SLEEP_GAP_MS = 5000;
/** How long a character stays somewhere when touring or wandering (ms). */
const TOUR_STAY_MS: [number, number] = [45_000, 120_000];
const WANDER_STAY_MS: [number, number] = [15_000, 50_000];
/** Pause before trying again after a blocked walk (ms). */
const RETRY_MS = 3000;
/** How long a character stays by someone it waved at (ms). */
const WAVE_HOLD_MS = 6000;
/** A friend character counts when the affinity is at least this. */
const FRIEND_MIN = 0.4;
/** People this close (tiles) are "near" in the state Clef reads. */
const NEAR_TILES = 8;
/** Crowd: people within this many tiles. */
const CROWD_TILES = 5;

interface Goal {
  cell: Cell;
  spot: NpcSpot | null;
  face?: Dir;
}

type Mode = 'stay' | 'walk' | 'leaving';

const dist = (a: { x: number; y: number }, b: { x: number; y: number }) =>
  Math.hypot(a.x - b.x, a.y - b.y) / TILE;
const minutesOf = (r: [number, number], rng: () => number) => r[0] + rng() * (r[1] - r[0]);

/** What the director tells each character about the others. */
interface Cast {
  others: (self: Npc) => Npc[];
}

/**
 * One character (ADR-042, P15.2–P15.3). Its body follows a day: needs run down and get
 * restored, the schedule pulls, and every few seconds, once its last choice has held long
 * enough, it scores what it could do next. Clef picks among the 4 best; the top score wins when
 * Clef is unsure (under NPC_DECIDE_MIN_P), off or down. A person who comes near may be waved at
 * or walked up to (never someone Busy, in DND or away, never the same person twice in
 * 10 minutes), and it keeps its distance from people in Busy or DND. It is never a Player, and
 * never stands in a private room, a desk pod or the quiet zone. No words yet: talking is P15.4.
 */
export class Npc {
  state: NpcState;
  present = false;
  needs: NpcNeeds = { energy: 80, social: 60, focus: 80, caffeine: 60 };
  private path: Cell[] = [];
  private mode: Mode = 'stay';
  private goal: Goal | null = null;
  private teleportTo: string | null = null;
  private moment = '';
  private stayUntil = 0;
  private activity: NpcActivity = 'wander';
  /** chosen because the schedule asked for it (ends when the block changes) or by the mind */
  private source: 'schedule' | 'mind' = 'schedule';
  /** game minute and real time the current choice holds until */
  private commitMin = Infinity;
  private commitMs = 0;
  private nextDecideAt = 0;
  private gen = 0;
  private pendingNext = false;
  private pendingApproach = false;
  private lastMinute: number | null = null;
  private dayKey = '';
  private wraps = 0;
  private daySchedule: NpcBlock[] = [];
  private goalProgress: Record<number, number> = {};
  private recent: Partial<Record<NpcActivity, number>> = {};
  /** person key → when this character last waved at or walked up to them */
  private approached = new Map<string, number>();
  /** person key → when it last considered them (also when it chose to leave them be) */
  private considered = new Map<string, number>();
  private nearBefore = new Set<string>();
  /** the person it is walking up to */
  private target: { key: string; name: string } | null = null;
  /** the friend character it is joining */
  private friendId: string | null = null;
  /** someone in Busy or DND came close: whatever comes next, go somewhere else */
  private moveOn = false;
  private arrivedAt = 0;
  /** someone is talking to it (P15.4): it keeps still and faces them until this real time */
  private talkUntil = 0;
  /** the day's mood (P15.5); bends the persona's numbers for the day, never the file */
  mood: Mood = 'steady';
  private moodToken = 0;
  private lastNext?: NpcMindView['next'];
  private lastApproach?: NpcMindView['approach'];

  constructor(
    public persona: NpcPersona,
    private ctx: {
      host: NpcHost;
      spots: () => NpcSpot[];
      /** spot keys used by people and by the other characters */
      taken: (self: Npc) => Set<string>;
      rng: () => number;
      cast?: Cast;
      link?: NpcBrainLink;
      emit?: (e: NpcEvent) => void;
      /** P15.3b: fitted score weights, read each time it chooses */
      weights?: () => ScoreWeights;
      /** P15.5: pick a mood each morning and restore the saved day */
      social?: { saved: (id: string) => NpcSaved | undefined };
    },
  ) {
    const s = defaultSpawn(ctx.host.map());
    this.state = {
      id: `npc:${persona.id}`,
      name: persona.name,
      avatar: persona.avatar,
      x: s.x,
      y: s.y,
      d: 'down',
      m: false,
      act: 'wander',
    };
  }

  /** The persona as today's mood bends it. */
  private get eff(): NpcPersona {
    return moodPersona(this.persona, this.mood);
  }

  /** What to save so a restart does not reset the day. */
  saved(now: number): NpcSaved {
    return { day: new Date(now).toISOString().slice(0, 10), mood: this.mood, needs: this.needs };
  }

  /** The spot this character is using or heading to (others will not pick it). */
  get goalKey(): string | null {
    return this.present ? (this.goal?.spot?.key ?? null) : null;
  }

  get current(): NpcActivity {
    return this.activity;
  }

  get leaving(): boolean {
    return this.moment === 'leave';
  }

  setPersona(p: NpcPersona) {
    this.persona = p;
    this.state.name = p.name;
    this.state.avatar = p.avatar;
    this.dayKey = ''; // the new schedule (and its daily shift) takes effect now
    this.moment = '';
  }

  private map() {
    return this.ctx.host.map();
  }

  private walkable = (x: number, y: number) => npcAllowedAt(this.map(), x, y);

  /** The day's schedule: arrival and departure shifted a little, from a per-day seed. */
  private schedule(now: number): NpcBlock[] {
    const key = `${Math.floor(now / 86_400_000)}:${this.wraps}`;
    if (key !== this.dayKey) {
      this.dayKey = key;
      this.daySchedule = shiftSchedule(
        this.persona.schedule,
        hashString(`${this.persona.id}:${key}`),
      );
    }
    return this.daySchedule;
  }

  /**
   * Advance to `now`. `minute` is the character's clock (minutes since midnight); `jump` means
   * the room just woke up: the character appears where its schedule puts it, without walking.
   */
  tick(now: number, minute: number, dt: number, jump: boolean) {
    const map = this.map();
    const s = this.state;
    // game minutes since the last tick (the clock wraps at midnight; a jump is not lived time)
    let dMin = this.lastMinute === null ? 0 : minute - this.lastMinute;
    if (dMin < -720) {
      dMin += 1440;
      this.wraps++;
    }
    if (jump || dMin < 0 || dMin > 120) dMin = 0;
    this.lastMinute = minute;
    const m = scheduleAt(this.schedule(now), minute);

    if (m.activity === 'away') {
      if (!this.present) return;
      if (jump || (this.mode === 'stay' && this.moment === 'leave')) {
        this.present = false;
        this.goal = null;
        return;
      }
      if (this.moment !== 'leave') {
        this.moment = 'leave';
        this.talkUntil = 0;
        this.gen++; // drop any answer still on its way
        this.stand();
        this.target = null;
        const exit = defaultSpawn(map);
        this.travel({ cell: cellOf(map, exit.x, exit.y), spot: null }, now);
      }
    } else {
      if (!this.present) {
        this.present = true;
        this.moment = '';
        this.arriveForTheDay(now, minute, m.since);
        const p = npcNearestAllowed(map, ...xy(defaultSpawn(map)));
        s.x = p.x;
        s.y = p.y;
        s.d = 'down';
      }
      const key = `${m.activity}@${m.since}`;
      if (key !== this.moment || jump) {
        const first = this.moment === '';
        this.moment = key;
        if (jump || first) {
          // waking up (or just in): go straight to what the schedule says
          this.begin(m.activity, 'schedule', now, minute, jump);
        } else if (this.source === 'schedule') {
          // the block changed: a choice the schedule made ends now, a detour keeps going
          this.commitMin = minute;
          this.commitMs = now;
          this.nextDecideAt = now;
        }
      }
    }

    if (this.present && !jump) {
      const at = this.mode === 'stay' && this.goal !== null ? this.activity : null;
      this.needs = driftNeeds(this.needs, at, dMin, this.eff);
    }

    // The room under the character changed (a wall went up where it stood): step aside.
    if (!this.walkable(s.x, s.y)) {
      const p = npcNearestAllowed(map, s.x, s.y);
      s.x = p.x;
      s.y = p.y;
      this.stand();
      if (this.moment !== 'leave') this.plan(now, false);
    }

    const talking = now < this.talkUntil && this.moment !== 'leave' && this.mode !== 'leaving';
    if (talking) s.m = false;
    else if (this.mode === 'walk' || this.mode === 'leaving') this.walk(now, minute, dt);
    else if (this.moment !== 'leave') {
      if (now >= this.stayUntil && (this.activity === 'tour' || this.activity === 'wander'))
        this.plan(now, false);
      else this.keepDistance(now);
    }
    if (!this.present || this.moment === 'leave') return;
    // in the middle of a conversation: no new walk-ups, no new choice
    if (talking) return;
    const people = this.ctx.host.people();
    this.considerPeople(now, minute, people);
    this.maybeDecide(now, minute, m.activity === 'away' ? 'wander' : m.activity, people);
  }

  /** New day: fresh needs, no goal progress, nobody greeted yet. */
  private arriveForTheDay(now: number, minute: number, since: number) {
    const rng = seededRng(hashString(`${this.persona.id}:${this.dayKey}:needs`));
    this.needs = startNeeds(this.persona, rng);
    this.mood = 'steady';
    // woken up mid-day: the morning already happened
    const lived = Math.max(0, Math.min(240, minute - since));
    if (lived) this.needs = driftNeeds(this.needs, null, lived / 2, this.persona);
    // the same day after a restart: carry on from what was saved
    const day = new Date(now).toISOString().slice(0, 10);
    const saved = this.ctx.social?.saved(this.persona.id);
    if (saved && saved.day === day) {
      this.needs = saved.needs;
      this.mood = saved.mood;
    } else if (this.ctx.social) this.pickMood(now);
    this.goalProgress = {};
    this.recent = {};
    this.approached.clear();
    this.considered.clear();
    this.nearBefore.clear();
    this.commitMin = minute;
    this.commitMs = now;
  }

  /**
   * Clef picks what kind of day this is (steady unless it is sure). It reads only the persona and
   * the weekday: no people, nothing from the world. Without Clef every day is steady.
   */
  private pickMood(now: number) {
    const brain = this.ctx.link?.brain;
    if (!brain || brain.status !== 'up') return;
    const weekday = new Date(now).toLocaleDateString('en-CA', {
      weekday: 'long',
      timeZone: 'America/Toronto',
    });
    const state = moodState(this.persona, weekday);
    const token = ++this.moodToken;
    void brain.ask(state, { mood: MOOD_QUESTION }).then((answers) => {
      if (!answers || token !== this.moodToken || !this.present) return;
      this.mood = pickAnswer(answers.mood, brain.minP, MOODS, 'steady').value;
    });
  }

  // ───────────────────────────────────────────── choosing
  /** Everything the scoring and Clef need about this moment. */
  private situation(now: number, people: NpcPerson[]) {
    const me = this.state;
    const region = regionAt(this.map(), me.x, me.y);
    const greetable = people
      .filter(
        (p) =>
          approachable(p) &&
          !busyGuess(p) &&
          !this.recently(this.approached, p.key, now, NPC_APPROACH_COOLDOWN_MS) &&
          dist(p, me) <= NPC_GREET_TILES &&
          regionAt(this.map(), p.x, p.y)?.id === region?.id,
      )
      .sort((a, b) => dist(a, me) - dist(b, me));
    const target = greetable[0];
    const friends = (this.ctx.cast?.others(this) ?? [])
      .filter((n) => n.present && !n.leaving)
      .map((n) => ({ n, a: this.persona.friends[n.persona.id] ?? 0 }))
      .filter(
        ({ n, a }) =>
          a >= FRIEND_MIN &&
          regionAt(this.map(), n.state.x, n.state.y)?.id === region?.id &&
          n.current !== 'greet',
      )
      .sort((x, y) => y.a - x.a);
    const friend = friends[0];
    const avoid = people.filter(leaveAlone);
    const taken = this.ctx.taken(this);
    const who = { id: this.persona.id, home: this.persona.home, region: region?.id };
    const unavailable = new Set<NpcActivity>();
    for (const a of ['desk', 'coffee', 'lounge', 'tea', 'water', 'break'] as const)
      if (a !== this.activity && !pickSpot(this.ctx.spots(), a, who, taken, () => 0, avoid))
        unavailable.add(a);
    return {
      region,
      target,
      newcomer: !!target && now - target.joinedAt < NPC_NEWCOMER_MS,
      friend,
      avoid,
      crowd: people.filter((p) => dist(p, me) <= CROWD_TILES).length,
      unavailable,
    };
  }

  private recently(map: Map<string, number>, key: string, now: number, ms: number) {
    const t = map.get(key);
    return t !== undefined && now - t < ms;
  }

  /** Once the last choice has held long enough, score, ask Clef, and start the winner. */
  private maybeDecide(
    now: number,
    minute: number,
    scheduled: ScheduleActivity,
    people: NpcPerson[],
  ) {
    if (this.pendingNext || now < this.nextDecideAt) return;
    if (minute < this.commitMin || now < this.commitMs) return;
    if (this.activity === 'greet' && this.target) return;
    this.nextDecideAt = now + NPC_DECIDE_EVERY_MS;
    const sit = this.situation(now, people);
    const scored = scoreActivities(
      {
        persona: this.eff,
        needs: this.needs,
        minute,
        scheduled,
        current: this.activity,
        goalProgress: this.goalProgress,
        recent: this.recent,
        greet: sit.target ? { newcomer: sit.newcomer } : null,
        friend: sit.friend ? { affinity: sit.friend.a } : null,
        crowd: sit.crowd,
        unavailable: sit.unavailable,
      },
      this.ctx.rng,
      this.ctx.weights?.(),
    );
    if (!scored.length) return;
    const cands = scored.slice(0, NPC_CANDIDATES);
    const brain = this.ctx.link?.brain;
    const apply = (answers: Record<string, DecideAnswer> | null) => {
      const top = cands[0]!.activity;
      const picked = answers
        ? pickAnswer(
            answers.next,
            brain!.minP,
            cands.map((c) => c.activity),
            top,
          )
        : { value: top, sure: false };
      const via = answers ? (picked.sure ? 'clef' : 'unsure') : 'score';
      this.lastNext = {
        via: via === 'clef' ? 'clef' : 'score',
        p: answers?.next?.p,
        chosen: picked.value,
        top: cands.map((c) => ({ a: c.activity, s: Math.round(c.score * 100) / 100 })),
        at: now,
      };
      this.record('next', via, minute, state, cands, answers, { next: picked.value });
      const chosen = picked.value;
      const target = chosen === 'greet' ? sit.target : undefined;
      const friend = chosen === 'friend' ? sit.friend?.n : undefined;
      if (chosen === this.activity && chosen !== 'greet' && chosen !== 'friend' && !this.moveOn) {
        // same again: keep going, no new walk
        this.source = chosen === scheduled ? 'schedule' : 'mind';
        this.commitMin = minute + minutesOf(ACTIVITY_MINUTES[chosen], this.ctx.rng);
        this.commitMs = now + NPC_COMMIT_FLOOR_MS;
        return;
      }
      if (chosen === 'greet' && target) this.target = { key: target.key, name: target.name };
      if (chosen === 'friend' && friend) this.friendId = friend.persona.id;
      this.begin(chosen, chosen === scheduled ? 'schedule' : 'mind', now, minute, false);
    };
    const state = this.clefStateFor(now, minute, scheduled, people, sit);
    if (!brain || brain.status !== 'up' || cands.length < 2) return apply(null);
    this.pendingNext = true;
    const gen = this.gen;
    void brain.ask(state, { next: nextQuestion(cands, scheduled) }).then((answers) => {
      this.pendingNext = false;
      if (gen !== this.gen || !this.present || this.leaving) return;
      apply(answers);
    });
  }

  private clefStateFor(
    now: number,
    minute: number,
    scheduled: ScheduleActivity,
    people: NpcPerson[],
    sit: ReturnType<Npc['situation']>,
    person?: NpcPerson,
  ) {
    const me = this.state;
    const area = this.goal?.spot?.area;
    const place = [sit.region?.nameEn ?? 'corridor', area].filter(Boolean).join(', ');
    const near = [
      ...people
        .filter((p) => dist(p, me) <= NEAR_TILES)
        .map((p) => ({ name: p.name, status: p.status, tiles: dist(p, me) })),
      ...(this.ctx.cast?.others(this) ?? [])
        .filter((n) => n.present && dist(n.state, me) <= NEAR_TILES)
        .map((n) => ({ name: n.persona.name, bot: true, tiles: dist(n.state, me) })),
    ].sort((a, b) => a.tiles - b.tiles);
    return clefState({
      persona: this.persona,
      minute,
      needs: this.needs,
      scheduled,
      doing: this.activity,
      place,
      near,
      greet: sit.target
        ? { name: sit.target.name, newcomer: sit.newcomer, tiles: dist(sit.target, me) }
        : null,
      friend: sit.friend ? { name: sit.friend.n.persona.name, affinity: sit.friend.a } : null,
      person: person
        ? {
            name: person.name,
            status: person.status,
            tiles: dist(person, me),
            sitting: person.sitting,
            group: person.group,
            newcomer: now - person.joinedAt < NPC_NEWCOMER_MS,
          }
        : null,
    });
  }

  /** Write one decision to the local log, with people's names taken out. */
  private record(
    kind: DecisionRecord['kind'],
    via: DecisionRecord['via'],
    minute: number,
    state: ReturnType<typeof clefState>,
    options: Scored[] | Record<string, number>,
    answers: Record<string, DecideAnswer> | null,
    chosen: Record<string, string>,
  ) {
    const log = this.ctx.link?.log;
    if (!log) return;
    const names = [
      ...state.near.filter((n) => !('bot' in n && n.bot)).map((n) => n.name),
      ...(state.greet ? [state.greet.name] : []),
      ...(state.person ? [state.person.name] : []),
    ];
    log.write({
      t: new Date().toISOString(),
      space: this.ctx.link!.space,
      npc: this.persona.id,
      kind,
      via,
      minute: Math.round(minute * 10) / 10,
      state: anonymize(state, names),
      options: Array.isArray(options)
        ? options.map((c) => ({
            id: c.activity,
            score: Math.round(c.score * 1000) / 1000,
            parts: Object.fromEntries(
              Object.entries(c.parts).map(([k, v]) => [k, Math.round((v ?? 0) * 1000) / 1000]),
            ),
          }))
        : Object.entries(options).map(([id, score]) => ({
            id,
            score: Math.round(score * 1000) / 1000,
          })),
      probs: answers
        ? Object.fromEntries(Object.entries(answers).map(([k, a]) => [k, a.probs]))
        : undefined,
      chosen,
    });
  }

  /** Start doing `a`: count it toward goals, then walk there (or appear there on wake). */
  private begin(
    a: NpcActivity,
    source: 'schedule' | 'mind',
    now: number,
    minute: number,
    jump: boolean,
  ) {
    this.gen++;
    this.moveOn = false;
    this.activity = a;
    this.state.act = a;
    this.source = source;
    if (a !== 'greet') this.target = null;
    if (a !== 'friend') this.friendId = null;
    this.recent[a] = minute;
    this.persona.goals.forEach((g, i) => {
      if (goalView(g).pushes.includes(a)) this.goalProgress[i] = (this.goalProgress[i] ?? 0) + 1;
    });
    // holds until it gets there, then for the activity's time (see arrive)
    this.commitMin = Infinity;
    this.commitMs = Infinity;
    this.plan(now, jump, minute);
  }

  // ───────────────────────────────────────────── people
  /**
   * Someone came within `NPC_APPROACH_TILES`: ignore, wave, or walk up? Only available people on
   * the open floor (the host never passes anyone else), never twice in 10 minutes, and never
   * when the busy decision says to leave them alone.
   */
  private considerPeople(now: number, minute: number, people: NpcPerson[]) {
    const me = this.state;
    const near = new Set<string>();
    let fresh: NpcPerson | undefined;
    for (const p of people) {
      if (dist(p, me) > NPC_APPROACH_TILES) continue;
      near.add(p.key);
      if (!this.nearBefore.has(p.key) && !fresh) fresh = p;
    }
    this.nearBefore = near;
    if (!fresh || this.pendingApproach || this.activity === 'greet') return;
    if (this.mode === 'leaving' || this.teleportTo) return;
    if (!approachable(fresh)) return;
    if (this.recently(this.approached, fresh.key, now, NPC_APPROACH_COOLDOWN_MS)) return;
    if (this.recently(this.considered, fresh.key, now, NPC_APPROACH_RETHINK_MS)) return;
    this.considered.set(fresh.key, now);
    const person = fresh;
    const atDesk = this.activity === 'desk' && this.mode === 'stay';
    const scores = scoreApproach({ persona: this.eff, needs: this.needs, atDesk }, this.ctx.rng);
    const brain = this.ctx.link?.brain;
    const sched = scheduleAt(this.daySchedule, minute).activity;
    const scheduled: ScheduleActivity = sched === 'away' ? 'wander' : sched;
    const state = this.clefStateFor(
      now,
      minute,
      scheduled,
      people,
      this.situation(now, people),
      person,
    );
    const apply = (answers: Record<string, DecideAnswer> | null) => {
      let choice: ApproachChoice;
      let busy: boolean;
      let via: DecisionRecord['via'];
      if (answers) {
        const a = pickAnswer(answers.approach, brain!.minP, APPROACH_CHOICES, 'ignore');
        const b = pickAnswer(answers.busy, brain!.minP, ['yes', 'no'] as const, 'yes');
        choice = a.value;
        busy = b.value === 'yes';
        via = a.sure && b.sure ? 'clef' : 'unsure';
      } else {
        choice = best(scores);
        busy = busyGuess(person);
        via = 'score';
      }
      // whatever the answers, a status change in the meantime wins
      const now2 = this.ctx.host.people().find((p) => p.key === person.key);
      if (busy || !now2 || !approachable(now2)) choice = 'ignore';
      this.lastApproach = {
        via: via === 'clef' ? 'clef' : 'score',
        p: answers?.approach?.p,
        choice,
        busy,
        at: now,
      };
      this.record('approach', via, minute, state, scores, answers, {
        approach: choice,
        busy: busy ? 'yes' : 'no',
      });
      if (choice === 'ignore' || !this.present || this.leaving) return;
      this.approached.set(person.key, now);
      if (choice === 'wave') {
        this.face(now2!);
        this.wave();
        return;
      }
      this.target = { key: person.key, name: person.name };
      this.begin('greet', 'mind', now, minute, false);
    };
    if (!brain || brain.status !== 'up') return apply(null);
    this.pendingApproach = true;
    const questions: Record<string, DecideQuestion> = {
      approach: APPROACH_QUESTION,
      busy: BUSY_QUESTION,
    };
    void brain.ask(state, questions).then((answers) => {
      this.pendingApproach = false;
      if (!this.present || this.leaving) return;
      apply(answers);
    });
  }

  private wave() {
    this.needs = { ...this.needs, social: Math.min(100, this.needs.social + GREET_SOCIAL) };
    this.gesture('wave');
  }

  /** Make a gesture people nearby can see (sent by the room, per recipient). */
  gesture(emote: NpcEmote) {
    this.ctx.emit?.({ npcId: this.state.id, x: this.state.x, y: this.state.y, emote });
  }

  /**
   * Someone is talking to this character (P15.4): it stops where it is, faces them and holds
   * still for a while after each message, then carries on. False when it is not around or on its
   * way home. Being talked to is company.
   */
  attend(p: { x: number; y: number }, now: number, holdMs = NPC_TALK_HOLD_MS): boolean {
    if (!this.present || this.moment === 'leave' || this.mode === 'leaving') return false;
    this.talkUntil = now + holdMs;
    this.state.m = false;
    this.face(p);
    this.needs = { ...this.needs, social: Math.min(100, this.needs.social + 3) };
    return true;
  }

  /** Standing here and free: not walking, not leaving, nobody holding it in a conversation. */
  canChat(now: number): boolean {
    return this.present && this.mode === 'stay' && this.moment !== 'leave' && now >= this.talkUntil;
  }

  /** Still here and not on its way home (a chat already holds it, so `talkUntil` is not checked). */
  canChatWith(_now: number): boolean {
    return this.present && this.mode !== 'leaving' && this.moment !== 'leave';
  }

  /** Walk to a place because someone asked (the "show the way" requests of P15.4). */
  errand(a: NpcActivity, now: number): boolean {
    if (!this.present || this.moment === 'leave' || this.mode === 'leaving') return false;
    this.talkUntil = 0;
    this.begin(a, 'mind', now, this.lastMinute ?? 0, false);
    return true;
  }

  private face(p: { x: number; y: number }) {
    const dx = p.x - this.state.x;
    const dy = p.y - this.state.y;
    if (this.state.p === 'sit') return; // seated: wave from the chair
    this.state.d =
      Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? 'right' : 'left') : dy > 0 ? 'down' : 'up';
  }

  /** Standing around within reach of someone in Busy or DND: move on. */
  private keepDistance(now: number) {
    if (this.state.p === 'sit' || this.activity === 'greet') return;
    const close = this.ctx.host
      .people()
      .some((p) => leaveAlone(p) && dist(p, this.state) < NPC_AVOID_TILES - 1);
    if (close && !this.moveOn && now - this.arrivedAt >= RETRY_MS) {
      this.moveOn = true;
      this.commitMs = now;
      this.commitMin = 0;
      this.nextDecideAt = now;
      if (this.activity === 'tour' || this.activity === 'wander') this.stayUntil = now;
    }
  }

  // ───────────────────────────────────────────── moving
  /** A free cell about `NPC_WALK_UP_TILES` from `p`, on the side nearest the character. */
  private beside(p: { x: number; y: number }): Cell | null {
    const map = this.map();
    const me = this.state;
    let bestCell: Cell | null = null;
    let bestD = Infinity;
    const c = cellOf(map, p.x, p.y);
    const r = NPC_WALK_UP_TILES;
    for (let dy = -r; dy <= r; dy++)
      for (let dx = -r; dx <= r; dx++) {
        const d = Math.hypot(dx, dy);
        if (d < 1 || d > r + 0.5) continue;
        const cell = { cx: c.cx + dx, cy: c.cy + dy };
        if (cell.cx < 0 || cell.cy < 0 || cell.cx >= map.width || cell.cy >= map.height) continue;
        const q = cellPos(map, cell);
        if (!this.walkable(q.x, q.y)) continue;
        const score = Math.abs(d - r) * 2 * TILE + Math.hypot(q.x - me.x, q.y - me.y);
        if (score < bestD) {
          bestD = score;
          bestCell = cell;
        }
      }
    return bestCell;
  }

  /** Choose where the current activity takes the character and set off (or appear there). */
  private plan(now: number, jump: boolean, _minute?: number) {
    const map = this.map();
    const me = cellOf(map, this.state.x, this.state.y);
    const avoid = this.ctx.host.people().filter(leaveAlone);
    let goal: Goal | null = null;
    const a = this.activity;
    if (a === 'greet' && this.target) {
      const p = this.ctx.host.people().find((q) => q.key === this.target!.key);
      const cell = p && this.beside(p);
      if (cell) goal = { cell, spot: null };
      else this.target = null;
    } else if (a === 'friend' && this.friendId) {
      const f = this.ctx.cast?.others(this).find((n) => n.persona.id === this.friendId);
      const cell = f?.present ? this.beside(f.state) : null;
      if (cell) goal = { cell, spot: null };
    } else if (a === 'tour') {
      const here = regionAt(map, this.state.x, this.state.y)?.id;
      const others = map.regions.filter((r) => r.id !== here);
      const r = others[Math.floor(this.ctx.rng() * others.length)];
      const spawn = r && regionSpawn(map, r.id);
      if (spawn) {
        const j = () => (this.ctx.rng() - 0.5) * 6 * map.tile;
        const p = npcNearestAllowed(map, spawn.x + j(), spawn.y + j());
        goal = { cell: cellOf(map, p.x, p.y), spot: null };
      }
    } else if (a !== 'wander' && a !== 'greet' && a !== 'friend') {
      this.goal = null; // free our own spot before choosing
      const region = regionAt(map, this.state.x, this.state.y)?.id;
      const spot = pickSpot(
        this.ctx.spots(),
        a,
        { ...this.persona, region },
        this.ctx.taken(this),
        this.ctx.rng,
        avoid,
      );
      if (spot) goal = { cell: spot.cell, spot, face: spot.face };
    }
    if (!goal) {
      const near = (c: Cell) => {
        const p = cellPos(map, c);
        return avoid.some((q) => dist(q, p) < NPC_AVOID_TILES) ? 1 : 0;
      };
      const path = planWander(
        map,
        me,
        this.ctx.rng,
        (x, y) => !this.walkable(x, y),
        6,
        avoid.length ? near : undefined,
      );
      const end = path?.[path.length - 1];
      goal = end ? { cell: end, spot: null } : null;
    }
    if (!goal) return this.settle(now);
    if (jump) {
      const p = cellPos(map, goal.cell);
      this.state.x = p.x;
      this.state.y = p.y;
      this.goal = goal;
      this.path = [];
      return this.arrive(now);
    }
    this.travel(goal, now);
  }

  /** Walk to `goal`, through a teleporter first when it is in another wing. */
  private travel(goal: Goal, now: number) {
    const map = this.map();
    this.stand();
    this.goal = goal;
    const here = regionAt(map, this.state.x, this.state.y)?.id;
    const target = cellPos(map, goal.cell);
    const there = regionAt(map, target.x, target.y)?.id;
    let dest = goal.cell;
    this.teleportTo = null;
    if (here && there && here !== there) {
      const pad = portalFor(map, here, there);
      if (pad) {
        dest = pad;
        this.teleportTo = there;
      }
    }
    const blocked = (x: number, y: number) => !this.walkable(x, y);
    const me = cellOf(map, this.state.x, this.state.y);
    // never through a pod or a private room, even on the way to a teleporter
    if (this.teleportTo) dest = nearestWalkable(map, dest, blocked) ?? dest;
    const path = findPath(map, me, dest, blocked, NPC_PATH_NODES);
    if (!path) {
      this.goal = null;
      this.teleportTo = null;
      return this.settle(now, RETRY_MS);
    }
    this.path = path;
    this.mode = this.moment === 'leave' ? 'leaving' : 'walk';
    this.state.m = path.length > 0;
    if (!path.length) this.onPathEnd(now);
  }

  private walk(now: number, _minute: number, dt: number) {
    const s = this.state;
    const r = stepAlong(this.map(), s, this.path, dt, this.walkable, NPC_SPEED_PX);
    s.x = r.x;
    s.y = r.y;
    if (r.d) s.d = r.d;
    if (r.stopped) {
      // something new is in the way: pause, then choose again
      this.path = [];
      this.teleportTo = null;
      return this.settle(now, RETRY_MS);
    }
    s.m = this.path.length > 0;
    if (!this.path.length) this.onPathEnd(now);
  }

  private onPathEnd(now: number) {
    const map = this.map();
    if (this.teleportTo) {
      const there = this.teleportTo;
      this.teleportTo = null;
      const spawn = regionSpawn(map, there);
      if (spawn && this.goal) {
        const p = npcNearestAllowed(map, spawn.x, spawn.y);
        this.state.x = p.x;
        this.state.y = p.y;
        return this.travel(this.goal, now);
      }
    }
    if (this.mode === 'leaving') {
      this.mode = 'stay';
      this.state.m = false;
      return;
    }
    this.arrive(now);
  }

  /** At the goal: sit on a chair, face the counter or the water, wave at someone, or just stand. */
  private arrive(now: number) {
    const s = this.state;
    const g = this.goal;
    this.mode = 'stay';
    this.arrivedAt = now;
    s.m = false;
    if (g?.face) s.d = g.face;
    if (g?.spot?.sit) s.p = 'sit';
    const [lo, hi] = this.activity === 'tour' ? TOUR_STAY_MS : WANDER_STAY_MS;
    this.stayUntil = now + lo + this.ctx.rng() * (hi - lo);
    const minute = this.lastMinute ?? 0;
    this.commitMin = minute + minutesOf(ACTIVITY_MINUTES[this.activity], this.ctx.rng);
    this.commitMs = now + NPC_COMMIT_FLOOR_MS;
    if (this.activity === 'greet') {
      const p = this.target && this.ctx.host.people().find((q) => q.key === this.target!.key);
      // still there, still available, still within reach: wave; then carry on with the day
      if (p && approachable(p) && dist(p, s) <= NPC_APPROACH_TILES) {
        this.face(p);
        this.wave();
        this.approached.set(p.key, now);
      }
      this.target = null;
      this.commitMin = minute;
      this.commitMs = now + WAVE_HOLD_MS;
    } else if (this.activity === 'friend' && this.friendId) {
      const f = this.ctx.cast?.others(this).find((n) => n.persona.id === this.friendId);
      if (f) this.face(f.state);
    }
  }

  private settle(now: number, ms?: number) {
    this.mode = 'stay';
    this.state.m = false;
    this.path = [];
    const [lo, hi] = WANDER_STAY_MS;
    this.stayUntil = now + (ms ?? lo + this.ctx.rng() * (hi - lo));
    // could not get there: reconsider soon
    if (this.commitMin === Infinity) {
      this.commitMin = this.lastMinute ?? 0;
      this.commitMs = now + (ms ?? RETRY_MS);
      if (this.activity === 'greet') this.target = null;
    }
  }

  private stand() {
    delete this.state.p;
  }

  /** What the brain view shows (dev and admins): needs, activity, why. Nothing about people. */
  view(): NpcMindView {
    const r = (v: number) => Math.round(v);
    return {
      id: this.state.id,
      needs: {
        energy: r(this.needs.energy),
        social: r(this.needs.social),
        focus: r(this.needs.focus),
        caffeine: r(this.needs.caffeine),
      },
      act: this.activity,
      mood: this.mood,
      until: Number.isFinite(this.commitMin) ? Math.round(this.commitMin) : -1,
      next: this.lastNext,
      approach: this.lastApproach,
    };
  }
}

/**
 * Characters talking to each other (P15.5, ADR-046; audience rule from ADR-043). Costs nothing: the
 * lines come from the prepared banks, never a model, and no decision is asked of Clef. A chat starts
 * only when two free characters stand close and a person is within earshot of both
 * (`npcChatHasAudience`), each line is said only if someone is within earshot of its speaker
 * (`npcAudience`), and the chat ends the moment nobody is. One chat at a time per space.
 */
export class NpcChatter {
  private chat: {
    a: Npc;
    b: Npc;
    kinds: ReturnType<typeof chatKinds>;
    i: number;
    next: number;
  } | null = null;
  private cooldown = new Map<string, number>();
  private nextCheck = 0;
  readonly says: NpcSay[] = [];
  readonly stats = { started: 0, lines: 0, endedUnheard: 0 };

  constructor(
    private bank: (id: string) => LineBank,
    private rng: () => number,
  ) {}

  private placed = (n: Npc): Placed => ({ id: n.state.id, x: n.state.x, y: n.state.y });
  private pairKey = (a: Npc, b: Npc) => [a.state.id, b.state.id].sort().join('|');

  tick(now: number, npcs: Npc[], people: Placed[]) {
    if (this.chat) return this.step(now, people);
    if (now < this.nextCheck || !people.length) return; // nobody to hear: no check at all
    this.nextCheck = now + 2000;
    const here = npcs.filter((n) => n.canChat(now));
    for (let i = 0; i < here.length; i++)
      for (let j = i + 1; j < here.length; j++) {
        const a = here[i]!;
        const b = here[j]!;
        if (dist(a.state, b.state) > NPC_CHAT_TILES) continue;
        if ((this.cooldown.get(this.pairKey(a, b)) ?? 0) > now) continue;
        if (!npcChatHasAudience(this.placed(a), this.placed(b), people)) continue;
        if (this.rng() >= NPC_CHAT_START_P) continue;
        this.chat = { a, b, kinds: chatKinds(NPC_CHAT_LINES), i: 0, next: now };
        this.cooldown.set(this.pairKey(a, b), now + NPC_CHAT_COOLDOWN_MS);
        this.stats.started++;
        return this.step(now, people);
      }
  }

  private step(now: number, people: Placed[]) {
    const c = this.chat!;
    const end = () => (this.chat = null);
    if (
      !c.a.canChatWith(now) ||
      !c.b.canChatWith(now) ||
      dist(c.a.state, c.b.state) > NPC_CHAT_TILES + 1
    )
      return end();
    if (now < c.next) return;
    const [speaker, other] = c.i % 2 === 0 ? [c.a, c.b] : [c.b, c.a];
    // no one within earshot of the speaker: this line is not said, and the chat is over
    if (!npcAudience(this.placed(speaker), people).length) {
      this.stats.endedUnheard++;
      return end();
    }
    const kind = c.kinds[c.i]!;
    const line = pickLine(this.bank(speaker.persona.id), kind, 'fr', this.rng);
    if (line) {
      const gap = NPC_CHAT_GAP_MS[0] + this.rng() * (NPC_CHAT_GAP_MS[1] - NPC_CHAT_GAP_MS[0]);
      const hold = NPC_CHAT_GAP_MS[1] + 2000;
      speaker.attend(other.state, now, hold);
      other.attend(speaker.state, now, hold);
      this.says.push({
        from: speaker.state.id,
        to: other.state.id,
        x: speaker.state.x,
        y: speaker.state.y,
        body: fillSlots(line, { name: other.persona.name }),
      });
      this.stats.lines++;
      c.next = now + gap;
    }
    c.i++;
    if (c.i >= c.kinds.length) end();
  }
}

const xy = (p: { x: number; y: number }): [number, number] => [p.x, p.y];

/**
 * The characters of one space. Ticked by the room only while someone is connected; after a sleep
 * each character jumps to where its schedule says it should be.
 */
export class NpcDirector {
  private npcs = new Map<string, Npc>();
  private last = 0;
  private sent = '';
  private cache: { rev: number; spots: NpcSpot[] } | null = null;
  private events: NpcEvent[] = [];
  private people: NpcPerson[] | null = null;
  /** the room as the characters see it: people listed once per tick, not once per question */
  private seen: NpcHost;

  constructor(
    private host: NpcHost,
    personas: NpcPersona[],
    private clock: (now: number) => number,
    private rng: () => number = Math.random,
    private link?: NpcBrainLink,
    private social?: NpcSocialLink & { space?: string },
    private weights?: () => ScoreWeights,
  ) {
    this.seen = { ...host, people: () => (this.people ??= host.people()) };
    if (social) this.chatter = new NpcChatter(social.bank, rng);
    this.setPersonas(personas);
  }

  private chatter?: NpcChatter;
  private saved = new Map<string, NpcSaved>();
  private savedAt = 0;

  /** Load what the characters kept from an earlier run (once, before the first tick). */
  async load(personaIds: string[]) {
    if (!this.social) return;
    for (const id of personaIds) {
      try {
        const raw = await this.social.state.get(id);
        const j = raw ? (JSON.parse(raw) as Partial<NpcSaved>) : null;
        if (j && typeof j.day === 'string' && j.mood && MOODS.includes(j.mood) && j.needs)
          this.saved.set(id, j as NpcSaved);
      } catch {
        /* a bad or missing state is a fresh day */
      }
    }
  }

  /** What the characters said to each other since the last call, for the room to deliver. */
  takeSays(): NpcSay[] {
    if (!this.chatter?.says.length) return [];
    return this.chatter.says.splice(0);
  }

  get chatStats() {
    return this.chatter?.stats;
  }

  private spots = (): NpcSpot[] => {
    const rev = this.host.rev();
    if (this.cache?.rev !== rev) this.cache = { rev, spots: npcSpots(this.host.map()) };
    return this.cache.spots;
  };

  private taken = (self: Npc): Set<string> => {
    const out = this.host.takenByPeople();
    for (const n of this.npcs.values()) {
      const k = n !== self ? n.goalKey : null;
      if (k) out.add(k);
    }
    return out;
  };

  private cast: Cast = { others: (self) => [...this.npcs.values()].filter((n) => n !== self) };

  /** Apply the current cast: new files add characters, removed ones leave at once. */
  setPersonas(list: NpcPersona[]) {
    const ids = new Set(list.map((p) => p.id));
    for (const id of [...this.npcs.keys()]) if (!ids.has(id)) this.npcs.delete(id);
    for (const p of list) {
      const n = this.npcs.get(p.id);
      if (!n)
        this.npcs.set(
          p.id,
          new Npc(p, {
            host: this.seen,
            spots: this.spots,
            taken: this.taken,
            rng: this.rng,
            cast: this.cast,
            link: this.link,
            emit: (e) => this.events.push(e),
            social: this.social ? { saved: (pid) => this.saved.get(pid) } : undefined,
            weights: this.weights,
          }),
        );
      else if (n.persona !== p) n.setPersona(p);
    }
  }

  get all(): Npc[] {
    return [...this.npcs.values()];
  }

  /** A character by its id (`npc:zoe`), only while it is in the office. */
  get(id: string): Npc | undefined {
    const n = [...this.npcs.values()].find((q) => q.state.id === id);
    return n?.present ? n : undefined;
  }

  /** Advance every character to `now`. Returns true when what browsers see changed. */
  tick(now: number): boolean {
    const jump = !this.last || now - this.last > SLEEP_GAP_MS;
    const dt = jump ? 0 : Math.min((now - this.last) / 1000, 0.25);
    this.last = now;
    this.people = null;
    const minute = this.clock(now);
    for (const n of this.npcs.values()) n.tick(now, minute, dt, jump);
    if (this.chatter && !jump) {
      const here = this.all.filter((n) => n.present);
      this.chatter.tick(
        now,
        here,
        this.seen.people().map((p) => ({ id: p.key, x: p.x, y: p.y })),
      );
    }
    this.saveSometimes(now);
    return this.dirty();
  }

  /** The day so far, once a minute, so a restart does not send everyone back to a fresh morning. */
  private saveSometimes(now: number) {
    if (!this.social || now - this.savedAt < 60_000) return;
    this.savedAt = now;
    for (const n of this.npcs.values())
      if (n.present)
        void this.social.state
          .set(n.persona.id, JSON.stringify(n.saved(now)))
          .catch(() => undefined);
  }

  /** What the characters did since the last call (waves), for the room to send nearby. */
  takeEvents(): NpcEvent[] {
    const out = this.events;
    this.events = [];
    return out;
  }

  private dirty(): boolean {
    const key = this.snapshot()
      .map(
        (s) =>
          `${s.id}|${s.x}|${s.y}|${s.d}|${s.m}|${s.p ?? ''}|${s.act}|${s.name}|${JSON.stringify(s.avatar)}`,
      )
      .join(';');
    if (key === this.sent) return false;
    this.sent = key;
    return true;
  }

  /** The characters present, as browsers draw them. */
  snapshot(): NpcState[] {
    return this.all
      .filter((n) => n.present)
      .map((n) => {
        const s = n.state;
        return { ...s, x: Math.round(s.x * 10) / 10, y: Math.round(s.y * 10) / 10 };
      });
  }

  /** The brain view of the characters present (dev, admins). */
  minds(): NpcMindView[] {
    return this.all.filter((n) => n.present).map((n) => n.view());
  }

  get brainStatus() {
    return this.link?.brain.status ?? 'off';
  }
}
