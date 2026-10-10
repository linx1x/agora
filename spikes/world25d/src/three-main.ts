/**
 * P16.1 variant (a): the Jungle in Three.js, in its own canvas. One merged mesh for every static
 * face (one draw call), avatars as upright cut-out cards, real-time lights, optional sun shadows.
 */
import './glcount';
import * as THREE from 'three';
import { drawCalls, lastDrawCalls } from './glcount';
import { TILE } from '@agora/shared';
import { AV_FRAMES, AV_H, AV_W, DIR_ROW, makeAvatarCanvas } from '@web/game/avatars';
import { loadTileset } from './assets';
import { makeAtlas } from './atlas';
import { camPos, flipScale, project, unprojectFloor, type Cam } from './camera';
import { Hud, bindKeys, readOpts } from './hud';
import { buildScene, scanExtents } from './scene';
import { REGION, Sim, map, type Mob } from './sim';
import { TILESET_COLUMNS } from '@agora/shared';

const opts = readOpts();
const sim = new Sim(opts.bots);
const hud = new Hud('three', opts, sim);
bindKeys(sim);

const tileset = await loadTileset();
const atlas = makeAtlas(tileset);
const desc = buildScene(map, REGION, scanExtents(tileset, TILESET_COLUMNS), { wallH: opts.wallH });

const host = document.getElementById('world')!;
const renderer = new THREE.WebGLRenderer({ antialias: false, powerPreference: 'high-performance' });
renderer.setPixelRatio(devicePixelRatio * opts.scale);
renderer.setSize(innerWidth, innerHeight);
renderer.setClearColor(0x10140f);
renderer.shadowMap.enabled = opts.shadows;
renderer.shadowMap.type = THREE.PCFShadowMap;
host.append(renderer.domElement);

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(opts.fov, innerWidth / innerHeight, 0.5, 200);

function tex(c: HTMLCanvasElement): THREE.Texture {
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  if (opts.filter === 'nearest') {
    t.magFilter = THREE.NearestFilter;
    t.minFilter = THREE.NearestFilter;
    t.generateMipmaps = false;
  } else {
    t.magFilter = THREE.LinearFilter;
    t.minFilter = THREE.LinearMipmapLinearFilter;
    t.anisotropy = renderer.capabilities.getMaxAnisotropy();
  }
  return t;
}

// ── static faces → one geometry
const pos: number[] = [];
const uvs: number[] = [];
const nrm: number[] = [];
const idx: number[] = [];
for (const f of desc.faces) {
  const [u0, v0, u1, v1] = atlas.uv(f);
  const b = pos.length / 3;
  const [a, bb, c, d] = f.p;
  for (const p of [a, bb, c, d]) pos.push(p[0], p[1], p[2]);
  // three's uv v is bottom-up
  uvs.push(u0, 1 - v0, u1, 1 - v0, u1, 1 - v1, u0, 1 - v1);
  const n = new THREE.Vector3()
    .subVectors(new THREE.Vector3(...bb), new THREE.Vector3(...a))
    .cross(new THREE.Vector3().subVectors(new THREE.Vector3(...d), new THREE.Vector3(...a)))
    .normalize()
    .negate();
  for (let k = 0; k < 4; k++) nrm.push(n.x, n.y, n.z);
  idx.push(b, b + 3, b + 2, b, b + 2, b + 1);
}
const geo = new THREE.BufferGeometry();
geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
geo.setAttribute('normal', new THREE.Float32BufferAttribute(nrm, 3));
geo.setIndex(idx);
const atlasTex = tex(atlas.canvas);
const mat = opts.lights
  ? new THREE.MeshLambertMaterial({ map: atlasTex, alphaTest: 0.5, side: THREE.DoubleSide })
  : new THREE.MeshBasicMaterial({ map: atlasTex, alphaTest: 0.5, side: THREE.DoubleSide });
const world = new THREE.Mesh(geo, mat);
world.castShadow = opts.shadows;
world.receiveShadow = opts.shadows;
world.customDepthMaterial = new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking, map: atlasTex, alphaTest: 0.5 });
scene.add(world);

// ── lights: sky + sun (from the south-east, so fronts facing the camera are lit) + lamps
let sun: THREE.DirectionalLight | null = null;
if (opts.lights) {
  scene.add(new THREE.HemisphereLight(0xfff4e0, 0x50604a, 1.6));
  sun = new THREE.DirectionalLight(0xffe7c2, 1.6);
  sun.position.set(REGION.x + REGION.w / 2 + 12, 22, REGION.y + REGION.h + 14);
  sun.target.position.set(REGION.x + REGION.w / 2, 0, REGION.y + REGION.h / 2);
  scene.add(sun, sun.target);
  if (opts.shadows) {
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    const s = sun.shadow.camera;
    s.left = -26;
    s.right = 26;
    s.top = 26;
    s.bottom = -26;
    s.far = 80;
    sun.shadow.bias = -0.0015;
  }
  for (const l of desc.lights.slice(0, 8)) {
    const p = new THREE.PointLight(0xffc06a, 2.2, 4.5, 1.6);
    p.position.set(l.x, l.y, l.z);
    scene.add(p);
  }
}

// ── avatars: upright cards, bottom-centre anchored, plus a blob shadow
interface AvView {
  mesh: THREE.Mesh;
  tex: THREE.Texture;
  blob: THREE.Mesh;
}
const AVW = 1;
const AVH = AV_H / AV_W;
const cardGeo = new THREE.PlaneGeometry(AVW, AVH).translate(0, AVH / 2, 0);
const blobTex = (() => {
  const c = document.createElement('canvas');
  c.width = c.height = 32;
  const g = c.getContext('2d')!;
  const r = g.createRadialGradient(16, 16, 2, 16, 16, 16);
  r.addColorStop(0, 'rgba(0,0,0,.45)');
  r.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = r;
  g.fillRect(0, 0, 32, 32);
  return new THREE.CanvasTexture(c);
})();
const blobGeo = new THREE.PlaneGeometry(0.8, 0.4).rotateX(-Math.PI / 2);
const blobMat = new THREE.MeshBasicMaterial({ map: blobTex, transparent: true, depthWrite: false });
const avs = new Map<string, AvView>();
for (const m of sim.all()) {
  const t = tex(makeAvatarCanvas(m.avatar));
  t.repeat.set(1 / AV_FRAMES, 1 / 6);
  const mt = opts.lights
    ? new THREE.MeshLambertMaterial({ map: t, alphaTest: 0.5, side: THREE.DoubleSide })
    : new THREE.MeshBasicMaterial({ map: t, alphaTest: 0.5, side: THREE.DoubleSide });
  const mesh = new THREE.Mesh(cardGeo, mt);
  mesh.castShadow = opts.shadows;
  mesh.customDepthMaterial = new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking, map: t, alphaTest: 0.5 });
  const blob = new THREE.Mesh(blobGeo, blobMat);
  scene.add(mesh, blob);
  avs.set(m.id, { mesh, tex: t, blob });
}

const FLIP_MS = matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : 140;
function placeAvatar(m: Mob, now: number) {
  const v = avs.get(m.id)!;
  const x = m.x / TILE;
  const z = m.y / TILE;
  v.mesh.position.set(x, 0, z);
  v.blob.position.set(x, 0.01, z);
  const frame = m.moving ? Math.floor(now / 125) % AV_FRAMES : 0;
  v.tex.offset.set(frame / AV_FRAMES, 1 - (DIR_ROW[m.dir] + 1) / 6);
  // card flip: squash through zero width when turning left ↔ right
  const k = FLIP_MS ? Math.min(1, (now - m.flipAt) / FLIP_MS) : 1;
  v.mesh.scale.x = flipScale(k);
}

// ── camera follow
const cam: Cam = { tx: sim.me.x / TILE, tz: sim.me.y / TILE, tilt: opts.tilt, dist: opts.dist, fov: opts.fov, w: innerWidth, h: innerHeight };
function placeCamera() {
  const [x, y, z] = camPos(cam);
  camera.position.set(x, y, z);
  camera.lookAt(cam.tx, 0, cam.tz);
}

addEventListener('resize', () => {
  cam.w = innerWidth;
  cam.h = innerHeight;
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
});
renderer.domElement.addEventListener('pointerup', (e) => {
  const p = unprojectFloor(cam, e.clientX, e.clientY);
  if (p) sim.goTo(p.x * TILE, p.z * TILE);
});
addEventListener('wheel', (e) => {
  cam.dist = Math.min(40, Math.max(6, cam.dist * (e.deltaY > 0 ? 1.1 : 0.9)));
});

hud.calls = lastDrawCalls;
hud.extra = () => ({
  triangles: renderer.info.render.triangles,
  faces: desc.faces.length,
  textures: renderer.info.memory.textures,
});

let last = performance.now();
renderer.setAnimationLoop((now: number) => {
  const t0 = performance.now();
  const dt = Math.min(0.1, (now - last) / 1000);
  last = now;
  sim.step(dt, now);
  const k = 1 - Math.pow(1 - 0.18, dt * 60);
  cam.tx += (sim.me.x / TILE - cam.tx) * k;
  cam.tz += (sim.me.y / TILE - cam.tz) * k;
  placeCamera();
  for (const m of sim.all()) placeAvatar(m, now);
  renderer.render(scene, camera);
  drawCalls();
  hud.plates_(sim.all(), (m) => project(cam, [m.x / TILE, AVH + 0.15, m.y / TILE]));
  hud.frame(now, performance.now() - t0);
});
(window as unknown as Record<string, unknown>).__spike = { sim, cam, desc, renderer };
