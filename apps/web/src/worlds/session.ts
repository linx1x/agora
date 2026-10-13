/**
 * What the client knows about the personal world it is in (P17.14, ADR-053). The server sends the
 * seed and generator (`world:welcome`), the chunk deltas in view (`world:chunks`), the people
 * (`world:join` / `world:pos` / `world:depart`), the farm layer (`world:farm`) and the clock
 * (`world:time`). The client rebuilds the base terrain itself with the shared generator, so the
 * deltas are all it needs on top. This is plain data read every frame by the world view, not React
 * state; `store.worldId` only says a world is open, and GameView mounts the world view for it.
 */
import {
  chunkKey,
  deltaOverlay,
  worldTerrainFor,
  type WorldTerrain,
  type ChunkDelta,
  type ActionKind,
  type Emote,
  type CellRef,
  type Dir,
  type PlotState,
  type S2CMsg,
  type WorldGenParams,
  type WorldPerson,
  type WorldTime,
  type WeatherForecast,
} from '@agora/shared';
import { world as link } from '../net/client';
import { store, toast } from '../state/store';
import { applyWorldHudMessage } from './ui/hudState';

/** What changed, so the view redraws only what moved. */
export type WorldChange = 'welcome' | 'chunks' | 'people' | 'farm' | 'time' | 'correction' | 'exit';

/** Someone in my view swung a tool (P17.21b). Cosmetic: the views draw it, nothing else reads it. */
export interface WorldSwing {
  readonly id: string;
  readonly dir: Dir;
  readonly tier: number;
}

export interface WorldAction {
  readonly id: string;
  readonly kind: ActionKind | Emote | 'talk' | null;
  readonly dir?: Dir;
  readonly at?: CellRef;
  readonly tier?: number;
  readonly speed?: number;
  readonly token?: number;
}

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
  /** bumped whenever `people` changes (P17.15b: the People panel re-reads it) */
  peopleVersion = 0;
  /** the effective delta (starter stamp under stored edits) of each chunk in view */
  readonly deltas = new Map<string, ChunkDelta>();
  /** the farm layer by world cell "x,y" (P17.22 fills it; the view draws what arrives) */
  readonly plots = new Map<string, PlotState>();
  farmDay = 0;
  time: WorldTime | null = null;
  weather: WeatherForecast | null = null;
  /** the server refused my last move and says where I stand */
  correction: { x: number; y: number; seq: number; serial: number } | null = null;
  private serial = 0;
  private readonly listeners = new Set<(change: WorldChange) => void>();
  private readonly swingListeners = new Set<(swing: WorldSwing) => void>();

  private readonly actionListeners = new Set<(action: WorldAction) => void>();
  onAction(fn: (action: WorldAction) => void): () => void {
    this.actionListeners.add(fn); return () => this.actionListeners.delete(fn);
  }
  animate(action: WorldAction): void {
    if(this.active)for(const fn of this.actionListeners)fn(action);
  }

  get active(): boolean {
    return this.worldId !== null;
  }

  /** Tell me when the world changes. Returns the unsubscribe. */
  on(fn: (change: WorldChange) => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  /** Tell me when someone in view swings a tool (P17.21b). Returns the unsubscribe. */
  onSwing(fn: (swing: WorldSwing) => void): () => void {
    this.swingListeners.add(fn);
    return () => this.swingListeners.delete(fn);
  }

  private emit(change: WorldChange): void {
    if (change === 'people' || change === 'welcome' || change === 'exit') this.peopleVersion++;
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
        // a cave (P17.32) is read from its id and the world's seed, so it is the same for everyone in it
        this.terrain = worldTerrainFor(m.worldId, m.seed, m.params, {
          overlay: deltaOverlay((cx, cy) => this.deltas.get(chunkKey(cx, cy))),
        });
        this.deltas.clear();
        this.plots.clear();
        this.farmDay = 0;
        this.time = null;
        this.weather = null;
        this.people.clear();
        for (const p of m.people) this.people.set(p.id, p);
        // the office's prompt and zone describe the office: the world sets its own
        store.set({
          worldId: m.worldId,
          worldOwner: m.owner,
          worldMine: m.mine === true,
          worldPerms: null,
          contracts: [],
          prompt: null,
          talkTo: null,
        });
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
        this.weather = m.weather ?? null;
        this.emit('time');
        return;
      case 'world:action':
        this.animate(m);
        return;
      case 'world:refused':
        this.animate({id:this.you,kind:null,token:m.op});
        return;
      case 'emote':
        this.animate({id:m.id,kind:m.emote});
        return;
      case 'chat':
        if(m.msg.scope==='nearby')this.animate({id:m.msg.from,kind:'talk'});
        return;
      case 'world:swing':
        for (const fn of this.swingListeners) fn({ id: m.id, dir: m.dir, tier: m.tier });
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
    this.weather = null;
    this.correction = null;
    // the office position comes back with the next `state` tick (the server sends none on exit)
    if (me) link.samples.delete(me);
    store.set({
      worldId: null,
      worldOwner: '',
      worldMine: false,
      worldPerms: null,
      contracts: [],
      contractsOpen: false,
      prompt: null,
    });
    this.emit('exit');
  }
}

/** The one session of this browser tab. Created at import, fed by the one realtime connection. */
export const worldSession = new WorldSession();
// every server message reaches the session, and the world HUD (P17.21b: the inventory, clock, refusals)
link.on((m) => {
  worldSession.handle(m);
  applyWorldHudMessage(m);
});
