/**
 * Personal worlds on the server (ADR-053, P17.9). A WorldRoom holds the people in one world. The
 * WorldHub opens a room when the first person arrives (lazy load: the world row, its generator
 * params and every stored delta) and closes it when the last one leaves. The server decides every
 * position with `validateWorldMove` on the seed's terrain plus the stored edits; the client only
 * predicts. Messages go to the people in that world and nobody else.
 */
import {
  ChunkDeltaSchema,
  WORLDGEN,
  WORLD_CELL_PX,
  WORLD_SPAWN,
  WORLD_VIEW_CHUNKS,
  WorldTerrain,
  chunkKey,
  chunkOfPoint,
  chunksInView,
  deltaOverlay,
  inPortal,
  mergeDeltas,
  returnTrigger,
  starterPatches,
  validateWorldMove,
  worldCollides,
  worldGenParamsFor,
  type Avatar,
  type ChunkCoord,
  type ChunkDelta,
  type Dir,
  type PortalRect,
  type S2CMsg,
  type Starter,
  type WorldGenParams,
  type WorldPerson,
} from '@agora/shared';
import { defaultStarter } from './starter';
import type { StoredChunk, StoredWorld, WorldStore } from './worldStore';

/** How far (in cells, each way) the spawn search looks for walkable ground. */
const SPAWN_SEARCH_CELLS = 16;

/** The part of a socket a world needs. The office's Conn satisfies it. */
export interface WorldConn {
  send(m: S2CMsg): void;
}

/** A person inside one world. `uid` stays on the server; `id` is the office presence id. */
export interface WorldMember {
  readonly id: string;
  readonly uid: string;
  name: string;
  avatar: Avatar;
  x: number;
  y: number;
  d: Dir;
  conn: WorldConn | null;
  lastMoveAt: number;
  /** chunks this person is shown, by chunk key */
  view: Map<string, ChunkCoord>;
}

const personOf = (m: WorldMember): WorldPerson => ({
  id: m.id,
  name: m.name,
  avatar: m.avatar,
  x: m.x,
  y: m.y,
  d: m.d,
});

/**
 * The walkable feet point nearest the origin, searched ring by ring in a fixed order so every
 * server and client picks the same one. The origin itself when it is already free.
 */
export function worldSpawn(terrain: WorldTerrain): { x: number; y: number } {
  for (let r = 0; r <= SPAWN_SEARCH_CELLS; r++)
    for (let cy = -r; cy <= r; cy++)
      for (let cx = -r; cx <= r; cx++) {
        if (Math.max(Math.abs(cx), Math.abs(cy)) !== r) continue;
        const x = cx * WORLD_CELL_PX + WORLD_SPAWN.x;
        const y = cy * WORLD_CELL_PX + WORLD_SPAWN.y;
        if (!worldCollides(terrain, x, y)) return { x, y };
      }
  return { x: WORLD_SPAWN.x, y: WORLD_SPAWN.y };
}

export class WorldRoom {
  readonly id: string;
  readonly seed: number;
  readonly genVersion: number;
  readonly params: WorldGenParams;
  readonly terrain: WorldTerrain;
  private readonly members = new Map<string, WorldMember>();
  /** stored edits only, by chunk key: the revision each chunk was saved at */
  private readonly deltas = new Map<string, { rev: number; delta: ChunkDelta }>();
  /** what the terrain and the client see per chunk: the starter stamp, stored edits over it */
  private readonly effective = new Map<string, ChunkDelta>();
  private readonly returnRect: PortalRect;
  private readonly onEmpty: () => void;
  disposed = false;

  constructor(
    world: StoredWorld,
    params: WorldGenParams,
    stored: readonly StoredChunk[],
    onEmpty: () => void,
    starter: Starter,
  ) {
    this.id = world.id;
    this.seed = world.seed;
    this.genVersion = world.genVersion;
    this.params = params;
    this.onEmpty = onEmpty;
    this.returnRect = returnTrigger(starter);
    for (const c of stored) {
      // a stored delta that no longer parses is left out: its cells show the stamp or the base terrain
      const parsed = ChunkDeltaSchema.safeParse(c.delta);
      if (parsed.success) this.deltas.set(chunkKey(c.cx, c.cy), { rev: c.rev, delta: parsed.data });
    }
    const stamp = starterPatches(starter);
    for (const key of new Set([...stamp.keys(), ...this.deltas.keys()]))
      this.effective.set(key, mergeDeltas(stamp.get(key), this.deltas.get(key)?.delta));
    // the terrain reads the effective layers, built once here, so a chunk costs no copy per cell
    this.terrain = new WorldTerrain(world.seed, params, {
      overlay: deltaOverlay((cx, cy) => this.effective.get(chunkKey(cx, cy))),
    });
  }

  get size(): number {
    return this.members.size;
  }

  /** Where someone arriving stands (see `worldSpawn`). */
  spawn(): { x: number; y: number } {
    return worldSpawn(this.terrain);
  }

  /**
   * Put a person in the world at its spawn: they get the welcome (seed, generator, who is here)
   * and their chunks, and everyone else hears `world:join`.
   */
  join(conn: WorldConn, who: { id: string; uid: string; name: string; avatar: Avatar }): WorldMember {
    const at = this.spawn();
    const m: WorldMember = {
      id: who.id,
      uid: who.uid,
      name: who.name,
      avatar: who.avatar,
      x: at.x,
      y: at.y,
      d: 'down',
      conn,
      lastMoveAt: Date.now(),
      view: new Map(),
    };
    const others = [...this.members.values()];
    this.members.set(m.id, m);
    conn.send({
      t: 'world:welcome',
      worldId: this.id,
      you: m.id,
      seed: this.seed,
      genVersion: this.genVersion,
      params: this.params,
      people: [...this.members.values()].map(personOf),
    });
    this.updateView(m);
    for (const o of others) o.conn?.send({ t: 'world:join', person: personOf(m) });
    return m;
  }

  /**
   * A client's move: refused with `world:correction` when the terrain (with stored edits) does
   * not allow it, otherwise everyone in the world gets `world:pos`.
   */
  move(m: WorldMember, to: { x: number; y: number; dir: Dir; seq: number }): void {
    if (this.disposed || this.members.get(m.id) !== m) return;
    const now = Date.now();
    const verdict = validateWorldMove(this.terrain, { x: m.x, y: m.y }, to, now - m.lastMoveAt);
    if (!verdict.ok)
      return m.conn?.send({
        t: 'world:correction',
        x: m.x,
        y: m.y,
        seq: to.seq,
        reason: verdict.reason,
      });
    m.x = to.x;
    m.y = to.y;
    m.d = to.dir;
    m.lastMoveAt = now;
    this.updateView(m);
    for (const o of this.members.values())
      o.conn?.send({ t: 'world:pos', id: m.id, x: m.x, y: m.y, d: m.d });
  }

  /** Whether a person stands on the return pad (the only way back to the office from a world). */
  atReturn(m: WorldMember): boolean {
    return inPortal(this.returnRect, m.x, m.y);
  }

  /** Leave the world. The last person out closes the room. */
  leave(m: WorldMember): void {
    if (this.members.get(m.id) !== m) return;
    this.members.delete(m.id);
    m.view.clear();
    m.conn = null;
    for (const o of this.members.values()) o.conn?.send({ t: 'world:depart', id: m.id });
    if (this.members.size === 0) this.onEmpty();
  }

  dispose(): void {
    this.disposed = true;
    this.members.clear();
    this.deltas.clear();
  }

  /** Stream the chunks that came into this person's view, and tell them which left it. */
  private updateView(m: WorldMember): void {
    if (!m.conn) return;
    const want = new Map<string, ChunkCoord>();
    for (const c of chunksInView(chunkOfPoint(m.x, m.y), WORLD_VIEW_CHUNKS))
      want.set(chunkKey(c.cx, c.cy), c);
    const add: { cx: number; cy: number; rev: number; delta: ChunkDelta }[] = [];
    for (const [key, c] of want) {
      if (m.view.has(key)) continue;
      add.push({
        cx: c.cx,
        cy: c.cy,
        rev: this.deltas.get(key)?.rev ?? 0,
        delta: this.effective.get(key) ?? {},
      });
    }
    const drop: ChunkCoord[] = [];
    for (const [key, c] of m.view) if (!want.has(key)) drop.push(c);
    m.view = want;
    if (add.length > 0 || drop.length > 0) m.conn.send({ t: 'world:chunks', add, drop });
  }
}

/**
 * Opens and closes world rooms. A room exists only while someone is in it, so a world's terrain
 * and deltas are in memory only while they are used.
 */
export class WorldHub {
  private readonly rooms = new Map<string, WorldRoom>();
  private readonly opening = new Map<string, Promise<WorldRoom | null>>();

  /** `starter` is read on the first world opened (a missing file refuses worlds, never the office) */
  constructor(
    private readonly store: WorldStore,
    private readonly starter?: Starter,
  ) {}

  /**
   * The open room of a world, loading it when it is not open. Concurrent arrivals share one load.
   * Null when the world does not exist or its generator version is unknown.
   */
  enter(worldId: string): Promise<WorldRoom | null> {
    const open = this.rooms.get(worldId);
    if (open && !open.disposed) return Promise.resolve(open);
    let pending = this.opening.get(worldId);
    if (!pending) {
      pending = this.open(worldId).finally(() => this.opening.delete(worldId));
      this.opening.set(worldId, pending);
    }
    return pending;
  }

  /** Close a room that has nobody in it (for example after a refused arrival). */
  release(room: WorldRoom): void {
    if (room.size === 0) this.close(room);
  }

  private async open(worldId: string): Promise<WorldRoom | null> {
    const world = await this.store.getWorld(worldId);
    if (!world) return null;
    let params: WorldGenParams;
    try {
      params = worldGenParamsFor(WORLDGEN, world.genVersion);
    } catch {
      return null;
    }
    const stored = await this.store.loadAllChunks(worldId);
    const starter = this.starter ?? defaultStarter();
    const room: WorldRoom = new WorldRoom(world, params, stored, () => this.close(room), starter);
    this.rooms.set(worldId, room);
    return room;
  }

  private close(room: WorldRoom): void {
    if (this.rooms.get(room.id) !== room) return;
    this.rooms.delete(room.id);
    room.dispose();
  }
}

const hubs = new WeakMap<WorldStore, WorldHub>();

/** The hub for a store: one per process, so every space shares the same open worlds. */
export function worldHubFor(store: WorldStore): WorldHub {
  let hub = hubs.get(store);
  if (!hub) {
    hub = new WorldHub(store);
    hubs.set(store, hub);
  }
  return hub;
}
