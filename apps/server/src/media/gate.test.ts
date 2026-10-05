import { readFileSync } from 'node:fs';
import { beforeEach, describe, expect, it } from 'vitest';
import { TILE, parseMap, type S2CMsg, type Tmj } from '@agora/shared';
import { MemoryStore, roomStore } from '../db/store';
import { SpaceRoom, type Player } from '../world/room';
import type { SfuApi } from './gate';

const tmj = JSON.parse(
  readFileSync(new URL('../../../../packages/maps/hq.tmj', import.meta.url), 'utf8'),
) as Tmj;
const silent = { info: () => {}, warn: () => {} };
const cell = (cx: number, cy: number) => ({ x: cx * TILE + 16, y: cy * TILE + 26 });

class FakeConn {
  msgs: S2CMsg[] = [];
  send(m: S2CMsg) {
    this.msgs.push(m);
  }
  close() {}
  of<T extends S2CMsg['t']>(t: T) {
    return this.msgs.filter((m): m is Extract<S2CMsg, { t: T }> => m.t === t);
  }
}

interface Tok {
  room: string;
  identity: string;
  canPublish: boolean;
  nbf: number;
}

/**
 * A model of the SFU: rooms with participants, tokens that carry their grants, and
 * per-person token revocation. Clients "connect" with a token like LiveKit checks it.
 */
class FakeSfu implements SfuApi {
  state = new Map<string, Map<string, { canPublish: boolean }>>();
  revoked = new Map<string, number>();
  log: string[] = [];
  /** called on every mint, to check the world room placement at that moment */
  onMint?: (room: string, identity: string) => void;
  clock = 1000;

  async mint(room: string, identity: string, _name: string, canPublish: boolean) {
    this.onMint?.(room, identity);
    this.log.push(`mint ${room} ${identity} ${canPublish ? 'pub' : 'sub'}`);
    return JSON.stringify({ room, identity, canPublish, nbf: this.clock } satisfies Tok);
  }
  async setPublish(room: string, identity: string, canPublish: boolean) {
    this.log.push(`perm ${room} ${identity} ${canPublish ? 'pub' : 'sub'}`);
    const p = this.state.get(room)?.get(identity);
    if (p) p.canPublish = canPublish;
  }
  async remove(room: string, identity: string) {
    this.log.push(`remove ${room} ${identity}`);
    this.state.get(room)?.delete(identity);
    this.revoked.set(`${room}|${identity}`, this.clock);
  }
  async rooms(prefix: string) {
    return [...this.state.keys()].filter((r) => r.startsWith(prefix));
  }
  async participants(room: string) {
    return [...(this.state.get(room) ?? new Map()).entries()].map(([identity, v]) => ({
      identity,
      canPublish: v.canPublish,
    }));
  }
  /** A browser joining with a token: refused when the token was revoked. */
  connect(token: string): boolean {
    const t = JSON.parse(token) as Tok;
    if (t.nbf < (this.revoked.get(`${t.room}|${t.identity}`) ?? 0)) return false;
    if (!this.state.has(t.room)) this.state.set(t.room, new Map());
    this.state.get(t.room)!.set(t.identity, { canPublish: t.canPublish });
    return true;
  }
  in(room: string) {
    return [...(this.state.get(room)?.keys() ?? [])].sort();
  }
}

function makeRoom(sfu: FakeSfu) {
  return new SpaceRoom(
    parseMap(tmj),
    {
      mapId: 'hq',
      capacity: 10,
      connectR: 5,
      disconnectR: 6,
      clientConfig: {
        mediaBackend: 'livekit',
        iceServers: [],
        connectR: 5,
        disconnectR: 6,
        videoCap: 9,
        flags: {} as never,
      },
      reconnectGraceMs: 50,
      sfu: { api: sfu, url: 'wss://rtc.test', prefix: 'agora' },
    },
    roomStore(new MemoryStore(), 'hq'),
    silent,
  );
}

function place(room: SpaceRoom, p: Player, pos: { x: number; y: number }) {
  p.x = pos.x;
  p.y = pos.y;
  p.zone = undefined;
  room.handle(p, { t: 'move', x: pos.x, y: pos.y, dir: 'down', moving: false, seq: 0 });
}

const FLOOR = 'agora:hq:floor';
const SALLE_A = 'agora:hq:zone:salle-a';

describe('SFU media rooms (ADR-031): private rooms are enforced by the server', () => {
  let sfu: FakeSfu;
  let room: SpaceRoom;
  let ca: FakeConn, cb: FakeConn, cc: FakeConn;
  let a: Player, b: Player, c: Player;
  /** every zone token minted, with where the world room placed that person then */
  let minted: { room: string; identity: string; scope: string }[];

  /** What a genuine browser does with its latest grant: join the rooms it is given. */
  const follow = (conn: FakeConn) => {
    const g = conn.of('media:grant').at(-1);
    if (!g) return;
    const me = (JSON.parse(g.floor.token) as Tok).identity;
    if (!sfu.in(g.floor.room).includes(me)) sfu.connect(g.floor.token); // a live connection is kept
    if (g.zone) sfu.connect(g.zone.token);
  };
  const settle = async () => {
    room.tick();
    await room.gate!.idle();
  };

  beforeEach(async () => {
    sfu = new FakeSfu();
    minted = [];
    room = makeRoom(sfu);
    sfu.onMint = (r, identity) => {
      const p = room.players.get(identity);
      minted.push({
        room: r,
        identity,
        scope: p ? (p.scope.kind === 'zone' ? `zone:${p.scope.zoneId}` : p.scope.kind) : 'gone',
      });
    };
    await room.init();
    ca = new FakeConn();
    cb = new FakeConn();
    cc = new FakeConn();
    a = (await room.join(ca, { uid: 'ua', name: 'A' }))!;
    b = (await room.join(cb, { uid: 'ub', name: 'B' }))!;
    c = (await room.join(cc, { uid: 'uc', name: 'C' }))!;
    await settle();
    for (const conn of [ca, cb, cc]) follow(conn);
    // A and B walk into meeting room "salle-a"; C stands in the lane right outside its wall.
    place(room, a, cell(41, 16));
    place(room, b, cell(44, 12));
    place(room, c, cell(38, 14));
    await settle();
    for (const conn of [ca, cb, cc]) follow(conn);
  });

  it('joining gives a floor token only; the world socket says which room to publish to', async () => {
    const d = new FakeConn();
    await room.join(d, { uid: 'ud', name: 'D' });
    await settle();
    const g = d.of('media:grant')[0]!;
    expect(g).toMatchObject({ url: 'wss://rtc.test', zone: null, publish: 'floor' });
    expect(g.floor.room).toBe(FLOOR);
    expect(JSON.parse(g.floor.token)).toMatchObject({ room: FLOOR, canPublish: true });
  });

  it('isolation: only people inside get a zone token; C outside the wall never does', () => {
    expect(ca.of('media:grant').at(-1)).toMatchObject({ publish: 'zone', zone: { room: SALLE_A } });
    expect(cb.of('media:grant').at(-1)?.zone?.room).toBe(SALLE_A);
    expect(cc.of('media:grant').every((g) => g.zone === null)).toBe(true);
    expect(sfu.in(SALLE_A)).toEqual([a.id, b.id].sort());
    // every zone token ever minted went to someone the server placed in that zone
    for (const m of minted.filter((x) => x.room.includes(':zone:')))
      expect(`agora:hq:${m.scope}`).toBe(m.room);
  });

  it('isolation: entering a room revokes floor publishing before the zone token is sent', () => {
    const order = sfu.log.filter((l) => l.includes(a.id));
    const revoke = order.indexOf(`perm ${FLOOR} ${a.id} sub`);
    const zoneMint = order.indexOf(`mint ${SALLE_A} ${a.id} pub`);
    expect(revoke).toBeGreaterThanOrEqual(0);
    expect(zoneMint).toBeGreaterThan(revoke);
    expect(sfu.state.get(FLOOR)?.get(a.id)?.canPublish).toBe(false);
    expect(sfu.state.get(FLOOR)?.get(c.id)?.canPublish).toBe(true);
  });

  it('isolation: leaving the room removes you from its SFU room and voids your old token', async () => {
    const oldToken = cb.of('media:grant').at(-1)!.zone!.token;
    sfu.clock = 2000;
    place(room, b, cell(42, 22));
    await settle();
    expect(b.scope.kind).toBe('floor');
    expect(sfu.in(SALLE_A)).toEqual([a.id]);
    const g = cb.of('media:grant').at(-1)!;
    expect(g).toMatchObject({ zone: null, publish: 'floor' });
    expect(sfu.state.get(FLOOR)?.get(b.id)?.canPublish).toBe(true);
    // a modified client replaying the old zone token is refused
    expect(sfu.connect(oldToken)).toBe(false);
    expect(sfu.in(SALLE_A)).toEqual([a.id]);
    // removal happened before the new floor grant was minted
    const log = sfu.log.filter((l) => l.includes(b.id));
    expect(log.indexOf(`remove ${SALLE_A} ${b.id}`)).toBeLessThan(
      log.lastIndexOf(`mint ${FLOOR} ${b.id} pub`),
    );
  });

  it('quiet zone: nothing published anywhere, no zone room', async () => {
    place(room, c, cell(45, 5));
    expect(c.zone?.kind).toBe('quiet');
    await settle();
    expect(cc.of('media:grant').at(-1)).toMatchObject({ zone: null, publish: 'none' });
    expect(sfu.state.get(FLOOR)?.get(c.id)?.canPublish).toBe(false);
  });

  it('reconcile: the SFU is corrected to match the world room, never trusted', async () => {
    // C forges its way into the zone room (e.g. a token leaked), a stranger sits on the floor,
    // and A somehow regained floor publishing while inside.
    sfu.state.get(SALLE_A)!.set(c.id, { canPublish: true });
    sfu.state.get(FLOOR)!.set('stranger', { canPublish: true });
    sfu.state.get(FLOOR)!.get(a.id)!.canPublish = true;
    await room.gate!.reconcile();
    expect(sfu.in(SALLE_A)).toEqual([a.id, b.id].sort());
    expect(sfu.in(FLOOR)).not.toContain('stranger');
    expect(sfu.state.get(FLOOR)?.get(a.id)?.canPublish).toBe(false);
    expect(sfu.state.get(FLOOR)?.get(c.id)?.canPublish).toBe(true);
  });

  it('asking for tokens again only ever returns the rooms you are placed in', async () => {
    room.handle(c, { t: 'media:token' });
    await settle();
    expect(cc.of('media:grant').at(-1)).toMatchObject({ zone: null, publish: 'floor' });
  });

  it('no peer-to-peer signalling is relayed with the SFU backend', () => {
    room.handle(a, { t: 'rtc', to: b.id, data: { kind: 'offer', sdp: 'v=0' } });
    expect(cb.of('rtc')).toHaveLength(0);
    expect(ca.of('error').at(-1)?.code).toBe('rtc_off');
  });

  it('leaving the space removes you from every SFU room', async () => {
    room.handle(a, { t: 'leave' });
    await settle();
    expect(sfu.in(SALLE_A)).toEqual([b.id]);
    expect(sfu.in(FLOOR)).not.toContain(a.id);
  });

  it('screen sharing is announced in the profile', () => {
    room.handle(a, { t: 'media', mic: true, cam: false, screen: true });
    expect(cb.of('profile').at(-1)?.profile).toMatchObject({ id: a.id, screen: true });
  });
});
