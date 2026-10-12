import { afterEach, describe, expect, it, vi } from 'vitest';
import * as THREE from 'three';
import { WORLDGEN, WorldTerrain } from '@agora/shared';
import { WorldAmbience } from './worldAmbience';

vi.mock('../art/approvedArt', () => ({
  loadApprovedWorldArt: async () => ({
    birds: [{}, {}, {}, {}],
    butterflies: [{}, {}, {}, {}],
    metrics: new Map([['decor:oak_tree', { height: 4.4 }]]),
  }),
}));

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('world ambience follows actual terrain', () => {
  it('caps actors, freezes motion, shelters wildlife, and removes light when torches are removed', async () => {
    vi.stubGlobal('document', {
      createElement: () => ({
        getContext: () => ({ createRadialGradient: () => ({ addColorStop() {} }), fillRect() {} }),
      }),
    });
    let now = 1000,
      decorPresent = true;
    vi.spyOn(Date, 'now').mockImplementation(() => now);
    const terrain = new WorldTerrain(42, WORLDGEN.params);
    vi.spyOn(terrain, 'cellAt').mockImplementation((x, z) => ({
      block: 'meadow_grass',
      decor:
        decorPresent && x >= 0 && x < 10 ? (z === 0 ? 'oak_tree' : z === 1 ? 'torch' : '') : '',
      level: 2,
      walkable: true,
      solid: false,
      liquid: false,
      ramp: false,
    }));
    const scene = new THREE.Scene(),
      ambience = new WorldAmbience(scene),
      tint = new THREE.Color();
    await ambience.ready;
    const window = { x0: 0, y0: 0, x1: 10, y1: 3 };
    ambience.sync(terrain, window, 'test-world');
    expect(ambience.snapshot()).toMatchObject({ birds: 6, butterflies: 6, torches: 8 });
    ambience.update(0, false, 'clear', tint);
    ambience.update(0.1, false, 'clear', tint);
    const frozen = scene.children.map((child) => child.position.clone());
    for (let i = 1; i < 5; i++) ambience.update(i, true, 'clear', tint);
    scene.children.forEach((child, i) => expect(child.position.equals(frozen[i]!)).toBe(true));
    ambience.update(5, true, 'thunderstorm', tint);
    expect(scene.children.filter((child) => child.visible)).toHaveLength(16); // only actual torch halos
    decorPresent = false;
    now += 301;
    ambience.sync(terrain, window, 'test-world');
    expect(ambience.snapshot()).toMatchObject({ birds: 0, butterflies: 0, torches: 0 });
    expect(scene.children).toHaveLength(0);
    ambience.dispose();
  });
});
