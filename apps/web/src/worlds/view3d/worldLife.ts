import * as THREE from 'three';
import { hash32, animalsShelter, type WorldTerrain, type WeatherKind } from '@agora/shared';
import { loadApprovedWorldArt, type ApprovedWorldArt } from '../art/approvedArt';
import {
  groundedGeometry,
  shadowGeometry,
  silhouetteMask,
  supportOf,
} from '../../artReview/grounding';
import jungle from '../../artReview/biomes/jungle.json';
import desert from '../../artReview/biomes/desert.json';
import taiga from '../../artReview/biomes/taiga.json';
import { heightOf } from './math3d';
import { habitatOf, safeWildlifeStep, type Habitat } from './lifePlacement';
import type { CellWindow } from '../cellMath';

interface Species {
  id: string;
  biome: Habitat;
  size: number;
}
const SPECIES: Record<Habitat, Species[]> = {
  meadow: [
    { id: 'deer', biome: 'meadow', size: 1.5 },
    { id: 'pig', biome: 'meadow', size: 1.05 },
    { id: 'hen', biome: 'meadow', size: 0.65 },
    { id: 'cow', biome: 'meadow', size: 1.7 },
  ],
  jungle: jungle.animals.map((a) => ({
    id: a.id,
    biome: 'jungle',
    size: Math.max(a.width, a.height),
  })),
  desert: desert.animals.map((a) => ({
    id: a.id,
    biome: 'desert',
    size: Math.max(a.width, a.height),
  })),
  taiga: taiga.animals.map((a) => ({
    id: a.id,
    biome: 'taiga',
    size: Math.max(a.width, a.height),
  })),
};
interface Frame {
  geometry: THREE.BufferGeometry;
  cast: THREE.BufferGeometry;
  contact: THREE.BufferGeometry;
  map: THREE.Texture;
  mask: THREE.Texture;
}
interface Actor {
  key: string;
  species: Species;
  root: THREE.Group;
  body: THREE.Mesh<THREE.BufferGeometry, THREE.MeshBasicMaterial>;
  cast: THREE.Mesh<THREE.BufferGeometry, THREE.MeshBasicMaterial>;
  contact: THREE.Mesh<THREE.BufferGeometry, THREE.MeshBasicMaterial>;
  frames: Frame[];
  frame: number;
  x: number;
  z: number;
  level: number;
  phase: number;
  state: string;
  watchUntil: number;
}
interface Detail {
  key: string;
  root: THREE.Group;
  geometry: THREE.BufferGeometry;
  material: THREE.Material;
}

/** Local ecology is visual only; saved livestock and all inventory actions remain authoritative. */
export class WorldLife {
  readonly ready: Promise<void>;
  private art?: ApprovedWorldArt;
  private destroyed = false;
  private actors = new Map<string, Actor>();
  private frames = new Map<string, Frame[]>();
  private textures = new Map<HTMLCanvasElement, THREE.Texture>();
  private details = new Map<string, Detail>();
  private clock = 0;
  private lastSync = -Infinity;
  private world = '';
  private terrains?: WorldTerrain;
  private planted: (x: number, z: number) => boolean = () => false;
  private insectGeo = new THREE.BufferGeometry();
  private insects: THREE.Points;
  private ray = new THREE.Raycaster();
  constructor(private scene: THREE.Scene) {
    this.insectGeo.setAttribute(
      'position',
      new THREE.Float32BufferAttribute(new Float32Array(48 * 3), 3),
    );
    this.insects = new THREE.Points(
      this.insectGeo,
      new THREE.PointsMaterial({
        color: '#d7cf84',
        size: 2,
        sizeAttenuation: false,
        transparent: true,
        opacity: 0.55,
        depthWrite: false,
      }),
    );
    this.insects.frustumCulled = false;
    scene.add(this.insects);
    this.ready = loadApprovedWorldArt().then((art) => {
      if (!this.destroyed) this.art = art;
    });
    void this.ready.catch((error) =>
      console.warn('Wildlife art unavailable; world remains playable.', error),
    );
  }
  private texture(source: HTMLCanvasElement): THREE.Texture {
    let t = this.textures.get(source);
    if (!t) {
      t = new THREE.CanvasTexture(source);
      t.colorSpace = THREE.SRGBColorSpace;
      t.magFilter = t.minFilter = THREE.NearestFilter;
      t.generateMipmaps = false;
      this.textures.set(source, t);
    }
    return t;
  }
  private artFrames(species: Species): Frame[] {
    const key = `${species.biome}:${species.id}`;
    let frames = this.frames.get(key);
    if (frames) return frames;
    const sources = this.art?.animals.get(key) ?? [];
    frames = sources.map((source) => {
      const geometry = groundedGeometry(species.size, species.size, supportOf(source, 0.025));
      return {
        geometry,
        cast: shadowGeometry(geometry, false),
        contact: shadowGeometry(geometry, true),
        map: this.texture(source),
        mask: this.texture(silhouetteMask(source)),
      };
    });
    this.frames.set(key, frames);
    return frames;
  }
  private add(key: string, species: Species, x: number, z: number, level: number): void {
    const frames = this.artFrames(species);
    if (!frames.length) return;
    const f = frames[0]!;
    const body = new THREE.Mesh(
      f.geometry,
      new THREE.MeshBasicMaterial({
        map: f.map,
        vertexColors: true,
        alphaTest: 0.5,
        side: THREE.DoubleSide,
      }),
    );
    const shadow = (geometry: THREE.BufferGeometry, opacity: number) =>
      new THREE.Mesh(
        geometry,
        new THREE.MeshBasicMaterial({
          map: f.mask,
          vertexColors: true,
          color: '#263229',
          transparent: true,
          opacity,
          depthWrite: false,
          side: THREE.DoubleSide,
        }),
      );
    const cast = shadow(f.cast, 0.23),
      contact = shadow(f.contact, 0.45),
      root = new THREE.Group();
    cast.renderOrder = contact.renderOrder = 1;
    body.renderOrder = 2;
    root.add(body, cast, contact);
    root.position.set(x, heightOf(level), z);
    this.scene.add(root);
    this.actors.set(key, {
      key,
      species,
      root,
      body,
      cast,
      contact,
      frames,
      frame: 0,
      x,
      z,
      level,
      phase: hash32(key) % 997,
      state: 'resting',
      watchUntil: 0,
    });
  }
  /** Called after terrain/farm updates and camera moves, with a modest fixed actor budget. */
  sync(
    world: string,
    seed: number,
    terrain: WorldTerrain,
    window: CellWindow,
    planted: (x: number, z: number) => boolean,
    force = false,
  ): void {
    if (!this.art || this.destroyed) return;
    this.terrains = terrain;
    this.planted = planted;
    if (this.world !== world) {
      this.clear();
      this.world = world;
      force = true;
    }
    if (!force && this.clock - this.lastSync < 1) return;
    this.lastSync = this.clock;
    const keep = new Set<string>();
    const centerX = (window.x0 + window.x1) / 2,
      centerZ = (window.y0 + window.y1) / 2;
    const sectors: { x: number; z: number; d: number }[] = [];
    for (let z = Math.floor(window.y0 / 8) * 8; z <= window.y1; z += 8)
      for (let x = Math.floor(window.x0 / 8) * 8; x <= window.x1; x += 8)
        sectors.push({ x, z, d: Math.hypot(x + 4 - centerX, z + 4 - centerZ) });
    sectors.sort((a, b) => a.d - b.d);
    for (const sector of sectors.slice(0, 28)) {
      if (keep.size >= 14) break;
      const key = `${seed}:${sector.x}:${sector.z}`,
        hash = hash32(key);
      for (let attempt = 0; attempt < 12; attempt++) {
        const x = sector.x + ((hash + attempt * 13) % 8) + 0.5,
          z = sector.z + (((hash >>> 8) + attempt * 7) % 8) + 0.5;
        const c = terrain.cellAt(Math.floor(x), Math.floor(z)),
          biome = habitatOf(c);
        if (!biome || !c.walkable || c.liquid || c.decor || planted(Math.floor(x), Math.floor(z)))
          continue;
        keep.add(key);
        const prior = this.actors.get(key);
        if (
          prior &&
          (prior.level !== c.level ||
            prior.species.biome !== biome ||
            prior.x !== x ||
            prior.z !== z)
        ) {
          this.remove(prior);
          this.actors.delete(key);
        }
        if (!this.actors.has(key))
          this.add(key, SPECIES[biome][hash % SPECIES[biome].length]!, x, z, c.level);
        break;
      }
    }
    for (const [key, actor] of this.actors)
      if (!keep.has(key)) {
        this.remove(actor);
        this.actors.delete(key);
      }
    this.syncDetails(terrain, window, seed, planted);
  }
  private syncDetails(
    terrain: WorldTerrain,
    window: CellWindow,
    seed: number,
    planted: (x: number, z: number) => boolean,
  ): void {
    const keep = new Set<string>();
    for (let z = window.y0; z <= window.y1; z++)
      for (let x = window.x0; x <= window.x1; x++) {
        if (keep.size >= 36) break;
        const c = terrain.cellAt(x, z);
        if (!/^(oak_tree|spruce|palm|jungle_tree)$/.test(c.decor)) continue;
        const biome = habitatOf(c);
        if (!biome) continue;
        const definition =
          biome === 'jungle'
            ? jungle
            : biome === 'desert'
              ? desert
              : biome === 'taiga'
                ? taiga
                : null;
        if (!definition) continue;
        const hash = hash32(`${seed}:understory:${x},${z}`),
          idx = 1 + (hash % 5),
          prop = definition.props[idx]!;
        const px = x + (hash % 2 ? 1 : -1),
          pz = z + 1,
          target = terrain.cellAt(px, pz);
        if (
          target.level !== c.level ||
          target.decor ||
          !target.walkable ||
          target.liquid ||
          planted(px, pz)
        )
          continue;
        const key = `${x},${z}:${prop.id}:${c.level}`;
        keep.add(key);
        if (this.details.has(key)) continue;
        const source = this.art!.decor.get(prop.id);
        if (!source) continue;
        const size = Math.min(1.6, Math.max(prop.width, prop.height)) * 0.8;
        const geometry = groundedGeometry(size, size, supportOf(source, 0.025));
        const material = new THREE.MeshBasicMaterial({
          map: this.texture(source),
          alphaTest: 0.5,
          vertexColors: true,
          side: THREE.DoubleSide,
        });
        const root = new THREE.Group();
        root.add(new THREE.Mesh(geometry, material));
        root.position.set(px + 0.5, heightOf(c.level), pz + 0.5);
        this.scene.add(root);
        this.details.set(key, { key, root, geometry, material });
      }
    for (const [key, d] of this.details)
      if (!keep.has(key)) {
        this.scene.remove(d.root);
        d.geometry.dispose();
        d.material.dispose();
        this.details.delete(key);
      }
  }
  update(
    dt: number,
    reduced: boolean,
    weather: WeatherKind | null,
    tint: THREE.Color,
    centerX: number,
    centerZ: number,
  ): void {
    if (!reduced) this.clock += Math.min(0.08, dt);
    const hide = weather !== null && animalsShelter(weather);
    const terrain = this.terrains;
    for (const a of this.actors.values()) {
      a.root.visible = !hide;
      a.body.material.color.copy(tint);
      if (!terrain) continue;
      const t = (this.clock + a.phase) % 24,
        walking = t < 8 || (t >= 16 && t < 22);
      const progress = t < 8 ? t / 8 : t < 16 ? 1 : t < 22 ? 1 - (t - 16) / 6 : 0;
      const direction = a.phase % 2 ? 1 : -1,
        next = {
          x: a.x + direction * Math.sin(progress * Math.PI * 0.5) * 1.35,
          z: a.z + Math.sin(progress * Math.PI) * 0.45,
        };
      const observing = this.clock < a.watchUntil;
      a.state = observing ? 'watching' : walking ? 'walking' : t < 16 ? 'grazing' : 'resting';
      if (
        !observing &&
        !reduced &&
        safeWildlifeStep(
          (x, z) => terrain.cellAt(x, z),
          this.planted,
          { x: a.root.position.x, z: a.root.position.z },
          next,
          a.level,
        )
      ) {
        a.body.scale.x = a.cast.scale.x = a.contact.scale.x = next.x < a.root.position.x ? -1 : 1;
        a.root.position.set(next.x, heightOf(a.level), next.z);
      } else if (walking && !observing) a.state = 'resting';
      const frame =
        observing || reduced
          ? 0
          : a.state === 'walking'
            ? 1 + (Math.floor(this.clock * 5) % 2)
            : a.state === 'grazing'
              ? 3
              : 0;
      if (frame !== a.frame) {
        const f = a.frames[frame]!;
        a.frame = frame;
        a.body.geometry = f.geometry;
        a.body.material.map = f.map;
        a.cast.geometry = f.cast;
        a.contact.geometry = f.contact;
        a.cast.material.map = a.contact.material.map = f.mask;
      }
    }
    for (const d of this.details.values()) (d.material as THREE.MeshBasicMaterial).color.copy(tint);
    const points = this.insectGeo.getAttribute('position');
    this.insects.visible = !hide && this.actors.size > 0;
    for (let i = 0; i < 48; i++) {
      const x =
        Math.floor(centerX / 4) * 4 + ((i * 3.73) % 22) - 11 + Math.sin(this.clock * 0.3 + i) * 0.1;
      const z = Math.floor(centerZ / 4) * 4 + ((i * 2.31) % 18) - 9;
      const cell = terrain?.cellAt(Math.floor(x), Math.floor(z));
      points.setXYZ(
        i,
        x,
        heightOf(cell?.level ?? 0) + 0.25 + (i % 4) * 0.12 + Math.sin(this.clock + i) * 0.05,
        z,
      );
    }
    points.needsUpdate = true;
  }
  /** Empty-hand clicks observe wildlife; they never consume items or intercept tool actions. */
  observe(camera: THREE.Camera, point: THREE.Vector2, feet: { x: number; z: number }): boolean {
    this.ray.setFromCamera(point, camera);
    const hits = this.ray.intersectObjects(
      [...this.actors.values()].filter((a) => a.root.visible).map((a) => a.body),
      false,
    );
    for (const hit of hits) {
      const a = [...this.actors.values()].find((a) => a.body === hit.object)!;
      if (Math.hypot(a.root.position.x - feet.x, a.root.position.z - feet.z) > 3) continue;
      if (!hit.uv) continue;
      const source = a.body.material.map!.image as HTMLCanvasElement;
      const x = Math.max(0, Math.min(source.width - 1, Math.floor(hit.uv.x * source.width)));
      const y = Math.max(
        0,
        Math.min(source.height - 1, Math.floor((1 - hit.uv.y) * source.height)),
      );
      if (source.getContext('2d')!.getImageData(x, y, 1, 1).data[3]! < 128) continue;
      a.watchUntil = this.clock + 4;
      a.state = 'watching';
      return true;
    }
    return false;
  }
  snapshot() {
    return {
      ready: !!this.art,
      count: this.actors.size,
      props: this.details.size,
      animals: [...this.actors.values()].map((a) => ({
        id: a.species.id,
        biome: a.species.biome,
        x: a.root.position.x,
        z: a.root.position.z,
        state: a.state,
      })),
    };
  }
  private remove(a: Actor): void {
    this.scene.remove(a.root);
    a.body.material.dispose();
    a.cast.material.dispose();
    a.contact.material.dispose();
  }
  private clear(): void {
    this.actors.forEach((a) => this.remove(a));
    this.actors.clear();
    this.details.forEach((d) => {
      this.scene.remove(d.root);
      d.geometry.dispose();
      d.material.dispose();
    });
    this.details.clear();
  }
  dispose(): void {
    this.destroyed = true;
    this.clear();
    for (const frames of this.frames.values())
      for (const f of frames) {
        f.geometry.dispose();
        f.cast.dispose();
        f.contact.dispose();
      }
    this.frames.clear();
    this.textures.forEach((t) => t.dispose());
    this.textures.clear();
    this.scene.remove(this.insects);
    this.insectGeo.dispose();
    (this.insects.material as THREE.Material).dispose();
  }
}
