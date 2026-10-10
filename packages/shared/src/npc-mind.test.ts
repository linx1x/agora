import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { TILE } from './constants';
import { cellPos, parseMap, zoneAt, type Tmj } from './map';
import {
  ACTIVITY_MINUTES,
  APPROACH_QUESTION,
  BUSY_QUESTION,
  CHOOSABLE,
  anonymize,
  approachable,
  best,
  busyGuess,
  clefState,
  driftNeeds,
  goalView,
  leaveAlone,
  nextQuestion,
  pickAnswer,
  scoreActivities,
  scoreApproach,
  seededRng,
  shiftSchedule,
  startNeeds,
  urgency,
  type MindInput,
} from './npc-mind';
import {
  NPC_FORBIDDEN,
  NpcPersonaSchema,
  npcSpots,
  pickSpot,
  scheduleAt,
  spotNear,
  type NpcNeeds,
  type NpcPersona,
} from './npcs';
import { petSpots } from './pets';

const map = parseMap(
  JSON.parse(readFileSync(new URL('../../maps/hq.tmj', import.meta.url), 'utf8')) as Tmj,
);

const persona = (over: Partial<NpcPersona> = {}): NpcPersona =>
  NpcPersonaSchema.parse({
    id: 'test',
    name: 'Test',
    avatar: { skin: 0, hair: 0, hairColor: 0, top: 0, bottom: 0, accessory: 0 },
    home: 'jungle',
    schedule: [{ at: '09:00', do: 'arrive' }],
    ...over,
  });

const calm = persona({ traits: { extrovert: 0.3, focus: 0.9, nightOwl: 0.3 } });
const hyped = persona({
  traits: { extrovert: 0.95, focus: 0.4, nightOwl: 0.1 },
  goals: [{ text: 'Greet everyone', pushes: ['greet'], weight: 0.25 }],
});

const ok: NpcNeeds = { energy: 80, social: 70, focus: 80, caffeine: 70 };

const input = (over: Partial<MindInput> = {}): MindInput => ({
  persona: calm,
  needs: ok,
  minute: 10 * 60 + 30,
  scheduled: 'desk',
  current: 'desk',
  goalProgress: {},
  recent: {},
  greet: null,
  friend: null,
  crowd: 0,
  unavailable: new Set(),
  ...over,
});

/** How often `activity` comes out on top over many seeds. */
function share(m: MindInput, activity: string, runs = 200) {
  let n = 0;
  for (let s = 1; s <= runs; s++)
    if (scoreActivities(m, seededRng(s))[0]!.activity === activity) n++;
  return n / runs;
}

describe('seeded random source', () => {
  it('repeats with the same seed and differs with another', () => {
    const a = seededRng(42);
    const b = seededRng(42);
    const c = seededRng(43);
    const xs = [a(), a(), a()];
    expect([b(), b(), b()]).toEqual(xs);
    expect(c()).not.toBe(xs[0]);
    for (const x of xs) expect(x >= 0 && x < 1).toBe(true);
  });
});

describe('needs', () => {
  it('run down over time, faster for an extrovert’s social need', () => {
    const later = driftNeeds(ok, null, 60, calm);
    expect(later.caffeine).toBeLessThan(ok.caffeine);
    expect(later.energy).toBeLessThan(ok.energy);
    const lonely = driftNeeds(ok, null, 60, hyped);
    expect(lonely.social).toBeLessThan(later.social);
  });

  it('are restored by the matching activity: coffee fills caffeine, the desk focus', () => {
    const low = { ...ok, caffeine: 20, focus: 30 };
    expect(driftNeeds(low, 'coffee', 5, calm).caffeine).toBeGreaterThan(50);
    expect(driftNeeds(low, 'desk', 20, calm).focus).toBeGreaterThan(low.focus);
    // focus does not run down at the desk, it does elsewhere
    expect(driftNeeds(low, 'lounge', 20, calm).focus).toBeLessThan(low.focus);
  });

  it('stay between 0 and 100, and a persona can slow a need down', () => {
    const empty = driftNeeds(ok, null, 10_000, calm);
    for (const v of Object.values(empty)) expect(v).toBe(0);
    const full = driftNeeds(ok, 'coffee', 10_000, calm);
    expect(full.caffeine).toBe(100);
    const slow = persona({ ...calm, needRates: { caffeine: 0.2 } });
    expect(driftNeeds(ok, null, 60, slow).caffeine).toBeGreaterThan(
      driftNeeds(ok, null, 60, calm).caffeine,
    );
  });

  it('start each day a little differently; a night owl comes in tired', () => {
    const owl = persona({ traits: { nightOwl: 0.9 } });
    const lark = persona({ traits: { nightOwl: 0.1 } });
    expect(startNeeds(owl, seededRng(1)).energy).toBeLessThan(
      startNeeds(lark, seededRng(1)).energy,
    );
    expect(startNeeds(calm, seededRng(1))).not.toEqual(startNeeds(calm, seededRng(2)));
  });

  it('weigh only once they get low (squared urgency)', () => {
    expect(urgency(100)).toBe(0);
    expect(urgency(0)).toBe(1);
    expect(urgency(50)).toBeCloseTo(0.25);
  });
});

describe('scoring: schedule, needs, traits, goals, surroundings', () => {
  it('mostly follows the schedule when needs are fine', () => {
    expect(share(input(), 'desk')).toBeGreaterThan(0.95);
    expect(share(input({ scheduled: 'lounge', current: null }), 'lounge')).toBeGreaterThan(0.95);
  });

  it('a strong need makes a short detour; a mild one does not', () => {
    expect(share(input({ needs: { ...ok, caffeine: 10 } }), 'coffee')).toBeGreaterThan(0.9);
    expect(share(input({ needs: { ...ok, caffeine: 45 } }), 'coffee')).toBe(0);
  });

  it('a tea drinker takes tea for its caffeine, others coffee', () => {
    const teaLover = persona({ traits: { extrovert: 0.3, focus: 0.5, tea: 0.9 } });
    const m = { scheduled: 'wander' as const, current: null, needs: { ...ok, caffeine: 10 } };
    expect(share(input({ ...m, persona: teaLover }), 'tea')).toBeGreaterThan(0.9);
    expect(share(input({ ...m, persona: calm }), 'coffee')).toBeGreaterThan(0.9);
  });

  it('a strict persona (schedulePull 2) stays at the desk even when caffeine is low', () => {
    const strict = persona({ ...calm, schedulePull: 2 });
    expect(share(input({ persona: strict, needs: { ...ok, caffeine: 10 } }), 'desk')).toBe(1);
  });

  it('free time lets needs lead', () => {
    const m = input({ scheduled: 'wander', current: null, needs: { ...ok, energy: 25 } });
    const top = scoreActivities(m, seededRng(3))[0]!.activity;
    expect(['lounge', 'tea', 'water', 'break']).toContain(top);
  });

  it('an extrovert goes to greet a newcomer, a calm character at its desk does not', () => {
    const m = { greet: { newcomer: true }, needs: { ...ok, social: 50 } };
    expect(share(input({ ...m, persona: hyped }), 'greet')).toBeGreaterThan(0.6);
    expect(share(input({ ...m, persona: calm }), 'greet')).toBe(0);
  });

  it('cannot greet without someone to greet, nor join a friend who is not there', () => {
    const acts = scoreActivities(input({ persona: hyped }), seededRng(1)).map((s) => s.activity);
    expect(acts).not.toContain('greet');
    expect(acts).not.toContain('friend');
  });

  it('a goal pushes its activity, less each time it was done today', () => {
    const fresh = scoreActivities(
      input({ persona: hyped, greet: { newcomer: false } }),
      seededRng(1),
    );
    const done = scoreActivities(
      input({ persona: hyped, greet: { newcomer: false }, goalProgress: { 0: 3 } }),
      seededRng(1),
    );
    const g = (l: typeof fresh) => l.find((s) => s.activity === 'greet')!.parts.goals ?? 0;
    expect(g(fresh)).toBeCloseTo(0.25);
    expect(g(done)).toBeCloseTo(0.0625);
  });

  it('a night owl is slow at the desk and wants coffee before 10:00', () => {
    const owl = persona({ traits: { nightOwl: 1, extrovert: 0.5, focus: 0.5 } });
    const early = scoreActivities(input({ persona: owl, minute: 9 * 60 }), seededRng(1));
    const late = scoreActivities(input({ persona: owl, minute: 11 * 60 }), seededRng(1));
    const s = (l: typeof early, a: string) => l.find((x) => x.activity === a)!.score;
    expect(s(early, 'desk')).toBeLessThan(s(late, 'desk'));
    expect(s(early, 'coffee')).toBeGreaterThan(s(late, 'coffee'));
  });

  it('does not repeat a break-like activity within 30 minutes', () => {
    const m = input({ scheduled: 'wander', current: null, needs: { ...ok, energy: 30 } });
    const before = scoreActivities(m, seededRng(5)).find((s) => s.activity === 'lounge')!;
    const after = scoreActivities({ ...m, recent: { lounge: m.minute - 10 } }, seededRng(5)).find(
      (s) => s.activity === 'lounge',
    )!;
    expect(after.score).toBeCloseTo(before.score - 0.35);
  });

  it('leaves out activities with nowhere to go, and is reproducible with a seed', () => {
    const m = input({ unavailable: new Set(['tea', 'water']) });
    const a = scoreActivities(m, seededRng(9));
    expect(a.map((s) => s.activity)).not.toContain('tea');
    expect(a).toEqual(scoreActivities(m, seededRng(9)));
    expect(a.map((s) => s.score)).toEqual([...a.map((s) => s.score)].sort((x, y) => y - x));
  });

  it('every activity has a duration, and a plain-text goal pushes nothing', () => {
    for (const a of CHOOSABLE) expect(ACTIVITY_MINUTES[a][0]).toBeGreaterThan(0);
    expect(goalView('Juste une phrase').pushes).toEqual([]);
  });
});

describe('the day’s schedule', () => {
  it('moves arrival and departure by at most 10 minutes, the rest stays', () => {
    const sched = persona({
      schedule: [
        { at: '09:00', do: 'arrive' },
        { from: '09:30', to: '12:00', do: 'desk' },
        { at: '17:00', do: 'leave' },
      ],
    }).schedule;
    const days = [1, 2, 3, 4, 5].map((d) => shiftSchedule(sched, d));
    const arrivals = new Set(days.map((s) => (s[0] as { at: string }).at));
    expect(arrivals.size).toBeGreaterThan(1);
    for (const s of days) {
      const a = scheduleAt(s, 8 * 60 + 49);
      expect(a.activity).toBe('away');
      expect(scheduleAt(s, 9 * 60 + 11).activity).not.toBe('away');
      expect(s[1]).toEqual(sched[1]);
    }
  });
});

describe('approaching people', () => {
  const person = { status: 'available' as const, group: 0 };
  it('only available people are approached; Busy and DND are left alone', () => {
    expect(approachable(person)).toBe(true);
    for (const status of ['busy', 'dnd', 'away'] as const)
      expect(approachable({ ...person, status })).toBe(false);
    expect(leaveAlone({ status: 'dnd' })).toBe(true);
    expect(leaveAlone({ status: 'busy' })).toBe(true);
    expect(leaveAlone({ status: 'available' })).toBe(false);
  });

  it('guesses busy from the status or a group of two or more', () => {
    expect(busyGuess(person)).toBe(false);
    expect(busyGuess({ ...person, group: 2 })).toBe(true);
    expect(busyGuess({ ...person, status: 'busy' })).toBe(true);
  });

  it('the hyped one walks up, the calm one at its desk lets people be', () => {
    const n = { ...ok, social: 50 };
    expect(best(scoreApproach({ persona: hyped, needs: n, atDesk: true }, seededRng(1)))).toBe(
      'walk_up',
    );
    expect(best(scoreApproach({ persona: calm, needs: n, atDesk: true }, seededRng(1)))).toBe(
      'ignore',
    );
    expect(best(scoreApproach({ persona: calm, needs: n, atDesk: false }, seededRng(1)))).toBe(
      'wave',
    );
  });
});

describe('Clef questions and answers', () => {
  it('asks "what next" over the candidates, marking the scheduled one', () => {
    const cands = scoreActivities(input(), seededRng(1)).slice(0, 4);
    const q = nextQuestion(cands, 'desk');
    expect(q.type).toBe('choice');
    if (q.type !== 'choice') return;
    expect(Object.keys(q.criteria)).toEqual(cands.map((c) => c.activity));
    expect(q.criteria.desk).toMatch(/schedule/);
    expect(APPROACH_QUESTION.type).toBe('choice');
    expect(BUSY_QUESTION.type).toBe('noul');
  });

  it('uses an answer only when sure enough and allowed; else the safe default', () => {
    const a = (top: string, p: number) => ({ top, p, probs: { [top]: p } });
    expect(pickAnswer(a('coffee', 0.8), 0.7, ['desk', 'coffee'], 'desk')).toEqual({
      value: 'coffee',
      sure: true,
    });
    expect(pickAnswer(a('coffee', 0.6), 0.7, ['desk', 'coffee'], 'desk')).toEqual({
      value: 'desk',
      sure: false,
    });
    expect(pickAnswer(a('fly', 0.99), 0.7, ['desk', 'coffee'], 'desk').value).toBe('desk');
    expect(pickAnswer(undefined, 0.7, ['desk'], 'desk').sure).toBe(false);
  });

  it('the state carries first names for Clef, the log copy carries none', () => {
    const state = clefState({
      persona: hyped,
      minute: 9 * 60 + 5,
      needs: ok,
      scheduled: 'desk',
      doing: 'desk',
      place: 'Jungle',
      near: [
        { name: 'Vincent', status: 'available', tiles: 4.2 },
        { name: 'Félix', bot: true, tiles: 8 },
      ],
      person: {
        name: 'Vincent',
        status: 'available',
        tiles: 4.2,
        sitting: false,
        group: 0,
        newcomer: true,
      },
    });
    expect(state.time).toBe('09:05');
    expect(JSON.stringify(state)).toContain('Vincent');
    const log = anonymize(state, ['Vincent']);
    expect(JSON.stringify(log)).not.toContain('Vincent');
    expect(JSON.stringify(log)).toContain('person 1');
    expect(JSON.stringify(log)).toContain('Félix');
  });
});

describe('spots (P15.3): windows and plants, shared tile names with the cat', () => {
  const spots = npcSpots(map);
  it('finds windows and plants, none in a forbidden zone', () => {
    expect(spots.some((s) => s.kind === 'window')).toBe(true);
    expect(spots.some((s) => s.kind === 'plant')).toBe(true);
    for (const s of spots.filter((x) => x.kind === 'window' || x.kind === 'plant')) {
      const p = cellPos(map, s.cell);
      expect(NPC_FORBIDDEN, s.key).not.toContain(zoneAt(map, p.x, p.y)?.kind);
    }
  });

  it('the cat still finds its spots from the same tile table', () => {
    const cat = petSpots(map);
    expect(cat.some((s) => s.kind === 'loaf')).toBe(true);
    expect(cat.some((s) => s.kind === 'drink')).toBe(true);
    expect(cat.some((s) => s.kind === 'sleep')).toBe(true);
  });

  it('a break goes to a window or a plant, in the wing it is in when there is one', () => {
    const s = pickSpot(
      spots,
      'break',
      { id: 'x', home: 'jungle', region: 'zen' },
      new Set(),
      () => 0.4,
    );
    expect(['window', 'plant']).toContain(s?.kind);
    if (spots.some((x) => (x.kind === 'window' || x.kind === 'plant') && x.region === 'zen'))
      expect(s?.region).toBe('zen');
  });

  it('keeps away from someone in Busy or DND (negative control: no one to avoid)', () => {
    const who = { id: 'zoe', home: 'oasis' };
    const free = pickSpot(spots, 'desk', who, new Set(), () => 0.5)!;
    const busyAt = cellPos(map, free.cell);
    const other = pickSpot(spots, 'desk', who, new Set(), () => 0.5, [busyAt])!;
    expect(other.key).not.toBe(free.key);
    expect(spotNear(other, [busyAt])).toBe(false);
    expect(
      Math.hypot(cellPos(map, other.cell).x - busyAt.x, cellPos(map, other.cell).y - busyAt.y),
    ).toBeGreaterThanOrEqual(3 * TILE - TILE);
    for (let i = 0; i < 20; i++) {
      const c = pickSpot(spots, 'coffee', who, new Set(), () => i / 20, [busyAt]);
      if (c) expect(spotNear(c, [busyAt])).toBe(false);
    }
  });
});
