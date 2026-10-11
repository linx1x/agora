/**
 * What the client knows about the personal world it is in (P17.14, ADR-053). The server sends the
 * seed and generator (`world:welcome`), the chunk deltas in view (`world:chunks`), the people
 * (`world:join` / `world:pos` / `world:depart`), the farm layer (`world:farm`) and the clock
 * (`world:time`). The client rebuilds the base terrain itself with the shared generator, so the
 * deltas are all it needs on top. This is plain data read every frame by the world view, not React
 * state; `store.worldId` only says a world is open, and GameView mounts the world view for it.
 */
import {
  WorldTerrain,
  chunkKey,
  deltaOverlay,
  type ChunkDelta,
  type PlotState,
  type S2CMsg,
  type WorldGenParams,
  type WorldPerson,
  type WorldTime,
} from '@agora/shared';
import { world as link } from '../net/client';
import { store, toast } from '../state/store';

/** What changed, so the view redraws only what moved. */
export type WorldChange = 'welcome' | 'chunks' | 'people' | 'farm' | 'time' | 'correction' | 'exit';

export class WorldSession {
  worldId: string | null = null;
  /** my presence id: the same id the office uses */
  you = '';
  seed = 0;
  genVersion = 0;
  params: WorldGenParams | null = null;
  /** base terrain from the seed plus the deltas in view; null outside a world */
  terrain: WorldTerrain | null = null;
  readonly people = new Map<string, WorldPerson>();
  /** the effective delta (starter stamp under stored edits) of each chunk in view */
  readonly deltas = new Map<string, ChunkDelta>();
  /** the farm layer by world cell "x,y" (P17.22 fills it; the view draws what arrives) */
  readonly plots = new Map<string, PlotState>();
  farmDay = 0;
  time: WorldTime | null = null;
  /** the server refused my last move and says where I stand */
  correction: { x: number; y: number; seq: number; serial: number } | null = null;
  private serial = 0;
  private readonly listeners = new Set<(change: WorldChange) => void>();

  get active(): boolean {
    return this.worldId !== null;
  }

  /** Tell me when the world changes. Returns the unsubscribe. */
  on(fn: (change: WorldChange) => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  private emit(change: WorldChange): void {
    for (const fn of this.listeners) fn(change);
  }

  /** Apply one server message. Messages that are not about worlds are ignored. */
  handle(m: S2CMsg): void {
    switch (m.t) {
      case 'welcome':
        // an office welcome (a reconnect after the socket dropped in a world) ends the world
        if (this.active) this.stop();
        return;
      case 'world:welcome': {
        this.worldId = m.worldId;
        this.you = m.you;
        this.seed = m.seed;
        this.genVersion = m.genVersion;
        this.params = m.params;
        this.terrain = new WorldTerrain(m.seed, m.params, {
          overlay: deltaOverlay((cx, cy) => this.deltas.get(chunkKey(cx, cy))),
        });
        this.deltas.clear();
        this.plots.clear();
        this.farmDay = 0;
        this.time = null;
        this.people.clear();
        for (const p of m.people) this.people.set(p.id, p);
        // the office's prompt and zone describe the office: the world sets its own
        store.set({ worldId: m.worldId, prompt: null, talkTo: null });
        this.emit('welcome');
        return;
      }
      case 'world:chunks':
        for (const c of m.add) this.deltas.set(chunkKey(c.cx, c.cy), c.delta);
        for (const c of m.drop) this.deltas.delete(chunkKey(c.cx, c.cy));
        this.emit('chunks');
        return;
      case 'world:pos': {
        const p = this.people.get(m.id);
        if (p) Object.assign(p, { x: m.x, y: m.y, d: m.d });
        this.emit('people');
        return;
      }
      case 'world:join':
        this.people.set(m.person.id, m.person);
        this.emit('people');
        return;
      case 'world:depart':
        this.people.delete(m.id);
        this.emit('people');
        return;
      case 'world:correction':
        this.correction = { x: m.x, y: m.y, seq: m.seq, serial: ++this.serial };
        this.emit('correction');
        return;
      case 'world:exit':
        if (this.active) this.stop();
        return;
      case 'world:farm':
        this.farmDay = m.day;
        for (const [key, plot] of Object.entries(m.plots)) {
          if (plot === null) this.plots.delete(key);
          else this.plots.set(key, plot);
        }
        this.emit('farm');
        return;
      case 'world:time':
        this.time = m.time;
        this.emit('time');
        return;
      case 'portal:refused':
        toast(`worlds.refused.${m.reason}`);
        return;
      default:
        return;
    }
  }

  /** Leave the world on the client: the office comes back (GameView unmounts this view). */
  stop(): void {
    const me = this.you;
    this.worldId = null;
    this.you = '';
    this.terrain = null;
    this.params = null;
    this.deltas.clear();
    this.plots.clear();
    this.people.clear();
    this.time = null;
    this.correction = null;
    // the office position comes back with the next `state` tick (the server sends none on exit)
    if (me) link.samples.delete(me);
    store.set({ worldId: null, prompt: null });
    this.emit('exit');
  }
}

/** The one session of this browser tab. Created at import, fed by the one realtime connection. */
export const worldSession = new WorldSession();
link.on((m) => worldSession.handle(m));
