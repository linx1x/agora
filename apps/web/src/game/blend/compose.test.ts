import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  applyChanges,
  furnitureKey,
  groundKey,
  mapReader,
  parseMap,
  type CellChange,
  type Tmj,
  type WorldMap,
} from '@agora/shared';
import { T, composeFurniture, composeGround, type TileSource } from './compose';
import { materialLook } from './ramps';

const raw = readFileSync(new URL('../../../../../packages/maps/hq.tmj', import.meta.url), 'utf8');
const fresh = () => parseMap(JSON.parse(raw) as Tmj);

/** Stand-in tileset: each tile a seeded opaque texture; props a small opaque block. */
const cache = new Map<string, Uint8ClampedArray>();
const src: TileSource = {
  tile(name) {
    let p = cache.get(name);
    if (!p) {
      p = new Uint8ClampedArray(T * T * 4);
      let h = 0;
      for (const ch of name) h = (h * 31 + ch.charCodeAt(0)) | 0;
      const prop = name.startsWith('prop.');
      for (let i = 0; i < T * T; i++) {
        const x = i % T;
        const y = (i - x) / T;
        const inside = !prop || (x >= 10 && x < 22 && y >= 6 && y < 20);
        p[i * 4] = (h >> 3) & 255;
        p[i * 4 + 1] = ((h >> 11) + x * 3) & 255;
        p[i * 4 + 2] = ((h >> 19) + y * 5) & 255;
        p[i * 4 + 3] = inside ? 255 : 0;
      }
      cache.set(name, p);
    }
    return p;
  },
};

/** Clean 9×9 jungle grass patch in the middle of the jungle wing. */
function patch(map: WorldMap) {
  const r = map.regions.find((q) => q.biome === 'jungle')!;
  const x = Math.floor((r.x + r.w / 2) / map.tile);
  const y = Math.floor((r.y + r.h / 2) / map.tile);
  const clear: CellChange[] = [];
  for (let dy = -4; dy <= 4; dy++)
    for (let dx = -4; dx <= 4; dx++) {
      clear.push({ l: 'floor', x: x + dx, y: y + dy, t: 'jungle.floor' });
      for (const l of ['walls', 'furniture', 'props', 'above'] as const)
        clear.push({ l, x: x + dx, y: y + dy, t: null });
    }
  applyChanges(map, clear);
  return { x, y };
}

const same = (a: Uint8ClampedArray, b: Uint8ClampedArray) =>
  a.length === b.length && a.every((v, i) => v === b[i]);
const rgbAt = (p: Uint8ClampedArray, x: number, y: number) => [
  p[(y * T + x) * 4],
  p[(y * T + x) * 4 + 1],
  p[(y * T + x) * 4 + 2],
  p[(y * T + x) * 4 + 3],
];

describe('blend compositor', () => {
  it('is deterministic', () => {
    const map = fresh();
    const { x, y } = patch(map);
    applyChanges(map, [
      { l: 'floor', x, y, t: 'jungle.dirt' },
      { l: 'furniture', x, y: y - 2, t: 'jungle.deskH' },
      { l: 'furniture', x: x + 1, y: y - 2, t: 'counter' },
    ]);
    const r = mapReader(map);
    expect(same(composeGround(r, src, x, y), composeGround(r, src, x, y))).toBe(true);
    expect(same(composeFurniture(r, src, x, y - 2), composeFurniture(r, src, x, y - 2))).toBe(true);
  });

  it('the build preview (a "what if" reader) equals the applied result', () => {
    const map = fresh();
    const { x, y } = patch(map);
    applyChanges(map, [
      { l: 'furniture', x: x - 1, y, t: 'jungle.deskH' },
      { l: 'floor', x: x + 2, y: y + 1, t: 'jungle.dirt' },
    ]);
    const edits: CellChange[] = [
      { l: 'furniture', x, y, t: 'jungle.deskMonitor' },
      { l: 'props', x: x - 1, y, t: 'prop.lampOn' },
      { l: 'floor', x: x + 1, y: y + 1, t: 'jungle.dirt' },
    ];
    const over = new Map(edits.map((c) => [`${c.l}:${c.x}:${c.y}`, c.t]));
    const preview = mapReader(map, over);
    const pics = (rd: ReturnType<typeof mapReader>) => {
      const out: Uint8ClampedArray[] = [];
      for (let dy = -2; dy <= 2; dy++)
        for (let dx = -2; dx <= 3; dx++) {
          out.push(composeGround(rd, src, x + dx, y + dy));
          out.push(composeFurniture(rd, src, x + dx, y + dy));
        }
      return out;
    };
    const before = pics(preview);
    applyChanges(map, edits);
    const after = pics(mapReader(map));
    expect(before.every((p, i) => same(p, after[i]!))).toBe(true);
  });

  it('equal keys give equal pixels (desk pods share their variants)', () => {
    const map = fresh();
    const r = mapReader(map);
    const seen = new Map<string, [number, number]>();
    let checked = 0;
    for (let y = 0; y < map.height && checked < 40; y++)
      for (let x = 0; x < map.width && checked < 40; x++) {
        for (const kind of ['g', 'f'] as const) {
          const k = kind === 'g' ? groundKey(r, x, y) : furnitureKey(r, x, y);
          if (!k) continue;
          const prev = seen.get(k);
          if (!prev) {
            seen.set(k, [x, y]);
            continue;
          }
          const f = kind === 'g' ? composeGround : composeFurniture;
          expect(same(f(r, src, x, y), f(r, src, prev[0], prev[1])), `${k} at ${x},${y}`).toBe(
            true,
          );
          checked++;
        }
      }
    expect(checked).toBeGreaterThan(10);
  });

  it('ground variants are opaque and keep the plain texture away from edges', () => {
    const map = fresh();
    const { x, y } = patch(map);
    applyChanges(map, [{ l: 'floor', x, y, t: 'jungle.dirt' }]);
    const r = mapReader(map);
    const g = composeGround(r, src, x + 1, y);
    for (let i = 3; i < g.length; i += 4) expect(g[i]).toBe(255);
    // the far edge of the neighbour stays plain grass
    const grass = src.tile('jungle.floor')!;
    expect(rgbAt(g, 31, 16)).toEqual(rgbAt(grass, 31, 16));
  });

  it('a desk row is one object: no outline at the joint, one seam where the counter starts', () => {
    const map = fresh();
    const { x, y } = patch(map);
    applyChanges(map, [
      { l: 'furniture', x: x - 1, y, t: 'jungle.deskH' },
      { l: 'furniture', x, y, t: 'jungle.deskH' },
      { l: 'furniture', x: x + 1, y, t: 'counter' },
    ]);
    const r = mapReader(map);
    const outline = [...materialLook('desk', 'jungle').outline.map(Math.round), 255];
    const a = composeFurniture(r, src, x - 1, y);
    const b = composeFurniture(r, src, x, y);
    // both sides of the desk–desk joint, mid top face: not outline
    expect(rgbAt(a, 31, 14)).not.toEqual(outline);
    expect(rgbAt(b, 0, 14)).not.toEqual(outline);
    // the desk–counter joint: a one-pixel seam on the counter's first column
    const c = composeFurniture(r, src, x + 1, y);
    const stone = materialLook('counter', 'jungle').top;
    const seam = [...materialLook('counter', 'jungle').outline.map(Math.round), 255];
    expect(rgbAt(c, 0, 14)).toEqual(seam);
    expect(rgbAt(c, 1, 14)).not.toEqual(seam);
    void stone;
    // above the top face is clear; the top face is opaque
    expect(rgbAt(b, 16, 2)[3]).toBe(0);
    expect(rgbAt(b, 16, 14)[3]).toBe(255);
  });

  it('a prop on a merged desk darkens the surface under it', () => {
    const map = fresh();
    const { x, y } = patch(map);
    applyChanges(map, [
      { l: 'furniture', x, y, t: 'jungle.deskH' },
      { l: 'furniture', x: x + 1, y, t: 'jungle.deskH' },
    ]);
    const plain = composeFurniture(mapReader(map), src, x, y);
    applyChanges(map, [{ l: 'props', x, y, t: 'prop.coffee' }]);
    const withProp = composeFurniture(mapReader(map), src, x, y);
    expect(same(plain, withProp)).toBe(false);
  });
});
