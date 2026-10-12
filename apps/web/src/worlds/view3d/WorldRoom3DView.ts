/**
 * The 2.5D view of a personal world (P17.15, ADR-053): a fixed-tilt Three.js camera over the cells
 * it can see, drawn as one merged mesh per chunk of 32 × 32 cells (tops, stepped cliffs, decor and
 * the farm layer, `geometry.ts`), with the people as paper cut-outs and names as screen overlays.
 * It is the same world the former flat view drew (WorldRoomScene, removed in P16.21): the walking is
 * `WorldWalker`, the terrain is `worldSession.terrain`, and the clicks and the e2e hooks follow the
 * former flat view's pixel rules, so every cell is where it was. Visual only: nothing here changes the server.
 *
 * Heights: a level is `heightOf(level)` tiles above the floor (12 px of the flat view). Occlusion:
 * the solid decor (walls, trees) fades over a person behind it (`occlusion.ts`, as the office).
 */
import * as THREE from 'three';
import { worldHud } from '../ui/hudState';
import { faceCell } from '../inputActs';
import * as use from '../use';
import { liveUse } from '../useLive';
import { speedOfTier, swingDurationMs } from '../tools/swing';
import { farmSprites, type FarmSprites } from '../farmArt';
import {
  CHUNK_SIZE,
  TILE,
  type CellRef,
  type Dir,
  type GridCell,
  type PlotState,
} from '@agora/shared';
import { world as link } from '../../net/client';
import { rendered } from '../../game/controller';
import { inputVector, isTyping } from '../../game/input';
import { exposeTestApi, type ViewTestApi } from '../../game/view';
import { store, toast } from '../../state/store';
import { COMPACT_QUERY, matches } from '../../ui/layout';
import { worldSession } from '../session';
import { WorldWalker } from '../walker';
import { portalOfPrompt, worldPromptAt } from '../prompts';
import { CELL, farmVisual, pickCell, type CellWindow } from '../cellMath';
import { cropFrameName } from '../blockArt';
import {
  FOV,
  TILT,
  camPos,
  distForZoom,
  dockPx,
  fitZoom,
  followStep,
  project,
  screenRay,
  unprojectFloor,
  type Cam,
  type Pt,
} from '../../game3d/camera';
import { FADE_ATTR, Occlusion, ditherFade } from '../../game3d/occlusion';
import { screenBox, type Subject } from '../../game3d/occlusionMath';
import { PaperFigures } from '../../game3d/paperFigures';
import { paperScale } from '../../game3d/paperLayout';
import { Overlays } from '../../game3d/overlays';
import { QualityGovernor, SCALE_ONLY, type QualityChange } from '../../game3d/tier';
import { pixelTexture } from '../../game3d/meshes';
import { buildWorldAtlas, type WorldAtlas } from './atlas3d';
import { buildChunk, type CellIn, type ChunkGeometry } from './geometry';
import {
  cellOnRay,
  chunkKey,
  chunksIn,
  heightOf,
  windowOf,
  worldOfDrawn,
  type ChunkIndex,
} from './math3d';
import { SwingFx } from './swing3d';
import { liveSwings, targetCells, type OwnSwing } from './targetRule';

/** the e2e hooks of this view (`window.__agora.view3d`), on top of the shared `ViewTestApi` */
interface WorldTestApi {
  /** the world, me and what is drawn, for the e2e specs */
  world(): {
    id: string | null;
    x: number;
    y: number;
    level: number;
    cell: GridCell;
    people: number;
    cellsDrawn: number;
    plots: number;
    farmDay: number;
    path: number;
    /** tool swings played in this view (mine and the people I see) */
    swings: number;
  };
  /** the level of a cell (with stored edits) */
  levelAt(cx: number, cy: number): number;
  /** whether a cell can be walked on */
  walkableAt(cx: number, cy: number): boolean;
  /** the items I hold, as the HUD has them (stack key to quantity) */
  inventory(): Record<string, number>;
  /** a cell as the view has it: its level, block, decor and farm plot (null when none) */
  cellInfo(
    cx: number,
    cy: number,
  ): {
    level: number;
    block: string;
    decor: string;
    plot: PlotState | null;
    farmDay: number;
  } | null;
}

const BG = 0x1b2733;
const FADE_BG = 'rgb(10, 20, 30)';
const FADE_IN_MS = 300;
const CAM_NEAR = 0.5;
const CAM_FAR = 200;
/** the controller's ~3 Hz work, as the flat view (the return pad's prompt) */
const SLOW_MS = 300;
/** a remote person catches up with the server's position in about this long (as the flat view) */
const CATCH_UP_MS = 90;
/** every other path cell is a dot (the flat view's rule) */
const PATH_EVERY = 2;
const PATH_Y = 0.03;
const PORTRAIT_QUERY = '(orientation: portrait)';

const reducedMotion = () =>
  window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
/** Tests fix the hour with `?hour=`; then nothing is decided from this device's speed (P16.11). */
const pinnedHour = () => new URLSearchParams(location.search).has('hour');

function gpuName(renderer: THREE.WebGLRenderer): string {
  const gl = renderer.getContext();
  const ext = gl.getExtension('WEBGL_debug_renderer_info');
  const name = ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER);
  return String(name ?? '');
}

interface ChunkView {
  readonly mesh: THREE.Mesh;
  readonly occlusion: Occlusion | null;
}

export class WorldRoom3DView {
  private readonly renderer: THREE.WebGLRenderer;
  private readonly scene = new THREE.Scene();
  private readonly camera = new THREE.PerspectiveCamera(FOV, 1, CAM_NEAR, CAM_FAR);
  private readonly cam: Cam = { tx: 0, tz: 0, tilt: TILT, dist: 10, fov: FOV, w: 1, h: 1 };
  private readonly atlas: WorldAtlas;
  private readonly texture: THREE.CanvasTexture;
  private readonly material: THREE.MeshBasicMaterial;
  private readonly chunks = new Map<string, ChunkView>();
  /** every chunk in view is rebuilt (the world's data or the farm changed) */
  private dirtyAll = true;
  private win: CellWindow | null = null;
  private readonly people: PaperFigures;
  /** the tool swings in view: arcs, marks, sparks and the shake (P17.21c) */
  private readonly swingFx: SwingFx;
  /** my swings still in their hold: their cells never fade (P17.21d, `targetRule.ts`) */
  private ownSwings: OwnSwing[] = [];
  private readonly overlays: Overlays;
  private readonly fade: HTMLDivElement;
  private fadeStart = 0;
  private walker: WorldWalker | null = null;
  private readonly drawn = new Map<string, { x: number; y: number }>();
  private readonly shown = new Set<string>();
  private target: Pt | null = null;
  private following = true;
  private zoomNow = 1;
  private readonly pathMat = new THREE.PointsMaterial({
    color: 0xf3f6f8,
    size: 4,
    sizeAttenuation: false,
    transparent: true,
    opacity: 0.55,
    depthWrite: false,
  });
  private readonly goalMat = new THREE.PointsMaterial({
    color: 0xf3f6f8,
    size: 9,
    sizeAttenuation: false,
    transparent: true,
    opacity: 0.8,
    depthWrite: false,
  });
  private pathObj: THREE.Points | null = null;
  private goalObj: THREE.Points | null = null;
  private pathLen = 0;
  /** the quality ladder (P16.11, ADR-054): this view has only the render scale to step down */
  private readonly gov: QualityGovernor;
  /** the device pixel ratio, capped at 2 (the render scale multiplies it) */
  private readonly devicePr: number;
  private lastFrame = 0;
  private lastSlow = Number.NEGATIVE_INFINITY;
  private raf = 0;
  private destroyed = false;
  private unsubs: (() => void)[] = [];
  private ro: ResizeObserver | null = null;
  private onKey: ((e: KeyboardEvent) => void) | null = null;

  constructor(private readonly parent: HTMLElement) {
    this.atlas = buildWorldAtlas();
    this.renderer = new THREE.WebGLRenderer({ antialias: false });
    this.renderer.setClearColor(BG);
    parent.append(this.renderer.domElement);
    this.renderer.domElement.style.touchAction = 'none';
    this.devicePr = Math.min(window.devicePixelRatio || 1, 2);
    this.gov = new QualityGovernor({
      coarse: window.matchMedia?.('(pointer: coarse)').matches ?? false,
      gpu: gpuName(this.renderer),
      pinned: pinnedHour(),
      rung: store.get().qualityLevel,
      features: SCALE_ONLY,
    });
    this.applyQuality();

    this.texture = pixelTexture(this.atlas.canvas);
    this.material = new THREE.MeshBasicMaterial({
      map: this.texture,
      vertexColors: true,
      alphaTest: 0.5,
      side: THREE.DoubleSide,
    });
    ditherFade(this.material);
    // the paper cut-outs are lit cards (Lambert); the terrain is flat colour, as the flat view
    this.scene.add(new THREE.AmbientLight(0xffffff, Math.PI));

    this.fade = document.createElement('div');
    this.fade.setAttribute('aria-hidden', 'true');
    Object.assign(this.fade.style, {
      position: 'absolute',
      inset: '0',
      background: FADE_BG,
      opacity: reducedMotion() ? '0' : '1',
      pointerEvents: 'none',
    });
    parent.append(this.fade);
    this.fadeStart = performance.now();

    this.people = new PaperFigures(this.scene, paperScale(window.devicePixelRatio || 1));
    this.swingFx = new SwingFx(this.scene);
    // after the canvas and the fade: the names go between them, so the fade covers them too
    this.overlays = new Overlays(parent);

    this.unsubs.push(
      worldSession.on((c) => {
        if (c === 'chunks' || c === 'farm' || c === 'welcome') this.dirtyAll = true;
      }),
    );
    this.unsubs.push(worldSession.onSwing((s) => this.playSwing(s.id, s.dir, s.tier)));
    this.bindInput();
    this.bindLayout();
    this.layout();
    exposeTestApi(this.testApi());
    this.raf = requestAnimationFrame(this.frame);
  }

  private get canvas(): HTMLCanvasElement {
    return this.renderer.domElement;
  }

  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    cancelAnimationFrame(this.raf);
    this.unsubs.forEach((u) => u());
    this.unsubs = [];
    this.ro?.disconnect();
    if (this.onKey) window.removeEventListener('keydown', this.onKey);
    this.onKey = null;
    for (const id of this.shown) rendered.delete(id);
    exposeTestApi(null);
    for (const v of this.chunks.values()) this.dropChunk(v);
    this.chunks.clear();
    this.clearPath();
    this.people.dispose();
    this.overlays.destroy();
    this.swingFx.dispose();
    this.pathMat.dispose();
    this.goalMat.dispose();
    this.material.dispose();
    this.texture.dispose();
    this.renderer.dispose();
    this.renderer.forceContextLoss();
    this.canvas.remove();
    this.fade.remove();
  }

  // ───────────────────────────────────────────── input and layout
  /** Walk to the cell under a point of the flat view's pixels (a click's rule, the People list's "go to"). */
  clickPixel(wx: number, wy: number): void {
    const t = worldSession.terrain;
    if (!t) return;
    this.walkTo(pickCell(wx, wy, (cx, cy) => t.cellAt(cx, cy).level));
  }

  private walkTo(cell: GridCell): void {
    if (!this.walker) return;
    if (!this.walker.goTo(cell)) toast('worlds.noRoute');
    this.drawPath();
  }

  /** The cell a canvas point is over: the first one a ray through it meets (the raised tops too). */
  private cellAtCanvas(sx: number, sy: number): GridCell | null {
    const t = worldSession.terrain;
    if (!t) return null;
    const r = screenRay(this.cam, sx, sy);
    return cellOnRay(r.o, r.d, (cx, cy) => t.cellAt(cx, cy).level);
  }

  /** X (or the touch button): act on the current prompt. */
  private act(): void {
    const id = portalOfPrompt(store.get().prompt);
    if (id !== null) link.send({ t: 'portal:enter', id });
  }

  private stepZoom(dir: number): void {
    const levels = [1, 2, 3, 4];
    const cur = this.zoomNow;
    const i = levels.findIndex((l) => l >= cur);
    const next =
      levels[Math.max(0, Math.min(levels.length - 1, (i < 0 ? levels.length - 1 : i) + dir))]!;
    store.set({ zoom: next });
  }

  /** The keyboard's state for the world keys (X, Space): a busy keyboard does nothing (use.ts). */
  private keys(e: KeyboardEvent): use.KeyContext {
    return {
      typing: isTyping(),
      modifier: e.metaKey || e.ctrlKey || e.altKey,
      dialog: !!store.get().dialog,
      chest: worldHud.get().chest !== null,
      panel: worldHud.get().panel !== null,
    };
  }

  /** The input's world: the held item acts on a cell, and my own swing is played from here. */
  private useEnv(): use.UseEnv {
    return liveUse(
      (at, tier, speed) =>
        this.playSwing(worldSession.you, this.walker?.d ?? 'down', tier, true, speed, at),
      (key) => toast(key),
    );
  }

  /** Space: the held item acts on the cell in front of me; with nothing to do there, the status says so. */
  private useFaced(shift: boolean): void {
    const focused = document.activeElement;
    if (focused instanceof HTMLElement && focused.closest('.wh-hud')) focused.blur();
    if (this.walker) use.useFaced(this.useEnv(), this.walker, shift);
  }

  private bindInput(): void {
    const c = this.canvas;
    c.addEventListener('pointerdown', (e: PointerEvent) => {
      if (e.button !== 0 || !this.walker) return;
      (document.activeElement as HTMLElement | null)?.blur?.();
      const r = c.getBoundingClientRect();
      const cell = this.cellAtCanvas(e.clientX - r.left, e.clientY - r.top);
      if (!cell) return;
      // the held item acts on a cell in reach (the server decides); any other click walks there
      if (!use.useAt(this.useEnv(), this.walker, { x: cell.cx, y: cell.cy }, e.shiftKey))
        this.walkTo(cell);
    });
    c.addEventListener('wheel', (e: WheelEvent) => this.stepZoom(e.deltaY > 0 ? -1 : 1), {
      passive: true,
    });
    this.onKey = (e: KeyboardEvent) => {
      if (use.keysBusy(this.keys(e))) return;
      if (e.key === 'x' || e.key === 'X') this.act();
      else if (e.key === ' ') {
        e.preventDefault();
        if (!e.repeat) this.useFaced(e.shiftKey);
      }
    };
    window.addEventListener('keydown', this.onKey);

    let lastZoom = store.get().zoom;
    let lastTouch = store.get().config?.flags.touchControls;
    this.unsubs.push(
      store.subscribe(() => {
        const st = store.get();
        if (st.zoom !== lastZoom || st.config?.flags.touchControls !== lastTouch) {
          lastZoom = st.zoom;
          lastTouch = st.config?.flags.touchControls;
          this.layout();
        }
        const r = st.navRequest;
        if (r) {
          store.set({ navRequest: null });
          if (r.kind === 'act') this.act();
          else if (r.kind === 'point') this.clickPixel(r.x, r.y);
          else if (r.kind === 'person') {
            const at = rendered.get(r.id);
            if (at) this.clickPixel(at.x, at.y);
          }
        }
      }),
    );
  }

  private bindLayout(): void {
    this.ro = new ResizeObserver(() => this.layout());
    this.ro.observe(this.parent);
  }

  /** The canvas fills the parent above the phone dock; the zoom is the stored level or the fit. */
  private layout(): void {
    if (this.destroyed) return;
    const s = store.get();
    const w = Math.max(1, this.parent.clientWidth);
    const parentH = Math.max(1, this.parent.clientHeight);
    const dock = dockPx(
      matches(COMPACT_QUERY),
      matches(PORTRAIT_QUERY),
      s.config?.flags.touchControls !== false,
    );
    const h = Math.max(1, parentH - dock);
    this.renderer.setSize(w, h, true);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.zoomNow = s.zoom ?? fitZoom(w, h);
    Object.assign(this.cam, { w, h, dist: distForZoom(this.zoomNow, h, FOV) });
  }

  // ───────────────────────────────────────────── frame
  private readonly frame = (): void => {
    this.raf = requestAnimationFrame(this.frame);
    if (document.hidden) return;
    const now = performance.now();
    const dtMs = this.lastFrame ? now - this.lastFrame : 16;
    this.lastFrame = now;
    if (!this.ensureWalker()) return;
    this.watchQuality(now);
    if (!this.walker) return;

    this.walker.step(dtMs, inputVector());
    if (this.walker.path.length !== this.pathLen) this.drawPath();
    this.syncPeople(now, dtMs);
    this.updateCamera(dtMs);
    this.syncChunks();
    this.syncOverlays(now);
    this.occlude(dtMs);
    this.stepFade(now);
    if (now - this.lastSlow > SLOW_MS) {
      this.lastSlow = now;
      this.slowTick();
    }
    this.swingFx.update(now);
    // a swing's shake slides the eye and the target together, so the view moves and does not turn
    const [sx, sy, sz] = this.swingFx.shake(this.cam, now);
    const [x, y, z] = camPos(this.cam);
    this.camera.position.set(x + sx, y + sy, z + sz);
    this.camera.lookAt(this.cam.tx + sx, sy, this.cam.tz + sz);
    this.camera.updateMatrixWorld();
    this.renderer.render(this.scene, this.camera);
  };

  /** The walker exists once the world's session is here (its welcome has set the terrain). */
  private ensureWalker(): boolean {
    if (this.walker) return true;
    if (!worldSession.active || !worldSession.terrain) return false;
    this.walker = new WorldWalker(worldSession);
    const me = worldSession.people.get(worldSession.you);
    const at = me ?? { x: 16, y: 26 };
    this.walker.place(at.x, at.y);
    this.target = { x: at.x / TILE, z: at.y / TILE };
    return true;
  }

  /**
   * The quality ladder (P16.11, ADR-054), as the office view: the probe sets the tier, and 15 s in a
   * row under 20 fps steps the render scale down. The first step down says so, once.
   */
  private watchQuality(now: number): void {
    const change = this.gov.frame(now);
    if (change) this.onQuality(change);
  }

  /** A new rung: the render scale follows it, and the session keeps it (a remount starts there). */
  private onQuality(c: QualityChange): void {
    store.set({ qualityLevel: c.rung });
    this.applyQuality();
    this.layout();
    if (c.dropped) toast('toast.qualityLower', undefined, 9000);
  }

  /** The render scale of the rung, times the device pixel ratio (this view has no lights or post). */
  private applyQuality(): void {
    this.renderer.setPixelRatio(this.devicePr * this.gov.quality.scale);
  }

  /** The fade-in from the dark on entering the world (none under reduced motion). */
  private stepFade(now: number): void {
    const a = reducedMotion() ? 0 : Math.max(0, 1 - (now - this.fadeStart) / FADE_IN_MS);
    const next = a.toFixed(3);
    if (this.fade.style.opacity !== next) this.fade.style.opacity = next;
  }

  // ───────────────────────────────────────────── people
  private syncPeople(now: number, dtMs: number): void {
    const s = worldSession;
    const t = s.terrain!;
    const ids = new Set<string>();
    for (const p of s.people.values()) {
      const mine = p.id === s.you;
      let x: number;
      let y: number;
      let d: Dir;
      let moving: boolean;
      if (mine) {
        ({ x, y, d, moving } = this.walker!);
      } else {
        // a remote person catches up with the last position the server sent (never teleports)
        const at = this.drawn.get(p.id) ?? { x: p.x, y: p.y };
        const k = Math.min(1, dtMs / CATCH_UP_MS);
        at.x += (p.x - at.x) * k;
        at.y += (p.y - at.y) * k;
        this.drawn.set(p.id, at);
        ({ x, y } = at);
        d = p.d;
        moving = Math.hypot(p.x - x, p.y - y) > 0.5;
      }
      const level = t.cellAt(
        Math.floor(Math.round(x) / CELL),
        Math.floor(Math.round(y) / CELL),
      ).level;
      this.people.place(
        p.id,
        p.avatar,
        { x, y, dir: d, moving, pose: 'stand', poseAt: 0, elev: heightOf(level) },
        now,
      );
      rendered.set(p.id, { x, y });
      ids.add(p.id);
    }
    for (const id of this.shown) if (!ids.has(id)) rendered.delete(id);
    this.people.keep(ids);
    for (const id of [...this.drawn.keys()]) if (!s.people.has(id)) this.drawn.delete(id);
    this.shown.clear();
    for (const id of ids) this.shown.add(id);
  }

  private syncOverlays(now: number): void {
    const s = worldSession;
    const ids = new Set<string>();
    for (const p of s.people.values()) {
      ids.add(p.id);
      this.overlays.sync(
        p.id,
        { name: p.name, online: true, hand: false },
        this.toParent(this.people.headPoint(p.id)),
        now,
      );
    }
    this.overlays.keep(ids);
  }

  private toParent(pt: [number, number, number] | null): { x: number; y: number } | null {
    if (!pt) return null;
    const p = project(this.cam, pt);
    if (!p) return null;
    return { x: p.x + this.canvas.offsetLeft, y: p.y + this.canvas.offsetTop };
  }

  // ───────────────────────────────────────────── camera
  private updateCamera(dtMs: number): void {
    const me = this.walker;
    if (!me) return;
    const at = { x: me.x / TILE, z: me.y / TILE };
    if (!this.target) this.target = at;
    if (this.following) this.target = followStep(this.target, at, dtMs);
    this.cam.tx = this.target.x;
    this.cam.tz = this.target.z;
  }

  /** The cells the camera sees: the floor under the screen's corners, with the view's margins. */
  private windowNow(): CellWindow {
    const { w, h } = this.cam;
    const pts = [
      unprojectFloor(this.cam, 0, 0),
      unprojectFloor(this.cam, w, 0),
      unprojectFloor(this.cam, 0, h),
      unprojectFloor(this.cam, w, h),
      unprojectFloor(this.cam, w / 2, 0),
    ];
    if (pts.some((p) => p === null)) return windowOf([{ x: this.cam.tx, z: this.cam.tz }]);
    return windowOf(pts as Pt[]);
  }

  /** Build the chunks in view that are missing (or all of them after a change), drop the others. */
  private syncChunks(): void {
    const win = this.windowNow();
    const moved =
      !this.win ||
      win.x0 !== this.win.x0 ||
      win.y0 !== this.win.y0 ||
      win.x1 !== this.win.x1 ||
      win.y1 !== this.win.y1;
    if (!moved && !this.dirtyAll) return;
    this.win = win;
    const want = chunksIn(win);
    const sprites = farmSprites(worldHud.get().animals, worldHud.get().machines);
    const keep = new Set(want.map(chunkKey));
    for (const [key, v] of this.chunks)
      if (!keep.has(key)) {
        this.dropChunk(v);
        this.chunks.delete(key);
      }
    for (const c of want) {
      const key = chunkKey(c);
      const have = this.chunks.get(key);
      if (have && !this.dirtyAll) continue;
      if (have) {
        this.dropChunk(have);
        this.chunks.delete(key);
      }
      this.chunks.set(key, this.buildChunkView(c, sprites));
    }
    this.dirtyAll = false;
  }

  private buildChunkView(c: ChunkIndex, sprites: FarmSprites): ChunkView {
    const s = worldSession;
    const t = s.terrain!;
    const read = (cx: number, cy: number): CellIn => {
      const cell = t.cellAt(cx, cy);
      const plot = s.plots.get(`${cx},${cy}`);
      const farm = farmVisual(plot, s.farmDay);
      return {
        level: cell.level,
        block: cell.block,
        decor: cell.decor,
        solid: cell.solid,
        soil: farm?.soil ?? false,
        watered: farm?.watered ?? false,
        crop:
          farm && farm.crop !== null && plot?.crop
            ? cropFrameName(plot.crop.crop, farm.crop)
            : null,
        sprinkler: farm?.sprinkler ?? false,
        animals: sprites.animals.get(`${cx},${cy}`) ?? [],
        mark: sprites.marks.get(`${cx},${cy}`) ?? null,
      };
    };
    const geo: ChunkGeometry = buildChunk(
      { x0: c.ix * CHUNK_SIZE, y0: c.iy * CHUNK_SIZE, size: CHUNK_SIZE },
      read,
      (name) => this.atlas.uv(name),
    );
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(geo.position, 3));
    g.setAttribute('uv', new THREE.BufferAttribute(geo.uv, 2));
    g.setAttribute('color', new THREE.BufferAttribute(geo.color, 3));
    const fade = new THREE.BufferAttribute(geo.fade, 1);
    g.setAttribute(FADE_ATTR, fade);
    g.setIndex(new THREE.BufferAttribute(geo.index, 1));
    g.computeBoundingSphere();
    const mesh = new THREE.Mesh(g, this.material);
    this.scene.add(mesh);
    return { mesh, occlusion: geo.occluders.length ? new Occlusion(fade, geo.occluders) : null };
  }

  private dropChunk(v: ChunkView): void {
    this.scene.remove(v.mesh);
    v.mesh.geometry.dispose();
  }

  /**
   * The solid decor fades where it hides me (the office's rule, for the walls and the trees). The
   * decor I work on does not: the cell I swing at (for the swing and a hold) and the cell I face
   * when it is in reach (P17.21d).
   */
  private occlude(dtMs: number): void {
    const subjects: Subject[] = [];
    const me = worldSession.you ? screenBox(this.cam, this.people.box(worldSession.you)) : null;
    if (me) subjects.push(me);
    const now = performance.now();
    this.ownSwings = liveSwings(this.ownSwings, now);
    const w = this.walker;
    const exempt = w
      ? targetCells({ now, feetX: w.x, feetY: w.y, dir: w.d, swings: this.ownSwings })
      : undefined;
    for (const v of this.chunks.values())
      v.occlusion?.update(this.cam, subjects, dtMs, reducedMotion(), exempt);
  }

  // ───────────────────────────────────────────── path
  private drawPath(): void {
    const path = this.walker?.path ?? [];
    this.pathLen = path.length;
    this.clearPath();
    if (!path.length) return;
    const dots = path.filter((_, i) => i % PATH_EVERY === 0);
    this.pathObj = this.dotsAt(dots, this.pathMat);
    this.goalObj = this.dotsAt([path[path.length - 1]!], this.goalMat);
    if (this.pathObj) this.scene.add(this.pathObj);
    if (this.goalObj) this.scene.add(this.goalObj);
  }

  private dotsAt(cells: readonly GridCell[], mat: THREE.PointsMaterial): THREE.Points {
    const t = worldSession.terrain!;
    const pos = new Float32Array(cells.length * 3);
    cells.forEach((c, i) => {
      pos[i * 3] = c.cx + 0.5;
      pos[i * 3 + 1] = heightOf(t.cellAt(c.cx, c.cy).level) + PATH_Y;
      pos[i * 3 + 2] = c.cy + 0.5;
    });
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    return new THREE.Points(g, mat);
  }

  private clearPath(): void {
    for (const o of [this.pathObj, this.goalObj]) {
      if (!o) continue;
      this.scene.remove(o);
      o.geometry.dispose();
    }
    this.pathObj = null;
    this.goalObj = null;
  }

  /** ~3 Hz: the prompt for the return pad. */
  private slowTick(): void {
    const at = this.walker;
    const prompt = at ? worldPromptAt(worldSession.worldId, worldSession.terrain, at) : null;
    const cur = store.get().prompt;
    if (JSON.stringify(prompt) !== JSON.stringify(cur ?? null)) store.set({ prompt });
  }

  /**
   * A tool swing by a person in view (P17.21b, P17.21c): mine (`own`, which shakes the view) or
   * another's. The arc starts at the hand; the sparks land on `at`, or on the cell in front of the feet.
   */
  playSwing(
    id: string,
    dir: Dir,
    tier: number,
    own = false,
    speed = speedOfTier(tier),
    at?: CellRef,
  ): void {
    const t = worldSession.terrain;
    const feet = id === worldSession.you ? this.walker : rendered.get(id);
    if (!t || !feet) return;
    const target = at ?? faceCell(feet.x, feet.y, dir);
    this.swings++;
    if (own)
      this.ownSwings.push({
        cell: { x: target.x, y: target.y },
        endAt: performance.now() + swingDurationMs({ tier, speed }),
      });
    this.swingFx.play(
      {
        feetX: feet.x / TILE,
        feetZ: feet.y / TILE,
        floor: heightOf(this.levelAtPx(feet.x, feet.y)),
        dir,
        tier,
        speed,
        target: {
          cx: target.x,
          cy: target.y,
          floor: heightOf(t.cellAt(target.x, target.y).level),
        },
        own,
        reduced: reducedMotion(),
        sounds: store.get().settings.sounds,
      },
      performance.now(),
    );
  }
  /** swings asked of this view (test hook, as in the flat view) */
  private swings = 0;

  private levelAtPx(x: number, y: number): number {
    return worldSession.terrain?.cellAt(Math.floor(x / CELL), Math.floor(y / CELL)).level ?? 0;
  }

  // ───────────────────────────────────────────── e2e handles
  private testApi(): ViewTestApi & WorldTestApi {
    return {
      engine: '2.5d',
      toClient: (x, y) => {
        const r = this.canvas.getBoundingClientRect();
        // the flat view's pixels (a raised top is drawn higher): the same ground, in 2.5D
        const w = worldOfDrawn(x, y, (cx, cy) => worldSession.terrain?.cellAt(cx, cy).level ?? 0);
        const p = project(this.cam, [w.x / TILE, w.height, w.y / TILE]);
        return p ? { x: r.left + p.x, y: r.top + p.y } : { x: r.left, y: r.top };
      },
      centerOn: (x, y) => {
        this.target = { x: x / TILE, z: y / TILE };
        this.following = false;
        this.cam.tx = this.target.x;
        this.cam.tz = this.target.z;
      },
      zoom: () => this.zoomNow,
      setZoom: (z) => {
        this.zoomNow = z;
        this.cam.dist = distForZoom(z, this.cam.h, FOV);
      },
      texts: (all = false) => this.overlays.texts(all),
      // no props, office blends or build preview inside a personal world (P16.13–14 hooks)
      propsCount: () => 0,
      propScreen: () => null,
      blendKeyAt: () => null,
      previewCells: () => 0,
      settled: () => this.win !== null && !this.dirtyAll,
      avatarFrame: (id) => this.people.info(id)?.frame ?? null,
      petsDrawn: () => 0,
      world: () => {
        const w = this.walker;
        const cell = { cx: Math.floor((w?.x ?? 0) / CELL), cy: Math.floor((w?.y ?? 0) / CELL) };
        const win = this.win;
        return {
          id: worldSession.worldId,
          x: Math.round(w?.x ?? 0),
          y: Math.round(w?.y ?? 0),
          level: worldSession.terrain?.cellAt(cell.cx, cell.cy).level ?? -1,
          cell,
          people: worldSession.people.size,
          cellsDrawn: win ? (win.x1 - win.x0 + 1) * (win.y1 - win.y0 + 1) : 0,
          plots: worldSession.plots.size,
          farmDay: worldSession.farmDay,
          path: w?.path.length ?? 0,
          swings: this.swings,
        };
      },
      levelAt: (cx, cy) => worldSession.terrain?.cellAt(cx, cy).level ?? -1,
      walkableAt: (cx, cy) => worldSession.terrain?.cellAt(cx, cy).walkable ?? false,
      // view-neutral, as in the flat view: the HUD's bag and the session's cells
      inventory: () => ({ ...worldHud.get().items }),
      cellInfo: (cx, cy) => {
        const c = worldSession.terrain?.cellAt(cx, cy);
        if (!c) return null;
        return {
          level: c.level,
          block: c.block,
          decor: c.decor,
          plot: worldSession.plots.get(`${cx},${cy}`) ?? null,
          farmDay: worldSession.farmDay,
        };
      },
    };
  }
}
