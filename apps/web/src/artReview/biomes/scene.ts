import * as THREE from 'three';
import { TILT } from '../../game3d/camera';
import { waterSurfaceTexture, type ReviewArt } from '../art';
import { groundedGeometry, shadowGeometry, silhouetteMask, supportOf } from '../grounding';
import { birdPose } from '../life';
import { biomeGround, inPond, pondDistance } from './terrain';
import type { BiomeArt } from './types';

interface Resident {
  root: THREE.Group;
  frames: THREE.Group[];
  state: string;
  frame: number;
  fed: number;
  petted: number;
  action: string;
  until: number;
  anchor: THREE.Vector3;
}
/** Review scenes share Agora's fixed camera and silhouette-grounded rendering. */
export class BiomeScene {
  readonly renderer = new THREE.WebGLRenderer({ antialias: false, alpha: true });
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.OrthographicCamera(-9, 9, 7, -7, 0.1, 100);
  readonly root = new THREE.Group();
  readonly animals: Resident[] = [];
  selected = 0;
  paused = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  dusk = false;
  private active = true;
  private time = 0;
  private last = 0;
  private raf = 0;
  private ro: ResizeObserver;
  private textures = new Set<THREE.Texture>();
  private tintMaterials: THREE.MeshBasicMaterial[] = [];
  private waterMaterials: THREE.MeshBasicMaterial[] = [];
  private waterMaps: THREE.CanvasTexture[];
  private windTime = { value: 0 };
  private birds: { root: THREE.Group; frames: THREE.Group[] }[] = [];
  private butterflies: THREE.Mesh[] = [];
  private motes: THREE.Points;
  private ray = new THREE.Raycaster();
  private pointer = new THREE.Vector2();
  private propCount = 0;

  constructor(
    readonly host: HTMLElement,
    readonly art: BiomeArt,
    sharedArt: ReviewArt,
    private onSelect: (index: number) => void,
  ) {
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.localClippingEnabled = true;
    this.renderer.setClearColor(0, 0);
    this.renderer.domElement.setAttribute(
      'aria-label',
      `${art.definition.label} biome. Select an animal in the scene or use the animal selector.`,
    );
    this.renderer.domElement.addEventListener('pointerdown', this.pick);
    host.append(this.renderer.domElement);
    const colors = art.definition.colors;
    host.style.background = `radial-gradient(ellipse at 45% 30%, ${new THREE.Color(colors.accent).lerp(new THREE.Color('#f4f0db'), 0.5).getStyle()}, ${new THREE.Color(colors.grass).lerp(new THREE.Color('#dedac8'), 0.45).getStyle()})`;
    this.scene.add(this.root);
    this.waterMaps = Array.from({ length: 8 }, (_, i) => this.texture(waterSurfaceTexture(i)));
    this.makeTerrain();
    this.makeProps();
    this.makeAnimals();
    const visitor = this.object(sharedArt.avatars.new[0]![0]!, 1.45, 0.035);
    visitor.position.set(6.55, 0, 9.5);
    this.root.add(visitor);
    for (let i = 0; i < 2; i++) {
      const root = new THREE.Group();
      const frames = sharedArt.birds.map((source) => this.object(source, 0.38, 0));
      frames.forEach((frame) =>
        frame.children.slice(1).forEach((shadow) => {
          shadow.visible = false;
        }),
      );
      root.add(...frames);
      this.root.add(root);
      this.birds.push({ root, frames });
    }
    for (let i = 0; i < 5; i++) {
      const m = new THREE.Mesh(
        new THREE.PlaneGeometry(0.22, 0.22),
        this.material(this.texture(sharedArt.butterflies[i % sharedArt.butterflies.length]!)),
      );
      this.root.add(m);
      this.butterflies.push(m);
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute(
      'position',
      new THREE.Float32BufferAttribute(new Float32Array(18 * 3), 3),
    );
    this.motes = new THREE.Points(
      geometry,
      new THREE.PointsMaterial({
        color: art.definition.id === 'taiga' ? '#eef7ef' : '#ead885',
        size: 2.1,
        sizeAttenuation: false,
        transparent: true,
        opacity: 0.65,
        depthWrite: false,
      }),
    );
    this.root.add(this.motes);
    this.ro = new ResizeObserver(() => this.resize());
    this.ro.observe(host);
    this.resize();
    this.seek(0);
    this.raf = requestAnimationFrame(this.tick);
  }
  private texture(source: HTMLCanvasElement): THREE.CanvasTexture {
    const t = new THREE.CanvasTexture(source);
    t.colorSpace = THREE.SRGBColorSpace;
    t.magFilter = THREE.NearestFilter;
    t.minFilter = THREE.NearestFilter;
    t.generateMipmaps = false;
    this.textures.add(t);
    return t;
  }
  private material(map?: THREE.Texture, wind = false): THREE.MeshBasicMaterial {
    const m = new THREE.MeshBasicMaterial({
      map,
      alphaTest: 0.5,
      side: THREE.DoubleSide,
      vertexColors: true,
    });
    this.tintMaterials.push(m);
    if (wind)
      m.onBeforeCompile = (shader) => {
        shader.uniforms.uBiomeTime = this.windTime;
        shader.vertexShader = 'uniform float uBiomeTime;\n' + shader.vertexShader;
        shader.vertexShader = shader.vertexShader.replace(
          '#include <begin_vertex>',
          `#include <begin_vertex>
        transformed.x += sin(uBiomeTime*1.25+position.y*1.5+modelMatrix[3].x)*max(0.0,position.y)*.008;`,
        );
      };
    return m;
  }
  private object(source: HTMLCanvasElement, size: number, foot = 0.04, wind = false): THREE.Group {
    const geometry = groundedGeometry(size, size, supportOf(source, foot));
    const group = new THREE.Group();
    const mesh = new THREE.Mesh(geometry, this.material(this.texture(source), wind));
    mesh.renderOrder = 2;
    group.add(mesh);
    for (const contact of [false, true]) {
      const shadow = new THREE.Mesh(
        shadowGeometry(geometry, contact),
        new THREE.MeshBasicMaterial({
          map: this.texture(silhouetteMask(source, contact)),
          color: '#26372d',
          vertexColors: true,
          transparent: true,
          depthWrite: false,
          side: THREE.DoubleSide,
          opacity: contact ? 0.48 : 0.25,
          clippingPlanes: [
            new THREE.Plane(new THREE.Vector3(1, 0, 0), 0),
            new THREE.Plane(new THREE.Vector3(-1, 0, 0), 14),
            new THREE.Plane(new THREE.Vector3(0, 0, 1), 0),
            new THREE.Plane(new THREE.Vector3(0, 0, -1), 11),
          ],
        }),
      );
      shadow.renderOrder = 1;
      group.add(shadow);
    }
    return group;
  }
  private makeTerrain(): void {
    const b = this.art.definition;
    const positions: number[] = [],
      uvs: number[] = [],
      water: number[] = [],
      waterUv: number[] = [],
      waterColors: number[] = [];
    const step = 0.1;
    for (let z = 0; z < 110; z++)
      for (let x = 0; x < 140; x++) {
        const wx = x * step,
          wz = z * step,
          wet = inPond(wx + 0.05, wz + 0.05);
        for (const [dx, dz] of [
          [0, 0],
          [0, 1],
          [1, 0],
          [1, 0],
          [0, 1],
          [1, 1],
        ]) {
          const px = wx + dx! * step,
            pz = wz + dz! * step;
          if (wet) {
            const depth = Math.max(0, 1 - pondDistance(px, pz));
            water.push(px, -0.12 - depth * 0.6, pz);
            waterUv.push(px / 2, 1 - pz / 2);
            const color = new THREE.Color(b.colors.water).lerp(
              new THREE.Color('#193f4a'),
              depth * 0.8,
            );
            color.lerp(new THREE.Color(b.colors.dirt), Math.max(0, 0.22 - depth) * 2);
            color.multiplyScalar(0.97 + Math.sin(px * 19 + pz * 25) * 0.03);
            waterColors.push(color.r, color.g, color.b);
          } else {
            positions.push(px, 0, pz);
            uvs.push(px / 14, 1 - pz / 11);
          }
        }
      }
    const floor = new THREE.BufferGeometry();
    floor.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    floor.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
    const material = new THREE.MeshBasicMaterial({
      map: this.texture(biomeGround(b)),
      side: THREE.DoubleSide,
    });
    this.tintMaterials.push(material);
    this.root.add(new THREE.Mesh(floor, material));
    const basin = new THREE.BufferGeometry();
    basin.setAttribute('position', new THREE.Float32BufferAttribute(water, 3));
    basin.setAttribute('color', new THREE.Float32BufferAttribute(waterColors, 3));
    basin.setAttribute('uv', new THREE.Float32BufferAttribute(waterUv, 2));
    const bedMat = new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.DoubleSide });
    this.tintMaterials.push(bedMat);
    this.root.add(new THREE.Mesh(basin, bedMat));
    const surface = basin.clone(),
      pos = surface.getAttribute('position');
    for (let i = 0; i < pos.count; i++) pos.setY(i, -0.06);
    surface.deleteAttribute('color');
    const surfaceMat = new THREE.MeshBasicMaterial({
      map: this.waterMaps[0],
      transparent: true,
      depthWrite: false,
      opacity: 0.8,
      side: THREE.DoubleSide,
    });
    for (const t of this.waterMaps) {
      t.wrapS = t.wrapT = THREE.RepeatWrapping;
    }
    this.waterMaterials.push(surfaceMat);
    this.root.add(new THREE.Mesh(surface, surfaceMat));
    for (let i = 0; i < 28; i++) {
      const a = i * 2.4,
        r = 0.6 + (i % 3) * 0.09,
        x = 9.8 + Math.cos(a) * 2.55 * r,
        z = 4.15 + Math.sin(a) * 1.8 * r;
      const depth = Math.max(0, 1 - pondDistance(x, z));
      const rock = new THREE.Mesh(
        new THREE.IcosahedronGeometry(0.04 + (i % 3) * 0.017, 0),
        new THREE.MeshBasicMaterial({
          color: new THREE.Color(b.colors.stone).lerp(new THREE.Color(b.colors.water), 0.4),
        }),
      );
      rock.position.set(x, -0.1 - depth * 0.6, z);
      rock.scale.set(1.6, 0.45, 1);
      this.root.add(rock);
    }
    // Shallow soil sides make the floor a tangible block volume.
    const sideMat = new THREE.MeshBasicMaterial({ color: b.colors.dirt });
    this.tintMaterials.push(sideMat);
    const island = new THREE.Mesh(new THREE.BoxGeometry(14, 0.55, 11), sideMat);
    island.position.set(7, -1.02, 5.5);
    this.root.add(island);
    const side = new THREE.Mesh(
      new THREE.BoxGeometry(14, 0.72, 0.08),
      new THREE.MeshBasicMaterial({ color: b.colors.edge }),
    );
    side.position.set(7, -0.37, 10.99);
    this.root.add(side);
    for (const x of [0, 14]) {
      const side = new THREE.Mesh(
        new THREE.BoxGeometry(0.06, 0.72, 11),
        new THREE.MeshBasicMaterial({ color: b.colors.dirt }),
      );
      side.position.set(x, -0.37, 5.5);
      this.root.add(side);
    }
  }
  private makeProps(): void {
    const locations: [number, number, number, number][] = [
      [0, 1.1, 1.9, 1.12],
      [0, 4, 1.3, 0.95],
      [0, 7.1, 0.8, 0.9],
      [0, 12.3, 1.4, 1.08],
      [0, 0.9, 6.8, 0.83],
      [1, 2.3, 3, 1],
      [2, 1, 3.7, 1],
      [3, 12.3, 5.2, 1],
      [4, 2.9, 4.15, 1],
      [5, 2.1, 4.55, 1],
      [1, 7.3, 2.6, 0.82],
      [2, 11.7, 6.5, 1],
      [1, 12.8, 8.4, 0.82],
      [5, 11.7, 7.9, 1.2],
      [3, 0.85, 8.5, 0.75],
      [2, 1.8, 8.8, 1.15],
      [4, 8.7, 9.5, 0.8],
      [5, 7.7, 9.6, 1],
      [1, 4, 9.5, 0.85],
      [2, 10.4, 6.5, 0.75],
      [5, 4.2, 2.4, 0.8],
      [3, 8.1, 2.3, 0.5],
    ];
    for (const [index, x, z, scale] of locations) {
      const def = this.art.definition.props[index]!,
        source = this.art.props[index]!;
      const size = Math.max(def.width, def.height) * scale * (index === 0 ? 1.08 : 1);
      const group = this.object(
        source,
        size,
        index === 0 ? 0.12 : index === 3 ? 0.055 : 0.025,
        index !== 3 && index !== 4,
      );
      group.position.set(x, 0, z);
      this.root.add(group);
      this.propCount++;
    }
  }
  private makeAnimals(): void {
    this.art.definition.animals.forEach((def, index) => {
      const root = new THREE.Group();
      const frames = this.art.animals[index]!.map((source) =>
        this.object(source, Math.max(def.width, def.height), 0.025),
      );
      frames.forEach((frame) => {
        frame.traverse((o) => {
          if (o instanceof THREE.Mesh && o.renderOrder === 2) o.userData.animal = index;
        });
        root.add(frame);
      });
      this.root.add(root);
      this.animals.push({
        root,
        frames,
        state: 'resting',
        frame: 0,
        fed: 0,
        petted: 0,
        action: '',
        until: 0,
        anchor: new THREE.Vector3(),
      });
    });
  }
  selectAnimal(index: number): void {
    this.selected = Math.max(0, Math.min(this.animals.length - 1, index));
  }
  interact(action: 'feed' | 'pet'): string {
    const animal = this.animals[this.selected]!,
      def = this.art.definition.animals[this.selected]!;
    if (action === 'pet' && def.kind === 'wild') {
      animal.action = 'watching';
      animal.until = this.time + 4;
      animal.anchor.copy(animal.root.position);
      this.update();
      return `${def.label} notices you and pauses to listen. Give this wild visitor some space.`;
    }
    animal.action = action === 'feed' ? 'feeding' : 'content';
    animal.until = this.time + 5;
    animal.anchor.copy(animal.root.position);
    if (action === 'feed') animal.fed++;
    else animal.petted++;
    this.update();
    return action === 'feed'
      ? `${def.label} stops to enjoy a little food. Fed ${animal.fed} time${animal.fed === 1 ? '' : 's'}.`
      : `${def.label} relaxes after a gentle pat. Petted ${animal.petted} time${animal.petted === 1 ? '' : 's'}.`;
  }
  setPaused(value: boolean): void {
    this.paused = value;
  }
  setActive(value: boolean): void {
    this.active = value;
    this.last = 0;
    if (value) this.resize();
  }
  setDusk(value: boolean): void {
    this.dusk = value;
    for (const mat of this.tintMaterials) {
      mat.userData.baseColor ??= mat.color.getHex();
      mat.color.set(mat.userData.baseColor as number);
      if (value) mat.color.multiply(new THREE.Color('#acb4ce'));
    }
    this.host.classList.toggle('dusk', value);
    this.render();
  }
  seek(time: number): void {
    this.time = Math.max(0, time);
    this.update();
    this.render();
  }
  private update(): void {
    this.windTime.value = this.time;
    this.animals.forEach((a, i) => {
      const def = this.art.definition.animals[i]!,
        t = (this.time + i * 7) % 28;
      const walking = t < 8 || (t >= 18 && t < 26),
        goingRight = t < 8;
      const progress = t < 8 ? t / 8 : t < 18 ? 1 : t < 26 ? 1 - (t - 18) / 8 : 0;
      let x = 3.4 + i * 0.85 + progress * 1.35,
        z = 5.4 + i * 0.95 + Math.sin(progress * Math.PI) * 0.22;
      const swims = this.art.definition.id === 'jungle' && /turtle|capybara/.test(def.id);
      if (swims) {
        x = 7.8 + progress * 2.25;
        z = 5.5 - i * 0.38 - Math.sin(progress * Math.PI) * 0.32;
      }
      const acting = this.time < a.until;
      a.state = acting ? a.action : walking ? 'walking' : t < 18 ? 'grazing' : 'resting';
      a.frame = acting
        ? a.action === 'feeding'
          ? 3
          : 0
        : walking
          ? 1 + (Math.floor(this.time * 5) % 2)
          : t < 18
            ? 3
            : 0;
      if (acting) a.root.position.copy(a.anchor);
      else {
        a.root.position.set(x, swims && inPond(x, z) ? -0.22 : 0, z);
        if (a.until > 0 && this.time - a.until < 2) {
          const mix = Math.min(1, Math.max(0, (this.time - a.until) / 2));
          a.root.position.lerpVectors(a.anchor, a.root.position, mix * mix * (3 - 2 * mix));
        }
        if (swims && inPond(x, z)) a.state = 'swimming';
      }
      // Hares hop while their body and silhouette stay attached between each landing.
      if (!acting && walking && /hare/.test(def.id))
        a.root.position.y = Math.abs(Math.sin(this.time * 6)) * 0.075;
      a.root.scale.x = walking ? (goingRight ? 1 : -1) : a.root.scale.x;
      a.frames.forEach((frame, j) => (frame.visible = j === a.frame));
    });
    const perches: [number, number, number][] = [
      [1.1, 2.2, 1.9],
      [7.1, 2.4, 0.8],
      [12.3, 2.3, 1.4],
    ];
    this.birds.forEach((bird, i) => {
      const pose = birdPose(this.time, i, perches);
      bird.root.position.set(...pose.at);
      bird.root.scale.x = pose.facing;
      bird.frames.forEach((frame, j) => (frame.visible = j === pose.frame));
    });
    this.butterflies.forEach((m, i) => {
      m.position.set(
        2 + i * 2 + Math.sin(this.time * 0.45 + i) * 0.5,
        0.35 + Math.sin(this.time * 1.8 + i) * 0.16,
        7 + Math.cos(this.time * 0.4 + i) * 1.3,
      );
      m.scale.x = 0.55 + Math.abs(Math.sin(this.time * 7 + i)) * 0.45;
      m.visible = this.art.definition.id !== 'taiga';
    });
    const pos = this.motes.geometry.getAttribute('position');
    for (let i = 0; i < pos.count; i++)
      pos.setXYZ(
        i,
        0.5 + ((i * 1.77) % 13) + Math.sin(this.time * 0.35 + i) * 0.18,
        this.art.definition.id === 'taiga'
          ? 3 - ((this.time * 0.2 + i * 0.23) % 3)
          : 0.2 + (i % 5) * 0.17 + Math.sin(this.time + i) * 0.07,
        2 + ((i * 1.31) % 8) + Math.cos(this.time * 0.3 + i) * 0.13,
      );
    pos.needsUpdate = true;
    for (const m of this.waterMaterials) m.map = this.waterMaps[Math.floor(this.time * 4) % 8]!;
  }
  private resize(): void {
    const w = this.host.clientWidth,
      h = this.host.clientHeight;
    if (!w || !h) return;
    this.renderer.setSize(w, h);
    const aspect = w / h,
      halfWidth = Math.max(8.4, 7 * aspect),
      halfHeight = halfWidth / aspect;
    this.camera.left = -halfWidth;
    this.camera.right = halfWidth;
    this.camera.top = halfHeight;
    this.camera.bottom = -halfHeight;
    const tilt = (TILT * Math.PI) / 180;
    this.camera.position.set(7, 25 * Math.sin(tilt) + 0.9, 5.5 + 25 * Math.cos(tilt));
    this.camera.lookAt(7, 0.9, 5.5);
    this.camera.updateProjectionMatrix();
    this.render();
  }
  private render(): void {
    this.renderer.render(this.scene, this.camera);
  }
  private tick = (now: number): void => {
    const delta = this.last ? Math.min(0.05, (now - this.last) / 1000) : 0;
    this.last = now;
    if (this.active) {
      if (!this.paused) this.time += delta;
      this.update();
      this.render();
    }
    this.raf = requestAnimationFrame(this.tick);
  };
  private pick = (event: PointerEvent): void => {
    const rect = this.renderer.domElement.getBoundingClientRect();
    this.pointer.set(
      ((event.clientX - rect.left) / rect.width) * 2 - 1,
      (-(event.clientY - rect.top) / rect.height) * 2 + 1,
    );
    this.ray.setFromCamera(this.pointer, this.camera);
    const meshes = this.animals.flatMap((a) =>
      a.frames[a.frame]!.children.filter((o) => o.userData.animal !== undefined),
    );
    const hit = this.ray.intersectObjects(meshes, false)[0];
    if (hit) {
      this.selectAnimal(hit.object.userData.animal as number);
      this.onSelect(this.selected);
    }
  };
  snapshot(): object {
    return {
      biome: this.art.definition.id,
      time: this.time,
      paused: this.paused,
      dusk: this.dusk,
      propCount: this.propCount,
      waterDepth: 0.66,
      selected: this.selected,
      animals: this.animals.map((a, i) => ({
        id: this.art.definition.animals[i]!.id,
        kind: this.art.definition.animals[i]!.kind,
        state: a.state,
        frame: a.frame,
        position: a.root.position.toArray(),
        fed: a.fed,
        petted: a.petted,
      })),
    };
  }
  dispose(): void {
    cancelAnimationFrame(this.raf);
    this.ro.disconnect();
    this.renderer.domElement.removeEventListener('pointerdown', this.pick);
    this.root.traverse((o) => {
      if (o instanceof THREE.Mesh || o instanceof THREE.Points) {
        o.geometry.dispose();
        (Array.isArray(o.material) ? o.material : [o.material]).forEach((m) => m.dispose());
      }
    });
    this.textures.forEach((t) => t.dispose());
    this.renderer.dispose();
    this.renderer.domElement.remove();
  }
}
