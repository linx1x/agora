/**
 * P16.4 check: every HQ region built by the app's scene builder (apps/web/src/game3d/scene.ts),
 * with plain tiles (blend variants are not composed here). `PAGE=regions node stills.mjs`.
 */
import * as THREE from 'three';
import { TILESET_COLUMNS } from '@agora/shared';
import { buildScene, regionTiles, type Extents } from '@web/game3d/scene';
import { loadTileset } from './assets';
import { makeAtlas } from './atlas';
import { camPos } from './camera';
import { scanExtents, type Face } from './scene';
import { map } from './sim';

const tileset = await loadTileset();
const ext = scanExtents(tileset, TILESET_COLUMNS) as Extents[];
const atlas = makeAtlas(tileset);
const W = 1200;
const H = 800;
const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
renderer.setSize(W, H);
document.body.append(renderer.domElement);
const tex = new THREE.CanvasTexture(atlas.canvas);
tex.colorSpace = THREE.SRGBColorSpace;
tex.magFilter = THREE.NearestFilter;
tex.minFilter = THREE.NearestFilter;
tex.generateMipmaps = false;
const shots: Record<string, string> = {};
for (const r of map.regions) {
  const rt = regionTiles(map, r);
  const sc = buildScene(map, rt, ext);
  const pos: number[] = [];
  const uvs: number[] = [];
  const idx: number[] = [];
  const nrm: number[] = [];
  for (const f of sc.faces) {
    const [u0, v0, u1, v1] = atlas.uv(f as unknown as Face);
    const b = pos.length / 3;
    for (const p of f.p) pos.push(...p);
    uvs.push(u0, 1 - v0, u1, 1 - v0, u1, 1 - v1, u0, 1 - v1);
    const [a, bb, , dd] = f.p.map((p) => new THREE.Vector3(...p));
    const n = new THREE.Vector3()
      .subVectors(bb!, a!)
      .cross(new THREE.Vector3().subVectors(dd!, a!))
      .normalize()
      .negate();
    for (let k = 0; k < 4; k++) nrm.push(n.x, n.y, n.z);
    idx.push(b, b + 3, b + 2, b, b + 2, b + 1);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nrm, 3));
  g.setIndex(idx);
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x10140f);
  scene.add(
    new THREE.Mesh(
      g,
      new THREE.MeshLambertMaterial({ map: tex, alphaTest: 0.5, side: THREE.DoubleSide }),
    ),
  );
  scene.add(new THREE.HemisphereLight(0xffffff, 0x666655, 2.2));
  const cam = new THREE.PerspectiveCamera(30, W / H, 0.5, 300);
  const c = {
    tx: rt.x + rt.w / 2,
    tz: rt.y + rt.h / 2 + 1,
    tilt: 35,
    dist: Math.max(rt.w, rt.h) * 1.9,
    fov: 30,
    w: W,
    h: H,
  };
  cam.position.set(...camPos(c));
  cam.lookAt(c.tx, 0, c.tz);
  renderer.render(scene, cam);
  shots[r.id] = renderer.domElement.toDataURL('image/png');
  g.dispose();
}
(window as unknown as { __shots: unknown }).__shots = shots;
(window as unknown as { __done: boolean }).__done = true;
