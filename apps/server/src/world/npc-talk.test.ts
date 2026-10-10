import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  DEFAULT_FLAGS,
  NPC_TALK_TILES,
  TICK_HZ,
  TILE,
  consentVersion,
  npcAllowedAt,
  parseMap,
  type S2CMsg,
  type Tmj,
} from '@agora/shared';
import { MemoryStore, roomStore } from '../db/store';
import { Brain, fakeDecider } from '../npc-brain/decide';
import { fakeCompleter } from '../npc-brain/llm';
import { NpcLineBanks } from '../npc-brain/lines';
import { MemoryKeeper } from '../npc-brain/memory';
import type { VoiceClient } from '../npc-brain/voice';
import { TalkBudget, TalkEngine, type TalkResult } from '../npc-brain/talk';
import { DEFAULT_NPCS } from './npc-personas';
import type { NpcDirector, NpcTalkLink } from './npcs';
import { SpaceRoom, type Player } from './room';

const tmj = JSON.parse(
  readFileSync(new URL('../../../../packages/maps/hq.tmj', import.meta.url), 'utf8'),
) as Tmj;
const map = parseMap(tmj);
const silent = { info: () => {}, warn: () => {} };
const STEP = 1000 / TICK_HZ;
const flush = () => new Promise<void>((r) => setImmediate(r));
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
  room.handle(p, {
    t: 'move',
    x: pos.x,
    y: pos.y,
    dir: 'down',
    moving: false,
    pose: 'stand',
    seq: 0,
  });
}

/** A real engine on fake Clef and a fake cloud model, so a test can count what reached them. */
function realEngine(notice = false) {
  const clef = fakeDecider((id) =>
    id === 'kind'
      ? { top: 'greeting', p: 0.95 }
      : id === 'pii'
        ? { top: 'no', p: 0.95 }
        : id === 'lang'
          ? { top: 'fr', p: 0.95 }
          : undefined,
  );
  const llm = fakeCompleter(() => 'Bien sûr!');
  const engine = new TalkEngine({
    brain: new Brain(clef, 0.7, silent, { backoffMs: 1 }),
    llm,
    banks: new NpcLineBanks(undefined, silent),
    budget: new TalkBudget(60, 1),
    cfg: { minP: 0.7, llmTimeoutMs: 1000 },
    rng: () => 0.3,
    log: silent,
  });
  return { engine, clef, llm, notice };
}

function setup(
  opts: {
    notice?: boolean;
    engine?: TalkEngine;
    talk?: boolean;
    memory?: boolean;
    voice?: Pick<VoiceClient, 'speak'>;
  } = {},
) {
  const store = new MemoryStore();
  const real = realEngine();
  const link: NpcTalkLink = {
    engine: opts.engine ?? real.engine,
    voice: opts.voice,
    memory: opts.memory
      ? new MemoryKeeper({
          store,
          brain: new Brain(null, 0.7, silent),
          budget: new TalkBudget(60, 1),
          log: silent,
          days: 90,
          timeoutMs: 1000,
        })
      : undefined,
    notice: {
      needed: opts.notice ?? false,
      provider: 'DeepSeek',
      country: 'CN',
      version: consentVersion('DeepSeek', 'CN'),
    },
    consent: {
      has: async (uid) => (await store.getNpcConsent(uid)) === consentVersion('DeepSeek', 'CN'),
      set: (uid, accept) =>
        store.setNpcConsent(uid, accept ? consentVersion('DeepSeek', 'CN') : null),
    },
  };
  const clock = { minute: 10 * 60 + 30 };
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
        flags: { ...DEFAULT_FLAGS, npcs: true, npcTalk: opts.talk ?? true, npcVoice: !!opts.voice },
      },
      npcs: { personas: () => DEFAULT_NPCS, clock: () => clock.minute, rng: () => 0.4, talk: link },
    },
    roomStore(store, 'hq'),
    silent,
  );
  return { room, store, link, real };
}

const director = (room: SpaceRoom) => (room as unknown as { npcDirector: NpcDirector }).npcDirector;

/** Join `n` people, tick so the characters appear, and hold Zoé still on open floor. */
async function scene(opts: Parameters<typeof setup>[0] = {}) {
  const s = setup(opts);
  await s.room.init();
  const conns = [new FakeConn(), new FakeConn(), new FakeConn(), new FakeConn()];
  const players: Player[] = [];
  for (const [i, c] of conns.entries())
    players.push((await s.room.join(c, { uid: `u${i}`, name: `P${i}` }))!);
  await flush();
  s.room.tick(1000);
  const zoe = director(s.room).get('npc:zoe')!;
  // open floor, away from any wall: find a cell around which a 3x3 block is open floor
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
  return { ...s, conns, players, zoe, spot };
}

const talk = (room: SpaceRoom, p: Player, body = 'Salut Zoé!', npcId = 'npc:zoe') =>
  room.handle(p, { t: 'npc:talk', npcId, body });
const says = (c: FakeConn) => c.of('npc:say');
const refusals = (c: FakeConn) => c.of('npc:refused').map((m) => m.reason);

describe('talking to a character (P15.4, ADR-045): who may speak and who hears', () => {
  it('a person beside a character on the open floor is answered, and so is a bystander in chat range (control)', async () => {
    const { room, players, conns, spot } = await scene();
    place(room, players[0]!, { x: spot.x + TILE, y: spot.y });
    place(room, players[1]!, { x: spot.x, y: spot.y + 2 * TILE });
    talk(room, players[0]!);
    await flush();
    await flush();
    expect(refusals(conns[0]!)).toEqual([]);
    expect(says(conns[0]!)).toHaveLength(1);
    expect(says(conns[0]!)[0]!.to).toBe(players[0]!.id);
    expect(says(conns[1]!)).toHaveLength(1);
    expect(says(conns[1]!)[0]!.mid).toBe(says(conns[0]!)[0]!.mid);
  });

  it('someone far from the character hears nothing (negative control for the recipients)', async () => {
    const { room, players, conns, spot } = await scene();
    place(room, players[0]!, { x: spot.x + TILE, y: spot.y });
    place(room, players[2]!, cell(5, 5));
    talk(room, players[0]!);
    await flush();
    await flush();
    expect(says(conns[0]!)).toHaveLength(1);
    expect(says(conns[2]!)).toHaveLength(0);
    expect(conns[2]!.of('npc:typing')).toHaveLength(0);
  });

  it('refuses from a private room even when the character is right outside, and accepts on the open floor (control)', async () => {
    const { room, players, conns, zoe } = await scene();
    const p = players[0]!;
    place(room, p, cell(41, 16)); // inside the private room "salle-a"
    expect(p.zone?.kind).toBe('private');
    zoe.state.x = cell(38, 14).x; // in the lane right outside its wall, within talking range
    zoe.state.y = cell(38, 14).y;
    talk(room, p);
    await flush();
    expect(refusals(conns[0]!)).toEqual(['zone']);
    expect(says(conns[0]!)).toHaveLength(0);
  });

  it('refuses a person too far away, accepts one near (control), and says why', async () => {
    const { room, players, conns, spot } = await scene();
    const p = players[0]!;
    place(room, p, { x: spot.x + (NPC_TALK_TILES + 2) * TILE, y: spot.y });
    talk(room, p);
    expect(refusals(conns[0]!)).toEqual(['range']);
    place(room, p, { x: spot.x + TILE, y: spot.y });
    (p.buckets.talk as unknown as { tokens: number }).tokens = 4;
    talk(room, p);
    await flush();
    await flush();
    expect(refusals(conns[0]!)).toEqual(['range']);
    expect(says(conns[0]!)).toHaveLength(1);
  });

  it('refuses a character that is not here, and everything when the flag is off', async () => {
    const { room, players, conns, spot } = await scene();
    place(room, players[0]!, { x: spot.x + TILE, y: spot.y });
    talk(room, players[0]!, 'Salut', 'npc:nobody');
    expect(refusals(conns[0]!)).toEqual(['gone']);
    const off = await scene({ talk: false });
    place(off.room, off.players[0]!, { x: off.spot.x + TILE, y: off.spot.y });
    talk(off.room, off.players[0]!);
    expect(refusals(off.conns[0]!)).toEqual(['off']);
  });

  it('asks for the AI notice first, and only a person who accepted it is answered', async () => {
    const { room, players, conns, spot, real } = await scene({ notice: true });
    const [a, b] = [players[0]!, players[1]!];
    place(room, a, { x: spot.x + TILE, y: spot.y });
    place(room, b, { x: spot.x - TILE, y: spot.y });
    expect(conns[0]!.of('npc:consent').at(-1)?.consent).toMatchObject({
      needed: true,
      ok: false,
      provider: 'DeepSeek',
      country: 'CN',
    });
    talk(room, a);
    expect(refusals(conns[0]!)).toEqual(['consent']);
    expect(real.clef.calls).toHaveLength(0);
    room.handle(a, { t: 'npc:consent', accept: true });
    await flush();
    await flush();
    expect(conns[0]!.of('npc:consent').at(-1)?.consent.ok).toBe(true);
    // the other person did not accept: still refused (control that consent is per person)
    talk(room, b);
    expect(refusals(conns[1]!)).toEqual(['consent']);
    talk(room, a);
    await flush();
    await flush();
    expect(says(conns[0]!)).toHaveLength(1);
  });

  it('forgets a refusal: declining the notice closes the door again', async () => {
    const { room, players, conns, spot, store } = await scene({ notice: true });
    const a = players[0]!;
    place(room, a, { x: spot.x + TILE, y: spot.y });
    room.handle(a, { t: 'npc:consent', accept: true });
    await flush();
    await flush();
    expect(await store.getNpcConsent('u0')).toBe(consentVersion('DeepSeek', 'CN'));
    room.handle(a, { t: 'npc:consent', accept: false });
    await flush();
    await flush();
    expect(await store.getNpcConsent('u0')).toBeNull();
    (a.buckets.talk as unknown as { tokens: number }).tokens = 4;
    talk(room, a);
    expect(refusals(conns[0]!).at(-1)).toBe('consent');
  });

  it('a person who walks into a private room while the reply is being written gets nothing', async () => {
    let release!: (r: TalkResult) => void;
    const stub = {
      handle: (_i: unknown, h: { thinking: () => void }) => {
        h.thinking();
        return new Promise<TalkResult>((r) => (release = r));
      },
      end: () => {},
    } as unknown as TalkEngine;
    const { room, players, conns, spot } = await scene({ engine: stub });
    const [a, b] = [players[0]!, players[1]!];
    place(room, a, { x: spot.x + TILE, y: spot.y });
    place(room, b, { x: spot.x, y: spot.y + TILE });
    talk(room, a);
    await flush();
    // both see the character "typing" …
    expect(conns[0]!.of('npc:typing').map((m) => m.on)).toEqual([true]);
    expect(conns[1]!.of('npc:typing').map((m) => m.on)).toEqual([true]);
    // … then B steps into a private room before the line arrives
    place(room, b, cell(44, 12));
    expect(b.zone?.kind).toBe('private');
    release({
      say: 'Réponse secrète',
      emote: null,
      action: 'none',
      kind: 'other',
      route: 'llm',
      lang: 'fr',
      via: 'clef',
      ms: 5,
    });
    await flush();
    await flush();
    expect(says(conns[0]!).map((m) => m.body)).toEqual(['Réponse secrète']);
    expect(says(conns[1]!)).toHaveLength(0);
    expect(conns[1]!.of('npc:typing').map((m) => m.on)).toEqual([true]); // no "off" either: it left the range of hearing
  });

  it('only one message at a time per character, and a flood is refused', async () => {
    const stub = {
      handle: () => new Promise<TalkResult>(() => {}),
      end: () => {},
    } as unknown as TalkEngine;
    const { room, players, conns, spot } = await scene({ engine: stub });
    place(room, players[0]!, { x: spot.x + TILE, y: spot.y });
    talk(room, players[0]!);
    talk(room, players[0]!);
    expect(refusals(conns[0]!)).toEqual(['rate']);
  });

  it('nearby chat and "everyone" chat between people never reach Clef or the cloud model', async () => {
    const { room, players, spot, real } = await scene();
    const [a, b] = [players[0]!, players[1]!];
    place(room, a, { x: spot.x + TILE, y: spot.y });
    place(room, b, { x: spot.x, y: spot.y + TILE });
    room.handle(a, { t: 'chat', scope: 'nearby', body: 'Mon numéro est 418 555 0199' });
    room.handle(b, { t: 'chat', scope: 'everyone', body: 'Bonjour tout le monde' });
    room.tick(5000);
    await flush();
    await flush();
    expect(real.clef.calls).toHaveLength(0);
    expect(real.llm.calls).toHaveLength(0);
    // control: the same words through the Talk box do reach Clef
    talk(room, a, 'Bonjour Zoé');
    await flush();
    await flush();
    expect(real.clef.calls.length).toBeGreaterThan(0);
  });

  it('leaving ends the conversation memory for that person', async () => {
    const ended: string[] = [];
    const stub = {
      handle: async () => ({}),
      end: (k: string) => ended.push(k),
    } as unknown as TalkEngine;
    const { room, players } = await scene({ engine: stub });
    room.remove?.(players[0]!);
    expect(ended).toContain('u0');
  });
});

describe('what characters remember (P15.5): only the person it is about sees it, and can erase it', () => {
  it('"recall" returns the asker’s own notes, never another person’s (negative control: nothing kept)', async () => {
    const { room, players, conns, store } = await scene({ memory: true });
    await store.setNpcMemory('u0', 'zoe', 'Aime le thé.');
    await store.setNpcMemory('u1', 'zoe', 'Secret de la personne 1.');
    room.handle(players[0]!, { t: 'npc:recall', npcId: 'npc:zoe' });
    room.handle(players[2]!, { t: 'npc:recall', npcId: 'npc:zoe' });
    await flush();
    await flush();
    expect(conns[0]!.of('npc:memory').map((m) => m.summary)).toEqual(['Aime le thé.']);
    expect(conns[2]!.of('npc:memory').map((m) => m.summary)).toEqual([null]);
    expect(JSON.stringify(conns[0]!.msgs)).not.toContain('Secret');
    expect(JSON.stringify(conns[2]!.msgs)).not.toContain('Secret');
    expect(conns[1]!.of('npc:memory')).toHaveLength(0);
  });

  it('"forget" deletes the asker’s notes with every character and confirms, leaving other people’s', async () => {
    const { room, players, conns, store } = await scene({ memory: true });
    await store.setNpcMemory('u0', 'zoe', 'a');
    await store.setNpcMemory('u0', 'felix', 'b');
    await store.setNpcMemory('u1', 'zoe', 'c');
    room.handle(players[0]!, { t: 'npc:forget' });
    await flush();
    await flush();
    expect(conns[0]!.of('npc:forgot')).toHaveLength(1);
    expect(await store.getNpcMemory('u0', 'zoe')).toBeNull();
    expect(await store.getNpcMemory('u0', 'felix')).toBeNull();
    expect(await store.getNpcMemory('u1', 'zoe')).toBe('c');
  });

  it('withdrawing the AI notice also deletes the notes', async () => {
    const { room, players, store, spot } = await scene({ memory: true, notice: true });
    place(room, players[0]!, { x: spot.x + TILE, y: spot.y });
    await store.setNpcMemory('u0', 'zoe', 'a');
    room.handle(players[0]!, { t: 'npc:consent', accept: false });
    await flush();
    await flush();
    expect(await store.getNpcMemory('u0', 'zoe')).toBeNull();
  });

  it('does nothing when the flag is off (no memory link)', async () => {
    const { room, players, conns, store } = await scene();
    await store.setNpcMemory('u0', 'zoe', 'a');
    room.handle(players[0]!, { t: 'npc:recall', npcId: 'npc:zoe' });
    await flush();
    expect(conns[0]!.of('npc:memory')).toHaveLength(0);
    expect(await store.getNpcMemory('u0', 'zoe')).toBe('a');
  });
});

describe('character voices (P15.6): a clip goes only to people who asked and are still in reach', () => {
  const clip = { opus: Buffer.from('OggS-fake'), ms: 1200 };
  const spoken: string[] = [];
  const voice = {
    speak: async (text: string) => {
      spoken.push(text);
      return clip;
    },
  };
  const voices = (c: FakeConn) => c.of('npc:voice');

  it('sends the clip to the listener who asked, not to one who did not, nor one far away (controls)', async () => {
    spoken.length = 0;
    const { room, players, conns, spot } = await scene({ voice });
    place(room, players[0]!, { x: spot.x + TILE, y: spot.y });
    place(room, players[1]!, { x: spot.x, y: spot.y + 2 * TILE });
    place(room, players[2]!, cell(5, 5));
    room.handle(players[0]!, { t: 'npc:voice', on: true });
    room.handle(players[2]!, { t: 'npc:voice', on: true });
    talk(room, players[0]!);
    await flush();
    await flush();
    await flush();
    expect(voices(conns[0]!)).toHaveLength(1);
    expect(voices(conns[0]!)[0]).toMatchObject({ ms: 1200 });
    expect(Buffer.from(voices(conns[0]!)[0]!.data, 'base64').toString()).toBe('OggS-fake');
    expect(voices(conns[0]!)[0]!.mid).toBe(says(conns[0]!)[0]!.mid);
    expect(voices(conns[1]!)).toHaveLength(0); // heard the line, did not ask for voices
    expect(voices(conns[2]!)).toHaveLength(0); // asked, but is far away
  });

  it('synthesises nothing when nobody who heard the line asked for voices', async () => {
    spoken.length = 0;
    const { room, players, spot } = await scene({ voice });
    place(room, players[0]!, { x: spot.x + TILE, y: spot.y });
    talk(room, players[0]!);
    await flush();
    await flush();
    await flush();
    expect(spoken).toHaveLength(0);
  });

  it('a person who walks into a private room while the voice is being made gets no sound', async () => {
    let release!: () => void;
    const slow = {
      speak: () => new Promise<typeof clip>((r) => (release = () => r(clip))),
    };
    const { room, players, conns, spot } = await scene({ voice: slow });
    const [a, b] = [players[0]!, players[1]!];
    place(room, a, { x: spot.x + TILE, y: spot.y });
    place(room, b, { x: spot.x, y: spot.y + TILE });
    room.handle(a, { t: 'npc:voice', on: true });
    room.handle(b, { t: 'npc:voice', on: true });
    talk(room, a);
    await flush();
    await flush();
    await flush();
    place(room, b, cell(44, 12)); // private room
    release();
    await flush();
    await flush();
    expect(voices(conns[0]!)).toHaveLength(1);
    expect(voices(conns[1]!)).toHaveLength(0);
  });

  it('a voice service that is down changes nothing: the text still arrives', async () => {
    const { room, players, conns, spot } = await scene({ voice: { speak: async () => null } });
    place(room, players[0]!, { x: spot.x + TILE, y: spot.y });
    room.handle(players[0]!, { t: 'npc:voice', on: true });
    talk(room, players[0]!);
    await flush();
    await flush();
    await flush();
    expect(says(conns[0]!)).toHaveLength(1);
    expect(voices(conns[0]!)).toHaveLength(0);
  });
});

void STEP;

describe('web lookups in the room (P15.8, ADR-049): nothing is searched or sourced outside the rules', () => {
  function webEngine() {
    const searches: string[] = [];
    const clef = fakeDecider((id) =>
      id === 'kind'
        ? { top: 'other', p: 0.95 }
        : id === 'pii'
          ? { top: 'no', p: 0.95 }
          : id === 'lang'
            ? { top: 'fr', p: 0.95 }
            : id === 'web'
              ? { top: 'yes', p: 0.95 }
              : undefined,
    );
    const engine = new TalkEngine({
      brain: new Brain(clef, 0.7, silent, { backoffMs: 1 }),
      llm: fakeCompleter(() => 'Selon la météo, ciel dégagé.'),
      banks: new NpcLineBanks(undefined, silent),
      budget: new TalkBudget(60, 1),
      cfg: { minP: 0.7, llmTimeoutMs: 1000 },
      rng: () => 0.3,
      log: silent,
      web: {
        available: true,
        search: async (q) => {
          searches.push(q);
          return [{ host: 'meteo.example', text: 'Ciel dégagé, douze degrés à Québec ce soir.' }];
        },
      },
    });
    return { engine, searches };
  }

  it('the sites reach exactly the people who hear the line; a far person gets nothing', async () => {
    const w = webEngine();
    const { room, players, conns, spot } = await scene({ engine: w.engine });
    place(room, players[0]!, { x: spot.x + TILE, y: spot.y });
    place(room, players[1]!, { x: spot.x, y: spot.y + 2 * TILE });
    place(room, players[2]!, cell(5, 5));
    talk(room, players[0]!, 'Quel temps fait-il à Québec ce soir?');
    await flush();
    await flush();
    expect(w.searches).toHaveLength(1);
    expect(says(conns[0]!)[0]).toMatchObject({ src: ['meteo.example'] });
    expect(says(conns[1]!)[0]).toMatchObject({ src: ['meteo.example'] });
    expect(says(conns[2]!)).toHaveLength(0);
  });

  it('a message from a private room is refused before any search happens', async () => {
    const w = webEngine();
    const { room, players, conns, zoe } = await scene({ engine: w.engine });
    place(room, players[0]!, cell(41, 16)); // inside "salle-a"
    zoe.state.x = cell(38, 14).x;
    zoe.state.y = cell(38, 14).y;
    talk(room, players[0]!, 'Quel temps fait-il à Québec ce soir?');
    await flush();
    await flush();
    expect(refusals(conns[0]!)).toEqual(['zone']);
    expect(w.searches).toHaveLength(0);
    expect(conns.flatMap((c) => says(c))).toHaveLength(0);
  });
});
