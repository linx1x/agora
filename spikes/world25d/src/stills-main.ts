/**
 * P16.2 stills: the same Jungle corner (waterfall, pond, a pod on each side) in three styles, by
 * day and in the evening, with the new paper avatars. Results land in `window.__shots` as PNG data
 * URLs; `node stills.mjs` saves them to stills/.
 */
import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { TILESET_COLUMNS, randomAvatar, type Avatar } from '@agora/shared';
import { loadTileset } from './assets';
import { makeAtlas, type Atlas } from './atlas';
import { camPos } from './camera';
import { paperFrame, paperSheet, type PaperDir, type PaperLook } from './paper-avatar';
import { buildScene, scanExtents, type SceneDesc } from './scene';
import { REGION, map, rng } from './sim';
import { lowPoly, storybookTileset, tileColors } from './styles';

type Style = 'diorama' | 'storybook' | 'lowpoly';
type Light = 'day' | 'evening';

const W = 1600;
const H = 1000;
const shots: Record<string, string> = {};
(window as unknown as { __shots: typeof shots }).__shots = shots;

const tileset = await loadTileset();
const ext = scanExtents(tileset, TILESET_COLUMNS);
const WALL_H = 1.5;
const desc = buildScene(map, REGION, ext, { wallH: WALL_H });
const dioramaAtlas = makeAtlas(tileset);
const storyAtlas = makeAtlas(storybookTileset(tileset), 128);
const colors = tileColors(tileset);

const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
renderer.setPixelRatio(1);
renderer.setSize(W, H);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
document.body.append(renderer.domElement);

function tex(c: HTMLCanvasElement, smooth: boolean): THREE.Texture {
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  if (smooth) {
    // no mipmaps: lower levels would bleed neighbouring atlas cells into each other
    t.generateMipmaps = false;
    t.minFilter = THREE.LinearFilter;
    t.magFilter = THREE.LinearFilter;
    t.anisotropy = renderer.capabilities.getMaxAnisotropy();
  } else {
    t.minFilter = t.magFilter = THREE.NearestFilter;
    t.generateMipmaps = false;
  }
  return t;
}

function facesMesh(d: SceneDesc, atlas: Atlas, smooth: boolean): THREE.Mesh {
  const pos: number[] = [], uvs: number[] = [], nrm: number[] = [], idx: number[] = [];
  for (const f of d.faces) {
    const [u0, v0, u1, v1] = atlas.uv(f);
    const b = pos.length / 3;
    for (const p of f.p) pos.push(...p);
    uvs.push(u0, 1 - v0, u1, 1 - v0, u1, 1 - v1, u0, 1 - v1);
    const [a, bb, , dd] = f.p.map((p) => new THREE.Vector3(...p));
    const n = new THREE.Vector3().subVectors(bb!, a!).cross(new THREE.Vector3().subVectors(dd!, a!)).normalize().negate();
    for (let k = 0; k < 4; k++) nrm.push(n.x, n.y, n.z);
    idx.push(b, b + 3, b + 2, b, b + 2, b + 1);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geo.setAttribute('normal', new THREE.Float32BufferAttribute(nrm, 3));
  geo.setIndex(idx);
  const t = tex(atlas.canvas, smooth);
  const m = new THREE.Mesh(geo, new THREE.MeshLambertMaterial({ map: t, alphaTest: 0.5, side: THREE.DoubleSide }));
  m.customDepthMaterial = new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking, map: t, alphaTest: 0.5 });
  m.castShadow = m.receiveShadow = true;
  return m;
}

// ── people in the shot
const r = rng(11);
const people: { a: Avatar; x: number; z: number; dir: PaperDir; flip?: number }[] = [
  { a: randomAvatar(r), x: 19.4, z: 9.7, dir: 'down' },
  { a: randomAvatar(r), x: 15.9, z: 10.4, dir: 'right' },
  { a: randomAvatar(r), x: 22.6, z: 9.9, dir: 'left', flip: 0.45 },
  { a: randomAvatar(r), x: 24.3, z: 12.6, dir: 'up' },
];
people[0]!.a.accessory = 1;
people[1]!.a.hair = 1;
people[2]!.a.accessory = 3;

function avatarCards(look: PaperLook, w: number, h: number, heightTiles: number): THREE.Group {
  const g = new THREE.Group();
  const blob = (() => {
    const c = document.createElement('canvas');
    c.width = c.height = 64;
    const x = c.getContext('2d')!;
    const gr = x.createRadialGradient(32, 32, 2, 32, 32, 32);
    gr.addColorStop(0, 'rgba(0,0,0,.4)');
    gr.addColorStop(1, 'rgba(0,0,0,0)');
    x.fillStyle = gr;
    x.fillRect(0, 0, 64, 64);
    return new THREE.CanvasTexture(c);
  })();
  for (const p of people) {
    const fr = paperFrame(p.a, p.dir, w, h, look);
    const t = tex(fr, look === 'smooth');
    // smooth frames are drawn at 4×; the figure is h·k px tall inside a padded canvas
    const k = look === 'smooth' ? 4 : 1;
    const hh = heightTiles * (fr.height / (h * k));
    const ww = hh * (fr.width / fr.height);
    const pad = (fr.height - h * k) / 2;
    const geo = new THREE.PlaneGeometry(ww, hh).translate(0, hh / 2 - (heightTiles * pad) / (h * k) + 0.02, 0);
    const m = new THREE.Mesh(geo, new THREE.MeshLambertMaterial({ map: t, alphaTest: 0.5, side: THREE.DoubleSide }));
    m.customDepthMaterial = new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking, map: t, alphaTest: 0.5 });
    m.castShadow = true;
    m.position.set(p.x, 0, p.z);
    if (p.flip !== undefined) m.scale.x = Math.max(0.05, Math.abs(Math.cos(Math.PI * p.flip)));
    const b = new THREE.Mesh(new THREE.PlaneGeometry(0.9, 0.45).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ map: blob, transparent: true, depthWrite: false }));
    b.position.set(p.x, 0.02, p.z);
    g.add(m, b);
  }
  return g;
}

function lights(scene: THREE.Scene, light: Light, lamps: SceneDesc['lights'], style: Style) {
  const day = light === 'day';
  scene.add(new THREE.HemisphereLight(day ? 0xeaf4ff : 0x8090c8, day ? 0x6f7d4c : 0x3a3020, day ? 1.5 : 1.05));
  const sun = new THREE.DirectionalLight(day ? 0xfff1d8 : 0xff9a5c, day ? 2.0 : 1.7);
  const cx = REGION.x + REGION.w / 2, cz = REGION.y + REGION.h / 2;
  if (day) sun.position.set(cx + 10, 26, cz + 16);
  else sun.position.set(cx - 26, 9, cz + 8);
  sun.target.position.set(cx, 0, cz);
  sun.castShadow = true;
  sun.shadow.mapSize.set(4096, 4096);
  Object.assign(sun.shadow.camera, { left: -24, right: 24, top: 24, bottom: -24, far: 90 });
  sun.shadow.bias = -0.0008;
  sun.shadow.normalBias = 0.02;
  scene.add(sun, sun.target);
  if (!day)
    for (const l of lamps) {
      const p = new THREE.PointLight(0xffb45e, style === 'lowpoly' ? 4 : 3.2, 5.5, 1.4);
      p.position.set(l.x, l.kind === 'lamp' ? 1.35 : 1, l.z);
      scene.add(p);
    }
  scene.background = new THREE.Color(day ? 0x1d2a1b : 0x0e1220);
}

const TiltShift = {
  uniforms: { tDiffuse: { value: null }, amount: { value: 2.2 }, res: { value: new THREE.Vector2(W, H) } },
  vertexShader: 'varying vec2 vUv; void main(){ vUv=uv; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0); }',
  fragmentShader: `uniform sampler2D tDiffuse; uniform float amount; uniform vec2 res; varying vec2 vUv;
    void main(){
      float d = smoothstep(0.18, 0.5, abs(vUv.y - 0.47));
      vec4 acc = vec4(0.0); float tot = 0.0;
      for (int i=-4;i<=4;i++) for (int j=-4;j<=4;j++){
        vec2 o = vec2(float(i), float(j)) * d * amount / res;
        float w = 1.0 - length(vec2(i,j))/6.0; if (w <= 0.0) continue;
        acc += texture2D(tDiffuse, vUv + o) * w; tot += w;
      }
      vec4 c = acc / tot;
      float v = smoothstep(0.95, 0.35, length(vUv - 0.5));
      gl_FragColor = vec4(c.rgb * mix(0.78, 1.0, v), 1.0);
    }`,
};
const Vignette = {
  uniforms: { tDiffuse: { value: null }, warm: { value: 0.0 } },
  vertexShader: TiltShift.vertexShader,
  fragmentShader: `uniform sampler2D tDiffuse; uniform float warm; varying vec2 vUv;
    void main(){ vec4 c = texture2D(tDiffuse, vUv); float v = smoothstep(0.9, 0.3, length(vUv - 0.5));
      c.rgb *= mix(0.82, 1.0, v); c.rgb = mix(c.rgb, c.rgb * vec3(1.04, 1.0, 0.92), warm); gl_FragColor = c; }`,
};

function shoot(style: Style, light: Light, tilt = 35, dist = 14) {
  const scene = new THREE.Scene();
  if (style === 'diorama') scene.add(facesMesh(desc, dioramaAtlas, false));
  if (style === 'storybook') scene.add(facesMesh(desc, storyAtlas, true));
  if (style === 'lowpoly') scene.add(lowPoly(map, REGION, colors, WALL_H));
  scene.add(style === 'diorama' ? avatarCards('pixel', 48, 64, 1.45) : avatarCards('smooth', 64, 96, 1.5));
  lights(scene, light, desc.lights, style);
  const camera = new THREE.PerspectiveCamera(30, W / H, 0.5, 200);
  const cam = { tx: 19.5, tz: 9.2, tilt, dist, fov: 30, w: W, h: H };
  camera.position.set(...camPos(cam));
  camera.lookAt(cam.tx, 0, cam.tz);
  const composer = new EffectComposer(renderer);
  composer.setPixelRatio(1);
  composer.setSize(W, H);
  composer.addPass(new RenderPass(scene, camera));
  const evening = light === 'evening';
  if (style === 'diorama') {
    if (evening) composer.addPass(new UnrealBloomPass(new THREE.Vector2(W, H), 0.7, 0.5, 0.72));
    composer.addPass(new ShaderPass(TiltShift));
  } else {
    if (evening || style === 'lowpoly') composer.addPass(new UnrealBloomPass(new THREE.Vector2(W, H), evening ? 0.6 : 0.18, 0.4, 0.8));
    const v = new ShaderPass(Vignette);
    v.uniforms.warm!.value = style === 'storybook' ? 1 : 0.3;
    composer.addPass(v);
  }
  composer.addPass(new OutputPass());
  composer.render();
  shots[`${style}-${light}${tilt !== 35 ? `-tilt${tilt}` : ''}`] = renderer.domElement.toDataURL('image/png');
  composer.dispose();
  scene.traverse((o) => {
    if (o instanceof THREE.Mesh) o.geometry.dispose();
  });
}

for (const s of ['diorama', 'storybook', 'lowpoly'] as Style[]) for (const l of ['day', 'evening'] as Light[]) shoot(s, l);
for (const t of [30, 45, 55]) shoot('diorama', 'day', t, t >= 45 ? 15 : 14);

// avatar sheet: both sizes × both looks, plus the flip frames
{
  const cv = document.createElement('canvas');
  cv.width = 1600;
  cv.height = 1000;
  const c = cv.getContext('2d')!;
  c.fillStyle = '#7f9a66';
  c.fillRect(0, 0, cv.width, cv.height);
  c.imageSmoothingEnabled = false;
  c.fillStyle = '#16231a';
  c.font = '600 22px system-ui, sans-serif';
  let y = 40;
  const rows: [number, number, PaperLook, number, string][] = [
    [48, 64, 'pixel', 3, 'Pixel, 48 × 64'],
    [64, 96, 'pixel', 2, 'Pixel, 64 × 96'],
    [48, 64, 'smooth', 0.75, 'Smooth, 48 × 64 (drawn at 4×)'],
    [64, 96, 'smooth', 0.5, 'Smooth, 64 × 96 (drawn at 4×)'],
  ];
  for (const [w, h, look, z, label] of rows) {
    c.fillText(label, 20, y);
    let x = 20;
    for (const p of people.slice(0, 2)) {
      const s = paperSheet(p.a, w, h, look);
      c.drawImage(s.canvas, x, y + 10, s.canvas.width * z, s.canvas.height * z);
      x += s.canvas.width * z + 24;
    }
    // flip frames of the second person: right → (squash) → left
    const fr = paperFrame(people[1]!.a, 'right', w, h, look);
    const fw = fr.width * z, fh = fr.height * z;
    for (let k = 0; k <= 4; k++) {
      const sx = Math.cos((Math.PI * k) / 4);
      const img = k <= 2 ? fr : paperFrame(people[1]!.a, 'left', w, h, look);
      const ww = Math.max(2, Math.abs(sx) * fw);
      c.drawImage(img, x + k * (fw + 10) + (fw - ww) / 2, y + 10, ww, fh);
    }
    y += fr.height * z + 50;
  }
  c.fillText('Flip (left ↔ right), 140 ms →', 1100, 28);
  shots['avatars'] = cv.toDataURL('image/png');
}
(window as unknown as { __done: boolean }).__done = true;
