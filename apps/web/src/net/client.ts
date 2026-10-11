import {
  MOVE_SEND_HZ,
  applyChanges,
  inverseOf,
  parseMap,
  type Avatar,
  type C2SIn,
  type PlayerPos,
  type S2CMsg,
  type Tmj,
} from '@agora/shared';
import { store, toast } from '../state/store';
import { playNpcVoice } from '../media/npcVoice';
import { chime } from '../ui/sound';
import { ack, clearHistory, refused } from '../game/build';

export interface Sample {
  t: number;
  x: number;
  y: number;
  d: PlayerPos['d'];
  m: boolean;
  p: 'stand' | 'sit';
}

type Handler = (m: S2CMsg) => void;

/** Realtime connection to the authoritative SpaceRoom, with resume on brief drops (P1.7). */
export class WorldClient {
  ws: WebSocket | null = null;
  /** remote position buffers for interpolation */
  samples = new Map<string, Sample[]>();
  zones = new Map<string, string | null>();
  private handlers = new Set<Handler>();
  private resumeId: string | null = null;
  private closedByUser = false;
  private retryStart = 0;
  private seq = 0;
  private lastSent = 0;
  lastCorrection: { x: number; y: number; seq: number; reason?: string } | null = null;
  tmj: Tmj | null = null;
  /** revision of the map we hold */
  mapRev = 0;
  /** newest revision announced by the server */
  private seenRev = 0;
  private gen = 0;
  private reloading = false;
  /** space slug this client is in (P2.3) */
  space = 'hq';

  on(h: Handler) {
    this.handlers.add(h);
    return () => this.handlers.delete(h);
  }

  async start(avatar: Avatar, space = this.space) {
    this.space = space;
    this.closedByUser = false;
    const gen = ++this.gen;
    if (!store.get().map) await this.fetchMap();
    if (gen === this.gen) await this.open(avatar, gen);
  }

  private async fetchMap() {
    const res = await fetch(`/api/spaces/${encodeURIComponent(this.space)}/map`, {
      credentials: 'same-origin',
      cache: 'no-store',
    });
    if (res.status === 403 || res.status === 404) {
      this.deny(res.status === 404 ? 'not_found' : 'forbidden');
      throw new Error('denied');
    }
    if (!res.ok) throw new Error('map');
    this.tmj = (await res.json()) as Tmj;
    this.mapRev = Number(res.headers.get('X-Map-Rev') ?? 0);
    store.set({ map: parseMap(this.tmj), mapRev: this.mapRev });
  }

  /** Whole map replaced (reset, or we missed edits): refetch and remount the world view. */
  private async reloadMap() {
    if (this.reloading) return;
    this.reloading = true;
    try {
      await this.fetchMap();
      clearHistory();
      store.set((s) => ({ mapGen: s.mapGen + 1 }));
    } catch {
      toast('toast.mapReloadFailed');
    } finally {
      this.reloading = false;
    }
    if (this.seenRev > this.mapRev) void this.reloadMap();
  }

  private async open(avatar: Avatar, gen = this.gen) {
    if (gen !== this.gen || this.closedByUser) return;
    store.set({ conn: this.resumeId ? 'reconnecting' : 'connecting' });
    let token: string;
    try {
      const r = await fetch('/api/session/realtime-token', {
        method: 'POST',
        credentials: 'same-origin',
      });
      if (r.status === 401) {
        store.set({ conn: 'lost' });
        location.reload();
        return;
      }
      token = ((await r.json()) as { token: string }).token;
    } catch {
      return this.retry(avatar);
    }
    if (gen !== this.gen || this.closedByUser) return;
    const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
    const qs = new URLSearchParams({ token, space: this.space, avatar: JSON.stringify(avatar) });
    if (this.resumeId) qs.set('resume', this.resumeId);
    const ws = new WebSocket(`${proto}//${location.host}/world?${qs}`);
    this.ws = ws;
    ws.onmessage = (ev) => {
      let m: S2CMsg;
      try {
        m = JSON.parse(String(ev.data)) as S2CMsg;
      } catch {
        return;
      }
      this.ingest(m);
      for (const h of this.handlers) h(m);
    };
    ws.onclose = (ev) => {
      if (this.ws !== ws) return;
      this.ws = null;
      if (this.closedByUser) return;
      if (ev.code === 4403) {
        store.set({ conn: 'full' });
        return;
      }
      if (ev.code === 4404 || ev.code === 4405) {
        this.deny(ev.code === 4404 ? 'not_found' : 'forbidden');
        return;
      }
      this.retry(avatar);
    };
  }

  private retry(avatar: Avatar) {
    if (!this.retryStart) this.retryStart = Date.now();
    if (Date.now() - this.retryStart > 20_000) {
      // Seat expired on the server; join fresh.
      this.resumeId = null;
    }
    if (Date.now() - this.retryStart > 120_000) {
      store.set({ conn: 'lost' });
      return;
    }
    store.set({ conn: 'reconnecting' });
    const gen = this.gen;
    setTimeout(() => void this.open(avatar, gen), 1000 + Math.random() * 1000);
  }

  /** This space does not exist or is invite-only: stop and let the UI explain. */
  private deny(why: 'not_found' | 'forbidden') {
    this.closedByUser = true;
    store.set({ conn: 'denied', denied: why });
  }

  /** Leave on purpose: the server frees the seat at once (no "reconnecting" ghost). */
  leave() {
    this.send({ t: 'leave' });
    this.stop();
  }

  stop() {
    this.gen++;
    this.closedByUser = true;
    this.ws?.close();
    this.ws = null;
  }

  send(m: C2SIn) {
    if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(m));
  }

  /** Throttled move sender (≤ MOVE_SEND_HZ), always sends the final stop. */
  sendMove(
    x: number,
    y: number,
    dir: PlayerPos['d'],
    moving: boolean,
    force = false,
    pose: 'stand' | 'sit' = 'stand',
  ) {
    const now = performance.now();
    if (!force && now - this.lastSent < 1000 / MOVE_SEND_HZ) return;
    this.lastSent = now;
    this.send({
      t: 'move',
      x: Math.round(x * 10) / 10,
      y: Math.round(y * 10) / 10,
      dir,
      moving,
      pose,
      seq: ++this.seq,
    });
  }

  private ingest(m: S2CMsg) {
    const now = performance.now();
    switch (m.t) {
      case 'welcome': {
        this.resumeId = m.you;
        this.retryStart = 0;
        const profiles = Object.fromEntries(m.profiles.map((p) => [p.id, p]));
        this.samples.clear();
        for (const p of m.positions) this.push(p, now);
        const wasReconnect = store.get().conn === 'reconnecting';
        store.set((s) => ({
          conn: 'online',
          me: m.you,
          profiles,
          config: m.config,
          chat: wasReconnect ? s.chat : m.history,
          desks: m.desks,
          pets: [],
          npcs: [],
          npcMinds: {},
          npcBrain: null,
          talkTo: null,
          npcLog: wasReconnect ? s.npcLog : [],
          npcTyping: {},
          myDesk: m.myDesk,
          admitted: [],
          builder: m.builder,
          build: m.builder ? s.build : null,
          spaceName: m.spaceName,
        }));
        if (wasReconnect) toast('toast.reconnected');
        // voices are opt-in: the server sends clips only to people who said yes
        if (store.get().settings.npcVoices) this.send({ t: 'npc:voice', on: true });
        this.seenRev = Math.max(this.seenRev, m.mapRev);
        if (m.mapRev !== this.mapRev) void this.reloadMap();
        break;
      }
      case 'state':
        for (const p of m.positions) this.push(p, now);
        for (const id of [...this.samples.keys()])
          if (!m.positions.some((p) => p.id === id)) this.samples.delete(id);
        break;
      case 'pet:state':
        store.set({ pets: m.pets });
        break;
      case 'npc:state':
        store.set({ npcs: m.npcs });
        break;
      case 'npc:say':
        // the log keeps what was said near me, for the Talk box; the scene draws the bubble
        store.set((s) => ({
          npcLog: [
            ...s.npcLog.slice(-59),
            {
              id: m.mid,
              npcId: m.id,
              from: 'npc' as const,
              ...(m.to === s.me ? {} : { to: m.to }),
              body: m.body,
              at: m.at,
              ...(m.src?.length ? { src: m.src } : {}),
            },
          ],
        }));
        break;
      case 'npc:voice':
        playNpcVoice(m);
        break;
      case 'npc:typing':
        store.set((s) => ({ npcTyping: { ...s.npcTyping, [m.id]: m.on } }));
        break;
      case 'npc:refused':
        store.set({ npcRefused: { id: m.id, reason: m.reason, at: Date.now() } });
        break;
      case 'npc:memory':
        store.set((s) => ({ npcMemory: { ...s.npcMemory, [m.id]: m.summary } }));
        break;
      case 'npc:forgot':
        store.set({ npcMemory: {} });
        toast('talk.memory.forgot');
        break;
      case 'world:perms':
        store.set({ worldPerms: m.kinds });
        break;
      case 'world:visitors':
        store.set({ worldVisitors: m, visitorsRefused: null });
        break;
      case 'world:visitors:refused':
        store.set({ visitorsRefused: m.reason });
        break;
      case 'friendship':
        store.set({ hearts: m.hearts });
        break;
      case 'gift:result':
        store.set({
          giftResult: {
            key: m.key,
            npcId: m.npcId,
            ok: m.ok,
            ...(m.reason ? { reason: m.reason } : {}),
            ...(m.taste ? { taste: m.taste } : {}),
            at: Date.now(),
          },
        });
        break;
      case 'office:bought':
        store.set({ officeShopRefused: m.ok ? null : (m.reason ?? 'invalid') });
        break;
      case 'npc:consent':
        store.set({ npcConsent: m.consent });
        break;
      case 'npc:mind':
        store.set({
          npcBrain: m.brain,
          npcMinds: Object.fromEntries(m.minds.map((x) => [x.id, x])),
        });
        break;
      case 'profile':
        // P17.15b: someone who stepped into a world stays listed but is no longer on the floor
        if (m.profile.inWorld) this.samples.delete(m.profile.id);
        store.set((s) => ({ profiles: { ...s.profiles, [m.profile.id]: m.profile } }));
        break;
      case 'roster': {
        // back from a world: the office as it is now (who left, who arrived, the desks)
        const profiles = Object.fromEntries(m.profiles.map((p) => [p.id, p]));
        for (const id of [...this.samples.keys()])
          if (!profiles[id] || profiles[id]!.inWorld) this.samples.delete(id);
        store.set({ profiles, desks: m.desks });
        break;
      }
      case 'leave': {
        this.samples.delete(m.id);
        store.set((s) => {
          const profiles = { ...s.profiles };
          delete profiles[m.id];
          return { profiles };
        });
        break;
      }
      case 'correction':
        this.lastCorrection = m;
        break;
      case 'chat': {
        const s = store.get();
        const viewing = s.panelOpen && s.panel === 'chat' && s.chatTab === m.msg.scope;
        store.set({
          chat: [...s.chat.slice(-499), m.msg],
          unread:
            viewing || m.msg.from === s.me
              ? s.unread
              : { ...s.unread, [m.msg.scope]: s.unread[m.msg.scope] + 1 },
        });
        break;
      }
      case 'peers':
        store.set({ peers: m.peers });
        break;
      case 'map:edit': {
        this.seenRev = Math.max(this.seenRev, m.rev);
        const map = store.get().map;
        if (!map || this.reloading) break;
        if (m.rev !== this.mapRev + 1) {
          void this.reloadMap();
          break;
        }
        const inverse = inverseOf(map, m.changes);
        applyChanges(map, m.changes);
        this.mapRev = m.rev;
        if (m.by === store.get().me) ack(m.op, inverse);
        store.set({ mapRev: m.rev });
        break;
      }
      case 'config':
        store.set({ config: m.config });
        break;
      case 'space':
        store.set({ spaceName: m.name });
        break;
      case 'map:refused':
        refused(m);
        break;
      case 'map:reload':
        this.seenRev = Math.max(this.seenRev, m.rev);
        if (m.rev !== this.mapRev) void this.reloadMap();
        break;
      case 'desks':
        store.set({ desks: m.desks });
        break;
      case 'myDesk':
        store.set({ myDesk: m.deskId });
        toast(m.deskId ? 'desk.claimed' : 'desk.released');
        break;
      case 'admitted':
        store.set({ admitted: m.deskIds });
        break;
      case 'knock':
        store.set((s) => ({
          knocks: [
            ...s.knocks.filter((k) => k.from !== m.from),
            { from: m.from, name: m.name, deskId: m.deskId },
          ],
        }));
        chime('knock');
        setTimeout(
          () => store.set((s) => ({ knocks: s.knocks.filter((k) => k.from !== m.from) })),
          30_000,
        );
        break;
      case 'knock:result':
        if (m.result !== 'accepted' || store.get().prompt?.kind === 'knock')
          toast(`knock.${m.result}`);
        break;
      case 'callover':
        store.set({ callover: { from: m.from, name: m.name } });
        chime('callover');
        break;
      case 'visitor':
        toast('desk.visitor', { name: m.name });
        chime('visitor');
        break;
      case 'error':
        if (m.code === 'rate_limited') toast('toast.rateLimited');
        else if (
          [
            'callover_dnd',
            'desk_taken',
            'desk_sit_first',
            'knock_too_far',
            'teleport_refused',
            'not_builder',
          ].includes(m.code)
        )
          toast(`error.${m.code}`);
        break;
    }
  }

  private push(p: PlayerPos, t: number) {
    let buf = this.samples.get(p.id);
    if (!buf) {
      buf = [];
      this.samples.set(p.id, buf);
    }
    const same = (s?: Sample) =>
      !!s && s.x === p.x && s.y === p.y && s.m === p.m && s.d === p.d && s.p === (p.p ?? 'stand');
    const last = buf[buf.length - 1];
    // Keep the first identical sample as an anchor and only refresh a second copy,
    // so interpolation reaches the "stopped" state (fixes remote avatars stuck walking).
    if (same(last) && same(buf[buf.length - 2])) last!.t = t;
    else buf.push({ t, x: p.x, y: p.y, d: p.d, m: p.m, p: p.p ?? 'stand' });
    if (buf.length > 30) buf.splice(0, buf.length - 30);
    this.zones.set(p.id, p.z);
  }

  /** Interpolated position of a remote player at render time. */
  sampleAt(id: string, renderT: number): Sample | undefined {
    const buf = this.samples.get(id);
    if (!buf?.length) return undefined;
    if (renderT <= buf[0]!.t) return buf[0];
    for (let i = buf.length - 1; i >= 0; i--) {
      const a = buf[i]!;
      if (a.t <= renderT) {
        const b = buf[i + 1];
        if (!b) return a;
        const f = (renderT - a.t) / (b.t - a.t || 1);
        return {
          t: renderT,
          x: a.x + (b.x - a.x) * f,
          y: a.y + (b.y - a.y) * f,
          d: b.d,
          // moving while between samples; stopped once we reach a stopped sample
          m: f < 1 ? a.m || b.m : b.m,
          p: b.p,
        };
      }
    }
    return buf[buf.length - 1];
  }
}

export const world = new WorldClient();
