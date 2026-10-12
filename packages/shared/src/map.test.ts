import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  TILE,
  cellOf,
  cellPos,
  chairAt,
  collides,
  defaultSpawn,
  findPath,
  parseMap,
  regionAt,
  regionSpawn,
  tileDef,
  validateMove,
  zoneAt,
  type Tmj,
} from './index';

const tmj = JSON.parse(readFileSync(new URL('../../maps/hq.tmj', import.meta.url), 'utf8')) as Tmj;
const map = parseMap(tmj);
const at = (cx: number, cy: number) => ({ x: cx * TILE + 16, y: cy * TILE + 26 });

describe('hq map (hub + 4 biomes)', () => {
  it('desk pods are open on every side (ADR-021)', () => {
    for (const d of map.desks) {
      const z = d.zone;
      const x0 = z.x / TILE - 1;
      const y0 = z.y / TILE - 1;
      const x1 = (z.x + z.w) / TILE;
      const y1 = (z.y + z.h) / TILE;
      const r = regionAt(map, z.x, z.y)!;
      const inner = (cx: number, cy: number) =>
        cx > r.x / TILE &&
        cy > r.y / TILE &&
        cx < (r.x + r.w) / TILE - 1 &&
        cy < (r.y + r.h) / TILE - 1;
      for (let cy = y0; cy <= y1; cy++)
        for (let cx = x0; cx <= x1; cx++) {
          if (cx > x0 && cx < x1 && cy > y0 && cy < y1) continue;
          if (!inner(cx, cy)) continue;
          expect(map.solid[cy * map.width + cx], `${d.id} ring ${cx},${cy}`).toBe(0);
        }
    }
  });
  it('jungle layout (ADR-023): staggered pods, a pond under the waterfall, walkable trails, a full lounge', () => {
    const jungleDesks = map.desks.filter((d) => d.region === 'jungle');
    expect(new Set(jungleDesks.map((d) => d.zone.y)).size).toBeGreaterThanOrEqual(5);
    const names = (layer: 'floor' | 'furniture') =>
      (map.layers[layer] ?? []).map((g, i) => ({ n: tileDef(g)?.name ?? '', i }));
    const furn = names('furniture').filter((c) => c.n.startsWith('jungle.'));
    const ponds = furn.filter((c) => /^jungle\.pond\d+$/.test(c.n));
    expect(ponds.length).toBeGreaterThanOrEqual(20);
    for (const c of ponds) expect(map.solid[c.i], c.n).toBe(1);
    for (const want of [
      'jungle.fall00',
      'jungle.fall32',
      'jungle.hammockL',
      'jungle.arcadeATop',
      'jungle.boardGame',
      'jungle.vr',
      'jungle.sofaL',
      'jungle.deskCornerUp',
    ])
      expect(
        furn.some((c) => c.n === want),
        want,
      ).toBe(true);
    const paths = names('floor').filter((c) => /^jungle\.path\d+$/.test(c.n));
    expect(paths.length).toBeGreaterThanOrEqual(80);
    // a trail tile never sits under a solid cell: you can walk every trail
    for (const c of paths)
      expect(map.solid[c.i], `trail ${c.i % map.width},${(c.i / map.width) | 0}`).toBe(0);
  });
  it('oasis layout (ADR-024): fountain pool, cabanas, sandstone paths, a games lounge', () => {
    const desks = map.desks.filter((d) => d.region === 'oasis');
    expect(desks).toHaveLength(8);
    expect(new Set(desks.map((d) => d.zone.y)).size).toBeGreaterThanOrEqual(4);
    const names = (layer: 'floor' | 'furniture') =>
      (map.layers[layer] ?? []).map((g, i) => ({ n: tileDef(g)?.name ?? '', i }));
    const furn = names('furniture').filter((c) => c.n.startsWith('oasis.'));
    const pools = furn.filter((c) => /^oasis\.pond\d+$/.test(c.n));
    expect(pools.length).toBeGreaterThanOrEqual(20);
    for (const c of pools) expect(map.solid[c.i], c.n).toBe(1);
    for (const want of [
      'oasis.fall00',
      'oasis.fall22',
      'oasis.cabana00',
      'oasis.cabana12',
      'oasis.poolTableL',
      'oasis.pingPongR',
      'oasis.boardGame',
      'oasis.vr',
      'oasis.sofaL',
      'oasis.deskCornerUp',
    ])
      expect(
        furn.some((c) => c.n === want),
        want,
      ).toBe(true);
    const paths = names('floor').filter((c) => /^oasis\.path\d+$/.test(c.n));
    expect(paths.length).toBeGreaterThanOrEqual(80);
    for (const c of paths)
      expect(map.solid[c.i], `path ${c.i % map.width},${(c.i / map.width) | 0}`).toBe(0);
  });
  it('boreal layout (ADR-025): fire pit, frozen pond, slate paths, a lounge with TV, chess and VR', () => {
    const desks = map.desks.filter((d) => d.region === 'boreal');
    expect(desks).toHaveLength(8);
    expect(new Set(desks.map((d) => d.zone.y)).size).toBeGreaterThanOrEqual(4);
    const names = (layer: 'floor' | 'furniture') =>
      (map.layers[layer] ?? []).map((g, i) => ({ n: tileDef(g)?.name ?? '', i }));
    const furn = names('furniture').filter((c) => c.n.startsWith('boreal.'));
    const ice = furn.filter((c) => /^boreal\.pond\d+$/.test(c.n));
    expect(ice.length).toBeGreaterThanOrEqual(4);
    for (const c of ice) expect(map.solid[c.i], c.n).toBe(1);
    const pit = furn.filter((c) => /^boreal\.firepit\d\d$/.test(c.n));
    expect(pit).toHaveLength(16);
    for (const c of pit) expect(map.solid[c.i], c.n).toBe(1);
    for (const want of [
      'boreal.tvL',
      'boreal.tvR',
      'boreal.boardGame',
      'boreal.vr',
      'boreal.sofaL',
      'boreal.deskCornerUp',
    ])
      expect(
        furn.some((c) => c.n === want),
        want,
      ).toBe(true);
    const paths = names('floor').filter((c) => /^boreal\.path\d+$/.test(c.n));
    expect(paths.length).toBeGreaterThanOrEqual(80);
    for (const c of paths)
      expect(map.solid[c.i], `path ${c.i % map.width},${(c.i / map.width) | 0}`).toBe(0);
  });
  it('zen layout (ADR-026): koi pond in a gravel garden, flagstone paths, a tea and go lounge', () => {
    const desks = map.desks.filter((d) => d.region === 'zen');
    expect(desks).toHaveLength(8);
    expect(new Set(desks.map((d) => d.zone.y)).size).toBeGreaterThanOrEqual(4);
    const names = (layer: 'floor' | 'furniture') =>
      (map.layers[layer] ?? []).map((g, i) => ({ n: tileDef(g)?.name ?? '', i }));
    const furn = names('furniture').filter((c) => c.n.startsWith('zen.'));
    const koi = furn.filter((c) => /^zen\.pond\d+$/.test(c.n));
    expect(koi.length).toBeGreaterThanOrEqual(20);
    for (const c of koi) expect(map.solid[c.i], c.n).toBe(1);
    for (const want of [
      'zen.tsukubai',
      'zen.screen',
      'zen.puzzle',
      'zen.boardGame',
      'zen.sofaL',
      'zen.deskCornerUp',
    ])
      expect(
        furn.some((c) => c.n === want),
        want,
      ).toBe(true);
    const flo = names('floor');
    expect(flo.some((c) => c.n === 'zen.zabuton')).toBe(true);
    const paths = flo.filter((c) => /^zen\.path\d+$/.test(c.n));
    expect(paths.length).toBeGreaterThanOrEqual(80);
    for (const c of paths)
      expect(map.solid[c.i], `path ${c.i % map.width},${(c.i / map.width) | 0}`).toBe(0);
  });
  it('records required cells per region for build mode', () => {
    for (const r of map.regions) expect(r.reach?.length).toBeGreaterThan(0);
  });
  it('has the required layers', () => {
    expect(tmj.layers.map((l) => l.name)).toEqual([
      'floor',
      'walls',
      'furniture',
      'props',
      'above',
      'zones',
      'spawns',
      'interactables',
      'regions',
      'labels',
      'lights',
    ]);
  });
  it('has 5 regions, 32 desks (8 per biome), 7 meeting rooms, a quiet library and portals', () => {
    expect(map.regions.map((r) => r.id).sort()).toEqual([
      'boreal',
      'hub',
      'jungle',
      'oasis',
      'zen',
    ]);
    expect(map.desks).toHaveLength(32);
    for (const b of ['jungle', 'boreal', 'oasis', 'zen'])
      expect(map.desks.filter((d) => d.region === b)).toHaveLength(8);
    expect(map.zones.filter((z) => z.kind === 'private')).toHaveLength(7);
    expect(map.zones.some((z) => z.kind === 'quiet')).toBe(true);
    expect(map.zones.filter((z) => z.kind === 'portal')).toHaveLength(8);
    // P17.26b: one office shop board, in the hub
    expect(map.zones.filter((z) => z.kind === 'shop').map((z) => [z.id, z.region])).toEqual([
      ['comptoir', 'hub'],
    ]);
  });
  it('the office shop board is reachable from the hub arrival point', () => {
    const z = map.zones.find((q) => q.kind === 'shop')!;
    const sp = regionSpawn(map, 'hub')!;
    expect(findPath(map, cellOf(map, sp.x, sp.y), cellOf(map, z.x + 16, z.y + 26))).not.toBeNull();
  });
  it('default spawn and every region arrival point are walkable', () => {
    const s = defaultSpawn(map);
    expect(collides(map, s.x, s.y)).toBe(false);
    expect(regionAt(map, s.x, s.y)?.id).toBe('hub');
    for (const r of map.regions) {
      const a = regionSpawn(map, r.id)!;
      expect(a, r.id).toBeDefined();
      expect(collides(map, a.x, a.y), r.id).toBe(false);
      expect(regionAt(map, a.x, a.y)?.id).toBe(r.id);
    }
  });
  it('every desk chair, guest spot and entrance is reachable from its region arrival point', () => {
    for (const d of map.desks) {
      const from = cellOf(map, regionSpawn(map, d.region)!.x, regionSpawn(map, d.region)!.y);
      for (const c of [d.entrance, d.guest, d.chair])
        expect(findPath(map, from, c), `${d.id} ${JSON.stringify(c)}`).not.toBeNull();
      const chair = cellPos(map, d.chair);
      expect(chairAt(map, chair.x, chair.y)).toBe(d.chair.face);
      expect(zoneAt(map, chair.x, chair.y)?.id).toBe(d.id);
      const ent = cellPos(map, d.entrance);
      expect(zoneAt(map, ent.x, ent.y)?.kind).not.toBe('desk');
    }
  });
  it('every portal pad is reachable in its region', () => {
    for (const z of map.zones.filter((q) => q.kind === 'portal')) {
      const sp = regionSpawn(map, z.region!)!;
      expect(
        findPath(map, cellOf(map, sp.x, sp.y), cellOf(map, z.x + 16, z.y + 26)),
        z.id,
      ).not.toBeNull();
    }
  });
  it('regions are sealed from each other (only teleporters connect them)', () => {
    const hub = regionSpawn(map, 'hub')!;
    const jungle = regionSpawn(map, 'jungle')!;
    expect(findPath(map, cellOf(map, hub.x, hub.y), cellOf(map, jungle.x, jungle.y))).toBeNull();
  });
  it('rejects moves through walls and too-fast moves', () => {
    const s = defaultSpawn(map);
    expect(validateMove(map, s, { x: s.x, y: s.y + 3 * TILE }, 1000).ok).toBe(false);
    expect(validateMove(map, s, { x: s.x - 60, y: s.y }, 10)).toEqual({
      ok: false,
      reason: 'speed',
    });
    expect(validateMove(map, s, { x: s.x - 8, y: s.y }, 66).ok).toBe(true);
    void at;
  });
});
