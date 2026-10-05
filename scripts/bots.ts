/**
 * Load-test bots (PLAN P1.8): N clients join the space and walk random paths.
 * Usage: AGORA_URL=http://localhost:3000 BOTS=30 pnpm bots
 * Needs AUTH_MODE=access-code (set ACCESS_CODE env if the server has one) or dev.
 */
import WebSocket from 'ws';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  MOVE_SEND_HZ,
  parseMap,
  randomAvatar,
  stepMove,
  type S2CMsg,
  type Tmj,
} from '../packages/shared/src/index';

const base = process.env.AGORA_URL ?? 'http://localhost:3000';
const n = Number(process.env.BOTS ?? 10);
const map = parseMap(
  JSON.parse(
    readFileSync(join(import.meta.dirname, '..', 'packages', 'maps', 'hq.tmj'), 'utf8'),
  ) as Tmj,
);

async function bot(i: number) {
  const r = await fetch(`${base}/api/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ name: `Bot ${i + 1}`, code: process.env.ACCESS_CODE }),
  });
  if (!r.ok) throw new Error(`login ${r.status}`);
  const cookie = r.headers.get('set-cookie')!.split(';')[0]!;
  const t = await fetch(`${base}/api/session/realtime-token`, {
    method: 'POST',
    headers: { cookie },
  });
  const { token } = (await t.json()) as { token: string };
  const ws = new WebSocket(
    `${base.replace(/^http/, 'ws')}/world?token=${encodeURIComponent(token)}&avatar=${encodeURIComponent(JSON.stringify(randomAvatar()))}`,
  );
  let me = { x: 0, y: 0 };
  let dir: [number, number] = [0, 0];
  let seq = 0;
  let id = '';
  ws.on('message', (d) => {
    const m = JSON.parse(String(d)) as S2CMsg;
    if (m.t === 'welcome') {
      id = m.you;
      const p = m.positions.find((q) => q.id === id)!;
      me = { x: p.x, y: p.y };
    } else if (m.t === 'correction') me = { x: m.x, y: m.y };
  });
  const dt = 1 / MOVE_SEND_HZ;
  setInterval(() => {
    if (!id) return;
    if (Math.random() < 0.05)
      dir = [Math.round(Math.random() * 2 - 1), Math.round(Math.random() * 2 - 1)];
    const before = me;
    me = stepMove(map, me.x, me.y, dir[0], dir[1], dt);
    if (me.x === before.x && me.y === before.y)
      dir = [Math.round(Math.random() * 2 - 1), Math.round(Math.random() * 2 - 1)];
    const moving = dir[0] !== 0 || dir[1] !== 0;
    ws.send(
      JSON.stringify({
        t: 'move',
        x: me.x,
        y: me.y,
        dir: dir[0] < 0 ? 'left' : dir[0] > 0 ? 'right' : dir[1] < 0 ? 'up' : 'down',
        moving,
        seq: ++seq,
      }),
    );
    if (Math.random() < 0.002) ws.send(JSON.stringify({ t: 'emote', emote: 'wave' }));
  }, dt * 1000);
}

for (let i = 0; i < n; i++) await bot(i).catch((e) => console.error(`bot ${i}:`, e.message));
console.log(`${n} bots walking on ${base}. Ctrl+C to stop.`);
