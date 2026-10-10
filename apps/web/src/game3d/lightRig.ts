/**
 * The lights of the 2.5D view (P16.10, ADR-052): a hemisphere sky, a sun that follows the Québec
 * hour, a fixed pool of point lights for the nearest lamps, fires, windows, portals and desk
 * lamps, and blob shadows under the trees. The maths is in `lightingMath.ts` and `blobs.ts`; this
 * file only applies it to Three.js objects.
 *
 * Settings "Lighting" off: the scene keeps a plain midday light, no point lights, no shadows, no
 * blobs at night. The sun shadow map is on the desktop tier only (`tier.ts`).
 */
import * as THREE from 'three';
import { timeOfDay } from '../game/lighting';
import type { Blobs } from './blobs';
import {
  LAMP_SPEC,
  ambientAt,
  flicker,
  lampColor,
  lampLevel,
  nearestN,
  sunAt,
  type LampKind,
} from './lightingMath';
import { POINT_LIGHTS, sunShadows, type Tier } from './tier';

/** A light of the region, in tiles (x east, y up, z south). */
export interface LampSource {
  x: number;
  y: number;
  z: number;
  kind: LampKind;
  biome: string;
  /** a desk lamp: is its desk claimed, and its decor colour (the view keeps these current) */
  owned?: boolean;
  deskColor?: string;
}

/** The sun's shadow box: half its width, tiles, around the target. */
const SHADOW_HALF = 14;
/** How far the sun stands from the target along its direction, tiles (shadow camera range). */
const SUN_DISTANCE = 30;
/** Sun targets snap to this grid (tiles), so shadows do not shimmer as the camera moves. */
const SNAP = 0.5;
/** Blob shadow opacity by day and at night, and when the lighting is off. */
const BLOB_DAY = 0.5;
const BLOB_NIGHT = 0.28;
const BLOB_OFF = 0.3;
/** Midday, the hour the lighting-off look is taken at. */
const NOON = 13;

interface Slot {
  light: THREE.PointLight;
  seed: number;
  /** the source this slot lights now, and its strength before flicker */
  src: LampSource | null;
  base: number;
}

export class LightRig {
  private readonly scene: THREE.Scene;
  private readonly renderer: THREE.WebGLRenderer;
  private readonly tier: Tier;
  readonly hemi = new THREE.HemisphereLight(0xffffff, 0x000000, 1);
  readonly sun = new THREE.DirectionalLight(0xffffff, 1);
  private readonly slots: Slot[] = [];
  private sources: LampSource[] = [];
  private blobMesh: THREE.Mesh | null = null;
  private blobMat: THREE.MeshBasicMaterial | null = null;
  /** the daylight level of the last refresh, 0 at night (the post-processing reads it) */
  day = 1;
  private on = true;

  constructor(scene: THREE.Scene, renderer: THREE.WebGLRenderer, tier: Tier) {
    this.scene = scene;
    this.renderer = renderer;
    this.tier = tier;
    scene.add(this.hemi, this.sun, this.sun.target);
    for (let i = 0; i < POINT_LIGHTS[tier]; i++) {
      const light = new THREE.PointLight(0xffffff, 0, 1, 1.4);
      scene.add(light);
      this.slots.push({ light, seed: i * 1.7, src: null, base: 0 });
    }
    const shadows = sunShadows(tier);
    this.sun.castShadow = shadows;
    this.sun.shadow.mapSize.set(2048, 2048);
    Object.assign(this.sun.shadow.camera, {
      left: -SHADOW_HALF,
      right: SHADOW_HALF,
      top: SHADOW_HALF,
      bottom: -SHADOW_HALF,
      near: 1,
      far: SUN_DISTANCE * 2,
    });
    this.sun.shadow.camera.updateProjectionMatrix();
    this.sun.shadow.bias = -0.0008;
    this.sun.shadow.normalBias = 0.02;
    renderer.shadowMap.enabled = shadows;
    renderer.shadowMap.type = THREE.PCFShadowMap;
  }

  /** The region's lights (rebuilt when the region changes). */
  setLamps(sources: LampSource[]): void {
    this.sources = sources;
  }

  /** The region's blob shadows (rebuilt with the region), or none. */
  setBlobs(b: Blobs | null): void {
    this.blobMesh?.removeFromParent();
    this.blobMesh?.geometry.dispose();
    this.blobMat?.dispose();
    this.blobMesh = null;
    this.blobMat = null;
    if (!b || !b.index.length) return;
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(b.pos, 3));
    geo.setAttribute('color', new THREE.Float32BufferAttribute(b.color, 4));
    geo.setIndex(b.index);
    this.blobMat = new THREE.MeshBasicMaterial({
      color: 0x000000,
      vertexColors: true,
      transparent: true,
      depthWrite: false,
      opacity: this.blobOpacity(),
    });
    this.blobMesh = new THREE.Mesh(geo, this.blobMat);
    this.blobMesh.renderOrder = 1;
    this.scene.add(this.blobMesh);
  }

  /** Slow tick (about 3 Hz): the Québec hour, the Lighting setting, the camera target (tiles). */
  refresh(hour: number, on: boolean, target: { x: number; z: number }): void {
    this.on = on;
    const h = on ? hour : NOON;
    const sun = sunAt(h);
    const amb = ambientAt(h);
    const day = timeOfDay(h).day;
    this.day = on ? day : 1;

    this.hemi.color.set(amb.sky);
    this.hemi.groundColor.set(amb.ground);
    this.hemi.intensity = amb.intensity;

    this.sun.color.set(sun.color);
    this.sun.intensity = sun.intensity;
    this.sun.castShadow = sunShadows(this.tier) && on && sun.intensity > 0;
    const tx = Math.round(target.x / SNAP) * SNAP;
    const tz = Math.round(target.z / SNAP) * SNAP;
    this.sun.target.position.set(tx, 0, tz);
    this.sun.position.set(
      tx + sun.dir[0] * SUN_DISTANCE,
      Math.max(0.5, sun.dir[1] * SUN_DISTANCE),
      tz + sun.dir[2] * SUN_DISTANCE,
    );

    // the nearest lamps take the pool; the rest are off
    const near = on ? nearestN(this.sources, target, this.slots.length) : [];
    this.slots.forEach((slot, i) => {
      const src = near[i] ?? null;
      slot.src = src;
      if (!src) {
        slot.base = 0;
        slot.light.intensity = 0;
        return;
      }
      const spec = LAMP_SPEC[src.kind];
      slot.light.position.set(src.x, src.y, src.z);
      slot.light.color.set(lampColor(src.kind, src.biome, amb.sky, src.deskColor));
      slot.light.distance = spec.distance;
      slot.base = spec.intensity * lampLevel(src.kind, day, src.owned ?? true);
    });

    if (this.blobMat) this.blobMat.opacity = this.blobOpacity();
    // lamps off the pool are not in the shaders at all: the lighting-off look is the cheapest one
    for (const slot of this.slots) slot.light.visible = on;
  }

  /** Blob shadows are darker by day, lighter at night, and steady when the lighting is off. */
  private blobOpacity(): number {
    return this.on ? BLOB_NIGHT + (BLOB_DAY - BLOB_NIGHT) * this.day : BLOB_OFF;
  }

  /** Per frame: the flicker of the lamps in use (held still under reduced motion). */
  frame(now: number, reduced: boolean): void {
    const seconds = now / 1000;
    for (const slot of this.slots) {
      if (!slot.src) continue;
      slot.light.intensity = slot.base * flicker(slot.src.kind, seconds, slot.seed, reduced);
    }
  }

  /** Lamps in use now (test read-out). */
  lampsLit(): number {
    return this.slots.filter((s) => s.src && s.light.intensity > 0).length;
  }

  /** Whether the sun currently casts shadows (test read-out). */
  shadowsOn(): boolean {
    return this.renderer.shadowMap.enabled && this.sun.castShadow;
  }

  get lightingOn(): boolean {
    return this.on;
  }

  dispose(): void {
    this.setBlobs(null);
    for (const slot of this.slots) slot.light.removeFromParent();
    this.scene.remove(this.hemi, this.sun, this.sun.target);
    this.slots.length = 0;
  }
}
