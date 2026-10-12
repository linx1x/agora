import * as THREE from 'three';
import type { ReviewArt } from './art';
import { supportOf } from './grounding';
export type Place = readonly [number, number, number];
export interface BirdPose {
  at: Place;
  frame: number;
  facing: number;
  state: 'perch' | 'fly' | 'peck' | 'hop';
}
const GROUND: Place[] = [
  [2.6, 0.02, 8.8],
  [8.1, 0.02, 7.5],
  [9.3, 0.02, 8.8],
];
/** Deterministic timeline, sampled by elapsed time: independent of render frame rate. */
export function birdPose(time: number, index: number, perches: readonly Place[]): BirdPose {
  const t = (time + index * 9) % 30;
  const a = perches[index % perches.length]!,
    b = perches[(index + 1) % perches.length]!,
    ground = GROUND[index % GROUND.length]!;
  const fly = (from: Place, to: Place, progress: number): BirdPose => {
    const u = progress * progress * (3 - 2 * progress);
    return {
      at: [
        from[0] + (to[0] - from[0]) * u,
        from[1] + (to[1] - from[1]) * u + Math.sin(Math.PI * progress) * 0.85,
        from[2] + (to[2] - from[2]) * u,
      ],
      frame: 1 + (Math.floor(time * 12) % 2),
      facing: to[0] >= from[0] ? 1 : -1,
      state: 'fly',
    };
  };
  if (t < 5) return { at: a, frame: 0, facing: index % 2 ? 1 : -1, state: 'perch' };
  if (t < 8) return fly(a, b, (t - 5) / 3);
  if (t < 12) return { at: b, frame: 0, facing: 1, state: 'perch' };
  if (t < 15) return fly(b, ground, (t - 12) / 3);
  if (t < 23)
    return { at: ground, frame: Math.floor(time * 3) % 3 === 0 ? 0 : 3, facing: 1, state: 'peck' };
  const end: Place = [ground[0] + 0.55, ground[1], ground[2] + 0.2];
  if (t < 26) {
    const u = (t - 23) / 3;
    return {
      at: [
        ground[0] + 0.55 * u,
        0.02 + Math.abs(Math.sin(u * Math.PI * 3)) * 0.12,
        ground[2] + 0.2 * u,
      ],
      frame: 0,
      facing: 1,
      state: 'hop',
    };
  }
  return fly(end, a, (t - 26) / 4);
}

/** Small wildlife and light halos; no gameplay entities, saves or collision. */
export class ReviewLife {
  readonly root = new THREE.Group();
  private birds: THREE.Mesh<THREE.PlaneGeometry, THREE.MeshBasicMaterial>[] = [];
  private butterflies: THREE.Mesh<THREE.PlaneGeometry, THREE.MeshBasicMaterial>[] = [];
  private glows: THREE.Mesh<THREE.PlaneGeometry, THREE.MeshBasicMaterial>[] = [];
  private bugs: THREE.Points<THREE.BufferGeometry, THREE.PointsMaterial>;
  private birdMaps: THREE.CanvasTexture[];
  private birdFeet: number[];
  private butterflyMaps: THREE.CanvasTexture[];
  states: string[] = [];
  constructor(art: ReviewArt, texture: (source: HTMLCanvasElement) => THREE.CanvasTexture) {
    this.birdMaps = art.birds.map(texture);
    this.birdFeet = art.birds.map((source) => supportOf(source, 0).bottom);
    this.butterflyMaps = art.butterflies.map(texture);
    for (let i = 0; i < 3; i++) {
      const bird = new THREE.Mesh(
        new THREE.PlaneGeometry(0.48, 0.48),
        new THREE.MeshBasicMaterial({
          map: this.birdMaps[0],
          alphaTest: 0.5,
          side: THREE.DoubleSide,
        }),
      );
      bird.geometry.translate(0, 0.24, 0);
      this.birds.push(bird);
      this.root.add(bird);
    }
    for (let i = 0; i < 6; i++) {
      const butterfly = new THREE.Mesh(
        new THREE.PlaneGeometry(0.25, 0.25),
        new THREE.MeshBasicMaterial({
          map: this.butterflyMaps[0],
          alphaTest: 0.5,
          side: THREE.DoubleSide,
        }),
      );
      this.butterflies.push(butterfly);
      this.root.add(butterfly);
    }
    const points = new THREE.BufferGeometry();
    points.setAttribute('position', new THREE.Float32BufferAttribute(new Float32Array(48), 3));
    this.bugs = new THREE.Points(
      points,
      new THREE.PointsMaterial({
        color: '#dab862',
        size: 2.5,
        sizeAttenuation: false,
        transparent: true,
        opacity: 0.7,
        depthWrite: false,
      }),
    );
    this.root.add(this.bugs);
    const glow = document.createElement('canvas');
    glow.width = glow.height = 64;
    const c = glow.getContext('2d')!,
      radial = c.createRadialGradient(32, 32, 0, 32, 32, 32);
    radial.addColorStop(0, '#ffc57599');
    radial.addColorStop(0.35, '#ed9a3b55');
    radial.addColorStop(1, '#ed9a3b00');
    c.fillStyle = radial;
    c.fillRect(0, 0, 64, 64);
    for (const [x, z] of [
      [5.5, 5.6],
      [7.5, 8.6],
    ]) {
      const mesh = new THREE.Mesh(
        new THREE.PlaneGeometry(3.2, 3.2),
        new THREE.MeshBasicMaterial({
          map: texture(glow),
          transparent: true,
          depthWrite: false,
          blending: THREE.AdditiveBlending,
          opacity: 0.25,
        }),
      );
      mesh.rotation.x = -Math.PI / 2;
      mesh.position.set(x!, 0.003, z!);
      this.glows.push(mesh);
      this.root.add(mesh);
    }
  }
  update(time: number, dusk: boolean, perches: readonly Place[]): void {
    this.states = [];
    this.birds.forEach((bird, i) => {
      const pose = birdPose(time, i, perches);
      bird.position.set(...pose.at);
      bird.position.y -= (1 - this.birdFeet[pose.frame]!) * 0.48;
      bird.scale.x = pose.facing;
      bird.material.map = this.birdMaps[pose.frame]!;
      this.states.push(pose.state);
      bird.material.color.set(dusk ? '#b9b3b0' : '#ffffff');
    });
    this.butterflies.forEach((b, i) => {
      const phase = time * 0.65 + i * 2.1;
      const flower = i < 3 ? [10.8, 8.3] : [6.9, 2.7];
      b.position.set(
        flower[0]! + Math.sin(phase) * 0.65,
        0.3 + Math.sin(phase * 1.9) * 0.13 + (i % 3) * 0.18,
        flower[1]! + Math.cos(phase * 0.8) * 0.55,
      );
      b.material.map = this.butterflyMaps[Math.floor(time * 11 + i) % 4]!;
      b.rotation.z = Math.sin(phase) * 0.15;
      b.material.color.set(dusk ? '#92968c' : '#ffffff');
    });
    const p = this.bugs.geometry.getAttribute('position');
    for (let i = 0; i < p.count; i++)
      p.setXYZ(
        i,
        8.5 + Math.sin(time * 0.6 + i * 2.3) * 2.4,
        0.25 + Math.sin(time * 1.8 + i) * 0.15,
        (i % 2 ? 4.7 : 8) + Math.cos(time * 0.5 + i) * 0.65,
      );
    p.needsUpdate = true;
    this.bugs.material.color.set(dusk ? '#ffe4a1' : '#787044');
    this.glows.forEach(
      (g, i) =>
        (g.material.opacity =
          (dusk ? 0.8 : 0.18) * (1 + Math.sin(time * 8 + i) * 0.09 + Math.sin(time * 13.7) * 0.04)),
    );
  }
  dispose(): void {
    this.root.traverse((o) => {
      if (o instanceof THREE.Mesh || o instanceof THREE.Points) {
        o.geometry.dispose();
        (o.material as THREE.Material).dispose();
      }
    });
    this.root.removeFromParent();
  }
}
