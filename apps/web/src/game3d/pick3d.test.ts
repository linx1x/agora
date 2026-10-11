import { describe, expect, it } from 'vitest';
import { floorPoint, pickNearest, prepare, type Opaque, type Ray } from './pick3d';
import type { Face3D } from './scene';

const face = (p: Face3D['p'], over: Partial<Face3D> = {}): Face3D => ({
  p,
  tile: 0,
  u0: 0,
  v0: 0,
  u1: 32,
  v1: 32,
  shade: 0,
  kind: 'floor',
  cx: 0,
  cy: 0,
  ...over,
});

/** A horizontal quad at height `y` over [x0, x1] x [z0, z1]; corner 1 runs along +x, corner 3 along +z. */
const flat = (
  y: number,
  x0: number,
  x1: number,
  z0: number,
  z1: number,
  over: Partial<Face3D> = {},
) =>
  face(
    [
      [x0, y, z0],
      [x1, y, z0],
      [x1, y, z1],
      [x0, y, z1],
    ],
    over,
  );

const ALL: Opaque = () => true;

/** A ray straight down at (x, z) from height `h`. */
const down = (x: number, z: number, h = 5): Ray => ({ o: [x, h, z], d: [0, -1, 0] });

describe('pickNearest (P16.13: what is drawn under the pointer)', () => {
  it('hits the floor under the ray, with the point and the distance along it', () => {
    const prep = prepare([flat(0, 0, 4, 0, 4)]);
    const hit = pickNearest(prep, down(1, 2), ALL);
    expect(hit?.item.kind).toBe('floor');
    expect(hit?.t).toBeCloseTo(5, 9);
    expect(hit?.p[0]).toBeCloseTo(1, 9);
    expect(hit?.p[1]).toBeCloseTo(0, 9);
    expect(hit?.p[2]).toBeCloseTo(2, 9);
  });

  it('the nearest opaque face wins: a box top above the floor hides the floor under it', () => {
    const prep = prepare([flat(0, 0, 4, 0, 4), flat(1, 1, 2, 1, 2, { kind: 'box' })]);
    const top = pickNearest(prep, down(1.5, 1.5), ALL);
    expect(top?.item.kind).toBe('box');
    expect(top?.p[1]).toBeCloseTo(1, 9);
    expect(top?.t).toBeCloseTo(4, 9);
    expect(pickNearest(prep, down(3, 3), ALL)?.item.kind).toBe('floor');
  });

  it('a transparent texel lets the ray through to what is behind it', () => {
    const prep = prepare([flat(0, 0, 4, 0, 4), flat(1, 1, 2, 1, 2, { tile: 9, kind: 'card' })]);
    const seen: [number, number, number][] = [];
    const opaque: Opaque = (tile, u, v) => {
      seen.push([tile, u, v]);
      return tile !== 9;
    };
    const hit = pickNearest(prep, down(1.5, 1.5), opaque);
    expect(hit?.item.kind).toBe('floor');
    // the card was nearer, so its texel under the ray was tested
    expect(seen.map((s) => s[0])).toContain(9);
  });

  it('maps the point to the face art through its source rect', () => {
    // the floor's corner 0 is (0, 0): the ray at x = 1 of a 4-tile floor is a quarter along u,
    // and at z = 2 half way along v; the rect is u 8..24, v 0..16
    const prep = prepare([flat(0, 0, 4, 0, 4, { u0: 8, u1: 24, v0: 0, v1: 16 })]);
    const seen: [number, number, number][] = [];
    pickNearest(prep, down(1, 2), (tile, u, v) => {
      seen.push([tile, u, v]);
      return true;
    });
    expect(seen).toEqual([[0, 12, 8]]);
  });

  it('keep filters faces out before they can be hit', () => {
    const prep = prepare([flat(0, 0, 4, 0, 4), flat(1, 1, 2, 1, 2, { kind: 'box' })]);
    const hit = pickNearest(prep, down(1.5, 1.5), ALL, (f) => f.kind !== 'box');
    expect(hit?.item.kind).toBe('floor');
  });

  it('a ray that passes beside every face meets nothing', () => {
    const prep = prepare([flat(0, 0, 4, 0, 4)]);
    expect(pickNearest(prep, down(9, 9), ALL)).toBeNull();
  });

  it('ignores faces behind the eye', () => {
    const prep = prepare([flat(0, 0, 4, 0, 4)]);
    // from below the floor, looking down: the plane is behind the eye
    expect(pickNearest(prep, { o: [1, -5, 2], d: [0, -1, 0] }, ALL)).toBeNull();
  });
});

describe('prepare', () => {
  it('drops faces that are not flat on one axis', () => {
    const slanted = face([
      [0, 0, 0],
      [1, 0, 0],
      [1, 1, 0],
      [0, 0, 1],
    ]);
    expect(prepare([slanted])).toHaveLength(0);
    expect(prepare([flat(0, 0, 1, 0, 1)])).toHaveLength(1);
  });
});

describe('floorPoint', () => {
  it('finds where a ray meets the floor, and nothing when it points up', () => {
    const hit = floorPoint({ o: [0, 2, 0], d: [1, -1, 0] });
    expect(hit?.x).toBeCloseTo(2, 9);
    expect(hit?.z).toBeCloseTo(0, 9);
    expect(hit?.t).toBeCloseTo(2, 9);
    expect(floorPoint({ o: [0, 2, 0], d: [0, 1, 0] })).toBeNull();
  });
});
