import * as THREE from 'three';
import { hash32, type WeatherKind, type WorldTerrain } from '@agora/shared';
import { heightOf } from './math3d';

const COUNT = 480;
const SPAN = 42;
const SKY = 13;
const frac = (n: number) => n - Math.floor(n);
export const WEATHER_LOOK = {
  clear: { tint: 0xffffff, rain: 0, snow: 0, wind: 0.15 },
  cloudy: { tint: 0xc3d0dc, rain: 0, snow: 0, wind: 0.35 },
  rain: { tint: 0x9aafc5, rain: 0.65, snow: 0, wind: 0.55 },
  thunderstorm: { tint: 0x788aa7, rain: 1, snow: 0, wind: 1 },
  snow: { tint: 0xdce5f0, rain: 0, snow: 0.85, wind: 0.3 },
} as const;

/** Fixed-size, camera-local particle buffers. All art is procedural; no reference-game assets. */
export class WeatherFx {
  readonly wind = { value: 0 };
  readonly clock = { value: 0 };
  private readonly rainPos = new Float32Array(COUNT * 6);
  private readonly snowPos = new Float32Array(COUNT * 3);
  private readonly splashPos = new Float32Array(80 * 12);
  private readonly rainGeo = new THREE.BufferGeometry();
  private readonly snowGeo = new THREE.BufferGeometry();
  private readonly splashGeo = new THREE.BufferGeometry();
  private readonly rainMat = new THREE.LineBasicMaterial({
    color: 0xb8d4ea,
    transparent: true,
    opacity: 0,
    depthWrite: false,
  });
  private readonly snowMat = new THREE.PointsMaterial({
    color: 0xf2f7ff,
    size: 3,
    sizeAttenuation: false,
    transparent: true,
    opacity: 0,
    depthWrite: false,
  });
  private readonly splashMat = new THREE.LineBasicMaterial({
    color: 0xbed5e8,
    transparent: true,
    opacity: 0,
    depthWrite: false,
  });
  private readonly rain = new THREE.LineSegments(this.rainGeo, this.rainMat);
  private readonly snow = new THREE.Points(this.snowGeo, this.snowMat);
  private readonly splash = new THREE.LineSegments(this.splashGeo, this.splashMat);
  private readonly targetTint = new THREE.Color();
  private wet = 0;
  private flakes = 0;
  private readonly seeds = Array.from(
    { length: COUNT },
    (_, i) => hash32(`weather-particle:${i}`) / 0x1_0000_0000,
  );

  constructor(
    private readonly scene: THREE.Scene,
    private readonly ground: THREE.MeshBasicMaterial,
    private readonly light: THREE.AmbientLight,
  ) {
    for (const [geo, positions] of [
      [this.rainGeo, this.rainPos],
      [this.snowGeo, this.snowPos],
      [this.splashGeo, this.splashPos],
    ] as const) {
      geo.setAttribute(
        'position',
        new THREE.BufferAttribute(positions, 3).setUsage(THREE.DynamicDrawUsage),
      );
    }
    for (const obj of [this.rain, this.snow, this.splash]) {
      obj.frustumCulled = false;
      scene.add(obj);
    }
    const previous = ground.onBeforeCompile;
    ground.onBeforeCompile = (shader, renderer) => {
      previous.call(ground, shader, renderer);
      shader.uniforms.weatherWind = this.wind;
      shader.uniforms.weatherClock = this.clock;
      shader.vertexShader = shader.vertexShader
        .replace(
          '#include <common>',
          '#include <common>\nattribute float aWind;\nuniform float weatherWind;\nuniform float weatherClock;',
        )
        .replace(
          '#include <begin_vertex>',
          '#include <begin_vertex>\ntransformed.x += aWind * weatherWind * (sin(weatherClock * 1.7 + position.x * 0.8 + position.z * 0.4) + 0.3) * 0.065;',
        );
    };
    ground.customProgramCacheKey = () => 'agora-weather-dither-v1';
  }

  update(
    dt: number,
    seconds: number,
    kind: WeatherKind | null,
    centerX: number,
    centerZ: number,
    terrain: WorldTerrain,
    reduced: boolean,
  ): void {
    const look = WEATHER_LOOK[kind ?? 'clear'];
    const blend = 1 - Math.exp(-Math.min(dt, 0.1) / 2.5);
    this.wet += (look.rain - this.wet) * blend;
    this.flakes += (look.snow - this.flakes) * blend;
    if (kind === null) {
      this.wet = 0;
      this.flakes = 0;
    }
    this.wind.value += ((reduced || kind === null ? 0 : look.wind) - this.wind.value) * blend;
    this.clock.value = seconds;
    if (reduced) this.wind.value = 0;
    this.targetTint.setHex(look.tint);
    this.ground.color.lerp(this.targetTint, blend);
    this.light.color.copy(this.ground.color);
    // A restrained storm glow, no strobe. Reduced-motion users get no lightning.
    const phase = seconds % 23;
    if (kind === 'thunderstorm' && !reduced && phase < 0.8)
      this.light.intensity = Math.PI * (1 + Math.sin((phase / 0.8) * Math.PI) * 0.2);
    else this.light.intensity = Math.PI;
    this.rainMat.opacity = this.wet * 0.55;
    this.snowMat.opacity = this.flakes * 0.9;
    this.splashMat.opacity = reduced ? 0 : this.wet * 0.4;
    const density = reduced ? 0.2 : 1;
    const rainCount = Math.floor(COUNT * this.wet * density);
    const snowCount = Math.floor(COUNT * this.flakes * density);
    this.rainGeo.setDrawRange(0, rainCount * 2);
    this.snowGeo.setDrawRange(0, snowCount);
    this.splashGeo.setDrawRange(0, reduced ? 0 : Math.floor(80 * this.wet) * 4);
    if (rainCount + snowCount === 0) return;
    const originX = Math.floor(centerX / 4) * 4;
    const originZ = Math.floor(centerZ / 4) * 4;
    const t = reduced ? 0 : seconds;
    for (let i = 0; i < Math.max(rainCount, snowCount); i++) {
      const seed = this.seeds[i]!;
      const x = originX + (frac(seed * 317 + t * this.wind.value * 0.013) - 0.5) * SPAN;
      const z = originZ + (frac(seed * 719) - 0.5) * SPAN;
      const cell = terrain.cellAt(Math.floor(x), Math.floor(z));
      // Precipitation stops on the terrain or housing roof, never below raised land.
      const floor = heightOf(cell.level) + (cell.decor === 'coop' || cell.decor === 'barn' ? 1 : 0);
      const y = floor + frac(seed * 29 - t * 0.9) * SKY;
      this.rainPos.set([x, y, z, x + this.wind.value * 0.13, Math.max(floor, y - 0.45), z], i * 6);
      this.snowPos.set(
        [
          x + Math.sin(t + seed * 30) * (reduced ? 0 : 0.3),
          floor + frac(seed * 29 - t * 0.1) * SKY,
          z,
        ],
        i * 3,
      );
      if (i < 80) {
        const radius = frac(seed * 13 + t * 1.8) * 0.13;
        this.splashPos.set(
          [
            x - radius,
            floor + 0.015,
            z,
            x + radius,
            floor + 0.015,
            z,
            x,
            floor + 0.015,
            z - radius,
            x,
            floor + 0.015,
            z + radius,
          ],
          i * 12,
        );
      }
    }
    for (const geo of [this.rainGeo, this.snowGeo, this.splashGeo])
      geo.getAttribute('position').needsUpdate = true;
  }

  dispose(): void {
    for (const obj of [this.rain, this.snow, this.splash]) {
      this.scene.remove(obj);
      obj.geometry.dispose();
      obj.material.dispose();
    }
  }
}
