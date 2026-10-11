/**
 * The 2.5D world view (P16.6, ADR-052): a fixed-tilt Three.js camera over the region the player is
 * in. It implements the same `WorldView` seam as the flat Phaser scene (game/WorldScene.ts), so
 * `WorldController` decides movement and the view only draws it and turns pointer input into
 * `clickTo`. Visual only: nothing here changes the server, the protocol or the map maths.
 *
 * People and characters are paper cut-outs (P16.8, `paperFigures.ts`) with screen-space names,
 * status, emotes and bubbles (`overlays.ts`). Lights (P16.10) and blended tiles and animated
 * tiles (P16.12) are drawn, and placed props stand on their surfaces (P16.14). Build mode (P16.13,
 * `BuildMode3D.ts`) edits the region under its focus: while it is on, the focus follows the build
 * cursor and the camera stays in that region. Not yet: pets (checkpoint J).
 */
import * as THREE from 'three';
import {
  EMOTE_GLYPH,
  LAMP_COLORS,
  TILE,
  cellPos,
  mapReader,
  type Cell,
  type Emote,
  type S2CMsg,
} from '@agora/shared';
import { world } from '../net/client';
import { store, toast } from '../state/store';
import { COMPACT_QUERY, matches } from '../ui/layout';
import { zoomStep } from '../ui/Minimap';
import { AV_H } from '../game/avatars';
import { WorldController, rendered } from '../game/controller';
import { quebecHour } from '../game/lighting';
import { animatedTiles, tilesetCanvas } from '../game/tiles';
import { composeCell } from '../game/blend/source';
import { exposeTestApi, type ViewTestApi, type WorldView } from '../game/view';
import {
  FOV,
  TILT,
  camPos,
  clampTarget,
  distForZoom,
  dockPx,
  fitZoom,
  followStep,
  project,
  screenRay,
  unprojectFloor,
  type Cam,
  type Pt,
  type Rect,
} from './camera';
import { DEFAULT_SCENE, buildScene, regionTiles, type Face3D } from './scene';
import {
  buildRegionMesh,
  disposeTree,
  makeRegionAtlas,
  pixelTexture,
  scanExtents,
  type Atlas,
  type RegionAnim,
} from './meshes';
import { blendSlots, type BlendSlot } from './atlasMath';
import { Occlusion, FADE_ATTR } from './occlusion';
import { hits, occluderObjects, screenBox, type Subject } from './occlusionMath';
import { blobShadows } from './blobs';
import { bloomStrength } from './lightingMath';
import { LightRig, type LampSource } from './lightRig';
import { PostFx } from './postfx';
import { ALL_FEATURES, QualityGovernor, type QualityChange } from './tier';
import { PaperFigures, type FigureInfo } from './paperFigures';
import { paperScale } from './paperLayout';
import { Overlays } from './overlays';
import { BuildMode3D, type BuildHost } from './BuildMode3D';
import { BuildOverlay } from './buildOverlay';
import {
  floorPoint,
  pickNearest,
  prepare,
  type PickResult,
  type Prepared,
  type Ray,
} from './pick3d';
import { baseHeightPx, propFaces, propQuad, type PropFace } from './propFaces';
import { surfaceHeightPx, propTo3D } from './props3d';
import { propDef, resolveProps, surfaceTop, TILESET_COLUMNS, type WorldMap } from '@agora/shared';

/** Pan to a point, then follow again after this long (the 2D view's 500 ms pan and 2200 ms hold). */
const PAN_MS = 500;
const HOLD_MS = 2200;
const FADE_OUT_MS = 140;
const FADE_IN_MS = 240;
/** the controller's ~3 Hz work (the 2D cadence) */
const SLOW_MS = 300;
/** characters ease towards their server position like NpcsView (EASE 14/s, snap beyond 96 px) */
const NPC_EASE = 14;
const NPC_SNAP_PX = 96;
/** a click ends a drag beyond this many px (mouse) or this many px (touch), as WorldScene does */
const MOUSE_DRAG_PX = 6;
const TOUCH_DRAG_PX = 14;
const PINCH_LOW = 0.7;
const PINCH_HIGH = 1.4;
const BG = 0x1b2733;
const FADE_BG = 'rgb(10, 20, 30)';
const PORTRAIT_QUERY = '(orientation: portrait)';
/** the region of a cell, or null when no region holds it (the whole map is then drawn) */
function regionIdAt(map: WorldMap, cx: number, cy: number): string | null {
  const x = cx * TILE;
  const y = cy * TILE;
  return (
    map.regions.find((q) => x >= q.x && y >= q.y && x < q.x + q.w && y < q.y + q.h)?.id ?? null
  );
}
const cellKey = (c: { cx: number; cy: number }) => `${c.cx},${c.cy}`;
/** a face lying flat (every corner at one height): its height in tiles */
const flatHeight = (f: Face3D): number => (f.p.every((q) => q[1] === f.p[0][1]) ? f.p[0][1] : 0);

const reducedMotion = () =>
  window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;

/** The renderer's graphics card, as WebGL names it (the software renderers are told apart by it). */
function gpuName(renderer: THREE.WebGLRenderer): string {
  const gl = renderer.getContext();
  const ext = gl.getExtension('WEBGL_debug_renderer_info');
  const name = ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER);
  return String(name ?? '');
}

/** Tests fix the hour with `?hour=`; then nothing is decided from this device's speed (P16.11). */
const pinnedHour = () => new URLSearchParams(location.search).has('hour');

/** The Lighting setting, as the 2D view reads it (its config flag can switch it off too). */
const lightingOn = (s: ReturnType<typeof store.get>) =>
  s.settings.lighting && s.config?.flags.lighting !== false;

interface Pan {
  from: Pt;
  to: Pt;
  t0: number;
  dur: number;
  holdUntil: number;
}

interface Tap {
  id: number;
  x: number;
  y: number;
  touch: boolean;
  /** a drag cancels the click */
  moved: boolean;
}

export class World3DView implements WorldView {
  private renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private camera = new THREE.PerspectiveCamera(FOV, 1, 0.5, 200);
  /** the lights and shadows of the view (P16.10), and the post-processing: the quality rung sets them */
  private rig: LightRig;
  private post: PostFx | null = null;
  /** the device pixel ratio, capped at 2 (the render scale multiplies it) */
  private pr: number;
  /** the quality ladder (P16.11, ADR-054): the probe sets the tier, slow frames step the rung down */
  private gov: QualityGovernor;
  /** a test's forced frame rate (`view3d.forceFps`), read instead of the measured one */
  private fpsOverride: number | null = null;
  /** the desk lamps of this region, kept current with their pods at the slow tick */
  private deskLamps: { src: LampSource; deskId: string }[] = [];
  private ctl: WorldController;
  private cam: Cam = { tx: 0, tz: 0, tilt: TILT, dist: 10, fov: FOV, w: 1, h: 1 };
  /** the tileset, and its animated tiles: the region's atlas is made from them (P16.12) */
  private tileset: HTMLCanvasElement;
  private animTiles: ReturnType<typeof animatedTiles>;
  /** the texture of the region's atlas (rebuilt with the region) */
  private atlasTex: THREE.Texture | null = null;
  /** the frames of the region's animated tiles, moved on the mesh every frame */
  private anim: RegionAnim | null = null;
  /** composed blend variants by key (a key always composes to the same pixels) */
  private blendArt = new Map<string, Uint8ClampedArray>();
  private extents: ReturnType<typeof scanExtents>;

  private region: THREE.Group | null = null;
  private builtKey: string | null = null;
  private builtId: string | null = null;
  /** occlusion fades of the region's walls and tall plants (P16.9) */
  private occlusion: Occlusion | null = null;
  /** the mouse pointer over the canvas, canvas CSS px (null away; touch has no hover) */
  private pointer: { x: number; y: number } | null = null;

  private people: PaperFigures;
  private npcs: PaperFigures;
  private overlays: Overlays;
  private npcAt = new Map<string, { x: number; y: number }>();

  // ── build mode (P16.13) and props (P16.14)
  private build: BuildMode3D;
  private buildOverlay: BuildOverlay;
  /** build mode is on; its focus is the region the build cursor is in (null: no region) */
  private building = false;
  private focus: string | null = null;
  /** the region's atlas (kept for ghost art) and its faces, in mesh order */
  private atlas: Atlas | null = null;
  private regionFaces: Face3D[] = [];
  /** picking lists: the region's faces and the props' cards (nearest opaque hit wins) */
  private regionPrep: Prepared<Face3D>[] = [];
  private propPrep: Prepared<PropFace>[] = [];
  private propMesh: THREE.Object3D | null = null;
  private propCount = 0;
  /** props that step aside while a build preview shows them (their key, for the rebuild check) */
  private hiddenProps: ReadonlySet<string> | null = null;
  private hiddenKey = '';
  /** the tileset's pixels: a picked texel counts only when it is drawn (alpha ≥ 128) */
  private texels: Uint8ClampedArray;
  private texelsW: number;
  private texelsH: number;
  /** the store's map revision and generation the region was built at */
  private buildTag = '';
  /** the pointer that a build press started (its moves and release are the build's) */
  private buildPointer: number | null = null;

  private pathPoints: THREE.Points | null = null;
  private goalPoint: THREE.Points | null = null;
  private pointMat = new THREE.PointsMaterial({
    color: 0xf3f6f8,
    size: 4,
    sizeAttenuation: false,
    transparent: true,
    opacity: 0.55,
  });
  private goalMat = new THREE.PointsMaterial({
    color: 0xf3f6f8,
    size: 9,
    sizeAttenuation: false,
    transparent: true,
    opacity: 0.8,
  });

  private target: Pt | null = null;
  private snapped = false;
  private pan: Pan | null = null;
  private following = true;
  private zoomNow = 1;
  private lastFrame = 0;
  private lastSlow = Number.NEGATIVE_INFINITY;
  private raf = 0;
  private destroyed = false;

  private fade: HTMLDivElement;
  private fadeTimer = 0;
  private pts = new Map<number, { x: number; y: number; touch: boolean }>();
  private tap: Tap | null = null;
  private pinch: { d: number } | null = null;

  private unsubs: (() => void)[] = [];
  private ro: ResizeObserver | null = null;
  private mqs: MediaQueryList[] = [];

  constructor(private parent: HTMLElement) {
    const tileset = tilesetCanvas();
    this.tileset = tileset;
    this.animTiles = animatedTiles();
    this.extents = scanExtents(tileset);
    this.texelsW = tileset.width;
    this.texelsH = tileset.height;
    this.texels = tileset
      .getContext('2d', { willReadFrequently: true })!
      .getImageData(0, 0, tileset.width, tileset.height).data;

    this.renderer = new THREE.WebGLRenderer({ antialias: false });
    this.renderer.setClearColor(BG);
    parent.append(this.renderer.domElement);
    this.canvas.style.touchAction = 'none';

    this.pr = Math.min(window.devicePixelRatio || 1, 2);
    this.gov = new QualityGovernor({
      coarse: window.matchMedia?.('(pointer: coarse)').matches ?? false,
      gpu: gpuName(this.renderer),
      pinned: pinnedHour(),
      rung: store.get().qualityLevel,
      features: ALL_FEATURES,
    });
    this.rig = new LightRig(this.scene, this.renderer, this.gov.quality);
    this.applyQuality();

    this.fade = document.createElement('div');
    this.fade.setAttribute('aria-hidden', 'true');
    Object.assign(this.fade.style, {
      position: 'absolute',
      inset: '0',
      background: FADE_BG,
      opacity: '0',
      pointerEvents: 'none',
    });
    parent.append(this.fade);

    // figures share sheets at 1× or 2× by device pixel ratio (ADR-052 texture budget)
    const scale = paperScale(window.devicePixelRatio || 1);
    this.people = new PaperFigures(this.scene, scale);
    this.npcs = new PaperFigures(this.scene, scale);
    // after the canvas and the fade: the overlay goes between them
    this.overlays = new Overlays(parent);
    this.buildOverlay = new BuildOverlay(parent);
    this.build = new BuildMode3D(this.buildHost());

    this.ctl = new WorldController(this);
    this.unsubs.push(world.on((m) => this.onMessage(m)));

    this.bindInput();
    this.bindLayout();
    this.bindBuild();
    this.layout();
    exposeTestApi(this.testApi());
    const w = window as unknown as { __agora?: Record<string, unknown> };
    if (w.__agora)
      w.__agora.view3d = {
        builtRegion: () => this.builtId,
        figure: (id: string): FigureInfo | null => this.people.info(id) ?? this.npcs.info(id),
        faded: (): string[] => this.occlusion?.fadedKeys() ?? [],
        tier: () => this.gov.tier,
        rung: () => this.gov.rung,
        // the frame rate the ladder reads (null: the measured one): a test forces a slow view
        forceFps: (fps: number | null) => {
          this.fpsOverride = fps;
        },
        lighting: () => ({
          tier: this.gov.tier,
          rung: this.gov.rung,
          scale: this.gov.quality.scale,
          on: this.rig.lightingOn,
          lit: this.rig.lampsLit(),
          shadows: this.rig.shadowsOn(),
          post: !!this.post,
          day: this.rig.day,
        }),
      };
    this.raf = requestAnimationFrame(this.frame);
  }

  private get canvas(): HTMLCanvasElement {
    return this.renderer.domElement;
  }

  destroy() {
    if (this.destroyed) return;
    this.destroyed = true;
    cancelAnimationFrame(this.raf);
    window.clearTimeout(this.fadeTimer);
    this.unsubs.forEach((u) => u());
    this.unsubs = [];
    this.ro?.disconnect();
    this.mqs.forEach((mq) => mq.removeEventListener('change', this.onMediaChange));
    this.ctl.destroy();
    exposeTestApi(null);
    const w = window as unknown as { __agora?: Record<string, unknown> };
    if (w.__agora) delete w.__agora.view3d;

    this.clearRegion();
    this.rig.dispose();
    this.post?.dispose();
    this.people.dispose();
    this.npcs.dispose();
    this.overlays.destroy();
    this.build.destroy();
    this.buildOverlay.destroy();
    this.clearPath();
    this.pointMat.dispose();
    this.goalMat.dispose();
    this.renderer.dispose();
    this.renderer.forceContextLoss();
    this.canvas.remove();
    this.fade.remove();
  }

  // ───────────────────────────────────────────── layout (resize, compact, zoom)
  private bindLayout() {
    this.ro = new ResizeObserver(() => this.layout());
    this.ro.observe(this.parent);
    for (const q of [COMPACT_QUERY, PORTRAIT_QUERY]) {
      try {
        const mq = window.matchMedia(q);
        mq.addEventListener('change', this.onMediaChange);
        this.mqs.push(mq);
      } catch {
        // no media queries (very old engine): the parent's size still drives the layout
      }
    }
    let lastZoom = store.get().zoom;
    let lastTouch = store.get().config?.flags.touchControls;
    this.unsubs.push(
      store.subscribe(() => {
        const s = store.get();
        if (s.zoom !== lastZoom || s.config?.flags.touchControls !== lastTouch) {
          lastZoom = s.zoom;
          lastTouch = s.config?.flags.touchControls;
          this.layout();
        }
      }),
    );
  }

  private onMediaChange = () => this.layout();

  /**
   * The canvas fills the parent above the phone dock (ADR-035), and the zoom is the stored level
   * or the fit for that size. Zoom keeps its meaning: a tile at the target is 32 × zoom px.
   */
  private layout() {
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
    this.buildOverlay.place(
      this.canvas.offsetLeft,
      this.canvas.offsetTop,
      w,
      h,
      this.pr,
      this.building,
    );
    this.post?.setSize(w, h, this.pr * this.gov.quality.scale);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.zoomNow = s.zoom ?? fitZoom(w, h);
    Object.assign(this.cam, { w, h, dist: distForZoom(this.zoomNow, h, FOV) });
    if (this.target) this.target = clampTarget(this.target, this.regionRect(s), this.cam);
  }

  // ───────────────────────────────────────────── region (only mine is built)
  /** The region I am in (tiles), or the whole map when I am in none. */
  private currentRegion(s = store.get()): { id: string | null; tiles: Rect } {
    const map = s.map!;
    const id = this.building ? this.focus : s.myRegion;
    const r = id ? map.regions.find((q) => q.id === id) : undefined;
    const t = regionTiles(map, r);
    return { id: r?.id ?? null, tiles: { x: t.x, z: t.y, w: t.w, h: t.h } };
  }

  private regionRect(s = store.get()): Rect {
    return this.currentRegion(s).tiles;
  }

  /** Build the region I am in (the build focus while building); swap it when I walk or teleport. */
  private syncRegion(s: ReturnType<typeof store.get>) {
    // until my position is known, the region is not known either: do not build the whole map first
    if (!s.me || !rendered.has(s.me)) return;
    const { id } = this.currentRegion(s);
    const key = `${id ?? ''}|${s.mapGen}|${s.mapRev}`;
    if (key === this.builtKey) return;
    this.builtKey = key;
    this.clearRegion();
    const map = s.map!;
    const r = id ? map.regions.find((q) => q.id === id) : undefined;
    const tiles = regionTiles(map, r);
    const scene = buildScene(map, tiles, this.extents, DEFAULT_SCENE);
    const { slots } = blendSlots(scene.faces);
    const reader = mapReader(map);
    const atlas = makeRegionAtlas(this.tileset, this.animTiles, slots, (slot) =>
      this.blendPixels(reader, slot),
    );
    this.atlas = atlas;
    this.atlasTex = pixelTexture(atlas.canvas);
    const group = new THREE.Group();
    const built = buildRegionMesh(scene, atlas, this.atlasTex);
    const mesh = built.mesh;
    this.anim = built.anim;
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    group.add(mesh);
    this.scene.add(group);
    this.region = group;
    this.builtId = id ?? '';
    this.regionFaces = scene.faces;
    this.regionPrep = prepare(scene.faces);
    // face i of the scene is vertices 4i…4i+3 of the mesh, so the occluders index it directly
    const objs = occluderObjects(scene.faces);
    this.occlusion = new Occlusion(
      mesh.geometry.getAttribute(FADE_ATTR) as THREE.BufferAttribute,
      objs,
    );
    this.rig.setBlobs(blobShadows(objs));
    this.deskLamps = this.deskSources(s, map, id);
    const propLamps = this.rebuildProps(s, { x: tiles.x, z: tiles.y, w: tiles.w, h: tiles.h });
    this.rig.setLamps([
      ...scene.lights.map((l) => ({ x: l.x, y: l.y, z: l.z, kind: l.kind, biome: l.biome })),
      ...this.deskLamps.map((d) => d.src),
      ...propLamps,
    ]);
    this.buildTag = key;
    if (this.building) this.build.afterRebuild();
  }

  /**
   * The placed props of the region as cards (P16.14), replacing the last props mesh. Props of
   * other regions, and props a build preview shows elsewhere, are left out. Returns the lamps.
   */
  private rebuildProps(s: ReturnType<typeof store.get>, tiles: Rect): LampSource[] {
    if (this.propMesh) {
      this.region?.remove(this.propMesh);
      disposeTree(this.propMesh);
      this.propMesh = null;
    }
    const map = s.map!;
    const r = mapReader(map);
    const rest = resolveProps(r, map.props);
    const skip = new Set<string>(this.hiddenProps ?? []);
    const inside = (cx: number, cy: number) =>
      cx >= tiles.x && cy >= tiles.z && cx < tiles.x + tiles.w && cy < tiles.z + tiles.h;
    for (const p of map.props) {
      const c = { cx: Math.floor(p.x / TILE), cy: Math.floor(p.y / TILE) };
      if (!inside(c.cx, c.cy)) skip.add(p.id);
    }
    const faces = propFaces(map, map.props, rest, this.extents, skip);
    this.propPrep = prepare(faces);
    this.propCount = faces.length;
    const lamps: LampSource[] = [];
    map.props.forEach((p, i) => {
      if (skip.has(p.id)) return;
      const def = propDef(p.t);
      if (def?.light !== 'lamp') return;
      const [x, y, z] = propTo3D(p, rest[i]!, baseHeightPx(r, p, rest[i]!, this.extents));
      lamps.push({ x, y: y + 0.3, z, kind: 'lamp', biome: def.biome ?? 'hub' });
    });
    if (faces.length && this.atlas && this.atlasTex && this.region) {
      const built = buildRegionMesh(
        { faces, lights: [], x0: 0, z0: 0, w: 0, d: 0 },
        this.atlas,
        this.atlasTex,
      );
      built.mesh.castShadow = true;
      built.mesh.receiveShadow = true;
      this.region.add(built.mesh);
      this.propMesh = built.mesh;
    }
    return lamps;
  }

  /** The composed pixels of a blend slot, from the map (cached: a key always composes the same). */
  private blendPixels(reader: ReturnType<typeof mapReader>, slot: BlendSlot): Uint8ClampedArray {
    let px = this.blendArt.get(slot.key);
    if (!px) {
      px = composeCell(reader, slot.kind, slot.cx, slot.cy);
      this.blendArt.set(slot.key, px);
    }
    return px;
  }

  /** The desk lamps in this region: a lamp head per pod, lit by its desk's state (P9.16). */
  private deskSources(
    s: ReturnType<typeof store.get>,
    map: NonNullable<ReturnType<typeof store.get>['map']>,
    regionId: string | null,
  ): { src: LampSource; deskId: string }[] {
    const r = regionId ? map.regions.find((q) => q.id === regionId) : undefined;
    const t = regionTiles(map, r);
    const biome = r?.biome ?? 'hub';
    return map.desks
      .filter(
        (d) =>
          d.lamp.cx >= t.x && d.lamp.cy >= t.y && d.lamp.cx < t.x + t.w && d.lamp.cy < t.y + t.h,
      )
      .map((d) => {
        const desk = s.desks.find((x) => x.id === d.id);
        return {
          deskId: d.id,
          src: {
            x: d.lamp.cx + 0.69,
            y: 1.1,
            z: d.lamp.cy + 0.56,
            kind: 'desk' as const,
            biome,
            owned: !!desk?.ownerName,
            deskColor: LAMP_COLORS[desk?.decor.lamp ?? 0],
          },
        };
      });
  }

  private clearRegion() {
    this.occlusion = null;
    this.deskLamps = [];
    this.rig.setLamps([]);
    this.rig.setBlobs(null);
    this.anim = null;
    this.atlasTex?.dispose();
    this.atlasTex = null;
    this.atlas = null;
    this.regionFaces = [];
    this.regionPrep = [];
    this.propPrep = [];
    this.propMesh = null;
    this.propCount = 0;
    if (!this.region) return;
    this.scene.remove(this.region);
    disposeTree(this.region);
    this.region = null;
  }

  // ───────────────────────────────────────────── people and characters
  /** Screen point (CSS px inside the parent) of a world point in tiles, or null when behind me. */
  private toParent(pt: [number, number, number] | null): { x: number; y: number } | null {
    if (!pt) return null;
    const p = project(this.cam, pt);
    if (!p) return null;
    return { x: p.x + this.canvas.offsetLeft, y: p.y + this.canvas.offsetTop };
  }

  /** Nearby chat, emotes and characters' lines, as the 2D view shows them (WorldScene.onMessage). */
  private onMessage(m: S2CMsg) {
    const now = performance.now();
    const npcBubbles = store.get().settings.npcBubbles;
    if (m.t === 'emote') this.overlays.emote(m.id, EMOTE_GLYPH[m.emote as Emote], now);
    else if (m.t === 'npc:emote') this.overlays.emote(m.id, EMOTE_GLYPH[m.emote], now);
    else if (m.t === 'npc:say') {
      if (!npcBubbles) return;
      this.overlays.typing(m.id, false);
      this.overlays.say(m.id, m.body, now);
    } else if (m.t === 'npc:typing') this.overlays.typing(m.id, m.on && npcBubbles);
    else if (m.t === 'chat' && m.msg.scope === 'nearby')
      this.overlays.say(m.msg.from, m.msg.body, now);
  }

  // ───────────────────────────────────────────── path
  private clearPath() {
    for (const p of [this.pathPoints, this.goalPoint]) {
      if (!p) continue;
      this.scene.remove(p);
      p.geometry.dispose();
    }
    this.pathPoints = null;
    this.goalPoint = null;
  }

  private pointsAt(cells: readonly Cell[], mat: THREE.PointsMaterial): THREE.Points {
    const map = store.get().map!;
    const arr: number[] = [];
    for (const c of cells) {
      const p = cellPos(map, c);
      arr.push(p.x / TILE, 0.02, p.y / TILE);
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(arr, 3));
    const pts = new THREE.Points(geo, mat);
    this.scene.add(pts);
    return pts;
  }

  /** Dots on every other cell of the path and a ring at its end, as the 2D view draws them. */
  drawPath(path: readonly Cell[]) {
    this.clearPath();
    if (!path.length) return;
    this.pathPoints = this.pointsAt(
      path.filter((_, i) => i % 2 === 0),
      this.pointMat,
    );
    this.goalPoint = this.pointsAt([path[path.length - 1]!], this.goalMat);
  }

  // ───────────────────────────────────────────── camera
  /** Where the follow aims: my drawn feet, lifted by half an avatar as in 2D. */
  private meGoal(s: ReturnType<typeof store.get>): Pt | null {
    const me = rendered.get(s.me!);
    if (!me) return null;
    return { x: me.x / TILE, z: (me.y - AV_H / 2) / TILE };
  }

  private updateCamera(now: number, dtMs: number, s: ReturnType<typeof store.get>) {
    const rect = this.regionRect(s);
    const goal = this.meGoal(s);
    if (this.pan) {
      const p = this.pan;
      const t = p.dur > 0 ? Math.min(1, (now - p.t0) / p.dur) : 1;
      const e = -(Math.cos(Math.PI * t) - 1) / 2; // sine in-out
      this.target = clampTarget(
        { x: p.from.x + (p.to.x - p.from.x) * e, z: p.from.z + (p.to.z - p.from.z) * e },
        rect,
        this.cam,
      );
      if (now >= p.holdUntil) {
        this.pan = null;
        this.following = true;
      }
    } else if (goal) {
      if (!this.snapped || !this.target) {
        this.target = clampTarget(goal, rect, this.cam);
        this.snapped = true;
      } else if (this.following) {
        this.target = followStep(this.target, clampTarget(goal, rect, this.cam), dtMs);
      }
    }
    if (!this.target) this.target = { x: rect.x + rect.w / 2, z: rect.z + rect.h / 2 };
    // build mode does not follow me: the camera stays in the region the build cursor is in
    if (this.building) this.target = clampTarget(this.target, rect, this.cam);
    this.cam.tx = this.target.x;
    this.cam.tz = this.target.z;
    const [x, y, z] = camPos(this.cam);
    this.camera.position.set(x, y, z);
    this.camera.lookAt(this.cam.tx, 0, this.cam.tz);
  }

  // ───────────────────────────────────────────── frame
  private frame = () => {
    this.raf = requestAnimationFrame(this.frame);
    if (document.hidden) return;
    const s = store.get();
    if (!s.map || !s.me) return;
    const now = performance.now();
    const dtMs = this.lastFrame ? now - this.lastFrame : 16;
    this.lastFrame = now;
    this.watchQuality(now);

    this.ctl.step(now, dtMs);
    const avatars = this.ctl.avatars(now);
    if (now - this.lastSlow > SLOW_MS) {
      this.lastSlow = now;
      this.ctl.slowTick();
      this.lightsSlow(s);
    }
    this.syncRegion(s);

    const drawn = new Set<string>();
    for (const a of avatars) {
      const p = s.profiles[a.id];
      if (!p) continue;
      drawn.add(a.id);
      this.people.place(a.id, p.avatar, a, now);
      this.people.setAlpha(a.id, !p.online ? 0.35 : p.status === 'away' ? 0.6 : 1);
      const speaking = a.id === s.me ? s.speakingSelf : !!s.remote[a.id]?.speaking;
      this.people.setSpeaking(a.id, speaking);
    }
    this.people.keep(drawn);

    this.placeNpcs(s, dtMs, now);

    // the camera moves first, so names sit on this frame's heads
    this.updateCamera(now, dtMs, s);
    this.camera.updateMatrixWorld();
    const shown = new Set<string>();
    for (const id of drawn) {
      const p = s.profiles[id]!;
      shown.add(id);
      this.overlays.sync(
        id,
        { name: p.name, status: p.status, online: p.online, hand: !!p.hand },
        this.toParent(this.people.headPoint(id)),
        now,
      );
    }
    for (const n of s.npcs) {
      shown.add(n.id);
      this.overlays.sync(
        n.id,
        { name: n.name, bot: true, online: true, hand: false },
        this.toParent(this.npcs.headPoint(n.id)),
        now,
      );
    }
    this.overlays.keep(shown);
    this.occlude(s, drawn, dtMs);
    if (this.building) this.build.update();
    this.anim?.tick(now, reducedMotion());
    this.rig.frame(now, reducedMotion());
    // the post-processing is part of the lit look: with Lighting off it is skipped too
    if (this.post && lightingOn(s)) this.post.render(bloomStrength(this.rig.day));
    else this.renderer.render(this.scene, this.camera);
  };

  /**
   * The quality ladder (P16.11, ADR-054): the probe sets the tier after 3 s of frames, and 15 s in a
   * row under 20 fps steps the look down one rung. The governor decides; this applies the change.
   */
  private watchQuality(now: number) {
    const change = this.gov.frame(now, this.fpsOverride);
    if (change) this.onQuality(change);
  }

  /**
   * A new rung or tier: the render scale, the post-processing and the lights follow it, and the
   * session keeps the rung (a remount starts there). The first step down says so, once.
   */
  private onQuality(c: QualityChange) {
    store.set({ qualityLevel: c.rung });
    this.applyQuality();
    this.layout();
    if (c.dropped) toast('toast.qualityLower', undefined, 9000);
  }

  /** The quality rung's look: the render scale, the post-processing (created or disposed) and the lights. */
  private applyQuality() {
    const q = this.gov.quality;
    this.renderer.setPixelRatio(this.pr * q.scale);
    this.rig.setQuality(q);
    if (q.post && !this.post)
      this.post = new PostFx(
        this.renderer,
        this.scene,
        this.camera,
        this.cam.w,
        this.cam.h,
        this.pr * q.scale,
      );
    else if (!q.post && this.post) {
      this.post.dispose();
      this.post = null;
    }
  }

  /** Lighting at about 3 Hz: the Québec hour, the Lighting setting and the rung, the desks' lamps (P16.10). */
  private lightsSlow(s: ReturnType<typeof store.get>) {
    for (const d of this.deskLamps) {
      const desk = s.desks.find((x) => x.id === d.deskId);
      d.src.owned = !!desk?.ownerName;
      d.src.deskColor = LAMP_COLORS[desk?.decor.lamp ?? 0];
    }
    this.rig.refresh(quebecHour(), lightingOn(s) && this.gov.quality.lights, {
      x: this.cam.tx,
      z: this.cam.tz,
    });
  }

  /**
   * Walls and tall plants between the camera and me, or the person under the pointer, fade
   * (P16.9). The hovered person is the nearest figure on screen under the mouse.
   */
  private occlude(s: ReturnType<typeof store.get>, drawn: Set<string>, dtMs: number) {
    if (!this.occlusion) return;
    const subjects: Subject[] = [];
    const mine = s.me ? screenBox(this.cam, this.people.box(s.me)) : null;
    if (mine) subjects.push(mine);
    const under = this.pointer ? this.figureUnder(this.pointer, drawn, s) : null;
    if (under) subjects.push(under);
    this.occlusion.update(this.cam, subjects, dtMs, reducedMotion());
  }

  /** The nearest person or character whose body is under the pointer (canvas px), if any. */
  private figureUnder(
    p: { x: number; y: number },
    drawn: Set<string>,
    s: ReturnType<typeof store.get>,
  ): Subject | null {
    const boxes = [
      ...[...drawn].map((id) => this.people.box(id)),
      ...s.npcs.map((n) => this.npcs.box(n.id)),
    ];
    let best: Subject | null = null;
    for (const b of boxes) {
      const seen = screenBox(this.cam, b);
      if (seen && hits(seen.box, p.x, p.y) && (!best || seen.depth < best.depth)) best = seen;
    }
    return best;
  }

  private placeNpcs(s: ReturnType<typeof store.get>, dtMs: number, now: number) {
    const k = Math.min(1, (dtMs / 1000) * NPC_EASE);
    const keep = new Set<string>();
    for (const n of s.npcs) {
      keep.add(n.id);
      const at = this.npcAt.get(n.id);
      if (!at || Math.hypot(n.x - at.x, n.y - at.y) > NPC_SNAP_PX)
        this.npcAt.set(n.id, { x: n.x, y: n.y });
      else {
        at.x += (n.x - at.x) * k;
        at.y += (n.y - at.y) * k;
      }
      const pos = this.npcAt.get(n.id)!;
      this.npcs.place(
        n.id,
        n.avatar,
        {
          x: pos.x,
          y: pos.y,
          dir: n.d,
          moving: n.m,
          pose: n.p === 'sit' ? 'sit' : 'stand',
          poseAt: 0,
        },
        now,
      );
    }
    this.npcs.keep(keep);
    for (const id of [...this.npcAt.keys()]) if (!keep.has(id)) this.npcAt.delete(id);
  }

  // ───────────────────────────────────────────── input
  private touches() {
    return [...this.pts.entries()].filter(([, p]) => p.touch).map(([, p]) => p);
  }

  private bindInput() {
    const c = this.canvas;
    const spread = (a: { x: number; y: number }, b: { x: number; y: number }) =>
      Math.max(1, Math.hypot(a.x - b.x, a.y - b.y));
    const onHover = (e: PointerEvent) => {
      if (e.pointerType !== 'mouse') return;
      const r = c.getBoundingClientRect();
      this.pointer = { x: e.clientX - r.left, y: e.clientY - r.top };
    };
    const onLeave = () => {
      this.pointer = null;
    };
    const local = (e: PointerEvent) => {
      const r = c.getBoundingClientRect();
      return { x: e.clientX - r.left, y: e.clientY - r.top };
    };
    const onDown = (e: PointerEvent) => {
      const touch = e.pointerType === 'touch';
      this.pts.set(e.pointerId, { x: e.clientX, y: e.clientY, touch });
      if (touch && this.touches().length >= 2) {
        this.tap = null;
        this.pinch = { d: spread(this.touches()[0]!, this.touches()[1]!) };
        if (this.buildPointer !== null) this.endBuildPress();
        return;
      }
      if (this.building) {
        // build mode acts at the press (a stroke or a drag follows), not at the release
        this.tap = null;
        this.buildPointer = e.pointerId;
        (document.activeElement as HTMLElement | null)?.blur?.();
        const at = local(e);
        this.build.pointerDown(at.x, at.y, e.button, e.altKey);
        return;
      }
      if (touch) {
        this.tap = { id: e.pointerId, x: e.clientX, y: e.clientY, touch, moved: false };
        return;
      }
      if (e.button !== 0) return;
      this.tap = { id: e.pointerId, x: e.clientX, y: e.clientY, touch, moved: false };
      (document.activeElement as HTMLElement | null)?.blur?.();
    };
    const onMove = (e: PointerEvent) => {
      const p = this.pts.get(e.pointerId);
      if (p) {
        p.x = e.clientX;
        p.y = e.clientY;
      }
      // build mode: the cursor follows every move (a hover too), and a press drags
      if (this.building && !this.pinch && (!p || !p.touch || this.touches().length < 2)) {
        const at = local(e);
        this.build.pointerMove(at.x, at.y, e.altKey);
        return;
      }
      if (!p) return;
      if (this.pinch) {
        const t = this.touches();
        if (t.length < 2) return;
        const r = spread(t[0]!, t[1]!) / this.pinch.d;
        if (r > PINCH_HIGH || r < PINCH_LOW) {
          zoomStep(r > 1 ? 1 : -1);
          this.pinch.d = spread(t[0]!, t[1]!);
        }
      } else if (this.tap && this.tap.id === e.pointerId) {
        const limit = this.tap.touch ? TOUCH_DRAG_PX : MOUSE_DRAG_PX;
        if (Math.hypot(e.clientX - this.tap.x, e.clientY - this.tap.y) > limit)
          this.tap.moved = true;
      }
    };
    const onUp = (e: PointerEvent) => {
      if (this.buildPointer === e.pointerId) this.endBuildPress();
      const tap = this.tap;
      if (tap && tap.id === e.pointerId && !tap.moved && !this.pinch) {
        if (tap.touch) (document.activeElement as HTMLElement | null)?.blur?.();
        this.pick(e.clientX, e.clientY);
      }
      if (tap?.id === e.pointerId) this.tap = null;
      this.pts.delete(e.pointerId);
      if (this.touches().length < 2) this.pinch = null;
    };
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      zoomStep(e.deltaY > 0 ? -1 : 1);
    };
    const onMenu = (e: Event) => e.preventDefault();
    c.addEventListener('pointerdown', onDown);
    c.addEventListener('pointermove', onMove);
    c.addEventListener('pointerup', onUp);
    c.addEventListener('pointercancel', onUp);
    c.addEventListener('wheel', onWheel, { passive: false });
    c.addEventListener('pointermove', onHover);
    c.addEventListener('pointerleave', onLeave);
    c.addEventListener('contextmenu', onMenu);
    this.unsubs.push(() => {
      c.removeEventListener('contextmenu', onMenu);
      c.removeEventListener('pointerdown', onDown);
      c.removeEventListener('pointermove', onMove);
      c.removeEventListener('pointerup', onUp);
      c.removeEventListener('pointercancel', onUp);
      c.removeEventListener('wheel', onWheel);
      c.removeEventListener('pointermove', onHover);
      c.removeEventListener('pointerleave', onLeave);
    });
  }

  /** A build press or release ended (its stroke, drag or stretch is finished). */
  private endBuildPress() {
    this.buildPointer = null;
    this.build.pointerUp();
  }

  /** A click on the floor (client px) → a world point → the controller's click-to-move. */
  private pick(clientX: number, clientY: number) {
    const r = this.canvas.getBoundingClientRect();
    const p = unprojectFloor(this.cam, clientX - r.left, clientY - r.top);
    if (!p) return;
    const rect = this.regionRect();
    if (p.x < rect.x || p.z < rect.z || p.x > rect.x + rect.w || p.z > rect.z + rect.h) return;
    this.ctl.clickTo(p.x * TILE, p.z * TILE);
  }

  // ───────────────────────────────────────────── build mode (P16.13, P16.14)
  /** Build mode follows the store: on (enter, or the options changed) and off (exit). */
  private bindBuild() {
    let lastBuild = store.get().build;
    this.unsubs.push(
      store.subscribe(() => {
        const st = store.get();
        if (st.build === lastBuild) return;
        const was = !!lastBuild;
        lastBuild = st.build;
        this.onBuildChange(was, !!st.build);
      }),
    );
    if (store.get().build) this.onBuildChange(false, true);
  }

  private onBuildChange(was: boolean, on: boolean) {
    if (on && !was) {
      const s = store.get();
      this.building = true;
      this.focus = s.myRegion ?? null;
      this.following = false;
      this.ctl.enterBuild();
      this.buildOverlay.place(
        this.canvas.offsetLeft,
        this.canvas.offsetTop,
        this.cam.w,
        this.cam.h,
        this.pr,
        true,
      );
      this.build.enter();
    } else if (!on && was) {
      this.build.exit();
      this.building = false;
      this.focus = null;
      this.followMe();
      this.buildOverlay.place(
        this.canvas.offsetLeft,
        this.canvas.offsetTop,
        this.cam.w,
        this.cam.h,
        this.pr,
        false,
      );
    } else if (on) this.build.refresh();
  }

  /** The build cursor's region becomes the focus, so the camera and the faces follow it. */
  private focusCell(c: { cx: number; cy: number }) {
    const map = store.get().map;
    if (!map) return;
    const id = regionIdAt(map, c.cx, c.cy);
    if (id !== this.focus) this.focus = id;
  }

  /** What build mode needs of this view: the picks, the camera, the faces and the art. */
  private buildHost(): BuildHost {
    return {
      scene: this.scene,
      // the camera object is updated in place (tx, tz, w, h), so the host keeps this reference
      cam: this.cam,
      ext: this.extents,
      art: () => (this.atlas && this.atlasTex ? { atlas: this.atlas, tex: this.atlasTex } : null),
      pick: (sx, sy, skip) => this.pickAt(sx, sy, skip),
      floorAt: (sx, sy) => unprojectFloor(this.cam, sx, sy),
      focus: (c, center) => {
        this.focusCell(c);
        if (center)
          this.target = clampTarget({ x: c.cx + 0.5, z: c.cy + 0.5 }, this.regionRect(), this.cam);
      },
      moveTarget: (x, z) => {
        this.following = false;
        this.pan = null;
        this.focusCell({ cx: Math.floor(x), cy: Math.floor(z) });
        this.target = clampTarget({ x, z }, this.regionRect(), this.cam);
      },
      target: () => this.target ?? { x: this.cam.tx, z: this.cam.tz },
      hideCells: (cells) => this.hideCells(cells),
      hideProps: (ids) => this.setHiddenProps(ids),
      region: () => this.regionRect(),
      regions: () =>
        (store.get().map?.regions ?? []).map((r) => ({
          x: r.x / TILE,
          z: r.y / TILE,
          w: r.w / TILE,
          h: r.h / TILE,
        })),
      screen: (p) => {
        const q = project(this.cam, p);
        return q ? { x: q.x, y: q.y } : null;
      },
      overlay: this.buildOverlay,
    };
  }

  /**
   * What is drawn under a screen point (canvas CSS px): the nearest opaque face of the region or a
   * prop card, else the floor (BuildMode3D's pick). The point is `aim`-ed by the caller.
   */
  private pickAt(sx: number, sy: number, skip?: ReadonlySet<string>): PickResult | null {
    const ray: Ray = screenRay(this.cam, sx, sy);
    const op = (tile: number, u: number, v: number) => this.drawnTexel(tile, u, v);
    const a = pickNearest(this.regionPrep, ray, op);
    // a prop is hit anywhere in its card (the box of its art), as the flat view hits it (propsView.hit)
    const b = pickNearest(
      this.propPrep,
      ray,
      () => true,
      (f) => !skip?.has(f.prop),
    );
    const hit = !b || (a && a.t <= b.t) ? a : b;
    if (hit) {
      const f = hit.item;
      const prop = (f as Partial<PropFace>).prop ?? null;
      return {
        cell: { cx: f.cx, cy: f.cy },
        p: hit.p,
        top: flatHeight(f),
        prop,
      };
    }
    const fl = floorPoint(ray);
    if (!fl) return null;
    return {
      cell: { cx: Math.floor(fl.x), cy: Math.floor(fl.z) },
      p: [fl.x, 0, fl.z],
      top: 0,
      prop: null,
    };
  }

  /** Is this texel of the tileset drawn (alpha ≥ 128)? Outside the sheet it is not. */
  private drawnTexel(tile: number, u: number, v: number): boolean {
    const x = (tile % TILESET_COLUMNS) * 32 + u;
    const y = Math.floor(tile / TILESET_COLUMNS) * 32 + v;
    if (x < 0 || y < 0 || x >= this.texelsW || y >= this.texelsH) return false;
    return this.texels[(y * this.texelsW + x) * 4 + 3]! >= 128;
  }

  /** Live faces of these cells step aside while a preview replaces them (null: they return). */
  private hideCells(cells: readonly { cx: number; cy: number }[] | null) {
    if (!this.occlusion) return;
    if (!cells) return this.occlusion.setHidden(null);
    const keys = new Set(cells.map(cellKey));
    const idx: number[] = [];
    this.regionFaces.forEach((f, i) => {
      if (keys.has(`${f.cx},${f.cy}`)) idx.push(i);
    });
    this.occlusion.setHidden(idx);
  }

  /** Props that step aside (a move's preview); the props mesh is rebuilt only when they change. */
  private setHiddenProps(ids: ReadonlySet<string> | null) {
    const key = ids ? [...ids].sort().join(',') : '';
    if (key === this.hiddenKey) return;
    this.hiddenKey = key;
    this.hiddenProps = ids && ids.size ? new Set(ids) : null;
    if (this.region) this.rebuildProps(store.get(), this.regionRect());
  }

  /** Surface height (px) under a 2D point: its top when it lies on a desk, else the floor. */
  private surfaceAt(x: number, y: number): number {
    const map = store.get().map;
    if (!map) return 0;
    const r = mapReader(map);
    if (!surfaceTop(r, x, y)) return 0;
    return surfaceHeightPx(r, Math.floor(x / TILE), Math.floor(y / TILE), this.extents);
  }

  /** Page point at the middle of a prop card's drawn sprite (test read-out). */
  private propScreen(id: string): { x: number; y: number } | null {
    const map = store.get().map;
    if (!map) return null;
    const i = map.props.findIndex((p) => p.id === id);
    if (i < 0) return null;
    const rest = resolveProps(mapReader(map), map.props);
    const quad = propQuad(map, map.props[i]!, rest[i]!, this.extents);
    if (!quad) return null;
    const pts = quad.map((q) => this.screen(q));
    if (pts.some((q) => !q)) return null;
    const r = this.canvas.getBoundingClientRect();
    const sx = pts.reduce((s, q) => s + q!.x, 0) / 4;
    const sy = pts.reduce((s, q) => s + q!.y, 0) / 4;
    return { x: r.left + sx, y: r.top + sy };
  }

  private screen(p: [number, number, number]): { x: number; y: number } | null {
    const q = project(this.cam, p);
    return q ? { x: q.x, y: q.y } : null;
  }

  // ───────────────────────────────────────────── WorldView (P16.3 seam)
  get buildActive(): boolean {
    return this.building && this.build.active;
  }

  followMe() {
    this.following = true;
    this.pan = null;
  }

  panTo(x: number, y: number) {
    const now = performance.now();
    const to = clampTarget({ x: x / TILE, z: (y - AV_H / 2) / TILE }, this.regionRect(), this.cam);
    this.pan = {
      from: this.target ?? to,
      to,
      t0: now,
      dur: reducedMotion() ? 0 : PAN_MS,
      holdUntil: now + HOLD_MS,
    };
    this.following = false;
  }

  teleport(land: () => void) {
    if (reducedMotion()) return land();
    window.clearTimeout(this.fadeTimer);
    this.fade.style.transition = `opacity ${FADE_OUT_MS}ms linear`;
    this.fade.style.opacity = '1';
    this.fadeTimer = window.setTimeout(() => {
      land();
      this.fade.style.transition = `opacity ${FADE_IN_MS}ms linear`;
      this.fade.style.opacity = '0';
    }, FADE_OUT_MS);
  }

  npcPosition(id: string): { x: number; y: number } | undefined {
    return this.npcAt.get(id);
  }

  /** e2e handles (`window.__agora.view`), the same contract as the 2D view. */
  private testApi(): ViewTestApi {
    return {
      engine: '2.5d',
      // where a 2D point is drawn: on its desk's top when it lies on one, else on the floor
      toClient: (x, y) => {
        const r = this.canvas.getBoundingClientRect();
        const h = this.surfaceAt(x, y);
        const p = project(this.cam, [x / TILE, h / TILE, (y + h) / TILE]);
        return p ? { x: r.left + p.x, y: r.top + p.y } : { x: Number.NaN, y: Number.NaN };
      },
      centerOn: (x, y) => {
        const c = { cx: Math.floor(x / TILE), cy: Math.floor(y / TILE) };
        if (this.building) this.focusCell(c);
        this.target = clampTarget({ x: x / TILE, z: y / TILE }, this.regionRect(), this.cam);
      },
      zoom: () => this.zoomNow,
      setZoom: (z) => store.set({ zoom: z }),
      texts: (all = false) => this.overlays.texts(all),
      propsCount: () => this.propCount,
      propScreen: (id) => this.propScreen(id),
      blendKeyAt: (cx, cy) =>
        this.regionFaces.find((f) => f.cx === cx && f.cy === cy && f.blend?.startsWith('f|'))
          ?.blend ?? null,
      previewCells: () => this.build.previewCells(),
      settled: () => this.builtKey !== null,
      avatarFrame: (id) => this.people.info(id)?.frame ?? null,
      // pets at checkpoint J
      petsDrawn: () => 0,
    };
  }
}
