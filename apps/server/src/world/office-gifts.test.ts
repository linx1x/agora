/**
 * Office gifts and the office shop board in the room (P17.26b): the room decides where (beside the
 * character on the open floor; in front of the board), the account action decides the rest.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  DEFAULT_FLAGS,
  TILE,
  loadGameData,
  npcAllowedAt,
  parseMap,
  stockOf,
  type S2CMsg,
  type Tmj,
} from '@agora/shared';
import { MemoryStore, roomStore } from '../db/store';
import { DEFAULT_NPCS } from './npc-personas';
import type { NpcDirector } from './npcs';
import { SpaceRoom, type Player } from './room';

const tmj = JSON.parse(
  readFileSync(new URL('../../../../packages/maps/hq.tmj', import.meta.url), 'utf8'),
) as Tmj;
const map = parseMap(tmj);
const data = loadGameData();
const silent = { info: () => {}, warn: () => {} };
const flush = async () => {
  for (let i = 0; i < 6; i++) await new Promise<void>((r) => setImmediate(r));
};
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

function place(room: SpaceRoom, p: Player, pos: { x: number; y: number }) {
  p.x = pos.x;
  p.y = pos.y;
  p.zone = undefined;
  room.handle(p, { t: 'move', x: pos.x, y: pos.y, dir: 'down', moving: false, pose: 'stand', seq: 0 });
}

const director = (room: SpaceRoom) => (room as unknown as { npcDirector: NpcDirector }).npcDirector;
const loved = data.gifts.npcs.find((p) => p.npc === 'zoe')!.love[0]!;

async function scene(worlds = true) {
  const store = new MemoryStore();
  const room = new SpaceRoom(
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
        flags: { ...DEFAULT_FLAGS, npcs: true, worlds },
      },
      npcs: { personas: () => DEFAULT_NPCS, clock: () => 10 * 60 + 30, rng: () => 0.4 },
    },
    roomStore(store, 'hq'),
    silent,
  );
  await room.init();
  await store.worlds.withTxn(async (tx) => {
    const a = await tx.accountOf('u0', true);
    await tx.saveAccount('u0', { items: { [loved]: 3 }, money: 500 }, a.rev);
  });
  const conns = [new FakeConn(), new FakeConn()];
  const players: Player[] = [];
  for (const [i, c] of conns.entries())
    players.push((await room.join(c, { uid: `u${i}`, name: `P${i}` }))!);
  await flush();
  room.tick(1000);
  const zoe = director(room).get('npc:zoe')!;
  let spot: { x: number; y: number } | undefined;
  for (let cy = 20; cy < 60 && !spot; cy++)
    for (let cx = 20; cx < 80 && !spot; cx++) {
      const p = cell(cx, cy);
      const ok = [-2, -1, 0, 1, 2].every((d) =>
        [-2, -1, 0, 1, 2].every((e) => npcAllowedAt(map, p.x + d * TILE, p.y + e * TILE)),
      );
      if (ok) spot = p;
    }
  if (!spot) throw new Error('no open floor');
  zoe.state.x = spot.x;
  zoe.state.y = spot.y;
  return { room, store, conns, players, zoe, spot };
}

const gift = (room: SpaceRoom, p: Player, key: string, npcId = 'npc:zoe', item = loved) =>
  room.handle(p, { t: 'gift', npcId, item, key });

describe('office gifts (P17.26b): the room checks where, the account action decides the rest', () => {
  it('on join, a person hears their hearts with each character', async () => {
    const { conns } = await scene();
    expect(conns[0]!.of('friendship').at(-1)?.hearts).toEqual({ zoe: 0, felix: 0, theo: 0 });
  });

  it('a gift beside the character is taken: the taste, the hearts and the new bag come back', async () => {
    const { room, players, conns, spot } = await scene();
    place(room, players[0]!, { x: spot.x + TILE, y: spot.y });
    gift(room, players[0]!, 'room-gift-0001');
    await flush();
    const r = conns[0]!.of('gift:result').at(-1)!;
    expect(r).toMatchObject({ key: 'room-gift-0001', npcId: 'npc:zoe', ok: true, taste: 'love' });
    expect(r.hearts?.zoe).toBe(Math.floor(data.gifts.points.love / 250));
    expect(conns[0]!.of('friendship').at(-1)?.hearts).toEqual(r.hearts);
    expect(conns[0]!.of('world:inv').at(-1)?.items[loved]).toBe(2);
    // the other person hears nothing about it
    expect(conns[1]!.of('gift:result')).toHaveLength(0);
    expect(conns[1]!.of('world:inv')).toHaveLength(0);
  });

  it('refuses a giver too far away, and accepts one near (control)', async () => {
    const { room, players, conns, spot } = await scene();
    place(room, players[0]!, { x: spot.x + 12 * TILE, y: spot.y });
    gift(room, players[0]!, 'room-gift-0002');
    await flush();
    expect(conns[0]!.of('gift:result').at(-1)).toMatchObject({ ok: false, reason: 'range' });
    place(room, players[0]!, { x: spot.x + TILE, y: spot.y });
    gift(room, players[0]!, 'room-gift-0003');
    await flush();
    expect(conns[0]!.of('gift:result').at(-1)).toMatchObject({ ok: true });
  });

  it('refuses from a private room even with the character right outside its wall', async () => {
    const { room, players, conns, zoe } = await scene();
    const p = players[0]!;
    place(room, p, cell(41, 16)); // inside "salle-a"
    expect(p.zone?.kind).toBe('private');
    zoe.state.x = cell(38, 14).x;
    zoe.state.y = cell(38, 14).y;
    gift(room, p, 'room-gift-0004');
    await flush();
    expect(conns[0]!.of('gift:result').at(-1)).toMatchObject({ ok: false, reason: 'zone' });
    expect(conns[0]!.of('world:inv')).toHaveLength(0);
  });

  it('refuses a character that does not take gifts, and everything while personal worlds are off', async () => {
    const { room, players, conns, spot } = await scene();
    place(room, players[0]!, { x: spot.x + TILE, y: spot.y });
    gift(room, players[0]!, 'room-gift-0005', 'npc:nobody');
    await flush();
    expect(conns[0]!.of('gift:result').at(-1)).toMatchObject({ ok: false, reason: 'gone' });

    const off = await scene(false);
    expect(off.conns[0]!.of('friendship')).toHaveLength(0);
    place(off.room, off.players[0]!, { x: off.spot.x + TILE, y: off.spot.y });
    gift(off.room, off.players[0]!, 'room-gift-0006');
    off.room.handle(off.players[0]!, { t: 'office:buy', item: stockOf(data)[0]!.id, key: 'room-buy-0006' });
    await flush();
    expect(off.conns[0]!.of('gift:result').at(-1)).toMatchObject({ ok: false, reason: 'disabled' });
    expect(off.conns[0]!.of('office:bought').at(-1)).toMatchObject({ ok: false, reason: 'disabled' });
  });
});

describe('the office shop board (P17.26b)', () => {
  const board = map.zones.find((z) => z.kind === 'shop')!;

  it('the map has one board, on the open floor of the hub', () => {
    expect(map.zones.filter((z) => z.kind === 'shop').map((z) => z.id)).toEqual(['comptoir']);
    expect(board.region).toBe('hub');
  });

  it('sells only to someone standing in front of it', async () => {
    const { room, players, conns } = await scene();
    const item = stockOf(data)[0]!.id;
    place(room, players[0]!, cell(5, 5));
    room.handle(players[0]!, { t: 'office:buy', item, key: 'room-buy-0001' });
    await flush();
    expect(conns[0]!.of('office:bought').at(-1)).toMatchObject({ ok: false, reason: 'range' });

    const front = { x: board.x + TILE / 2, y: board.y + TILE / 2 + 10 };
    place(room, players[0]!, front);
    expect(players[0]!.x).toBe(front.x);
    room.handle(players[0]!, { t: 'office:buy', item, key: 'room-buy-0002' });
    await flush();
    expect(conns[0]!.of('office:bought').at(-1)).toMatchObject({ key: 'room-buy-0002', ok: true });
    // the starter kit (granted on first sight) plus the one bought
    const kit = data.progression.starterKit.items[item] ?? 0;
    expect(conns[0]!.of('world:inv').at(-1)?.items[item]).toBe(kit + 1);
  });

  it('office:inv answers with the bag and the hearts', async () => {
    const { room, players, conns } = await scene();
    room.handle(players[0]!, { t: 'office:inv' });
    await flush();
    expect(conns[0]!.of('world:inv').at(-1)).toMatchObject({
      items: { [loved]: 3 },
      money: 500 + (data.progression.starterKit.money ?? 0),
    });
    expect(conns[0]!.of('friendship').length).toBeGreaterThanOrEqual(2);
  });
});

describe('the marketplace board in the room (P17.30)', () => {
  const board = map.zones.find((z) => z.kind === 'shop')!;
  const front = { x: board.x + TILE / 2, y: board.y + TILE / 2 + 10 };

  it('works only at the board; a sale reaches the seller and every board view, never the seller’s name', async () => {
    const { room, players, conns } = await scene();
    const [seller, buyer] = players as [Player, Player];
    room.handle(seller, { t: 'market:browse' });
    room.handle(seller, { t: 'market:list', item: loved, qty: 1, price: 30, key: 'room-list-0001' });
    await flush();
    expect(conns[0]!.of('market:result').at(-1)).toMatchObject({ op: 'list', ok: false, reason: 'range' });
    expect(conns[0]!.of('market:board')).toHaveLength(0);

    place(room, seller, front);
    place(room, buyer, { x: front.x + TILE, y: front.y });
    room.handle(seller, { t: 'market:list', item: loved, qty: 1, price: 30, key: 'room-list-0002' });
    await flush();
    expect(conns[0]!.of('market:result').at(-1)).toMatchObject({ op: 'list', ok: true });
    const seen = conns[1]!.of('market:board').at(-1)!;
    expect(seen.listings).toHaveLength(1);
    expect(seen.listings[0]).toMatchObject({ item: loved, qty: 1, price: 30, mine: false });
    expect(JSON.stringify(seen)).not.toContain('u0');

    room.handle(buyer, { t: 'market:buy', id: seen.listings[0]!.id, key: 'room-buy-0101' });
    await flush();
    expect(conns[1]!.of('market:result').at(-1)).toMatchObject({ op: 'buy', ok: true });
    expect(conns[0]!.of('market:sold').at(-1)).toEqual({ t: 'market:sold', item: loved, qty: 1, price: 30 });
    expect(conns[1]!.of('market:board').at(-1)!.listings).toEqual([]);
  });
});
