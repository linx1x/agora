import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  NONE,
  TILE_DEFS,
  mapReader,
  parseMap,
  resolveProps,
  type PlacedProp,
  type Tmj,
} from '@agora/shared';
import { propTo3D } from './props3d';
import { baseHeightPx, propFaces, propQuad, tileIndexOf } from './propFaces';
import type { Extents } from './scene';

const map = parseMap(
  JSON.parse(
    readFileSync(resolve(import.meta.dirname, '../../../../packages/maps/hq.tmj'), 'utf8'),
  ) as Tmj,
);
// every tile treated as fully opaque, the whole 32 px cell
const ext: Extents[] = TILE_DEFS.map(() => ({ r0: 0, r1: 31, c0: 0, c1: 31 }));
const prop = (over: Partial<PlacedProp> = {}): PlacedProp => ({
  id: 'p1',
  t: 'prop.coffee',
  x: 42 * 32 + 16,
  y: 45 * 32 + 16,
  z: 0,
  f: false,
  ...over,
});
const restOf = (props: PlacedProp[]) => resolveProps(mapReader(map), props);

describe('prop cards in 2.5D (P16.13, P16.14)', () => {
  it('draws one upright card per prop, as wide and tall as its art, on its base point', () => {
    const props = [prop()];
    const rest = restOf(props);
    const faces = propFaces(map, props, rest, ext);
    expect(faces).toHaveLength(1);
    const f = faces[0]!;
    expect(f.prop).toBe('p1');
    expect(f.kind).toBe('card');
    expect(f.shade).toBe(0);
    expect(f.tile).toBe(tileIndexOf('prop.coffee'));
    const [x, yb, zb] = propTo3D(
      props[0]!,
      rest[0]!,
      baseHeightPx(mapReader(map), props[0]!, rest[0]!, ext),
    );
    // corners: top-left, top-right, bottom-right, bottom-left
    expect(f.p[3][0]).toBeCloseTo(x - 0.5, 9);
    expect(f.p[2][0]).toBeCloseTo(x + 0.5, 9);
    expect(f.p[2][1]).toBeCloseTo(yb, 9);
    expect(f.p[0][1]).toBeCloseTo(yb + 1, 9);
    for (const c of f.p) expect(c[2]).toBeCloseTo(zb, 9);
  });

  it('the card is as big as the opaque art, and its rect is that art', () => {
    const narrow = ext.map(() => ({ r0: 2, r1: 29, c0: 4, c1: 27 }));
    const props = [prop()];
    const f = propFaces(map, props, restOf(props), narrow)[0]!;
    expect(f.p[1][0] - f.p[0][0]).toBeCloseTo(24 / 32, 9);
    expect(f.p[0][1] - f.p[2][1]).toBeCloseTo(28 / 32, 9);
    expect([f.u0, f.u1, f.v0, f.v1]).toEqual([4, 28, 2, 30]);
  });

  it('a flipped prop shows the art mirrored: its left edge is the art right column', () => {
    const plain = prop();
    const flipped = prop({ f: true });
    const a = propFaces(map, [plain], restOf([plain]), ext)[0]!;
    const b = propFaces(map, [flipped], restOf([flipped]), ext)[0]!;
    expect([a.u0, a.u1]).toEqual([0, 32]);
    expect([b.u0, b.u1]).toEqual([32, 0]);
  });

  it('a prop resting on a surface is lifted by the surface height', () => {
    // the meeting-room table (HQ): a lamp put on it rests on its top
    const lamp = prop({ id: 'lamp', t: 'prop.lampOn', x: 41 * 32 + 16, y: 14 * 32 + 16 });
    const rest = restOf([lamp]);
    expect(rest[0]!.on).not.toBe(NONE);
    expect(baseHeightPx(mapReader(map), lamp, rest[0]!, ext)).toBeGreaterThan(0);
    const f = propFaces(map, [lamp], rest, ext)[0]!;
    expect(f.p[2][1]).toBeGreaterThan(0);
  });

  it('a tile with no art draws no card', () => {
    const idx = tileIndexOf('prop.coffee')!;
    const none = ext.map((e, i) => (i === idx ? { r0: 0, r1: -1, c0: 0, c1: -1 } : e));
    const props = [prop()];
    expect(propFaces(map, props, restOf(props), none)).toEqual([]);
    expect(propQuad(map, props[0]!, restOf(props)[0]!, none)).toBeNull();
  });

  it('an unknown prop tile draws nothing', () => {
    const props = [prop({ t: 'prop.nope' })];
    expect(propFaces(map, props, restOf(props), ext)).toEqual([]);
  });

  it('skip leaves out the named props', () => {
    const props = [prop({ id: 'a' }), prop({ id: 'b', x: 40 * 32 + 16 })];
    const faces = propFaces(map, props, restOf(props), ext, new Set(['a']));
    expect(faces.map((f) => f.prop)).toEqual(['b']);
  });

  it('propQuad gives the same corners as the prop card', () => {
    const props = [prop()];
    const rest = restOf(props);
    const f = propFaces(map, props, rest, ext)[0]!;
    expect(propQuad(map, props[0]!, rest[0]!, ext)).toEqual(f.p);
  });
});
