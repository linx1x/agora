import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { cellPos, parseMap, zoneAt, type Tmj } from './map';
import {
  NPC_FORBIDDEN,
  NpcPersonaSchema,
  npcAllowedAt,
  npcAudience,
  npcChatHasAudience,
  npcClock,
  npcNearestAllowed,
  npcSpots,
  pickSpot,
  portalFor,
  scheduleAt,
  type NpcBlock,
} from './npcs';
import type { Placed } from './proximity';

const map = parseMap(
  JSON.parse(readFileSync(new URL('../../maps/hq.tmj', import.meta.url), 'utf8')) as Tmj,
);
const centre = (id: string) => {
  const z = map.zones.find((q) => q.id === id)!;
  return { x: z.x + z.w / 2, y: z.y + z.h / 2 };
};
const seq = (...v: number[]) => {
  let i = 0;
  return () => v[i++ % v.length]!;
};

const THEO: NpcBlock[] = [
  { at: '09:40', do: 'arrive' },
  { at: '09:50', do: 'coffee' },
  { from: '10:00', to: '12:00', do: 'desk' },
  { from: '12:00', to: '13:00', do: 'lounge' },
  { from: '13:00', to: '17:00', do: 'desk' },
  { at: '17:30', do: 'leave' },
];
const hm = (s: string) => Number(s.slice(0, 2)) * 60 + Number(s.slice(3));

describe('scheduleAt', () => {
  it('is away before arriving and after leaving', () => {
    expect(scheduleAt(THEO, hm('08:00')).activity).toBe('away');
    expect(scheduleAt(THEO, hm('17:30')).activity).toBe('away');
    expect(scheduleAt(THEO, hm('23:59')).activity).toBe('away');
  });
  it('follows moments and spans, and wanders in the gaps', () => {
    expect(scheduleAt(THEO, hm('09:45')).activity).toBe('wander'); // just arrived
    expect(scheduleAt(THEO, hm('09:55'))).toEqual({ activity: 'coffee', since: hm('09:50') });
    expect(scheduleAt(THEO, hm('11:59')).activity).toBe('desk');
    expect(scheduleAt(THEO, hm('12:30')).activity).toBe('lounge');
    expect(scheduleAt(THEO, hm('17:10'))).toEqual({ activity: 'wander', since: hm('17:00') });
  });
  it('does not depend on the order of the lines', () => {
    const shuffled = [...THEO].reverse();
    for (const t of ['09:55', '11:00', '12:30', '17:10', '18:00'])
      expect(scheduleAt(shuffled, hm(t))).toEqual(scheduleAt(THEO, hm(t)));
  });
});

describe('npcClock', () => {
  it('runs a dev clock from a start time at a chosen speed', () => {
    const clock = npcClock({ start: '10:00', scale: 60, t0: 0 });
    expect(clock(0)).toBe(600);
    expect(clock(60_000)).toBe(660); // one real minute = one game hour
    expect(clock(14 * 60_000)).toBe(0); // 14 game hours later: midnight, wraps
  });
});

describe('where a character may stand', () => {
  it('never in a private room, a desk pod or the quiet zone', () => {
    for (const z of map.zones.filter((q) => NPC_FORBIDDEN.includes(q.kind))) {
      const c = centre(z.id);
      expect(npcAllowedAt(map, c.x, c.y), z.id).toBe(false);
    }
  });
  it('on the open floor and in public areas (negative control)', () => {
    for (const id of ['salon', 'accueil', 'jungle-aire', 'zen-aire']) {
      const p = npcNearestAllowed(map, centre(id).x, centre(id).y);
      expect(npcAllowedAt(map, p.x, p.y), id).toBe(true);
      expect(NPC_FORBIDDEN).not.toContain(zoneAt(map, p.x, p.y)?.kind);
    }
  });
  it('is moved out of a pod to the nearest allowed place', () => {
    const pod = map.desks[0]!.zone;
    const p = npcNearestAllowed(map, pod.x + pod.w / 2, pod.y + pod.h / 2);
    expect(npcAllowedAt(map, p.x, p.y)).toBe(true);
  });
});

describe('npcSpots', () => {
  const spots = npcSpots(map);
  it('finds seats, the coffee corner and water', () => {
    expect(spots.filter((s) => s.kind === 'seat').length).toBeGreaterThan(10);
    expect(spots.some((s) => s.kind === 'coffee' && s.area === 'salon')).toBe(true);
    expect(spots.some((s) => s.kind === 'water')).toBe(true);
    expect(spots.some((s) => s.region === 'zen')).toBe(true);
  });
  it('has no spot in a private room, a desk pod or the quiet zone', () => {
    for (const s of spots) {
      const p = cellPos(map, s.cell);
      expect(NPC_FORBIDDEN, s.key).not.toContain(zoneAt(map, p.x, p.y)?.kind);
    }
  });
});

describe('pickSpot', () => {
  const spots = npcSpots(map);
  const theo = { id: 'theo', home: 'jungle' };
  it('keeps the same desk from day to day, and finds another when it is taken', () => {
    const a = pickSpot(spots, 'desk', theo, new Set(), seq(0.3))!;
    const b = pickSpot(spots, 'desk', theo, new Set(), seq(0.9))!;
    expect(a.key).toBe(b.key);
    expect(a.region).toBe('jungle');
    const c = pickSpot(spots, 'desk', theo, new Set([a.key]), seq(0.5))!;
    expect(c.key).not.toBe(a.key);
  });
  it('stands somewhere in its own wing when the wing has no open-floor chair (Zen)', () => {
    const felix = pickSpot(spots, 'desk', { id: 'felix', home: 'zen' }, new Set(), seq(0.5))!;
    expect(felix.region).toBe('zen');
  });
  it('sends coffee to the kitchen, lounge to the lounge, tea to the Zen garden', () => {
    expect(pickSpot(spots, 'coffee', theo, new Set(), seq(0.5))?.kind).toBe('coffee');
    expect(pickSpot(spots, 'lounge', theo, new Set(), seq(0.5))?.area).toBe('salon');
    expect(pickSpot(spots, 'tea', theo, new Set(), seq(0.5))?.region).toBe('zen');
    expect(pickSpot(spots, 'wander', theo, new Set(), seq(0.5))).toBeNull();
  });
  it('a teleporter pad leads out of each wing', () => {
    for (const r of ['jungle', 'oasis', 'boreal', 'zen'])
      expect(portalFor(map, r, 'hub')).not.toBeNull();
  });
});

describe('audience: characters only chat when a person hears them (Vincent, 2026-10-07)', () => {
  const at = (
    id: string,
    x: number,
    y: number,
    zone?: Placed['zoneKind'],
    zoneId?: string,
  ): Placed => ({
    id,
    x,
    y,
    zoneKind: zone,
    zoneId,
  });
  const zoe = at('npc:zoe', 1000, 1000);
  const theo = at('npc:theo', 1032, 1000);
  it('nobody near: no audience, no chat', () => {
    expect(npcAudience(zoe, [])).toEqual([]);
    expect(npcChatHasAudience(zoe, theo, [at('far', 3000, 1000)])).toBe(false);
  });
  it('someone in nearby-chat range of both: they may chat (negative control)', () => {
    const vincent = at('vincent', 1100, 1000);
    expect(npcAudience(zoe, [vincent])).toEqual(['vincent']);
    expect(npcChatHasAudience(zoe, theo, [vincent])).toBe(true);
  });
  it('a person inside a private room or pod next to them does not count', () => {
    const inside = at('in-pod', 1064, 1000, 'desk', 'jungle-1');
    expect(npcAudience(zoe, [inside])).toEqual([]);
    expect(npcChatHasAudience(zoe, theo, [inside])).toBe(false);
  });
});

describe('persona files', () => {
  it('fill the defaults and refuse a bad schedule', () => {
    const p = NpcPersonaSchema.parse({
      id: 'theo',
      name: 'Théo',
      avatar: { skin: 3, hair: 3, hairColor: 2, top: 1, bottom: 0, accessory: 3 },
      home: 'jungle',
      schedule: THEO,
    });
    expect(p.enabled).toBe(true);
    expect(p.locale).toBe('fr-CA');
    expect(() =>
      NpcPersonaSchema.parse({ ...p, schedule: [{ at: '25:00', do: 'desk' }] }),
    ).toThrow();
    expect(() => NpcPersonaSchema.parse({ ...p, id: '../etc' })).toThrow();
  });
});
