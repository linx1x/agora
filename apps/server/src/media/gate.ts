import { scopeKey, type MediaScope, type S2CMsg } from '@agora/shared';

/** What the gate needs from the SFU (LiveKit in production, a fake in tests). */
export interface SfuApi {
  /** A join token for one room, bound to one identity. */
  mint(room: string, identity: string, name: string, canPublish: boolean): Promise<string>;
  /** Change a connected participant's right to publish. Resolves quietly when absent. */
  setPublish(room: string, identity: string, canPublish: boolean): Promise<void>;
  /** Disconnect a participant and void the tokens they hold for that room. Quiet when absent. */
  remove(room: string, identity: string): Promise<void>;
  /** Names of the SFU rooms that currently exist and start with `prefix`. */
  rooms(prefix: string): Promise<string[]>;
  participants(room: string): Promise<{ identity: string; canPublish: boolean }[]>;
}

export interface GatePlayer {
  id: string;
  name: string;
  scope: MediaScope;
  send(msg: S2CMsg): void;
}

export interface MediaGateOptions {
  api: SfuApi;
  /** wss:// URL the browsers connect to */
  url: string;
  /** room name prefix shared by every space on this server (LIVEKIT_ROOM_PREFIX) */
  prefix: string;
  spaceId: string;
  /** live lookup of where the world room places someone (undefined = not in this space) */
  scopeOf: (identity: string) => MediaScope | undefined;
  log: { warn: (o: object, m?: string) => void };
  /** how often the SFU is checked against the world room (ms) */
  reconcileMs?: number;
}

/**
 * Server side of the SFU media rooms (ADR-031). One floor room per space plus one
 * room per private room or desk pod. The world room decides where someone is; the
 * gate turns that into SFU access:
 * - a zone token is minted only for someone the world room places in that zone;
 * - entering a zone or a quiet zone revokes the right to publish on the floor;
 * - leaving a zone removes the person from its SFU room (and voids old tokens);
 * - every few seconds the SFU's participant lists are checked against the world
 *   room, so a modified client or a missed event is corrected without trusting it.
 */
export class MediaGate {
  private queues = new Map<string, Promise<void>>();
  private timer?: NodeJS.Timeout;
  private reconciling = false;
  private lastWarn = 0;

  constructor(private o: MediaGateOptions) {}

  get floorRoom() {
    return `${this.o.prefix}:${this.o.spaceId}:floor`;
  }
  zoneRoom(zoneId: string) {
    return `${this.o.prefix}:${this.o.spaceId}:zone:${zoneId}`;
  }

  start() {
    this.timer = setInterval(() => void this.reconcile(), this.o.reconcileMs ?? 5000);
  }
  stop() {
    if (this.timer) clearInterval(this.timer);
  }

  /** Run SFU calls for one person in order (entering then leaving must not swap). */
  private queue(id: string, job: () => Promise<void>): Promise<void> {
    const prev = this.queues.get(id) ?? Promise.resolve();
    const next = prev.then(job).catch((err) => this.warn(err, 'media gate'));
    this.queues.set(id, next);
    void next.then(() => this.queues.get(id) === next && this.queues.delete(id));
    return next;
  }

  /** Wait for pending SFU calls (tests, shutdown). */
  async idle() {
    while (this.queues.size) await Promise.all([...this.queues.values()]);
  }

  private warn(err: unknown, msg: string) {
    const now = Date.now();
    if (now - this.lastWarn < 10_000) return;
    this.lastWarn = now;
    this.o.log.warn({ err: String(err) }, `${msg} failed (is the SFU reachable?)`);
  }

  private async sendGrant(p: GatePlayer) {
    const s = p.scope;
    const floor = {
      room: this.floorRoom,
      token: await this.o.api.mint(this.floorRoom, p.id, p.name, s.kind === 'floor'),
    };
    const zone =
      s.kind === 'zone'
        ? {
            room: this.zoneRoom(s.zoneId),
            token: await this.o.api.mint(this.zoneRoom(s.zoneId), p.id, p.name, true),
          }
        : null;
    // the scope may have changed while minting: only the latest placement is sent
    const now = this.o.scopeOf(p.id);
    if (!now || scopeKey(now) !== scopeKey(s)) return;
    p.send({ t: 'media:grant', url: this.o.url, floor, zone, publish: s.kind });
  }

  /** Joined or resumed: tokens for the rooms the person is placed in now. */
  joined(p: GatePlayer) {
    return this.queue(p.id, () => this.sendGrant(p));
  }

  /** Asked again (SFU connection lost for good). */
  refresh(p: GatePlayer) {
    return this.queue(p.id, () => this.sendGrant(p));
  }

  /**
   * The world room moved someone to another scope. Access is taken away first
   * (zone removal, floor publish), and only then are the new tokens sent.
   */
  moved(p: GatePlayer, from: MediaScope) {
    return this.queue(p.id, async () => {
      if (from.kind === 'zone') await this.o.api.remove(this.zoneRoom(from.zoneId), p.id);
      await this.o.api.setPublish(this.floorRoom, p.id, p.scope.kind === 'floor');
      await this.sendGrant(p);
    });
  }

  /** Left the space: out of every room. */
  left(id: string, scope: MediaScope) {
    return this.queue(id, async () => {
      if (scope.kind === 'zone') await this.o.api.remove(this.zoneRoom(scope.zoneId), id);
      await this.o.api.remove(this.floorRoom, id);
    });
  }

  /** Correct the SFU to match the world room (never the other way around). */
  async reconcile() {
    if (this.reconciling) return;
    this.reconciling = true;
    try {
      const base = `${this.o.prefix}:${this.o.spaceId}:`;
      for (const room of await this.o.api.rooms(base)) {
        const rest = room.slice(base.length);
        const zoneId = rest.startsWith('zone:') ? rest.slice(5) : null;
        if (!zoneId && rest !== 'floor') continue;
        for (const part of await this.o.api.participants(room)) {
          const scope = this.o.scopeOf(part.identity); // live, not a snapshot
          if (!scope) {
            await this.o.api.remove(room, part.identity);
            continue;
          }
          if (zoneId) {
            if (scopeKey(scope) !== `zone:${zoneId}`) await this.o.api.remove(room, part.identity);
          } else if (part.canPublish !== (scope.kind === 'floor'))
            await this.o.api.setPublish(room, part.identity, scope.kind === 'floor');
        }
      }
    } catch (err) {
      this.warn(err, 'media reconcile');
    } finally {
      this.reconciling = false;
    }
  }
}
