import * as THREE from 'three';
import { BLOCKS } from '@agora/shared';
import { FOV, TILT, camPos, distForZoom } from '../game3d/camera';
import {
  DIRECTIONS,
  cropTexture,
  groundTexture,
  waterSurfaceTexture,
  vergeTexture,
  type ArtMode,
  type ReviewArt,
} from './art';
import { DEPTH, PLACEMENTS, WIDTH, groundAt } from './catalog';
import { groundedGeometry, silhouetteMask, shadowGeometry, supportOf } from './grounding';
import { ReviewLife, type Place } from './life';
import type { BedAxis } from '../worlds/bedArt';
import { CropMotion, REVIEW_CROPS, type ReviewCrop } from './crops';
import { plantedSoilGeometry, plantedSoilTexture, plantingDepth, soilHeight } from './cropSoil';
import { REVIEW_TREES, type ReviewTree } from './plantCatalog';

// Painted floor depth: furniture rear feet occupy a deeper footprint than a trunk or shoe.
const FOOT_HEIGHT: Record<string, number> = {
  oak_tree: 0.18,
  spruce: 0.12,
  palm: 0.1,
  jungle_tree: 0.18,
  'hub.deskMonitor': 0.26,
  chairDown: 0.1,
  bed: 0.4,
  chest: 0.12,
  workbench: 0.18,
  shipping_bin: 0.18,
  fence: 0.055,
  boulder: 0.12,
  fern: 0.07,
  flower: 0.045,
  torch: 0.035,
  cactus: 0.045,
};
const PROP_SIZE: Record<string, [number, number]> = {
  oak_tree: [3.3, 4.4],
  spruce: [2.5, 4.8],
  palm: [2.9, 4.3],
  jungle_tree: [3.4, 4.6],
  flower: [0.75, 0.55],
  fern: [0.9, 0.7],
  cactus: [0.8, 1.3],
  torch: [0.65, 1.1],
  'hub.deskMonitor': [2, 1.65],
  chairDown: [1, 1.25],
  bed: [1.85, 1.85],
  workbench: [1.85, 1.4],
  boulder: [1, 0.85],
};

export class ReviewScene {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.PerspectiveCamera(FOV, 1, 0.1, 150);
  readonly root = new THREE.Group();
  readonly ray = new THREE.Raycaster();
  readonly pointer = new THREE.Vector2();
  readonly textures = new Map<HTMLCanvasElement, THREE.CanvasTexture>();
  readonly grounds = new Map<string, THREE.CanvasTexture>();
  readonly keys = new Set<string>();
  readonly person: THREE.Mesh<THREE.BufferGeometry, THREE.MeshBasicMaterial>;
  readonly shadow: THREE.Mesh<THREE.BufferGeometry, THREE.MeshBasicMaterial>;
  readonly contactShadow: THREE.Mesh<THREE.BufferGeometry, THREE.MeshBasicMaterial>;
  mode: ArtMode = 'new';
  direction = 0;
  walking = true;
  dusk = false;
  grid = false;
  zoom = 1;
  px = 6.3;
  pz = 6.8;
  time = 0;
  frame = 0;
  private raf = 0;
  private active = true;
  private last = 0;
  private waterFrame = -1;
  bedAxis: BedAxis = 'vertical';
  ambience = true;
  private life: ReviewLife;
  private lifeTime = 0;
  private torches: THREE.Group[] = [];
  private lightTime = { value: 0 };
  private lightStrength = { value: 0.1 };
  treeStage = 3;
  treeSpecies: ReviewTree = 'oak_tree';
  treeBloom = false;
  cropSpecies: ReviewCrop = 'dawn_radish';
  cropStage = -1;
  private soilStages: number[] = [];
  private crops: CropMotion[] = [];
  private cropSoils: THREE.MeshBasicMaterial[] = [];
  private wateredAt = -Infinity;
  private droplets?: THREE.Points<THREE.BufferGeometry, THREE.PointsMaterial>;
  private waterMaps: THREE.CanvasTexture[] = [];
  private vergeArt = [vergeTexture(), vergeTexture(true)];
  private waterSurface?: THREE.Mesh<THREE.PlaneGeometry, THREE.MeshBasicMaterial>;
  private materials: THREE.MeshBasicMaterial[] = [];
  private gridHelper: THREE.GridHelper;
  private masks = new Map<HTMLCanvasElement, THREE.CanvasTexture>();
  private contactMasks = new Map<HTMLCanvasElement, THREE.CanvasTexture>();
  private shadowMaterials: THREE.MeshBasicMaterial[] = [];
  private avatarGeometry = new Map<
    HTMLCanvasElement,
    {
      body: THREE.BufferGeometry;
      cast: THREE.BufferGeometry;
      contact: THREE.BufferGeometry;
    }
  >();
  private lastAvatar?: HTMLCanvasElement;
  private ro: ResizeObserver;
  private onSelect: (id: string) => void;
  private reduced = window.matchMedia('(prefers-reduced-motion: reduce)');

  constructor(
    readonly host: HTMLElement,
    readonly art: ReviewArt,
    onSelect: (id: string) => void,
  ) {
    this.onSelect = onSelect;
    this.renderer = new THREE.WebGLRenderer({ antialias: false, alpha: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.setClearColor(0x000000, 0);
    this.renderer.domElement.tabIndex = 0;
    this.renderer.domElement.setAttribute(
      'aria-label',
      '2.5D art review. Use arrow keys or WASD to walk. Click an object to inspect it.',
    );
    host.append(this.renderer.domElement);
    this.scene.add(this.root);
    this.life = new ReviewLife(art, (source) => this.texture(source));
    this.scene.add(this.life.root);
    this.ambience = !this.reduced.matches;

    this.person = new THREE.Mesh(
      new THREE.BufferGeometry(),
      new THREE.MeshBasicMaterial({ alphaTest: 0.5, vertexColors: true, side: THREE.DoubleSide }),
    );
    this.person.renderOrder = 2;
    this.bindLight(this.person.material);
    this.scene.add(this.person);
    this.shadow = new THREE.Mesh(new THREE.BufferGeometry(), this.shadowMaterial(false));
    this.contactShadow = new THREE.Mesh(new THREE.BufferGeometry(), this.shadowMaterial(true));
    this.shadow.renderOrder = this.contactShadow.renderOrder = 1;
    this.scene.add(this.shadow, this.contactShadow);
    this.gridHelper = new THREE.GridHelper(14, 14, 0xf3e1b1, 0xf3e1b1);
    this.gridHelper.position.set(7, 0.025, 7);
    (this.gridHelper.material as THREE.Material).transparent = true;
    (this.gridHelper.material as THREE.Material).opacity = 0.28;
    this.gridHelper.visible = false;
    this.scene.add(this.gridHelper);
    this.walking = !this.reduced.matches;
    this.ro = new ResizeObserver(() => this.resize());
    this.ro.observe(host);
    host.addEventListener('pointerdown', this.pick);
    this.renderer.domElement.addEventListener('keydown', this.keyDown);
    window.addEventListener('keyup', this.keyUp);
    window.addEventListener('blur', this.blur);
    this.rebuild();
    this.resize();
    this.raf = requestAnimationFrame(this.tick);
  }

  texture(c: HTMLCanvasElement): THREE.CanvasTexture {
    let tex = this.textures.get(c);
    if (!tex) {
      tex = new THREE.CanvasTexture(c);
      tex.colorSpace = THREE.SRGBColorSpace;
      tex.magFilter = THREE.NearestFilter;
      tex.minFilter = THREE.NearestFilter;
      tex.generateMipmaps = false;
      this.textures.set(c, tex);
    }
    return tex;
  }
  ground(id: string, variant: number, frame = 0, edges = 0): THREE.CanvasTexture {
    const key = `${this.mode}:${id}:${variant}:${frame}:${edges}`;
    let t = this.grounds.get(key);
    if (!t) {
      t = this.texture(groundTexture(id, variant, this.mode, frame, edges));
      this.grounds.set(key, t);
    }
    return t;
  }
  private material(map: THREE.Texture, vertexColors = false): THREE.MeshBasicMaterial {
    const m = new THREE.MeshBasicMaterial({
      map,
      side: THREE.DoubleSide,
      // TTYD's cutout pass: reject empty texels, write solid pixels to world depth.
      // Blended shadows alone belong in the transparent pass.
      transparent: false,
      alphaTest: 0.5,
      depthTest: true,
      depthWrite: true,
      vertexColors,
    });
    this.materials.push(m);
    this.bindLight(m);
    return m;
  }
  private bindLight(m: THREE.MeshBasicMaterial): void {
    m.onBeforeCompile = (shader) => {
      shader.uniforms.uLifeTime = this.lightTime;
      shader.uniforms.uTorchLight = this.lightStrength;
      shader.uniforms.uWind = { value: m.userData.wind ? 1 : 0 };
      shader.vertexShader =
        'uniform float uLifeTime; uniform float uWind; varying vec3 vLifeWorld;\n' +
        shader.vertexShader;
      shader.vertexShader = shader.vertexShader.replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
        transformed.x += sin(uLifeTime*1.4 + position.y*1.3 + modelMatrix[3].x)*max(position.y,0.0)*.009*uWind;
        vec4 lifePosition=vec4(transformed,1.0);
        #ifdef USE_INSTANCING
        lifePosition=instanceMatrix*lifePosition;
        #endif
        vLifeWorld=(modelMatrix*lifePosition).xyz;`,
      );
      shader.fragmentShader =
        'uniform float uTorchLight; varying vec3 vLifeWorld;\n' + shader.fragmentShader;
      shader.fragmentShader = shader.fragmentShader.replace(
        '#include <opaque_fragment>',
        `
        float lightA=pow(max(0.0,1.0-distance(vLifeWorld,vec3(5.5,.9,5.6))/2.25),2.0);
        float lightB=pow(max(0.0,1.0-distance(vLifeWorld,vec3(7.5,.9,8.6))/2.25),2.0);
        outgoingLight+=vec3(.7,.24,.035)*(lightA+lightB)*uTorchLight;
        #include <opaque_fragment>`,
      );
    };
  }
  private mask(source: HTMLCanvasElement, contact = false): THREE.CanvasTexture {
    const cache = contact ? this.contactMasks : this.masks;
    let mask = cache.get(source);
    if (!mask) {
      mask = this.texture(silhouetteMask(source, contact));
      cache.set(source, mask);
    }
    return mask;
  }
  private shadowMaterial(contact: boolean, source?: HTMLCanvasElement): THREE.MeshBasicMaterial {
    const m = new THREE.MeshBasicMaterial({
      map: source ? this.mask(source, contact) : null,
      color: '#24362b',
      vertexColors: true,
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
      opacity: contact ? 0.48 : 0.3,
    });
    m.userData.contact = contact;
    return m;
  }
  private groundedObject(
    source: HTMLCanvasElement,
    w: number,
    h: number,
    footHeight: number,
    buryDepth = 0,
  ): THREE.Group {
    const body = groundedGeometry(w, h, supportOf(source, footHeight));
    if (buryDepth) body.translate(0, -buryDepth, 0);
    const mesh = new THREE.Mesh(body, this.material(this.texture(source), true));
    mesh.renderOrder = 2;
    const group = new THREE.Group();
    group.add(mesh);
    for (const contact of [false, true]) {
      const m = this.shadowMaterial(contact, source);
      this.shadowMaterials.push(m);
      const shadow = new THREE.Mesh(shadowGeometry(body, contact), m);
      shadow.renderOrder = 1;
      group.add(shadow);
    }
    return group;
  }
  private clearRoot(): void {
    this.root.traverse((o) => {
      if (o instanceof THREE.Mesh || o instanceof THREE.Points) {
        if (o instanceof THREE.InstancedMesh) o.dispose();
        o.geometry.dispose();
        const ms = Array.isArray(o.material) ? o.material : [o.material];
        ms.forEach((m) => m.dispose());
      }
    });
    this.root.clear();
    this.materials = [];
    this.shadowMaterials = [];
  }
  rebuild(): void {
    this.clearRoot();
    this.torches = [];
    this.crops = [];
    this.cropSoils = [];
    this.soilStages = [];
    this.waterSurface = undefined;
    this.addSurroundings();
    for (let z = 0; z < DEPTH; z++)
      for (let x = 0; x < WIDTH; x++) {
        const id = groundAt(x, z),
          variant = x + z * WIDTH;
        const neighbours = [
          [x, z - 1],
          [x + 1, z],
          [x, z + 1],
          [x - 1, z],
        ];
        const edges = neighbours.reduce((bits, [nx = 0, nz = 0], i) => {
          const neighbour = groundAt(nx, nz);
          return (
            bits |
            ((id === 'water' ? neighbour !== 'water' : neighbour === 'meadow_grass') ? 1 << i : 0)
          );
        }, 0);
        if (id === 'water') continue;
        const planted = id === 'tilled_soil' && this.mode === 'new';
        const stage = this.cropStage < 0 ? Math.min(4, x - 1 + (z - 7) * 3) : this.cropStage;
        let floorMap = this.ground(id, variant, 0, edges);
        if (planted) {
          const key = `planted:${variant}:${stage}`;
          let texture = this.grounds.get(key);
          if (!texture) {
            texture = this.texture(
              plantedSoilTexture(floorMap.image as HTMLCanvasElement, stage, variant),
            );
            this.grounds.set(key, texture);
          }
          floorMap = texture;
        }
        const mat = this.material(floorMap);
        const mesh = new THREE.Mesh(
          planted ? plantedSoilGeometry(stage, variant) : new THREE.PlaneGeometry(1, 1),
          mat,
        );
        if (!planted) mesh.rotation.x = -Math.PI / 2;
        mesh.position.set(x + 0.5, 0, z + 0.5);
        mesh.userData = { ground: id, variant, edges };
        this.root.add(mesh);
        if (id === 'tilled_soil') {
          const size =
            this.mode === 'new' ? REVIEW_CROPS.find((c) => c.id === this.cropSpecies)!.size : 0.7;
          const source =
            this.mode === 'new'
              ? this.art.crops.get(this.cropSpecies)![stage]!
              : cropTexture(stage);
          const crop = this.groundedObject(
            source,
            size,
            size,
            planted ? 0 : 0.025,
            planted ? plantingDepth(this.cropSpecies, stage) : 0,
          );
          crop.position.set(x + 0.5, 0, z + 0.6);
          crop.children[0]!.userData.id = this.cropSpecies;
          if (this.mode === 'new')
            this.crops.push(
              new CropMotion(crop, this.cropSpecies, x * 1.7 + z * 0.9, (cx, cz) =>
                soilHeight(cx + 0.5, cz + 0.6, stage, variant),
              ),
            );
          this.soilStages.push(stage);
          this.cropSoils.push(mat);
          this.root.add(crop);
        }
        if (z === DEPTH - 1) {
          const side = new THREE.Mesh(
            new THREE.PlaneGeometry(1, 0.12),
            this.material(this.ground('stone', variant)),
          );
          side.position.set(x + 0.5, -0.06, DEPTH);
          this.root.add(side);
        }
      }
    for (const p of PLACEMENTS) {
      const stage = p.growth ?? this.treeStage;
      const specimen = p.id === 'oak_tree' && p.x === 7 && p.z === 0;
      const id = specimen && this.mode === 'new' ? this.treeSpecies : p.id;
      const orchard = this.art.orchard.get(id);
      const growing = (this.art.growth.has(id) || !!orchard) && stage < 3;
      let source =
        growing && this.mode === 'new'
          ? (orchard ?? this.art.growth.get(id)!)[stage]!
          : this.art.props[this.mode].get(id)!;
      if (orchard) source = orchard[stage < 3 ? stage : this.treeBloom ? 3 : 4]!;
      if (p.id === 'bed' && this.mode === 'new') source = this.art.beds[this.bedAxis];
      if (p.id === 'torch' && this.mode === 'new') source = this.art.torches[0]!;
      const [w, h] = growing
        ? [
            [0.45, 0.5],
            [0.8, 1.15],
            [1.55, 2.3],
          ][stage]!
        : orchard
          ? [3.4, 3.7]
          : (PROP_SIZE[id] ?? [1, 1]);
      const object = this.groundedObject(
        source,
        w!,
        h!,
        growing ? 0.035 : (FOOT_HEIGHT[id] ?? (orchard ? 0.12 : 0.06)),
      );
      object.position.set(p.x + 0.5, 0, p.z + 0.6);
      object.children[0]!.userData.id = id;
      const body = object.children[0] as THREE.Mesh<THREE.BufferGeometry, THREE.MeshBasicMaterial>;
      body.material.userData.wind =
        !!orchard || this.art.growth.has(id) || ['flower', 'fern'].includes(id);
      if (p.id === 'torch') this.torches.push(object);
      this.root.add(object);
    }
    const drops = new THREE.BufferGeometry();
    drops.setAttribute('position', new THREE.Float32BufferAttribute(new Float32Array(54), 3));
    this.droplets = new THREE.Points(
      drops,
      new THREE.PointsMaterial({
        color: '#c2e7ea',
        size: 0.045,
        transparent: true,
        depthWrite: false,
      }),
    );
    this.droplets.frustumCulled = false;
    this.droplets.visible = false;
    this.root.add(this.droplets);
    this.addPond();
    this.addVerges();
    this.waterFrame = -1;
    this.setDusk(this.dusk);
  }
  setTreeStage(stage: number): void {
    this.treeStage = stage;
    this.rebuild();
  }
  setTreeSpecies(species: ReviewTree): void {
    if (!REVIEW_TREES.some((tree) => tree.id === species)) return;
    this.treeSpecies = species;
    this.rebuild();
  }
  setTreeBloom(on: boolean): void {
    this.treeBloom = on;
    this.rebuild();
  }
  setBedAxis(axis: BedAxis): void {
    this.bedAxis = axis;
    this.rebuild();
  }
  setCropSpecies(species: ReviewCrop): void {
    this.cropSpecies = species;
    this.rebuild();
  }
  setCropStage(stage: number): void {
    this.cropStage = Math.max(-1, Math.min(4, Math.trunc(stage)));
    this.rebuild();
  }
  waterCrops(): void {
    this.wateredAt = this.lifeTime;
  }
  private updateCrops(): void {
    const age = this.lifeTime - this.wateredAt;
    for (const crop of this.crops) crop.update(this.lifeTime, age);
    const wet = age >= 0 ? Math.max(0, 1 - age / 12) : 0;
    for (const mat of this.cropSoils) {
      mat.color.set(this.dusk ? '#acb1bf' : '#ffffff');
      mat.color.multiplyScalar(1 - wet * 0.28);
    }
    if (!this.droplets) return;
    this.droplets.visible = this.mode === 'new' && this.ambience && age >= 0 && age < 1.25;
    // Pause freezes an already visible splash as well as the plants.
    if (!this.ambience) this.droplets.visible = this.mode === 'new' && age > 0 && age < 1.25;
    if (!this.droplets.visible) return;
    const p = this.droplets.geometry.getAttribute('position');
    for (let i = 0; i < p.count; i++) {
      const plot = Math.floor(i / 3),
        phase = (age * 1.8 + (i % 3) * 0.26) % 1;
      p.setXYZ(
        i,
        1.5 + (plot % 3) + Math.sin(i * 4.7) * 0.22,
        0.06 + (1 - phase) * 0.85,
        7.55 + Math.floor(plot / 3) + Math.cos(i * 3.1) * 0.18,
      );
    }
    p.needsUpdate = true;
    this.droplets.material.opacity = Math.min(1, (1.25 - age) * 3);
  }
  seekAmbience(time: number): void {
    this.lifeTime = Math.max(0, time);
    this.ambience = false;
  }
  private addSurroundings(): void {
    // Continue the meadow into a distant treeline instead of ending at an empty studio backdrop.
    // A ring leaves the recessed pond open; no background plane under the clearing.
    for (const [w, d, x, z] of [
      [42, 14, 7, -7],
      [42, 14, 7, DEPTH + 7],
      [14, DEPTH, -7, DEPTH / 2],
      [14, DEPTH, WIDTH + 7, DEPTH / 2],
    ]) {
      const ground = new THREE.Mesh(
        new THREE.PlaneGeometry(w!, d!),
        new THREE.MeshBasicMaterial({ color: '#99ab72' }),
      );
      ground.rotation.x = -Math.PI / 2;
      ground.position.set(x!, -0.13, z!);
      this.materials.push(ground.material);
      this.root.add(ground);
    }
    for (let row = 0; row < 2; row++)
      for (let i = 0; i < 11; i++) {
        const source = this.art.props[this.mode].get(i % 3 ? 'oak_tree' : 'spruce')!;
        const mat = this.material(this.texture(source));
        mat.userData.baseTint = '#c6d3ab';
        mat.color.set(mat.userData.baseTint as string);
        mat.transparent = true;
        mat.opacity = row ? 0.3 : 0.48;
        mat.alphaTest = 0.08;
        mat.depthWrite = false;
        const tree = new THREE.Mesh(
          new THREE.PlaneGeometry(2.8 + (i % 3) * 0.3, 2.8 + (i % 2) * 0.4),
          mat,
        );
        tree.position.set(-6 + i * 2.5 + row, 1.25, -1.8 - row * 2.4);
        this.root.add(tree);
      }
  }
  private addPond(): void {
    const water = (x: number, z: number) => groundAt(Math.floor(x), Math.floor(z)) === 'water';
    const shores: [number, number, number, number][] = [];
    for (let z = 0; z < DEPTH; z++)
      for (let x = 0; x < WIDTH; x++) {
        if (!water(x, z)) continue;
        if (!water(x, z - 1)) shores.push([x, z, x + 1, z]);
        if (!water(x + 1, z)) shores.push([x + 1, z, x + 1, z + 1]);
        if (!water(x, z + 1)) shores.push([x, z + 1, x + 1, z + 1]);
        if (!water(x - 1, z)) shores.push([x, z, x, z + 1]);
      }
    const depthAt = (x: number, z: number) => {
      let d = 10;
      for (const [ax, az, bx, bz] of shores) {
        const t = Math.max(0, Math.min(1, (x - ax) * (bx - ax) + (z - az) * (bz - az)));
        d = Math.min(d, Math.hypot(x - ax - (bx - ax) * t, z - az - (bz - az) * t));
      }
      return Math.min(1, d / 1.1);
    };
    for (let z = 0; z < DEPTH; z++)
      for (let x = 0; x < WIDTH; x++) {
        if (!water(x, z)) continue;
        const geo = new THREE.PlaneGeometry(1, 1, 12, 12);
        geo.rotateX(-Math.PI / 2);
        geo.translate(x + 0.5, 0, z + 0.5);
        const pos = geo.getAttribute('position'),
          colours: number[] = [];
        for (let i = 0; i < pos.count; i++) {
          const wx = pos.getX(i),
            wz = pos.getZ(i),
            depth = depthAt(wx, wz);
          pos.setY(i, -0.17 - depth * 0.42);
          const c = new THREE.Color('#91ad8a').lerp(new THREE.Color('#285867'), depth);
          c.multiplyScalar(0.96 + Math.sin(wx * 21 + wz * 18) * 0.04);
          colours.push(c.r, c.g, c.b);
        }
        geo.setAttribute('color', new THREE.Float32BufferAttribute(colours, 3));
        const mat = new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.DoubleSide });
        this.materials.push(mat);
        this.root.add(new THREE.Mesh(geo, mat));
        if (!this.waterMaps.length)
          this.waterMaps = [0, 1, 2, 3, 4, 5, 6, 7].map((f) =>
            this.texture(waterSurfaceTexture(f)),
          );
        const surfaceMat = new THREE.MeshBasicMaterial({
          map: this.waterMaps[0],
          transparent: true,
          depthWrite: false,
          opacity: 0.75,
          side: THREE.DoubleSide,
        });
        const surface = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), surfaceMat);
        surface.rotation.x = -Math.PI / 2;
        surface.position.set(x + 0.5, -0.085, z + 0.5);
        surface.userData.waterSurface = true;
        this.root.add(surface);
        this.waterSurface = surface;
        // Stones remain visibly below the water plane, tinted by the water column.
        for (let i = 0; i < 3; i++) {
          const rx = x + 0.18 + ((x * 17 + z * 11 + i * 19) % 61) / 100,
            rz = z + 0.12 + ((x * 13 + z * 7 + i * 23) % 71) / 100;
          const d = depthAt(rx, rz);
          if (d > 0.65) continue;
          const stone = new THREE.Mesh(
            new THREE.IcosahedronGeometry(0.055 + i * 0.012, 0),
            new THREE.MeshBasicMaterial({ color: i % 2 ? '#688e83' : '#89a391' }),
          );
          stone.scale.set(1.6, 0.5, 1);
          stone.position.set(rx, -0.15 - d * 0.42, rz);
          this.root.add(stone);
        }
      }
    for (const [ax, az, bx, bz] of shores) {
      const geo = new THREE.PlaneGeometry(1, 0.18);
      const mat = new THREE.MeshBasicMaterial({ color: '#748368', side: THREE.DoubleSide });
      this.materials.push(mat);
      const bank = new THREE.Mesh(geo, mat);
      bank.rotation.y = ax === bx ? Math.PI / 2 : 0;
      bank.position.set((ax + bx) / 2, -0.09, (az + bz) / 2);
      this.root.add(bank);
      // Uneven wet shelves soften the grid silhouette while staying inside water cells.
      const mx = (ax + bx) / 2,
        mz = (az + bz) / 2;
      const nx = ax === bx ? (water(mx + 0.01, mz) ? 1 : -1) : 0;
      const nz = az === bz ? (water(mx, mz + 0.01) ? 1 : -1) : 0;
      const positions: number[] = [],
        colors: number[] = [],
        indices: number[] = [];
      for (let i = 0; i <= 12; i++) {
        const t = i / 12,
          x = ax + (bx - ax) * t,
          z = az + (bz - az) * t;
        const width = 0.08 + 0.035 * (1 + Math.sin(x * 33 + z * 29));
        positions.push(x, 0.002, z, x + nx * width, -0.105, z + nz * width);
        for (const color of ['#a6ad83', '#759b87']) {
          const c = new THREE.Color(color);
          colors.push(c.r, c.g, c.b);
        }
        if (i < 12) {
          const v = i * 2;
          indices.push(v, v + 1, v + 2, v + 1, v + 3, v + 2);
        }
      }
      const shelf = new THREE.BufferGeometry();
      shelf.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
      shelf.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
      shelf.setIndex(indices);
      const shelfMat = new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.DoubleSide });
      this.materials.push(shelfMat);
      this.root.add(new THREE.Mesh(shelf, shelfMat));
    }
  }
  private addVerges(): void {
    const grass = this.vergeArt[0]!,
      reeds = this.vergeArt[1]!;
    const patches: [number, number][][] = [[], []];
    for (let z = 0; z < DEPTH; z++)
      for (let x = 0; x < WIDTH; x++) {
        const id = groundAt(x, z);
        const nearWater = [
          [1, 0],
          [-1, 0],
          [0, 1],
          [0, -1],
        ].some(([dx, dz]) => groundAt(x + dx!, z + dz!) === 'water');
        const nearProp = PLACEMENTS.some((p) => Math.hypot(p.x - x, p.z - z) < 1.4);
        if (id !== 'meadow_grass' && !(id === 'sand' && nearWater)) continue;
        if (!nearWater && !nearProp && x > 0 && z < 10) continue;
        for (let i = 0; i < (nearWater ? 2 : 3); i++) {
          const dx = ((x * 13 + z * 7 + i * 23) % 83) / 100,
            dz = ((x * 7 + z * 17 + i * 31) % 79) / 100;
          patches[nearWater ? 1 : 0]!.push([x + 0.1 + dx, z + 0.1 + dz]);
        }
      }
    // Hundreds of small blades share two draws instead of one object/shadow draw per tuft.
    for (let i = 0; i < 2; i++) {
      const source = i ? reeds : grass;
      const geo = groundedGeometry(i ? 0.36 : 0.3, i ? 0.48 : 0.2, supportOf(source, 0.015), 8);
      const mesh = new THREE.InstancedMesh(
        geo,
        this.material(this.texture(source), true),
        patches[i]!.length,
      );
      mesh.material.userData.wind = true;
      patches[i]!.forEach(([x, z], index) =>
        mesh.setMatrixAt(index, new THREE.Matrix4().makeTranslation(x, 0, z)),
      );
      mesh.instanceMatrix.needsUpdate = true;
      this.root.add(mesh);
    }
  }
  setMode(mode: ArtMode): void {
    this.mode = mode;
    this.rebuild();
  }
  setDusk(on: boolean): void {
    this.dusk = on;
    // One consistent tint for both art modes; the comparison does not hide the old art in darkness.
    for (const mat of this.materials) {
      mat.userData.baseTint ??= mat.color.getHex();
      mat.color.set(mat.userData.baseTint as THREE.ColorRepresentation);
      if (on) mat.color.multiply(new THREE.Color('#acb1bf'));
    }
    this.person.material.color.set(on ? '#c4bbba' : '#ffffff');
    for (const mat of [
      ...this.shadowMaterials,
      this.shadow.material,
      this.contactShadow.material,
    ]) {
      mat.opacity = mat.userData.contact ? 0.48 : on ? 0.2 : 0.3;
    }
    this.host.classList.toggle('dusk', on);
  }
  setGrid(on: boolean): void {
    this.grid = on;
    this.gridHelper.visible = on;
  }
  resize(): void {
    const w = this.host.clientWidth,
      h = this.host.clientHeight;
    this.renderer.setSize(w, h);
    this.camera.aspect = w / Math.max(1, h);
    // Same fixed perspective and tilt as the game. Fit the specimen scene, then apply review zoom.
    const scale = (Math.min(w / 19, h / 13) / 32) * this.zoom;
    const c = { tx: 7, tz: 5, tilt: TILT, dist: distForZoom(scale, h), fov: FOV, w, h };
    this.camera.position.set(...camPos(c));
    // Frame the taller canopy while keeping the same perspective and 35-degree tilt.
    this.camera.position.y += 0.55;
    this.camera.lookAt(c.tx, 0.55, c.tz);
    this.camera.updateProjectionMatrix();
  }
  private keyDown = (e: KeyboardEvent): void => {
    if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'w', 'a', 's', 'd'].includes(e.key)) {
      e.preventDefault();
      this.keys.add(e.key);
    }
  };
  private keyUp = (e: KeyboardEvent): void => {
    this.keys.delete(e.key);
  };
  private blur = (): void => {
    this.keys.clear();
  };
  private pick = (e: PointerEvent): void => {
    this.renderer.domElement.focus();
    const r = this.renderer.domElement.getBoundingClientRect();
    this.pointer.set(
      ((e.clientX - r.left) / r.width) * 2 - 1,
      (-(e.clientY - r.top) / r.height) * 2 + 1,
    );
    this.ray.setFromCamera(this.pointer, this.camera);
    const hit = this.ray.intersectObjects(this.root.children, true).find((h) => {
      if (typeof h.object.userData.id !== 'string' || !h.uv) return false;
      const source = (h.object as THREE.Mesh<THREE.BufferGeometry, THREE.MeshBasicMaterial>)
        .material.map?.image as HTMLCanvasElement | undefined;
      if (!source) return false;
      const x = Math.min(source.width - 1, Math.max(0, Math.floor(h.uv.x * source.width)));
      const y = Math.min(source.height - 1, Math.max(0, Math.floor((1 - h.uv.y) * source.height)));
      return source.getContext('2d')!.getImageData(x, y, 1, 1).data[3]! > 128;
    });
    if (hit) this.onSelect(hit.object.userData.id as string);
  };
  private canWalk(x: number, z: number): boolean {
    if (
      x < 0.3 ||
      z < 0.3 ||
      x >= WIDTH - 0.3 ||
      z >= DEPTH - 0.3 ||
      groundAt(Math.floor(x), Math.floor(z)) === 'water'
    )
      return false;
    return !PLACEMENTS.some((p) => {
      const solid = BLOCKS.list.find((b) => b.id === p.id)?.solid ?? p.id === 'hub.deskMonitor';
      return solid && Math.abs(x - (p.x + 0.5)) < 0.55 && Math.abs(z - (p.z + 0.5)) < 0.55;
    });
  }
  private tick = (now: number): void => {
    const dt = this.last ? Math.min((now - this.last) / 1000, 0.05) : 0;
    this.last = now;
    if (this.active && !document.hidden) {
      if (this.ambience) this.lifeTime += dt;
      this.lightTime.value = this.lifeTime;
      this.lightStrength.value =
        (this.dusk ? 0.85 : 0.17) *
        (1 + Math.sin(this.lifeTime * 8) * 0.08 + Math.sin(this.lifeTime * 13.7) * 0.04);
      const perches: Place[] =
        this.treeStage === 3
          ? [
              [1.6, 2.15, 1.62],
              [7.25, this.treeSpecies.startsWith('orchard_') ? 1.85 : 2.2, 0.62],
              [11.5, 2.5, 1.62],
            ]
          : [
              [1.5, 0.58, 9.62],
              [2.5, 0.58, 9.62],
              [3.5, 0.58, 9.62],
            ];
      this.life.update(this.lifeTime, this.dusk, perches);
      this.updateCrops();
      if (this.mode === 'new')
        this.torches.forEach((torch, i) => {
          const frame = Math.floor(this.lifeTime * 9 + i) % 4,
            source = this.art.torches[frame]!;
          (
            torch.children[0] as THREE.Mesh<THREE.BufferGeometry, THREE.MeshBasicMaterial>
          ).material.map = this.texture(source);
          (
            torch.children[1] as THREE.Mesh<THREE.BufferGeometry, THREE.MeshBasicMaterial>
          ).material.map = this.mask(source);
          (
            torch.children[2] as THREE.Mesh<THREE.BufferGeometry, THREE.MeshBasicMaterial>
          ).material.map = this.mask(source, true);
        });
      const dx =
        Number(this.keys.has('d') || this.keys.has('ArrowRight')) -
        Number(this.keys.has('a') || this.keys.has('ArrowLeft'));
      const dz =
        Number(this.keys.has('s') || this.keys.has('ArrowDown')) -
        Number(this.keys.has('w') || this.keys.has('ArrowUp'));
      const moving = !!(dx || dz);
      if (moving) {
        this.direction = dx < 0 ? 1 : dx > 0 ? 2 : dz < 0 ? 3 : 0;
        const norm = Math.hypot(dx, dz),
          step = (dt * 2.2) / norm;
        if (this.canWalk(this.px + dx * step, this.pz)) this.px += dx * step;
        if (this.canWalk(this.px, this.pz + dz * step)) this.pz += dz * step;
      }
      const animate = this.walking || (moving && !this.reduced.matches);
      if (animate) this.time += dt;
      this.frame = animate ? Math.floor(this.time * 7) % 4 : 0;
      const av = this.art.avatars[this.mode][this.direction]![this.frame]!;
      if (av !== this.lastAvatar) {
        let geometry = this.avatarGeometry.get(av);
        if (!geometry) {
          const body = groundedGeometry(0.85, 1.4, supportOf(av, 0.035));
          geometry = {
            body,
            cast: shadowGeometry(body, false),
            contact: shadowGeometry(body, true),
          };
          this.avatarGeometry.set(av, geometry);
        }
        if (!this.lastAvatar) {
          this.person.geometry.dispose();
          this.shadow.geometry.dispose();
          this.contactShadow.geometry.dispose();
        }
        this.person.geometry = geometry.body;
        this.shadow.geometry = geometry.cast;
        this.contactShadow.geometry = geometry.contact;
        this.person.material.map = this.texture(av);
        if (!this.lastAvatar)
          this.shadow.material.needsUpdate = this.contactShadow.material.needsUpdate = true;
        this.shadow.material.map = this.mask(av);
        this.contactShadow.material.map = this.mask(av, true);
        this.lastAvatar = av;
      }
      this.person.position.set(this.px, 0, this.pz);
      this.shadow.position.set(this.px, 0, this.pz);
      this.contactShadow.position.set(this.px, 0, this.pz);
      const wf = Math.floor(this.lifeTime * 3) % 8;
      if (wf !== this.waterFrame) {
        this.waterFrame = wf;
        for (const o of this.root.children)
          if (o instanceof THREE.Mesh && o.userData.waterSurface)
            (o.material as THREE.MeshBasicMaterial).map = this.waterMaps[wf]!;
      }
      this.renderer.render(this.scene, this.camera);
    }
    this.raf = requestAnimationFrame(this.tick);
  };
  snapshot(): object {
    return {
      mode: this.mode,
      position: [this.px, this.pz],
      frame: this.frame,
      direction: DIRECTIONS[this.direction],
      props: PLACEMENTS.length,
      tilt: TILT,
      grounding: 'alpha-silhouette-and-contact',
      shadowFrames: this.avatarGeometry.size,
      solidDepth: !this.person.material.transparent && this.person.material.depthWrite,
      treeStage: this.treeStage,
      treeSpecies: this.treeSpecies,
      treeBloom: this.treeBloom,
      cropCount: this.art.crops.size,
      orchardCount: this.art.orchard.size,
      seedCount: this.art.seeds.size,
      harvestCount: this.art.harvest.size,
      growthSpecies: this.art.growth.size,
      pondSurface: this.waterSurface?.position.y,
      bedAxis: this.bedAxis,
      ambience: this.ambience,
      lifeTime: this.lifeTime,
      birdStates: this.life.states,
      torchFrame: Math.floor(this.lifeTime * 9) % 4,
      cropSpecies: this.cropSpecies,
      cropStage: this.cropStage,
      soilStages: this.soilStages,
      plantingDepths: this.soilStages.map((stage) => plantingDepth(this.cropSpecies, stage)),
      cropStages: this.art.crops.get(this.cropSpecies)!.length,
      cropOffsets: this.crops.map((c) => c.tipOffset),
      cropWateredAgo: Number.isFinite(this.wateredAt) ? this.lifeTime - this.wateredAt : null,
      cropSplash: this.droplets?.visible,
    };
  }
  setActive(active: boolean): void {
    this.active = active;
    this.keys.clear();
    if (active) this.resize();
  }
  /** GPU check using the actual sprite geometry, alpha maps and depth settings. */
  depthProbe(id: string): { coveredPixels: number; behind: number; front: number } {
    let prop: THREE.Mesh<THREE.BufferGeometry, THREE.MeshBasicMaterial> | undefined;
    this.root.traverse((o) => {
      if (o instanceof THREE.Mesh && o.userData.id === id && !prop) prop = o;
    });
    if (!prop) throw new Error(`Missing review prop: ${id}`);
    this.scene.updateMatrixWorld(true);
    const probe = new THREE.Scene();
    const white = prop.material.clone();
    white.color.set('#ffffff');
    white.vertexColors = false;
    // Keep the real alpha silhouette but use diagnostic colours to count occlusion.
    white.map = this.mask(prop.material.map!.image as HTMLCanvasElement);
    const object = new THREE.Mesh(prop.geometry, white);
    object.position.copy(prop.getWorldPosition(new THREE.Vector3()));
    probe.add(object);
    const pink = this.person.material.clone();
    pink.color.set('#ff00ff');
    pink.vertexColors = false;
    pink.map = this.mask(this.lastAvatar!);
    const actor = new THREE.Mesh(this.person.geometry, pink);
    actor.renderOrder = 2; // Deliberately drawn last: depth must still hide the rear actor.
    const width = 768,
      height = Math.round(width / this.camera.aspect);
    const target = new THREE.WebGLRenderTarget(width, height);
    const previous = this.renderer.getRenderTarget();
    const read = () => {
      this.renderer.setRenderTarget(target);
      this.renderer.render(probe, this.camera);
      const pixels = new Uint8Array(width * height * 4);
      this.renderer.readRenderTargetPixels(target, 0, 0, width, height, pixels);
      return pixels;
    };
    try {
      const baseline = read();
      const covered: number[] = [];
      for (let i = 0; i < baseline.length; i += 4) if (baseline[i + 3]! > 128) covered.push(i);
      probe.add(actor);
      const count = (z: number) => {
        actor.position.set(object.position.x, 0, z);
        const pixels = read();
        return covered.filter((i) => pixels[i + 1]! < 100 && pixels[i]! > 150).length;
      };
      return {
        coveredPixels: covered.length,
        behind: count(object.position.z - 0.9),
        front: count(object.position.z + 0.6),
      };
    } finally {
      this.renderer.setRenderTarget(previous);
      target.dispose();
      white.dispose();
      pink.dispose();
    }
  }
  dispose(): void {
    cancelAnimationFrame(this.raf);
    this.ro.disconnect();
    this.clearRoot();
    this.life.dispose();
    this.textures.forEach((t) => t.dispose());
    for (const frame of this.avatarGeometry.values()) {
      frame.body.dispose();
      frame.cast.dispose();
      frame.contact.dispose();
    }
    this.person.material.dispose();
    (this.shadow.material as THREE.Material).dispose();
    this.contactShadow.material.dispose();
    this.gridHelper.geometry.dispose();
    (this.gridHelper.material as THREE.Material).dispose();
    this.host.removeEventListener('pointerdown', this.pick);
    this.renderer.domElement.removeEventListener('keydown', this.keyDown);
    window.removeEventListener('keyup', this.keyUp);
    window.removeEventListener('blur', this.blur);
    this.renderer.dispose();
    this.renderer.domElement.remove();
  }
}
