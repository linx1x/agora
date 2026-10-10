/**
 * P16.3: the world's logic runs without any renderer. A fake view records what the controller
 * asks it to draw; the network client and keyboard are stubbed.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { TILE, cellPos, parseMap, type Cell, type Tmj } from '@agora/shared';

const keys: [number, number] = [0, 0];
const samples = new Map<string, { x: number; y: number; d: string; m: boolean; p: string }[]>();
const fakeWorld = {
  samples,
  lastCorrection: null as { x: number; y: number; seq: number; reason?: string } | null,
  sendMove: vi.fn(),
  send: vi.fn(),
  on: () => () => undefined,
  sampleAt: (id: string) => samples.get(id)?.at(-1),
};
vi.mock('../net/client', () => ({ world: fakeWorld }));
vi.mock('./input', () => ({ inputVector: () => keys, isTyping: () => false }));
vi.mock('../i18n', () => ({ default: { t: (k: string) => k, language: 'fr-CA' } }));
vi.stubGlobal('window', {
  addEventListener: () => undefined,
  removeEventListener: () => undefined,
});
vi.stubGlobal('localStorage', { getItem: () => null, setItem: () => undefined });

const { WorldController, rendered } = await import('./controller');
const { store } = await import('../state/store');

const map = parseMap(
  JSON.parse(
    readFileSync(resolve(import.meta.dirname, '../../../../packages/maps/hq.tmj'), 'utf8'),
  ) as Tmj,
);
const profile = (name: string) =>
  ({
    name,
    avatar: { skin: 0, hair: 0, hairColor: 0, top: 0, bottom: 0, accessory: 0 },
    status: 'available',
    online: true,
  }) as never;

function fakeView() {
  return {
    paths: [] as (readonly Cell[])[],
    land: null as null | (() => void),
    buildActive: false,
    follows: 0,
    drawPath(p: readonly Cell[]) {
      this.paths.push([...p]);
    },
    teleport(land: () => void) {
      this.land = land;
    },
    panTo: vi.fn(),
    followMe() {
      this.follows++;
    },
    npcPosition: () => undefined,
  };
}

/** A free cell of the Atrium with three free cells east of it, and a chair outside desk pods. */
let start: Cell;
let chair: Cell;
beforeAll(() => {
  const free = (cx: number, cy: number) => !map.solid[cy * map.width + cx];
  const hub = map.regions.find((r) => r.id === 'hub')!;
  outer: for (let cy = hub.y / TILE + 2; cy < (hub.y + hub.h) / TILE - 2; cy++)
    for (let cx = hub.x / TILE + 2; cx < (hub.x + hub.w) / TILE - 5; cx++)
      if (
        [0, 1, 2, 3].every((k) => free(cx + k, cy) && free(cx + k, cy + 1) && free(cx + k, cy - 1))
      ) {
        start = { cx, cy };
        break outer;
      }
  const k = map.sit.findIndex(
    (v, i) =>
      v > 0 &&
      !map.desks.some(
        (d) => d.chair.cx === i % map.width && d.chair.cy === Math.floor(i / map.width),
      ),
  );
  chair = { cx: k % map.width, cy: Math.floor(k / map.width) };
});

function place(c: Cell) {
  const p = cellPos(map, c);
  samples.set('me', [{ x: p.x, y: p.y, d: 'down', m: false, p: 'stand' }]);
}

beforeEach(() => {
  samples.clear();
  rendered.clear();
  fakeWorld.lastCorrection = null;
  fakeWorld.sendMove.mockClear();
  keys[0] = keys[1] = 0;
  store.set({
    map,
    me: 'me',
    profiles: { me: profile('Vincent') },
    desks: [],
    admitted: [],
    prompt: null,
    settings: { ...store.get().settings, autoSit: true },
  });
});

describe('WorldController (P16.3)', () => {
  it('walks a clicked path, asks the view to draw it, and clears it on arrival', () => {
    place(start);
    const view = fakeView();
    const ctl = new WorldController(view);
    const goal = cellPos(map, { cx: start.cx + 3, cy: start.cy });
    ctl.clickTo(goal.x, goal.y - 6);
    expect(view.paths.at(-1)!.length).toBeGreaterThan(0);
    let t = 1000;
    for (let i = 0; i < 120; i++) ctl.step((t += 16), 16);
    // the navigator stops within a few px of the cell's foot point
    expect(Math.hypot(ctl.me.x - goal.x, ctl.me.y - goal.y)).toBeLessThan(4);
    expect(view.paths.at(-1)).toEqual([]);
    expect(fakeWorld.sendMove).toHaveBeenCalled();
    expect(view.follows).toBeGreaterThan(0);
    ctl.destroy();
  });

  it('keys move me and cancel a planned path', () => {
    place(start);
    const view = fakeView();
    const ctl = new WorldController(view);
    const goal = cellPos(map, { cx: start.cx + 3, cy: start.cy });
    ctl.clickTo(goal.x, goal.y - 6);
    const x0 = ctl.me.x;
    keys[0] = -1;
    ctl.step(1000, 100);
    expect(ctl.me.x).toBeLessThan(x0);
    expect(ctl.me.dir).toBe('left');
    expect(ctl.nav.active).toBe(false);
    ctl.destroy();
  });

  it('a teleport waits for the view to reach its darkest point', () => {
    place(start);
    const view = fakeView();
    const ctl = new WorldController(view);
    ctl.step(1000, 16);
    fakeWorld.lastCorrection = { x: 100, y: 200, seq: 1, reason: 'teleport' };
    ctl.step(1016, 16);
    expect(ctl.me.x).not.toBe(100);
    view.land!();
    expect([ctl.me.x, ctl.me.y]).toEqual([100, 200]);
    ctl.destroy();
  });

  it('fills `rendered` for everyone with a sample and drops people who left', () => {
    place(start);
    samples.set('ben', [{ x: 64, y: 64, d: 'left', m: true, p: 'stand' }]);
    store.set({ profiles: { me: profile('Vincent'), ben: profile('Ben') } });
    const ctl = new WorldController(fakeView());
    const a = ctl.avatars(1000);
    expect(a.map((q) => q.id).sort()).toEqual(['ben', 'me']);
    expect(rendered.get('ben')).toEqual({ x: 64, y: 64 });
    store.set({ profiles: { me: profile('Vincent') } });
    ctl.avatars(1100);
    expect(rendered.has('ben')).toBe(false);
    ctl.destroy();
  });

  it('offers to sit on a chair, then sits by itself after a short pause', () => {
    place(chair);
    const ctl = new WorldController(fakeView());
    ctl.avatars(1000);
    ctl.slowTick();
    expect(store.get().prompt?.kind).toBe('sit');
    ctl.step(5000, 16);
    expect(ctl.me.pose).toBe('sit');
    ctl.avatars(5016);
    ctl.slowTick();
    expect(store.get().prompt?.kind).toBe('stand');
    ctl.destroy();
  });
});
