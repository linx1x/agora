/**
 * Personal worlds on the server (ADR-053, P17.9). A WorldRoom holds the people in one world. The
 * WorldHub opens a room when the first person arrives (lazy load: the world row, its generator
 * params and every stored delta) and closes it when the last one leaves. The server decides every
 * position with `validateWorldMove` on the seed's terrain plus the stored edits; the client only
 * predicts. Messages go to the people in that world and nobody else.
 */
import { randomUUID } from 'node:crypto';
import {
  ChunkDeltaSchema,
  WORLDGEN,
  loadGameData,
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
  type ActionPlanners,
  type Avatar,
  type C2SMsg,
  type ChatMsg,
  type ChunkCoord,
  type ChunkDelta,
  type Dir,
  type GameData,
  type PortalRect,
  type S2CMsg,
  type Starter,
  type WorldGenParams,
  type WorldPerson,
} from '@agora/shared';
import type { SfuApi } from '../media/gate';
import { defaultStarter } from './starter';
import { accountView, grantStarterKit } from './inventory';
import { runAction, type ActionResult } from './actions';
import type { StoredChunk, StoredWorld, WorldStore } from './worldStore';

/** The world action request as the protocol carries it (P17.20). */
export type WorldActRequest = Extract<C2SMsg, { t: 'world:act' }>;

/** What a world room needs from the server: the store for transactions, the rules, a logger. */
export interface WorldRoomDeps {
  readonly store: WorldStore;
  /** the action rules; the default set when omitted (ADR-053, P17.21 onward) */
  readonly planners?: ActionPlanners;
  readonly log?: { warn: (o: object, m?: string) => void };
}

/** How far (in cells, each way) the spawn search looks for walkable ground. */
const SPAWN_SEARCH_CELLS = 16;

/** The part of a socket a world needs. The office's Conn satisfies it. */
export interface WorldConn {
  send(m: S2CMsg): void;
}

/**
 * The SFU a world's members publish through when this server runs one (ADR-031). The world has
 * one room, `prefix:world:<id>`, shared by every space; a member gets a token for it and nothing else.
 */
export interface WorldMedia {
  api: SfuApi;
  url: string;
  prefix: string;
  log: { warn: (o: object, m?: string) => void };
}

/** The SFU room of a world (P17.11). Named from the world id, never from a user id. */
export const worldRoomName = (prefix: string, worldId: string) => `${prefix}:world:${worldId}`;

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
  /** the SFU this person's media uses, undefined when the server carries no SFU (peer-to-peer) */
  readonly media: WorldMedia | undefined;
}

/** The signalling payload of an `rtc` message (P2P only, ADR-009). */
export type WorldSignal = Extract<S2CMsg, { t: 'rtc' }>['data'];

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

const NO_LOG = { warn: () => undefined };

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
  /** the starter stamp per chunk key (P17.10): the base of every chunk before stored edits */
  private readonly stamp: Map<string, ChunkDelta>;
  private readonly world: StoredWorld;
  private readonly store: WorldStore;
  private readonly planners: ActionPlanners | undefined;
  private readonly log: { warn: (o: object, m?: string) => void };
  private readonly returnRect: PortalRect;
  private readonly onEmpty: () => void;
  /** actions in order: each one waits for the one before, so a person's actions apply in the order sent */
  private chain: Promise<void> = Promise.resolve();
  /** actions queued or running; the room stays open until they finish (their caches are this room's) */
  private pending = 0;
  disposed = false;

  constructor(
    world: StoredWorld,
    params: WorldGenParams,
    stored: readonly StoredChunk[],
    onEmpty: () => void,
    starter: Starter,
    deps: WorldRoomDeps,
  ) {
    this.id = world.id;
    this.seed = world.seed;
    this.genVersion = world.genVersion;
    this.params = params;
    this.world = world;
    this.store = deps.store;
    this.planners = deps.planners;
    this.log = deps.log ?? NO_LOG;
    this.onEmpty = onEmpty;
    this.returnRect = returnTrigger(starter);
    for (const c of stored) {
      // a stored delta that no longer parses is left out: its cells show the stamp or the base terrain
      const parsed = ChunkDeltaSchema.safeParse(c.delta);
      if (parsed.success) this.deltas.set(chunkKey(c.cx, c.cy), { rev: c.rev, delta: parsed.data });
    }
    const stamp = starterPatches(starter);
    this.stamp = stamp;
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
  join(
    conn: WorldConn,
    who: { id: string; uid: string; name: string; avatar: Avatar },
    media?: WorldMedia,
  ): WorldMember {
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
      media,
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
    this.sendPeers();
    void this.grant(m);
    this.sendInventory(m);
    return m;
  }

  /**
   * A world action from a person in this world (P17.20). Runs after the actions before it and
   * replies to them alone (`world:acted` or `world:refused`, then their inventory when it changed).
   */
  act(m: WorldMember, req: WorldActRequest): void {
    if (this.disposed || this.members.get(m.id) !== m) return;
    this.pending++;
    this.chain = this.chain
      .then(() => this.runAct(m, req))
      .catch(() => undefined)
      .finally(() => {
        this.pending--;
        this.closeIfIdle();
      });
  }

  /** A fresh media token for someone who asked again (the SFU connection dropped for good). */
  refreshMedia(m: WorldMember): void {
    if (this.members.get(m.id) === m) void this.grant(m);
  }

  /**
   * Nearby chat inside the world (P17.11): every line reaches the people in this world, at any
   * distance, and nobody else. It is never stored and never enters the office history. An
   * `everyone` line from inside a world is the same thing: the world is the whole audience.
   */
  chat(m: WorldMember, body: string): void {
    if (this.disposed || this.members.get(m.id) !== m) return;
    const msg: ChatMsg = {
      id: randomUUID(),
      scope: 'nearby',
      from: m.id,
      name: m.name,
      body,
      at: Date.now(),
      zoneId: `world:${this.id}`,
    };
    for (const o of this.members.values()) o.conn?.send({ t: 'chat', msg });
  }

  /**
   * Peer-to-peer signalling between two members (ADR-009, P17.11). Relayed only to a member of this
   * world; refused as `off` when the SFU carries this person's media, as in the office.
   */
  signal(m: WorldMember, to: string, data: WorldSignal): 'ok' | 'off' | 'not_linked' {
    if (this.members.get(m.id) !== m) return 'not_linked';
    if (m.media) return 'off';
    const target = this.members.get(to);
    if (!target || target === m) return 'not_linked';
    target.conn?.send({ t: 'rtc', from: m.id, data });
    return 'ok';
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
    // out of the world's SFU room, and every token they hold for it is void (SfuApi.remove)
    const media = m.media;
    if (media)
      void media.api
        .remove(worldRoomName(media.prefix, this.id), m.id)
        .catch((err: unknown) => media.log.warn({ err: String(err) }, 'world media remove failed'));
    for (const o of this.members.values()) o.conn?.send({ t: 'world:depart', id: m.id });
    this.sendPeers();
    this.closeIfIdle();
  }

  /** The room closes when nobody is in it and no action of its own is still running. */
  private closeIfIdle(): void {
    if (this.members.size === 0 && this.pending === 0 && !this.disposed) this.onEmpty();
  }

  dispose(): void {
    this.disposed = true;
    this.members.clear();
    this.deltas.clear();
    this.effective.clear();
  }

  /**
   * Everyone in a world is linked to everyone else in it, at any distance (the private rule of
   * ADR-017, applied to the world as one room). Sent whenever someone comes or goes.
   */
  private sendPeers(): void {
    const ids = [...this.members.keys()];
    for (const m of this.members.values())
      m.conn?.send({ t: 'peers', peers: ids.filter((id) => id !== m.id).sort() });
  }

  /**
   * A media token for this person in the world's room, and only that room: no floor grant
   * (`floor: null`), so the office floor is never joined from inside a world.
   */
  private grant(m: WorldMember): Promise<void> {
    const media = m.media;
    if (!media) return Promise.resolve();
    const room = worldRoomName(media.prefix, this.id);
    return media.api
      .mint(room, m.id, m.name, true)
      .then((token) => {
        // they may have left while the token was minted: then nothing is sent
        if (this.members.get(m.id) !== m || !m.conn) return;
        m.conn.send({
          t: 'media:grant',
          url: media.url,
          floor: null,
          zone: { room, token },
          publish: 'zone',
        });
      })
      .catch((err: unknown) => media.log.warn({ err: String(err) }, 'world media grant failed'));
  }

  private async runAct(m: WorldMember, req: WorldActRequest): Promise<void> {
    if (this.disposed || this.members.get(m.id) !== m) return;
    let result: ActionResult;
    try {
      result = await runAction({
        world: {
          id: this.world.id,
          ownerId: this.world.ownerId,
          seed: this.world.seed,
          createdAt: this.world.createdAt,
          settings: this.world.settings,
        },
        params: this.params,
        stamp: this.stamp,
        actor: { uid: m.uid, x: m.x, y: m.y },
        req: { kind: req.kind, at: req.at, item: req.item, target: req.target },
        key: req.key,
        now: Date.now(),
        store: this.store,
        data: loadGameData(),
        planners: this.planners,
      });
    } catch (err) {
      this.log.warn({ err: String(err), world: this.id }, 'world action failed');
      return void m.conn?.send({ t: 'world:refused', op: req.op, reason: 'conflict' });
    }
    if (!result.ok) return void m.conn?.send({ t: 'world:refused', op: req.op, reason: result.reason });
    if (result.replayed) return void m.conn?.send({ t: 'world:acted', op: req.op, changes: result.changes });
    // the store has the change; this room's caches follow it, even if the person left meanwhile
    for (const c of result.chunks) this.publishChunk(c.cx, c.cy, c.rev, c.delta);
    m.conn?.send({ t: 'world:acted', op: req.op, changes: result.changes });
    m.conn?.send({
      t: 'world:inv',
      items: { ...result.inventory.items },
      money: result.inventory.money,
      energy: result.energy,
      maxEnergy: result.maxEnergy,
    });
  }

  /** A chunk's stored delta changed: this room's terrain follows it, and its viewers get it. */
  private publishChunk(cx: number, cy: number, rev: number, delta: ChunkDelta): void {
    const key = chunkKey(cx, cy);
    this.deltas.set(key, { rev, delta });
    this.effective.set(key, mergeDeltas(this.stamp.get(key), delta));
    const effective = this.effective.get(key) ?? {};
    for (const o of this.members.values())
      if (o.view.has(key)) o.conn?.send({ t: 'world:chunks', add: [{ cx, cy, rev, delta: effective }], drop: [] });
  }

  /** The person's inventory, money and energy, after the starter kit is granted (once per account). */
  private sendInventory(m: WorldMember): void {
    const data: GameData = loadGameData();
    this.store
      .withTxn(async (tx) => {
        await grantStarterKit(tx, m.uid, data, Date.now());
        return accountView(tx, m.uid, data, false);
      })
      .then((v) => {
        if (this.members.get(m.id) !== m) return;
        m.conn?.send({
          t: 'world:inv',
          items: { ...v.inventory.items },
          money: v.inventory.money,
          energy: v.energy,
          maxEnergy: v.maxEnergy,
        });
      })
      .catch((err: unknown) => this.log.warn({ err: String(err), world: this.id }, 'world inventory failed'));
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

  /**
   * `starter` is read on the first world opened (a missing file refuses worlds, never the office).
   * `planners` are the action rules (the default set when omitted).
   */
  constructor(
    private readonly store: WorldStore,
    private readonly starter?: Starter,
    private readonly planners?: ActionPlanners,
    private readonly log?: { warn: (o: object, m?: string) => void },
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
    const room: WorldRoom = new WorldRoom(world, params, stored, () => this.close(room), starter, {
      store: this.store,
      planners: this.planners,
      log: this.log,
    });
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
