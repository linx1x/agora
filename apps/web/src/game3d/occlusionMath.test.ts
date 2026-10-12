import { describe, expect, it } from 'vitest';
import { FOV, TILT, type Cam } from './camera';
import type { Face3D } from './scene';
import {
  FADE_MS,
  KEPT_WHEN_HIDDEN,
  TALL_TOP,
  fadeStep,
  hiders,
  hits,
  occluderObjects,
  overlaps,
  screenBox,
  type Box2,
} from './occlusionMath';

const cam: Cam = { tx: 5, tz: 5, tilt: TILT, dist: 10, fov: FOV, w: 800, h: 600 };

const box = (x0: number, y0: number, x1: number, y1: number): Box2 => ({ x0, y0, x1, y1 });

describe('overlaps and hits', () => {
  it('overlapping boxes overlap; touching edges and apart boxes do not', () => {
    expect(overlaps(box(0, 0, 10, 10), box(5, 5, 15, 15))).toBe(true);
    expect(overlaps(box(0, 0, 10, 10), box(10, 0, 20, 10))).toBe(false);
    expect(overlaps(box(0, 0, 10, 10), box(0, 10, 10, 20))).toBe(false);
    expect(overlaps(box(0, 0, 10, 10), box(11, 11, 20, 20))).toBe(false);
  });

  it('a point is hit inside the box, edges included', () => {
    expect(hits(box(0, 0, 10, 10), 5, 5)).toBe(true);
    expect(hits(box(0, 0, 10, 10), 10, 10)).toBe(true);
    expect(hits(box(0, 0, 10, 10), 10.5, 5)).toBe(false);
  });
});

describe('hiders (the occlusion rule)', () => {
  const me = { box: box(100, 100, 140, 200), depth: 10 };

  it('an object that overlaps me and stands nearer the camera hides me', () => {
    const wall = new Map([['near', { box: box(120, 90, 180, 150), depth: 8 }]]);
    expect([...hiders([me], wall)]).toEqual(['near']);
  });

  it('an object that overlaps me but stands behind me does not hide me', () => {
    const wall = new Map([['far', { box: box(120, 90, 180, 150), depth: 12 }]]);
    expect(hiders([me], wall).size).toBe(0);
  });

  it('an object nearer the camera but off my screen box does not hide me', () => {
    const wall = new Map([['aside', { box: box(200, 100, 260, 200), depth: 2 }]]);
    expect(hiders([me], wall).size).toBe(0);
  });

  it('an exempt object never hides, even when it overlaps me and stands nearer (P17.21d)', () => {
    const wall = new Map([
      ['tree', { box: box(120, 90, 180, 150), depth: 8 }],
      ['rock', { box: box(120, 90, 180, 150), depth: 7 }],
    ]);
    expect([...hiders([me], wall, new Set(['tree']))]).toEqual(['rock']);
    expect(hiders([me], wall, new Set(['tree', 'rock'])).size).toBe(0);
  });

  it('an equal depth does not hide (only strictly nearer objects)', () => {
    const wall = new Map([['same', { box: box(120, 90, 180, 150), depth: 10 }]]);
    expect(hiders([me], wall).size).toBe(0);
  });

  it('any of several subjects can be hidden (me and the hovered person)', () => {
    const hovered = { box: box(300, 100, 340, 200), depth: 6 };
    const wall = new Map([
      ['hides-me', { box: box(120, 90, 180, 150), depth: 8 }],
      ['hides-hovered', { box: box(320, 90, 380, 150), depth: 5 }],
      ['hides-nobody', { box: box(600, 0, 620, 20), depth: 1 }],
    ]);
    expect([...hiders([me, hovered], wall)].sort()).toEqual(['hides-hovered', 'hides-me']);
  });
});

describe('fadeStep', () => {
  it('reduced motion jumps straight to the target', () => {
    expect(fadeStep(1, KEPT_WHEN_HIDDEN, 16, true)).toBe(KEPT_WHEN_HIDDEN);
    expect(fadeStep(KEPT_WHEN_HIDDEN, 1, 0, true)).toBe(1);
  });

  it('fades out at a constant rate over FADE_MS and stops on the target', () => {
    const half = fadeStep(1, KEPT_WHEN_HIDDEN, FADE_MS / 2, false);
    expect(half).toBeCloseTo(1 - (1 - KEPT_WHEN_HIDDEN) / 2, 10);
    expect(fadeStep(1, KEPT_WHEN_HIDDEN, FADE_MS, false)).toBe(KEPT_WHEN_HIDDEN);
    expect(fadeStep(half, KEPT_WHEN_HIDDEN, 10 * FADE_MS, false)).toBe(KEPT_WHEN_HIDDEN);
  });

  it('fades back in towards solid and never overshoots', () => {
    const up = fadeStep(KEPT_WHEN_HIDDEN, 1, FADE_MS / 4, false);
    expect(up).toBeGreaterThan(KEPT_WHEN_HIDDEN);
    expect(up).toBeLessThan(1);
    expect(fadeStep(0.95, 1, 10 * FADE_MS, false)).toBe(1);
  });

  it('a frame with no time passed, or a settled fade, does not move', () => {
    expect(fadeStep(0.6, KEPT_WHEN_HIDDEN, 0, false)).toBe(0.6);
    expect(fadeStep(1, 1, 50, false)).toBe(1);
  });
});

describe('screenBox', () => {
  it('a box at the target is drawn near the centre of the view, with a depth', () => {
    const s = screenBox(cam, { x0: 4.5, x1: 5.5, y0: 0, y1: 1, z0: 4.5, z1: 5.5 });
    expect(s).not.toBeNull();
    expect(s!.box.x0).toBeLessThan(cam.w / 2);
    expect(s!.box.x1).toBeGreaterThan(cam.w / 2);
    expect(s!.depth).toBeGreaterThan(0);
  });

  it('a tall box projects above its footprint on screen', () => {
    const low = screenBox(cam, { x0: 4, x1: 5, y0: 0, y1: 0.1, z0: 4, z1: 5 })!;
    const tall = screenBox(cam, { x0: 4, x1: 5, y0: 0, y1: 1.5, z0: 4, z1: 5 })!;
    expect(tall.box.y0).toBeLessThan(low.box.y0);
  });

  it('a nearer box (further south, towards the camera) has a smaller depth', () => {
    const near = screenBox(cam, { x0: 4, x1: 5, y0: 0, y1: 1, z0: 7, z1: 8 })!;
    const far = screenBox(cam, { x0: 4, x1: 5, y0: 0, y1: 1, z0: 2, z1: 3 })!;
    expect(near.depth).toBeLessThan(far.depth);
  });

  it('a box behind the camera, or no box, has no screen box', () => {
    expect(screenBox(cam, { x0: 4, x1: 5, y0: 0, y1: 1, z0: 30, z1: 31 })).toBeNull();
    expect(screenBox(cam, null)).toBeNull();
    expect(screenBox(cam, undefined)).toBeNull();
  });
});

function face(kind: Face3D['kind'], cx: number, cy: number, top: number): Face3D {
  return {
    p: [
      [cx, top, cy],
      [cx + 1, top, cy],
      [cx + 1, 0, cy],
      [cx, 0, cy],
    ],
    tile: 0,
    u0: 0,
    v0: 0,
    u1: 32,
    v1: 32,
    shade: 0,
    kind,
    cx,
    cy,
  };
}

describe('occluderObjects', () => {
  it('takes walls, decals and tall cards, and leaves floors, boxes and low cards solid', () => {
    const faces: Face3D[] = [
      face('floor', 0, 0, 0), // 0 floor: solid
      face('wall', 1, 0, 1.5), // 1 wall: an occluder
      face('box', 2, 0, 0.6), // 2 desk: solid
      face('card', 3, 0, TALL_TOP - 0.2), // 3 low card (a chair, a bush): solid
      face('card', 4, 0, TALL_TOP), // 4 tall card (a tree trunk): an occluder
      face('decal', 5, 0, 1.5), // 5 vine: an occluder
    ];
    const objs = occluderObjects(faces);
    expect(objs.map((o) => o.key).sort()).toEqual(['1,0', '4,0', '5,0']);
    expect(objs.find((o) => o.key === '1,0')!.faces).toEqual([1]);
    expect(objs.map((o) => [o.key, o.card]).sort()).toEqual([
      ['1,0', false],
      ['4,0', true],
      ['5,0', false],
    ]);
  });

  it('groups the faces of one cell into one object, with their box', () => {
    const faces: Face3D[] = [
      face('wall', 2, 3, 1.5),
      face('wall', 2, 3, 0.5),
      face('floor', 2, 3, 0),
    ];
    const objs = occluderObjects(faces);
    expect(objs).toHaveLength(1);
    expect(objs[0]!.faces).toEqual([0, 1]);
    expect(objs[0]!.box).toEqual({ x0: 2, x1: 3, y0: 0, y1: 1.5, z0: 3, z1: 3 });
  });

  it('a region with no tall things has no occluders', () => {
    expect(occluderObjects([face('floor', 0, 0, 0), face('box', 1, 0, 0.6)])).toEqual([]);
  });
});
