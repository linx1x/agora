/**
 * Direct trades in the room (P17.29): ask, answer, offers, both confirm one revision, the swap; any
 * change clears the confirmations; leaving or dropping the connection ends a trade with nothing moved;
 * a resent confirm after the swap moves nothing more; nobody else hears a trade.
 */
import { readFileSync } from 'node:fs';
import { beforeEach, describe, expect, it } from 'vitest';
import { TILE, loadGameData, parseMap, type S2CMsg, type Tmj } from '@agora/shared';
import { MemoryStore, roomStore } from '../db/store';
import { SpaceRoom, type Player } from './room';

const tmj = JSON.parse(
  readFileSync(new URL('../../../../packages/maps/hq.tmj', import.meta.url), 'utf8'),
) as Tmj;
const map = parseMap(tmj);
const data = loadGameData();
const silent = { info: () => {}, warn: () => {} };
const settle = async () => {
  for (let i = 0; i < 10; i++) await new Promise((r) => setTimeout(r, 0));
};
const cell = (cx: number, cy: number) => ({ x: cx * TILE + 16, y: cy * TILE + 26 });
const CROP = data.items.find((i) => i.category === 'open' && i.kind === 'crop')!.id;

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

function place(room: SpaceRoom, p: Player, pos: { x: number; y: number }) {
  p.x = pos.x;
  p.y = pos.y;
  p.zone = undefined;
  room.handle(p, { t: 'move', x: pos.x, y: pos.y, dir: 'down', moving: false, pose: 'stand', seq: 0 });
}

describe('direct trades (P17.29)', () => {
  let store: MemoryStore;
  let room: SpaceRoom;
  let ca: FakeConn, cb: FakeConn, cc: FakeConn;
  let a: Player, b: Player, c: Player;

  const bag = (uid: string) => store.worlds.withTxn((tx) => tx.accountOf(uid, false)).then((r) => r.inventory);
  const setBag = (uid: string, items: Record<string, number>, money: number) =>
    store.worlds.withTxn(async (tx) => {
      const r = await tx.accountOf(uid, true);
      await tx.saveAccount(uid, { items, money }, r.rev);
    });

  /** a asks b, b says yes: the trade id */
  async function open(): Promise<string> {
    room.handle(a, { t: 'trade:ask', to: b.id });
    const id = cb.of('trade:asked').at(-1)!.id;
    room.handle(b, { t: 'trade:answer', id, accept: true });
    return id;
  }

  beforeEach(async () => {
    store = new MemoryStore();
    room = new SpaceRoom(
      map,
      {
        mapId: 'hq',
        capacity: 6,
        connectR: 5,
        disconnectR: 6,
        clientConfig: {
          mediaBackend: 'p2p',
          iceServers: [],
          connectR: 5,
          disconnectR: 6,
          videoCap: 9,
          flags: { worlds: true } as never,
        },
        reconnectGraceMs: 50,
      },
      roomStore(store, 'hq'),
      silent,
    );
    await room.init();
    ca = new FakeConn();
    cb = new FakeConn();
    cc = new FakeConn();
    a = (await room.join(ca, { uid: 'ua', name: 'Alice' }))!;
    b = (await room.join(cb, { uid: 'ub', name: 'Benoît' }))!;
    c = (await room.join(cc, { uid: 'uc', name: 'Chloé' }))!;
    place(room, a, cell(60, 40));
    place(room, b, cell(61, 40));
    place(room, c, cell(62, 40));
    // the starter kit comes on first sight of the bag (once); then each test sets the bags it needs
    room.handle(a, { t: 'office:inv' });
    room.handle(b, { t: 'office:inv' });
    await settle();
    await setBag('ua', { [CROP]: 4 }, 10);
    await setBag('ub', {}, 200);
  });

  it('both confirm the same revision: the swap happens, both see their new bags, the trade closes', async () => {
    const id = await open();
    room.handle(a, { t: 'trade:offer', id, items: { [CROP]: 3 }, money: 0 });
    room.handle(b, { t: 'trade:offer', id, items: {}, money: 60 });
    const rev = cb.of('trade:state').at(-1)!.rev;
    expect(cb.of('trade:state').at(-1)).toMatchObject({ with: 'Alice', them: { items: { [CROP]: 3 }, money: 0 }, you: { money: 60 } });
    room.handle(a, { t: 'trade:confirm', id, rev });
    expect(cb.of('trade:state').at(-1)).toMatchObject({ youConfirmed: false, themConfirmed: true });
    room.handle(b, { t: 'trade:confirm', id, rev });
    await settle();
    expect(ca.of('trade:closed').at(-1)).toEqual({ t: 'trade:closed', id, reason: 'done' });
    expect(cb.of('trade:closed').at(-1)).toEqual({ t: 'trade:closed', id, reason: 'done' });
    expect(await bag('ua')).toEqual({ items: { [CROP]: 1 }, money: 70 });
    expect(await bag('ub')).toEqual({ items: { [CROP]: 3 }, money: 140 });
    expect(ca.of('world:inv').at(-1)).toMatchObject({ money: expect.any(Number) });
    // a resent confirm (after a reconnect, say) finds no trade: nothing moves again
    room.handle(b, { t: 'trade:confirm', id, rev });
    await settle();
    expect(cb.of('trade:refused').at(-1)).toMatchObject({ reason: 'gone' });
    expect(await bag('ub')).toEqual({ items: { [CROP]: 3 }, money: 140 });
    // and the third person heard nothing of it
    expect(cc.msgs.filter((m) => m.t.startsWith('trade:'))).toEqual([]);
  });

  it('any change clears both confirmations, and a confirm of an old revision is refused', async () => {
    const id = await open();
    room.handle(a, { t: 'trade:offer', id, items: { [CROP]: 1 }, money: 0 });
    const rev1 = ca.of('trade:state').at(-1)!.rev;
    room.handle(b, { t: 'trade:confirm', id, rev: rev1 });
    room.handle(a, { t: 'trade:offer', id, items: { [CROP]: 4 }, money: 0 });
    const s = cb.of('trade:state').at(-1)!;
    expect(s).toMatchObject({ youConfirmed: false, themConfirmed: false, them: { items: { [CROP]: 4 } } });
    room.handle(a, { t: 'trade:confirm', id, rev: rev1 });
    expect(ca.of('trade:refused').at(-1)).toMatchObject({ reason: 'stale', id });
    await settle();
    expect(await bag('ua')).toEqual({ items: { [CROP]: 4 }, money: 10 });
  });

  it('dropping the connection during the confirm ends the trade, and nothing moves', async () => {
    const id = await open();
    room.handle(a, { t: 'trade:offer', id, items: { [CROP]: 2 }, money: 0 });
    const rev = ca.of('trade:state').at(-1)!.rev;
    room.handle(a, { t: 'trade:confirm', id, rev });
    room.disconnect(a);
    expect(cb.of('trade:closed').at(-1)).toEqual({ t: 'trade:closed', id, reason: 'gone' });
    room.handle(b, { t: 'trade:confirm', id, rev });
    await settle();
    expect(cb.of('trade:refused').at(-1)).toMatchObject({ reason: 'gone' });
    expect(await bag('ua')).toEqual({ items: { [CROP]: 4 }, money: 10 });
    expect(await bag('ub')).toEqual({ items: {}, money: 200 });
  });

  it('a failed swap (the bag changed) moves nothing and keeps the trade open, unconfirmed', async () => {
    const id = await open();
    room.handle(a, { t: 'trade:offer', id, items: { [CROP]: 4 }, money: 0 });
    const rev = ca.of('trade:state').at(-1)!.rev;
    await setBag('ua', { [CROP]: 1 }, 10); // spent elsewhere meanwhile
    room.handle(a, { t: 'trade:confirm', id, rev });
    room.handle(b, { t: 'trade:confirm', id, rev });
    await settle();
    expect(ca.of('trade:refused').at(-1)).toMatchObject({ reason: 'missing', id });
    expect(ca.of('trade:state').at(-1)).toMatchObject({ youConfirmed: false, themConfirmed: false });
    expect(await bag('ub')).toEqual({ items: {}, money: 200 });
  });

  it('refuses someone far away, someone busy, a closed category, and myself', async () => {
    place(room, c, cell(90, 40));
    room.handle(a, { t: 'trade:ask', to: c.id });
    expect(ca.of('trade:refused').at(-1)).toMatchObject({ reason: 'far' });
    room.handle(a, { t: 'trade:ask', to: a.id });
    expect(ca.of('trade:refused').at(-1)).toMatchObject({ reason: 'self' });
    const id = await open();
    place(room, c, cell(62, 40));
    room.handle(c, { t: 'trade:ask', to: a.id });
    expect(cc.of('trade:refused').at(-1)).toMatchObject({ reason: 'busy' });
    const tool = data.items.find((i) => i.category === 'restricted')!.id;
    room.handle(a, { t: 'trade:offer', id, items: { [tool]: 1 }, money: 0 });
    expect(ca.of('trade:refused').at(-1)).toMatchObject({ reason: 'restricted' });
  });

  it('a private room keeps its trades in: someone inside cannot trade with someone outside its wall', async () => {
    place(room, a, cell(41, 16)); // inside "salle-a"
    expect(a.zone?.kind).toBe('private');
    place(room, b, cell(38, 16)); // outside its wall, within range
    room.handle(a, { t: 'trade:ask', to: b.id });
    expect(ca.of('trade:refused').at(-1)).toMatchObject({ reason: 'far' });
    expect(cb.of('trade:asked')).toEqual([]);
  });

  it('declined: both hear it, and the asker may ask someone else', async () => {
    room.handle(a, { t: 'trade:ask', to: b.id });
    const id = cb.of('trade:asked').at(-1)!.id;
    room.handle(b, { t: 'trade:answer', id, accept: false });
    expect(ca.of('trade:closed').at(-1)).toEqual({ t: 'trade:closed', id, reason: 'declined' });
    room.handle(a, { t: 'trade:ask', to: c.id });
    expect(cc.of('trade:asked')).toHaveLength(1);
  });
});
