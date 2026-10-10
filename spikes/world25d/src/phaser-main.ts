/**
 * P16.1 variant (b): Phaser 4.2.1 faking depth. Phaser 4 removed Mesh/Plane ("proper 3D planned for
 * the future"), so the same 3D faces are projected on the CPU every frame and drawn as Mesh2D
 * triangles (affine texturing), grouped into depth bands and painter-sorted with the avatar images.
 * No lights: Phaser's Lighting component needs normal maps, which this art does not have.
 */
import './glcount';
import Phaser from 'phaser';
import { TILE, TILESET_COLUMNS } from '@agora/shared';
import { AV_FRAMES, AV_H, AV_W, DIR_ROW, makeAvatarCanvas } from '@web/game/avatars';
import { loadTileset } from './assets';
import { makeAtlas } from './atlas';
import { flipScale, project, unprojectFloor, type Cam } from './camera';
import { drawCalls, lastDrawCalls } from './glcount';
import { Hud, bindKeys, readOpts } from './hud';
import { buildScene, scanExtents, type Face } from './scene';
import { REGION, Sim, map } from './sim';

const opts = readOpts();
const sim = new Sim(opts.bots);
const hud = new Hud('phaser', opts, sim);
bindKeys(sim);

const tileset = await loadTileset();
const atlas = makeAtlas(tileset);
const desc = buildScene(map, REGION, scanExtents(tileset, TILESET_COLUMNS), { wallH: opts.wallH });

const GW = Math.round(innerWidth * opts.scale);
const GH = Math.round(innerHeight * opts.scale);
const cam: Cam = { tx: sim.me.x / TILE, tz: sim.me.y / TILE, tilt: opts.tilt, dist: opts.dist, fov: opts.fov, w: GW, h: GH };
const AVH = AV_H / AV_W;
const FLIP_MS = matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : 140;

interface Band {
  key: number;
  faces: Face[];
  mesh: Phaser.GameObjects.Mesh2D;
}

class World extends Phaser.Scene {
  bands: Band[] = [];
  avs = new Map<string, { img: Phaser.GameObjects.Image; blob: Phaser.GameObjects.Image }>();
  t0 = 0;

  constructor() {
    super('world');
  }

  create() {
    this.textures.addCanvas('atlas', atlas.canvas);
    // faces grouped by depth band (1/8 tile); floor first, one band
    const groups = new Map<number, Face[]>();
    for (const f of desc.faces) {
      const k = f.key < 0 ? -1e6 : Math.round(f.key * 8) / 8;
      (groups.get(k) ?? groups.set(k, []).get(k)!).push(f);
    }
    for (const [key, faces] of [...groups].sort((a, b) => a[0] - b[0])) {
      // within a band: sides, then tops, then fronts
      faces.sort((a, b) => b.shade - a.shade || a.key - b.key);
      const verts: number[] = [];
      const idx: number[] = [];
      faces.forEach((f, i) => {
        const [u0, v0, u1, v1] = atlas.uv(f);
        verts.push(0, 0, u0, v0, 0, 0, u1, v0, 0, 0, u1, v1, 0, 0, u0, v1);
        const b = i * 4;
        idx.push(b, b + 1, b + 2, 0, b, b + 2, b + 3, 0);
      });
      const mesh = this.add.mesh2d(0, 0, 'atlas', verts, idx, true);
      mesh.buildOrderedIndices(0, true);
      mesh.setDepth(key);
      this.bands.push({ key, faces, mesh });
    }
    // avatars
    const blob = this.textures.createCanvas('blob', 32, 16)!;
    const g = blob.getContext();
    const r = g.createRadialGradient(16, 8, 1, 16, 8, 16);
    r.addColorStop(0, 'rgba(0,0,0,.45)');
    r.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = r;
    g.fillRect(0, 0, 32, 16);
    blob.refresh();
    for (const m of sim.all()) {
      const key = `av-${m.id}`;
      const t = this.textures.addCanvas(key, makeAvatarCanvas(m.avatar))!;
      for (let row = 0; row < 6; row++)
        for (let col = 0; col < AV_FRAMES; col++) t.add(`${row}-${col}`, 0, col * AV_W, row * AV_H, AV_W, AV_H);
      const img = this.add.image(0, 0, key, '0-0').setOrigin(0.5, 1);
      const sh = this.add.image(0, 0, 'blob').setDepth(-1e5);
      this.avs.set(m.id, { img, blob: sh });
    }
    this.input.on('pointerup', (p: Phaser.Input.Pointer) => {
      const f = unprojectFloor(cam, p.x, p.y);
      if (f) sim.goTo(f.x * TILE, f.z * TILE);
    });
    this.input.on('wheel', (_p: unknown, _o: unknown, _dx: number, dy: number) => {
      cam.dist = Math.min(40, Math.max(6, cam.dist * (dy > 0 ? 1.1 : 0.9)));
    });
  }

  override update(now: number, dtMs: number) {
    this.t0 = performance.now();
    const dt = Math.min(0.1, dtMs / 1000);
    sim.step(dt, now);
    const k = 1 - Math.pow(1 - 0.18, dt * 60);
    cam.tx += (sim.me.x / TILE - cam.tx) * k;
    cam.tz += (sim.me.y / TILE - cam.tz) * k;
    // project every face corner (CPU), ~7k vertices
    for (const b of this.bands) {
      const v = b.mesh.vertices;
      let o = 0;
      for (const f of b.faces) {
        for (const p of f.p) {
          const s = project(cam, p);
          v[o] = s ? s.x : -9999;
          v[o + 1] = s ? s.y : -9999;
          o += 4;
        }
      }
    }
    for (const m of sim.all()) {
      const a = this.avs.get(m.id)!;
      const s = project(cam, [m.x / TILE, 0, m.y / TILE]);
      if (!s) {
        a.img.setVisible(false);
        continue;
      }
      const frame = m.moving ? Math.floor(now / 125) % AV_FRAMES : 0;
      const kf = FLIP_MS ? Math.min(1, (now - m.flipAt) / FLIP_MS) : 1;
      const scale = s.s / AV_W;
      a.img
        .setVisible(true)
        .setFrame(`${DIR_ROW[m.dir]}-${frame}`)
        .setPosition(s.x, s.y)
        .setScale(scale * flipScale(kf), scale)
        .setDepth(m.y / TILE);
      a.blob.setPosition(s.x, s.y).setScale(scale * 0.8, scale * 0.6);
    }
  }
}

const game = new Phaser.Game({
  type: Phaser.WEBGL,
  parent: 'world',
  width: GW,
  height: GH,
  backgroundColor: '#10140f',
  pixelArt: opts.filter === 'nearest',
  scale: { mode: Phaser.Scale.NONE },
  scene: [World],
  banner: false,
});

hud.calls = lastDrawCalls;
hud.extra = () => ({ faces: desc.faces.length, bands: (game.scene.getScene('world') as World)?.bands.length ?? 0 });
game.events.on('postrender', () => {
  const w = game.scene.getScene('world') as World;
  const now = performance.now();
  drawCalls();
  hud.plates_(sim.all(), (m) => {
    const s = project(cam, [m.x / TILE, AVH + 0.15, m.y / TILE]);
    return s ? { x: s.x / opts.scale, y: s.y / opts.scale } : null;
  });
  hud.frame(now, now - w.t0);
});
(window as unknown as Record<string, unknown>).__spike = { sim, cam, desc, game };
