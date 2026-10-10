import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import type { Face3D, Scene3D } from './scene';
import { buildRegionMesh, type Atlas } from './meshes';

const face = (over: Partial<Face3D>): Face3D => ({
  p: [
    [0, 0, 0],
    [1, 0, 0],
    [1, 0, 1],
    [0, 0, 1],
  ],
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

/** A fake atlas: tile 5 is animated (4 frames), each frame 0.1 along u; the other tiles are still. */
const atlas = {
  uv: (f: Face3D, frame: number): [number, number, number, number] => {
    const fr = f.tile === 5 ? frame : 0;
    const u = fr * 0.1 + f.tile * 0.01;
    return [u, 0.1, u + 0.05, 0.2];
  },
  animOf: (tile: number) => (tile === 5 ? { frames: 4, fps: 4 } : undefined),
} as unknown as Atlas;

const scene = (faces: Face3D[]): Scene3D => ({ faces, lights: [], x0: 0, z0: 0, w: 2, d: 1 });

describe('RegionAnim (the animated tiles of a region mesh)', () => {
  it('moves an animated face to its tile’s current frame, and leaves the still faces alone', () => {
    const { mesh, anim } = buildRegionMesh(
      scene([face({ tile: 5 }), face({ tile: 1, cx: 1 })]),
      atlas,
      new THREE.Texture(),
    );
    const uv = mesh.geometry.getAttribute('uv') as THREE.BufferAttribute;
    anim!.tick(0, false);
    expect(uv.getX(0)).toBeCloseTo(0.05, 6);
    // 4 fps: frame 1 from 250 ms on
    anim!.tick(260, false);
    expect(uv.getX(0)).toBeCloseTo(0.15, 6);
    // the still face (vertices 4…7) keeps its art
    expect(uv.getX(4)).toBeCloseTo(0.01, 6);
  });

  it('holds the first frame under reduced motion', () => {
    const { mesh, anim } = buildRegionMesh(scene([face({ tile: 5 })]), atlas, new THREE.Texture());
    const uv = mesh.geometry.getAttribute('uv') as THREE.BufferAttribute;
    anim!.tick(5000, true);
    expect(uv.getX(0)).toBeCloseTo(0.05, 6);
  });

  it('is absent when no tile in the region moves', () => {
    const { anim } = buildRegionMesh(scene([face({ tile: 1 })]), atlas, new THREE.Texture());
    expect(anim).toBeNull();
  });
});
