import * as THREE from 'three';
import { animalsShelter, hash32, type WeatherKind, type WorldTerrain } from '@agora/shared';
import { loadApprovedWorldArt, type ApprovedWorldArt } from '../art/approvedArt';
import type { CellWindow } from '../cellMath';
import { heightOf } from './math3d';

type Card = THREE.Mesh<THREE.PlaneGeometry, THREE.MeshBasicMaterial>;
interface Anchor {
  key: string;
  x: number;
  z: number;
  y: number;
  tree: string;
}
interface Bird {
  body: Card;
  home: Anchor;
  target: Anchor;
  ground: THREE.Vector3;
  phase: number;
  state: string;
}
interface Butterfly {
  body: Card;
  anchor: Anchor;
  phase: number;
}
interface Glow {
  floor: Card;
  flame: Card;
  phase: number;
}

/** Small, bounded ambient actors anchored to real placed terrain and decor. */
export class WorldAmbience {
  readonly ready: Promise<void>;
  private art?: ApprovedWorldArt;
  private destroyed = false;
  private world = '';
  private terrain?: WorldTerrain;
  private birds = new Map<string, Bird>();
  private butterflies = new Map<string, Butterfly>();
  private glows = new Map<string, Glow>();
  private textures = new Map<HTMLCanvasElement, THREE.Texture>();
  private birdFrames: THREE.Texture[] = [];
  private butterflyFrames: THREE.Texture[] = [];
  private glowTexture?: THREE.Texture;
  private clock = 0;
  private lastSeconds?: number;
  private lastSync = -Infinity;
  private lastWindow = '';
  private birdGeometry = new THREE.PlaneGeometry(0.36, 0.4).translate(0, 0.2, 0);
  private butterflyGeometry = new THREE.PlaneGeometry(0.24, 0.24).translate(0, 0.12, 0);
  private haloGeometry = new THREE.PlaneGeometry(2.8, 2.8).rotateX(-Math.PI / 2);
  private flameGeometry = new THREE.PlaneGeometry(0.8, 0.95);

  constructor(private scene: THREE.Scene) {
    this.ready = loadApprovedWorldArt().then((art) => {
      if (this.destroyed) return;
      this.art = art;
      this.birdFrames = art.birds.map((source) => this.texture(source));
      this.butterflyFrames = art.butterflies.map((source) => this.texture(source));
    });
    void this.ready.catch((error) =>
      console.warn('Ambient art unavailable; world remains playable.', error),
    );
  }

  private texture(source: HTMLCanvasElement): THREE.Texture {
    let texture = this.textures.get(source);
    if (!texture) {
      texture = new THREE.CanvasTexture(source);
      texture.colorSpace = THREE.SRGBColorSpace;
      texture.magFilter = texture.minFilter = THREE.NearestFilter;
      texture.generateMipmaps = false;
      this.textures.set(source, texture);
    }
    return texture;
  }

  private card(geometry: THREE.PlaneGeometry, map: THREE.Texture): Card {
    const body = new THREE.Mesh(
      geometry,
      new THREE.MeshBasicMaterial({ map, alphaTest: 0.45, side: THREE.DoubleSide }),
    );
    this.scene.add(body);
    return body;
  }

  private glow(anchor: Anchor): Glow {
    if (!this.glowTexture) {
      const source = document.createElement('canvas');
      source.width = source.height = 64;
      const context = source.getContext('2d')!;
      const gradient = context.createRadialGradient(32, 32, 0, 32, 32, 32);
      gradient.addColorStop(0, 'rgba(255, 196, 98, .85)');
      gradient.addColorStop(0.3, 'rgba(255, 155, 57, .35)');
      gradient.addColorStop(1, 'rgba(255, 125, 30, 0)');
      context.fillStyle = gradient;
      context.fillRect(0, 0, 64, 64);
      this.glowTexture = this.texture(source);
      this.glowTexture.magFilter = this.glowTexture.minFilter = THREE.LinearFilter;
    }
    const material = () =>
      new THREE.MeshBasicMaterial({
        map: this.glowTexture,
        transparent: true,
        depthWrite: false,
        side: THREE.DoubleSide,
        blending: THREE.AdditiveBlending,
      });
    const floor = new THREE.Mesh(this.haloGeometry, material()),
      flame = new THREE.Mesh(this.flameGeometry, material());
    floor.position.set(anchor.x, anchor.y + 0.012, anchor.z);
    flame.position.set(anchor.x, anchor.y + 0.78, anchor.z - 0.035);
    floor.renderOrder = flame.renderOrder = 3;
    this.scene.add(floor, flame);
    return { floor, flame, phase: hash32(anchor.key) % 100 };
  }

  /** Rescan after camera/terrain changes. Actor caps and distance sorting keep work bounded. */
  sync(terrain: WorldTerrain, window: CellWindow, worldId: string): void {
    if (!this.art || this.destroyed) return;
    if (this.world !== worldId) {
      this.clear();
      this.world = worldId;
      this.lastSync = -Infinity;
    }
    this.terrain = terrain;
    // Use wall time so placed/removed torches still update with reduced motion enabled.
    const now = Date.now(),
      windowKey = `${window.x0},${window.y0},${window.x1},${window.y1}`;
    if (windowKey === this.lastWindow && now - this.lastSync < 300) return;
    this.lastSync = now;
    this.lastWindow = windowKey;
    const trees: Anchor[] = [],
      flowers: Anchor[] = [],
      torches: Anchor[] = [];
    const cx = (window.x0 + window.x1) / 2,
      cz = (window.y0 + window.y1) / 2;
    for (let z = window.y0; z <= window.y1; z++)
      for (let x = window.x0; x <= window.x1; x++) {
        const cell = terrain.cellAt(x, z);
        const anchor = {
          key: `${worldId}:${x},${z}`,
          x: x + 0.5,
          z: z + 0.5,
          y: heightOf(cell.level),
          tree: cell.decor,
        };
        if (/^(oak_tree|spruce|palm|jungle_tree)$/.test(cell.decor)) trees.push(anchor);
        else if (cell.decor === 'torch') torches.push(anchor);
        else if (/flower|fern|bush/.test(cell.decor)) flowers.push(anchor);
      }
    const distance = (a: Anchor, b: Anchor) =>
      Math.hypot(a.x - cx, a.z - cz) - Math.hypot(b.x - cx, b.z - cz);
    trees.sort(distance);
    flowers.sort(distance);
    torches.sort(distance);
    const perches = trees.slice(0, 6);
    const birdKeys = new Set<string>();
    for (let i = 0; i < perches.length; i++) {
      const home = perches[i]!,
        target = perches[(i + 1) % perches.length]!;
      birdKeys.add(home.key);
      let bird = this.birds.get(home.key);
      const ground = this.groundNear(home);
      if (!bird) {
        const body = this.card(this.birdGeometry, this.birdFrames[0]!);
        bird = {
          body,
          home,
          target,
          ground,
          phase: (hash32(home.key) % 480) / 10,
          state: 'perching',
        };
        this.birds.set(home.key, bird);
      }
      bird.home = home;
      bird.target = target;
      bird.ground = ground;
    }
    this.prune(this.birds, birdKeys, (bird) => this.removeCard(bird.body));
    const butterflyKeys = new Set<string>();
    for (const anchor of [...flowers.slice(0, 4), ...perches].slice(0, 6)) {
      butterflyKeys.add(anchor.key);
      const prior = this.butterflies.get(anchor.key);
      if (prior) prior.anchor = anchor;
      else
        this.butterflies.set(anchor.key, {
          anchor,
          body: this.card(this.butterflyGeometry, this.butterflyFrames[0]!),
          phase: hash32(`butterfly:${anchor.key}`) % 200,
        });
    }
    this.prune(this.butterflies, butterflyKeys, (butterfly) => this.removeCard(butterfly.body));
    const torchKeys = new Set<string>();
    for (const anchor of torches.slice(0, 8)) {
      torchKeys.add(anchor.key);
      const prior = this.glows.get(anchor.key);
      if (!prior) this.glows.set(anchor.key, this.glow(anchor));
      else {
        prior.floor.position.y = anchor.y + 0.012;
        prior.flame.position.y = anchor.y + 0.78;
      }
    }
    this.prune(this.glows, torchKeys, (glow) => {
      this.removeCard(glow.floor);
      this.removeCard(glow.flame);
    });
  }

  private groundNear(anchor: Anchor): THREE.Vector3 {
    for (const [dx, dz] of [
      [1, 1],
      [-1, 1],
      [0, 2],
      [2, 0],
      [-2, 0],
    ]) {
      const x = anchor.x + dx!,
        z = anchor.z + dz!,
        cell = this.terrain!.cellAt(Math.floor(x), Math.floor(z));
      if (cell.walkable && !cell.liquid && !cell.decor)
        return new THREE.Vector3(x, heightOf(cell.level) + 0.015, z);
    }
    return this.perch(anchor);
  }

  private perch(anchor: Anchor): THREE.Vector3 {
    const height = this.art!.metrics.get(`decor:${anchor.tree}`)?.height ?? 3.6;
    return new THREE.Vector3(anchor.x - 0.22, anchor.y + height * 0.64, anchor.z - 0.2);
  }

  /** Absolute seconds; pausing/reduced motion never accumulates a catch-up jump. */
  update(seconds: number, reduced: boolean, weather: WeatherKind | null, tint: THREE.Color): void {
    if (this.destroyed) return;
    if (!reduced && this.lastSeconds !== undefined)
      this.clock += Math.min(0.1, Math.max(0, seconds - this.lastSeconds));
    this.lastSeconds = seconds;
    const sheltered = weather !== null && animalsShelter(weather);
    for (const bird of this.birds.values()) {
      bird.body.visible = !sheltered;
      bird.body.material.color.copy(tint);
      const t = (this.clock + bird.phase) % 48;
      const home = this.perch(bird.home),
        target = this.perch(bird.target);
      let from = home,
        to = home,
        progress = 0;
      bird.state = 'perching';
      if (t >= 12 && t < 18) {
        from = home;
        to = target;
        progress = (t - 12) / 6;
        bird.state = 'flying';
      } else if (t >= 18 && t < 26) from = to = target;
      else if (t >= 26 && t < 30) {
        from = target;
        to = bird.ground;
        progress = (t - 26) / 4;
        bird.state = 'landing';
      } else if (t >= 30 && t < 40) {
        from = to = bird.ground;
        bird.state = 'pecking';
      } else if (t >= 40) {
        from = bird.ground;
        to = home;
        progress = (t - 40) / 8;
        bird.state = 'flying';
      }
      const moving = bird.state === 'flying' || bird.state === 'landing';
      bird.body.position.lerpVectors(from, to, progress);
      if (moving) bird.body.position.y += Math.sin(progress * Math.PI) * 0.85;
      const peck =
        bird.state === 'pecking' ? Math.max(0, Math.sin(this.clock * 5 + bird.phase)) : 0;
      bird.body.rotation.z = peck * 0.22;
      bird.body.scale.set(to.x < from.x ? -1 : 1, 1 - peck * 0.12, 1);
      bird.body.material.map =
        this.birdFrames[moving ? Math.floor(this.clock * 8) % this.birdFrames.length : 0]!;
    }
    for (const butterfly of this.butterflies.values()) {
      const t = this.clock + butterfly.phase,
        a = butterfly.anchor;
      butterfly.body.visible = !sheltered;
      butterfly.body.material.color.copy(tint);
      butterfly.body.position.set(
        a.x + Math.sin(t * 0.7) * 0.9,
        a.y + 0.55 + Math.sin(t * 1.2) * 0.23,
        a.z + Math.cos(t * 0.47) * 0.6,
      );
      butterfly.body.scale.x = 0.4 + Math.abs(Math.sin(t * 8)) * 0.6;
      butterfly.body.material.map =
        this.butterflyFrames[Math.floor(t * 7) % this.butterflyFrames.length]!;
    }
    for (const glow of this.glows.values()) {
      const flicker =
        0.9 +
        Math.sin(this.clock * 7 + glow.phase) * 0.055 +
        Math.sin(this.clock * 11 + glow.phase) * 0.035;
      glow.floor.material.opacity = 0.3 * flicker;
      glow.flame.material.opacity = 0.2 * flicker;
      glow.floor.scale.setScalar(flicker);
    }
  }

  snapshot() {
    return {
      ready: !!this.art,
      birds: this.birds.size,
      butterflies: this.butterflies.size,
      torches: this.glows.size,
      states: [...this.birds.values()].map((bird) => bird.state),
    };
  }
  private removeCard(card: Card): void {
    this.scene.remove(card);
    card.material.dispose();
  }
  private prune<T>(items: Map<string, T>, keep: Set<string>, remove: (value: T) => void): void {
    for (const [key, value] of items)
      if (!keep.has(key)) {
        remove(value);
        items.delete(key);
      }
  }
  private clear(): void {
    this.birds.forEach((bird) => this.removeCard(bird.body));
    this.birds.clear();
    this.butterflies.forEach((butterfly) => this.removeCard(butterfly.body));
    this.butterflies.clear();
    this.glows.forEach((glow) => {
      this.removeCard(glow.floor);
      this.removeCard(glow.flame);
    });
    this.glows.clear();
  }
  dispose(): void {
    this.destroyed = true;
    this.clear();
    for (const geometry of [
      this.birdGeometry,
      this.butterflyGeometry,
      this.haloGeometry,
      this.flameGeometry,
    ])
      geometry.dispose();
    this.textures.forEach((texture) => texture.dispose());
    this.textures.clear();
  }
}
