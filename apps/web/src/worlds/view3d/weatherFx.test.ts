import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { WORLDGEN, WorldTerrain } from '@agora/shared';
import { WeatherFx } from './weatherFx';

describe('weather rendering lifecycle', () => {
  it('uses bounded buffers, stops at terrain, respects reduced motion and removes cave precipitation', () => {
    const scene = new THREE.Scene();
    const ground = new THREE.MeshBasicMaterial();
    const light = new THREE.AmbientLight();
    const fx = new WeatherFx(scene, ground, light);
    const terrain = new WorldTerrain(42, WORLDGEN.params);
    for (let i = 0; i < 150; i++) fx.update(0.1, i / 10, 'thunderstorm', 0, 0, terrain, false);
    const rain = scene.children[0] as THREE.LineSegments;
    const snow = scene.children[1] as THREE.Points;
    expect(rain.geometry.drawRange.count).toBeGreaterThan(900);
    expect(rain.geometry.getAttribute('position').count).toBe(960);
    const p = rain.geometry.getAttribute('position');
    for (let i = 0; i < rain.geometry.drawRange.count; i += 2) {
      const floor = terrain.cellAt(Math.floor(p.getX(i)), Math.floor(p.getZ(i))).level * 0.375;
      expect(p.getY(i + 1)).toBeGreaterThanOrEqual(floor - 0.00001);
    }
    fx.update(0.1, 46.2, 'thunderstorm', 0, 0, terrain, true);
    expect(rain.geometry.drawRange.count).toBeLessThan(200);
    expect(fx.wind.value).toBe(0);
    expect(light.intensity).toBe(Math.PI);
    fx.update(0.1, 47, null, 0, 0, terrain, false);
    expect(rain.geometry.drawRange.count).toBe(0);
    expect(snow.geometry.drawRange.count).toBe(0);
    fx.dispose();
    expect(scene.children).toHaveLength(0);
    ground.dispose();
  });
});
