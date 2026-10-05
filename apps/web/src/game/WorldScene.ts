import Phaser from 'phaser';
import {
  EMOTE_GLYPH,
  EMOTE_MS,
  INTERP_MS,
  POSTERS,
  SPEED_PX,
  TILE,
  TILESET_COLUMNS,
  TILESET_NAME,
  TILE_DEFS,
  avatarKey,
  cellOf,
  cellPos,
  chairAt,
  deskSpotAt,
  distTiles,
  distToPod,
  podAllows,
  regionAt,
  stepMove,
  zoneAt,
  type Avatar,
  type Dir,
  type Emote,
  type S2CMsg,
} from '@agora/shared';
import i18n from '../i18n';
import { world } from '../net/client';
import { saveSettings, store, toast } from '../state/store';
import { inputVector, isTyping } from './input';
import { COMPACT_QUERY, matches } from '../ui/layout';
import {
  AV_FRAMES,
  AV_H,
  AV_W,
  DECOR_H,
  DECOR_W,
  DIR_ROW,
  makeAvatarCanvas,
  makeDecorCanvas,
  makeGlowCanvas,
} from './avatars';
import {
  LIGHTMAP_SCALE,
  bakeVisibility,
  collectLights,
  composite,
  quebecHour,
  timeOfDay,
  type Light,
} from './lighting';
import { Navigator } from './nav';
import { TileAnimator } from './anim';
import { makeChairBackCanvas, tilesetCanvas } from './tiles';
import { BuildMode } from './BuildMode';
import { BlendLayers } from './blend/BlendLayers';
import { PropsView } from './blend/PropsView';

const STATUS_COLOR: Record<string, number> = {
  available: 0x2f7d5b,
  busy: 0xf2a900,
  dnd: 0xc2364b,
  away: 0x9aa6b1,
};
const WALK_SEQ = [1, 0, 3, 2];
/** Height the phone dock covers at the bottom of the screen (styles.css `--dock-space`). */
const DOCK_PX = 72;
const POSE_MS = 160;
const D_OVERLAY = 100000;
const D_LIGHT = 99000;
const D_GLOW = 99500;
const D_ABOVE = 98000;
const reducedMotion = () =>
  window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;

interface AvatarView {
  body: Phaser.GameObjects.Container;
  sprite: Phaser.GameObjects.Sprite;
  ring: Phaser.GameObjects.Arc;
  over: Phaser.GameObjects.Container;
  label: Phaser.GameObjects.Text;
  dot: Phaser.GameObjects.Arc;
  emote: Phaser.GameObjects.Text;
  bubble: Phaser.GameObjects.Text;
  chairBack: Phaser.GameObjects.Image;
  texKey: string;
  emoteUntil: number;
  bubbleUntil: number;
  pose: 'stand' | 'sit';
  poseAt: number;
  x: number;
  y: number;
}

interface DeskView {
  plant: Phaser.GameObjects.Image;
  lamp: Phaser.GameObjects.Image;
  poster: Phaser.GameObjects.Image;
  plate: Phaser.GameObjects.Text;
}

/** Latest rendered positions, read by the media manager, minimap and HUD. */
export const rendered = new Map<string, { x: number; y: number }>();

export class WorldScene extends Phaser.Scene {
  private views = new Map<string, AvatarView>();
  private me = {
    x: 0,
    y: 0,
    dir: 'up' as Dir,
    moving: false,
    pose: 'stand' as 'stand' | 'sit',
    poseAt: 0,
    standUntil: 0,
    idleSince: 0,
    suppressSit: false,
    ready: false,
  };
  private unsub: (() => void)[] = [];
  private lastSlow = 0;
  private lastZoneId: string | null | undefined = undefined;
  private following = true;
  private lastFrame = 0;
  private nav!: Navigator;
  private pathGfx!: Phaser.GameObjects.Graphics;
  private deskViews = new Map<string, DeskView>();
  private texts: Phaser.GameObjects.Text[] = [];
  private lightSources: Light[] = [];
  private lightCanvas: HTMLCanvasElement | null = null;
  private lightImage: Phaser.GameObjects.Image | null = null;
  private anim?: TileAnimator;
  private glows: { img: Phaser.GameObjects.Image; light: Light; base: number; seed: number }[] = [];
  private lastBakeKey = '';
  private teleporting = false;
  private fpsCheckAt = 0;
  private lowFps = 0;
  private build!: BuildMode;
  /** blended tiles (ADR-037), when the `blendTiles` flag is on */
  blend: BlendLayers | null = null;
  propsView!: PropsView;
  private baseLayers!: Record<'floor' | 'furniture', Phaser.Tilemaps.TilemapLayer | null>;
  private deskGfx!: Phaser.GameObjects.Graphics;
  private relightTimer?: Phaser.Time.TimerEvent;

  constructor() {
    super('world');
  }

  // ───────────────────────────────────────────── setup
  create() {
    const tmj = world.tmj!;
    const s = store.get();
    const map = s.map!;
    if (!this.textures.exists(TILESET_NAME)) {
      const t = this.textures.addCanvas(TILESET_NAME, tilesetCanvas())!;
      // one frame per tile for the build mode cursor preview
      const cols = TILESET_COLUMNS;
      for (let i = 0; i < TILE_DEFS.length; i++)
        t.add(String(i), 0, (i % cols) * TILE, Math.floor(i / cols) * TILE, TILE, TILE);
    }
    if (!this.textures.exists('decor')) {
      const t = this.textures.addCanvas('decor', makeDecorCanvas())!;
      for (let row = 0; row < 3; row++)
        for (let col = 0; col < 6; col++)
          t.add(`${row}-${col}`, 0, col * DECOR_W, row * DECOR_H, DECOR_W, DECOR_H);
    }
    if (!this.textures.exists('glow')) this.textures.addCanvas('glow', makeGlowCanvas());
    if (!this.textures.exists('chairback'))
      this.textures.addCanvas('chairback', makeChairBackCanvas());
    this.cache.tilemap.add('hq', { format: Phaser.Tilemaps.Formats.TILED_JSON, data: tmj });
    const tm = this.make.tilemap({ key: 'hq' });
    const ts = tm.addTilesetImage(TILESET_NAME, TILESET_NAME)!;
    const mk = (name: string, depth: number) =>
      (tm.createLayer(name, ts, 0, 0) as Phaser.Tilemaps.TilemapLayer | null)?.setDepth(depth) ??
      null;
    const layers = {
      floor: mk('floor', -3000),
      walls: mk('walls', -2000),
      furniture: mk('furniture', -1000),
      // props (P9.11) are y-sorted images (PropsView), not a tilemap layer
      props: null,
      above: mk('above', D_ABOVE),
    };
    this.baseLayers = layers;
    // Desk pods are open on every side; their outline shows the pod and its access.
    this.deskGfx = this.add.graphics().setDepth(-2500);
    this.build = new BuildMode(this, layers, () => this.blend);
    this.anim = new TileAnimator(this, layers, map);
    this.setBlend(s.config?.flags.blendTiles === true);
    this.propsView = new PropsView(
      this,
      () => store.get().map!,
      () => !!this.blend,
    );
    const teardown = () => {
      this.build.destroy();
      this.blend?.destroy();
      this.blend = null;
      this.propsView.destroy();
    };
    this.events.once('shutdown', teardown);
    this.events.once('destroy', teardown);

    // Map labels (teleporter signs)
    for (const o of tmj.layers.find((l) => l.name === 'labels')?.objects ?? []) {
      const p = Object.fromEntries((o.properties ?? []).map((q) => [q.name, q.value])) as {
        fr: string;
        en: string;
      };
      const t = this.add
        .text(o.x, o.y, '', {
          fontFamily: 'Atkinson Hyperlegible, sans-serif',
          fontStyle: 'bold',
          color: '#F3F6F8',
        })
        .setOrigin(0.5, 1)
        .setDepth(D_OVERLAY - 10)
        .setData('fr', p.fr)
        .setData('en', p.en);
      this.texts.push(t);
    }
    this.buildDesks();

    this.pathGfx = this.add.graphics().setDepth(D_ABOVE - 1);
    this.nav = new Navigator(
      map,
      (x, y) => this.blocked(x, y),
      (to) => world.send({ t: 'teleport', to }),
    );

    const cam = this.cameras.main;
    cam.setBackgroundColor('#1b2733');
    cam.setRoundPixels(true);
    this.fitZoom();
    this.scale.on('resize', () => this.fitZoom());

    // Pointer: click to move (or sit), wheel to zoom; build mode takes over when on.
    // Touch (P8.2): a tap moves on release, so a drag or a two-finger pinch never walks;
    // pinching steps the zoom.
    this.input.mouse?.disableContextMenu();
    this.input.addPointer(1);
    const touches = () => this.input.manager.pointers.filter((q) => q.isDown && q.wasTouch);
    const spread = (a: Phaser.Input.Pointer, b: Phaser.Input.Pointer) =>
      Math.hypot(a.x - b.x, a.y - b.y);
    let tap: { id: number; x: number; y: number } | null = null;
    let pinch: { d: number } | null = null;
    this.input.on('pointerdown', (p: Phaser.Input.Pointer) => {
      if (this.build.active) return this.build.pointerDown(p);
      if (p.wasTouch) {
        const t = touches();
        if (t.length >= 2) {
          tap = null;
          pinch = { d: Math.max(1, spread(t[0]!, t[1]!)) };
        } else tap = { id: p.id, x: p.x, y: p.y };
        return;
      }
      if (p.button !== 0) return;
      (document.activeElement as HTMLElement | null)?.blur?.();
      this.clickTo(p.worldX, p.worldY);
    });
    this.input.on('pointermove', (p: Phaser.Input.Pointer) => {
      if (this.build.active) return this.build.pointerMove(p);
      if (pinch) {
        const t = touches();
        if (t.length < 2) return;
        const r = spread(t[0]!, t[1]!) / pinch.d;
        if (r > 1.4 || r < 0.7) {
          this.stepZoom(r > 1 ? 1 : -1);
          pinch.d = Math.max(1, spread(t[0]!, t[1]!));
        }
      } else if (tap && p.id === tap.id && Math.hypot(p.x - tap.x, p.y - tap.y) > 14) tap = null;
    });
    const up = (p: Phaser.Input.Pointer) => {
      if (this.build.active) return this.build.pointerUp();
      if (!p.wasTouch) return;
      if (tap && tap.id === p.id && !pinch) {
        (document.activeElement as HTMLElement | null)?.blur?.();
        this.clickTo(p.worldX, p.worldY);
      }
      tap = null;
      if (touches().filter((q) => q.id !== p.id).length < 2) pinch = null;
    };
    this.input.on('pointerup', up);
    this.input.on('pointerupoutside', (p: Phaser.Input.Pointer) => {
      if (this.build.active) return this.build.pointerUp();
      if (p.id === tap?.id) tap = null;
      if (touches().filter((q) => q.id !== p.id).length < 2) pinch = null;
    });
    this.input.on('wheel', (_p: unknown, _o: unknown, _dx: number, dy: number) =>
      this.stepZoom(dy > 0 ? -1 : 1),
    );

    const onKey = (e: KeyboardEvent) => {
      if (isTyping() || e.metaKey || e.ctrlKey || e.altKey || store.get().dialog) return;
      if (e.key === 'x' || e.key === 'X') this.act();
    };
    window.addEventListener('keydown', onKey);
    this.unsub.push(() => window.removeEventListener('keydown', onKey));

    this.unsub.push(world.on((m) => this.onMessage(m)));
    let lastDesks = store.get().desks;
    let lastBuild = store.get().build;
    let lastZoom = store.get().zoom;
    let lastLighting = store.get().settings.lighting;
    let lastBlend = store.get().config?.flags.blendTiles === true;
    let lastLang = i18n.language;
    this.unsub.push(
      store.subscribe(() => {
        const st = store.get();
        if (st.locate) {
          const id = st.locate;
          store.set({ locate: null });
          this.locate(id);
        }
        if (st.navRequest) {
          const r = st.navRequest;
          store.set({ navRequest: null });
          if (r.kind === 'act') this.act();
          else this.handleNav(r);
        }
        if (st.desks !== lastDesks) {
          lastDesks = st.desks;
          this.refreshDesks();
          this.rebake();
        }
        if (st.build !== lastBuild) {
          const was = lastBuild;
          lastBuild = st.build;
          this.onBuildChange(!!was, !!st.build);
        }
        if (st.zoom !== lastZoom) {
          lastZoom = st.zoom;
          this.fitZoom();
        }
        const blendOn = st.config?.flags.blendTiles === true;
        if (blendOn !== lastBlend) {
          lastBlend = blendOn;
          this.setBlend(blendOn);
          this.propsView.sync();
        }
        if (st.settings.lighting !== lastLighting) {
          lastLighting = st.settings.lighting;
          this.setupLighting();
        }
        if (i18n.language !== lastLang) {
          lastLang = i18n.language;
          this.refreshTexts();
        }
      }),
    );
    const cleanup = () => {
      this.unsub.forEach((u) => u());
      this.unsub = [];
    };
    // a remount (map reload) destroys the game without a scene shutdown
    this.events.once('shutdown', cleanup);
    this.events.once('destroy', cleanup);
    this.refreshTexts();
    this.syncMe();
    if (store.get().build) this.time.delayedCall(0, () => this.onBuildChange(false, true));
    this.time.delayedCall(30, () => this.setupLighting());
    this.time.addEvent({ delay: 60_000, loop: true, callback: () => this.rebake(true) });
  }

  // ───────────────────────────────────────────── build mode (ADR-021)
  private onBuildChange(was: boolean, on: boolean) {
    if (on && !was) {
      this.nav.cancel();
      this.pathGfx.clear();
      this.me.moving = false;
      this.sendMe(true);
      this.build.enter();
    } else if (!on && was) {
      this.build.exit();
      this.boundCamera(true);
      const mine = this.views.get(store.get().me ?? '');
      if (mine) this.cameras.main.startFollow(mine.body, true, 0.18, 0.18, 0, AV_H / 2);
      this.following = true;
    } else this.build.refresh();
  }

  /** Turn blended tiles (ADR-037) on or off; the plain tilemap layers stay underneath. */
  private setBlend(on: boolean) {
    if (on && !this.blend)
      this.blend = new BlendLayers(this, this.baseLayers, () => store.get().map!);
    else if (!on && this.blend) {
      this.blend.destroy(true);
      this.blend = null;
    }
  }

  /** Lights follow lamps, windows and walls: rebuild them shortly after edits. */
  private scheduleRelight() {
    this.relightTimer?.remove();
    this.relightTimer = this.time.delayedCall(400, () => {
      this.lightSources = [];
      for (const g of this.glows) g.img.destroy();
      this.glows = [];
      this.setupLighting();
    });
  }

  private drawDeskOutlines() {
    const g = this.deskGfx;
    g.clear();
    const states = new Map(store.get().desks.map((d) => [d.id, d]));
    for (const d of store.get().map!.desks) {
      const st = states.get(d.id);
      const color = !st?.ownerName
        ? 0xf3f6f8
        : st.access === 'closed'
          ? 0xc2364b
          : st.access === 'knock'
            ? 0xf2a900
            : 0x5fd3c6;
      const z = d.zone;
      g.lineStyle(2, color, st?.ownerName ? 0.75 : 0.35);
      g.strokeRoundedRect(z.x + 2, z.y + 2, z.w - 4, z.h - 4, 6);
    }
  }

  // ───────────────────────────────────────────── lighting
  private setupLighting() {
    const on = store.get().settings.lighting && store.get().config?.flags.lighting !== false;
    if (!on) {
      this.lightImage?.destroy();
      this.lightImage = null;
      for (const g of this.glows) g.img.destroy();
      this.glows = [];
      this.lastBakeKey = '';
      return;
    }
    const map = store.get().map!;
    if (!this.lightSources.length) {
      this.lightSources = collectLights(map, world.tmj!);
      bakeVisibility(map, this.lightSources);
    }
    this.lightCanvas ??= document.createElement('canvas');
    this.rebake(true);
    if (!this.lightImage) {
      if (this.textures.exists('lightmap')) this.textures.remove('lightmap');
      const tex = this.textures.addCanvas('lightmap', this.lightCanvas)!;
      tex.setFilter(Phaser.Textures.FilterMode.LINEAR);
      this.lightImage = this.add
        .image(0, 0, 'lightmap')
        .setOrigin(0, 0)
        .setScale(1 / LIGHTMAP_SCALE)
        .setDepth(D_LIGHT);
    }
    const dbg = new URLSearchParams(location.search);
    if (dbg.has('nolightmap')) this.lightImage.setVisible(false);
    if (!this.glows.length && !dbg.has('noglow'))
      for (const l of this.lightSources) {
        if (l.kind === 'window' || l.kind === 'sky' || l.kind === 'ceiling') continue;
        const size = l.kind === 'fire' ? 3.2 : l.kind === 'portal' ? 2.6 : 1.8;
        const img = this.add
          .image(l.x, l.y, 'glow')
          .setScale((size * TILE) / 128)
          .setDepth(D_GLOW)
          .setTint(Phaser.Display.Color.HexStringToColor(l.color).color);
        this.glows.push({ img, light: l, base: 0.3, seed: Math.random() * 100 });
      }
    this.updateGlowBase();
  }

  private rebake(force = false) {
    if (!this.lightCanvas || !this.lightSources.length) return;
    const desks = store.get().desks;
    const hour = quebecHour();
    const key = `${Math.round(hour * 6)}|${desks.map((d) => `${d.ownerName ? 1 : 0}${d.decor.lamp}`).join('')}`;
    if (!force && key === this.lastBakeKey) return;
    this.lastBakeKey = key;
    composite(this.lightCanvas, store.get().map!, this.lightSources, hour, desks);
    (this.textures.get('lightmap') as Phaser.Textures.CanvasTexture | undefined)?.refresh?.();
    this.updateGlowBase();
  }

  private updateGlowBase() {
    const tod = timeOfDay(quebecHour());
    const desks = new Map(store.get().desks.map((d) => [d.id, d]));
    for (const g of this.glows) {
      let base = (0.05 + 0.18 * (1 - tod.day)) * (g.light.kind === 'portal' ? 1.5 : 1);
      if (g.light.kind === 'desk') {
        const d = desks.get(g.light.deskId!);
        if (!d?.ownerName) base *= 0.3;
        else
          g.img.setTint(
            Phaser.Display.Color.HexStringToColor(
              ['#ffb35c', '#fff1d6', '#ff8fa3', '#5fd3c6', '#b49cff', '#a6e36b'][d.decor.lamp] ??
                '#ffb35c',
            ).color,
          );
      }
      g.base = base;
      g.img.setAlpha(base);
    }
  }

  // ───────────────────────────────────────────── desks (decor, nameplates)
  private buildDesks() {
    const map = store.get().map!;
    for (const d of map.desks) {
      const plantPos = { x: d.plant.cx * TILE + TILE / 2, y: (d.plant.cy + 1) * TILE };
      const posterPos = { x: d.poster.cx * TILE + TILE / 2, y: (d.poster.cy + 1) * TILE };
      const lampPos = { x: d.lamp.cx * TILE + TILE / 2 + 2, y: (d.lamp.cy + 1) * TILE - 6 };
      const plant = this.add
        .image(plantPos.x, plantPos.y, 'decor', '0-0')
        .setOrigin(0.5, 1)
        .setDepth(plantPos.y);
      const poster = this.add
        .image(posterPos.x, posterPos.y, 'decor', '2-0')
        .setOrigin(0.5, 1)
        .setDepth(posterPos.y);
      const lamp = this.add
        .image(lampPos.x, lampPos.y, 'decor', '1-0')
        .setOrigin(0.5, 1)
        .setDepth(lampPos.y);
      const plate = this.add
        .text(d.plate.cx * TILE + TILE, d.plate.cy * TILE + TILE / 2, '', {
          fontFamily: 'Atkinson Hyperlegible, sans-serif',
          color: '#F3F6F8',
          backgroundColor: 'rgba(23,50,77,0.85)',
          align: 'center',
        })
        .setOrigin(0.5, 0.5)
        .setDepth(D_OVERLAY - 20);
      this.deskViews.set(d.id, { plant, lamp, poster, plate });
    }
    this.refreshDesks();
  }

  private refreshDesks() {
    this.drawDeskOutlines();
    const states = new Map(store.get().desks.map((d) => [d.id, d]));
    for (const [id, v] of this.deskViews) {
      const d = states.get(id);
      const decor = d?.decor ?? { plant: 0, lamp: 0, poster: 0, message: '' };
      v.plant.setFrame(`0-${decor.plant}`);
      v.lamp.setFrame(`1-${decor.lamp}`);
      v.poster.setFrame(`2-${decor.poster}`).setVisible(!!d?.ownerName);
      const access =
        d?.ownerName && d.access !== 'open' ? (d.access === 'knock' ? ' 🔔' : ' 🔒') : '';
      v.plate.setText(
        d?.ownerName
          ? `${d.ownerName}${access}${decor.message ? `\n${decor.message}` : ''}`
          : i18n.t('desk.free'),
      );
      v.plate.setAlpha(d?.ownerName ? 1 : 0.7);
    }
  }

  private refreshTexts() {
    const fr = i18n.language.startsWith('fr');
    for (const t of this.texts) t.setText(String(t.getData(fr ? 'fr' : 'en')));
    this.refreshDesks();
    this.styleTexts();
  }

  private styleTexts() {
    const z = this.cameras.main.zoom;
    const res = z * (window.devicePixelRatio || 1);
    for (const t of this.texts)
      t.setFontSize(12 / z)
        .setResolution(res)
        .setStroke('#17324D', 3 / z);
    for (const v of this.deskViews.values())
      v.plate
        .setFontSize(11 / z)
        .setResolution(res)
        .setPadding(4 / z, 2 / z, 4 / z, 2 / z);
  }

  // ───────────────────────────────────────────── camera
  private fitZoom() {
    const cam = this.cameras.main;
    const { width, height } = this.scale;
    const fit = Math.max(
      1,
      Math.min(3, Math.round(Math.min(width / (22 * 32), height / (14 * 32)))),
    );
    // Phones in portrait (P8.2): the world stops above the dock, so nothing you walk
    // to (a door, a chair at the bottom of a room) hides behind it.
    const dock =
      store.get().config?.flags.touchControls !== false &&
      matches(COMPACT_QUERY) &&
      matches('(orientation: portrait)')
        ? DOCK_PX
        : 0;
    cam.setViewport(0, 0, width, Math.max(1, height - dock));
    cam.setZoom(store.get().zoom ?? fit);
    this.boundCamera(true);
    for (const v of this.views.values()) this.styleLabel(v);
    this.styleTexts();
  }

  /** Keep the camera inside the current region so neighbouring wings stay hidden. */
  private boundRegion: string | null = null;
  private boundCamera(force = false) {
    const s = store.get();
    const map = s.map!;
    const region = s.myRegion ? map.regions.find((r) => r.id === s.myRegion) : undefined;
    if (this.build?.active) return;
    if (!force && (region?.id ?? null) === this.boundRegion) return;
    this.boundRegion = region?.id ?? null;
    const cam = this.cameras.main;
    if (region) cam.setBounds(region.x, region.y, region.w, region.h, true);
    else cam.setBounds(0, 0, map.pxWidth, map.pxHeight, true);
  }

  private stepZoom(dir: number) {
    const levels = [1, 2, 3, 4];
    const cur = this.cameras.main.zoom;
    const i = levels.findIndex((l) => l >= cur);
    const next =
      levels[Math.max(0, Math.min(levels.length - 1, (i < 0 ? levels.length - 1 : i) + dir))]!;
    store.set({ zoom: next });
  }

  private styleLabel(v: AvatarView) {
    const z = this.cameras.main.zoom;
    const res = z * (window.devicePixelRatio || 1);
    v.label
      .setFontSize(13 / z)
      .setResolution(res)
      .setStroke('#17324D', 3 / z);
    v.emote.setFontSize(20 / z).setResolution(res);
    v.bubble
      .setFontSize(13 / z)
      .setResolution(res)
      .setPadding(6 / z, 4 / z, 6 / z, 4 / z);
    v.bubble.setWordWrapWidth(200 / z);
    v.dot.setRadius(4 / z);
  }

  private syncMe() {
    const s = store.get();
    if (!s.me) return;
    const buf = world.samples.get(s.me);
    const last = buf?.[buf.length - 1];
    if (last && !this.me.ready)
      Object.assign(this.me, {
        x: last.x,
        y: last.y,
        dir: last.d,
        moving: false,
        pose: last.p,
        ready: true,
      });
  }

  // ───────────────────────────────────────────── avatars
  private texFor(a: Avatar): string {
    const key = avatarKey(a);
    if (!this.textures.exists(key)) {
      const tex = this.textures.addCanvas(key, makeAvatarCanvas(a))!;
      for (const [dir, row] of Object.entries(DIR_ROW)) {
        for (let f = 0; f < AV_FRAMES; f++)
          tex.add(`${dir}-${f}`, 0, f * AV_W, row * AV_H, AV_W, AV_H);
        tex.add(`crouch-${dir}`, 0, row * AV_W, 4 * AV_H, AV_W, AV_H);
        tex.add(`sit-${dir}`, 0, row * AV_W, 5 * AV_H, AV_W, AV_H);
      }
    }
    return key;
  }

  private viewFor(id: string): AvatarView | undefined {
    const p = store.get().profiles[id];
    if (!p) return undefined;
    let v = this.views.get(id);
    const key = this.texFor(p.avatar);
    if (!v) {
      const ring = this.add
        .ellipse(0, -2, 26, 10)
        .setStrokeStyle(2, 0xf2a900, 1)
        .setVisible(false) as unknown as Phaser.GameObjects.Arc;
      const sprite = this.add.sprite(0, 0, key, 'down-0').setOrigin(0.5, 1);
      const body = this.add.container(0, 0, [ring, sprite]);
      const label = this.add
        .text(0, -AV_H - 2, p.name, {
          fontFamily: 'Atkinson Hyperlegible, sans-serif',
          fontStyle: 'bold',
          color: '#F3F6F8',
        })
        .setOrigin(0.5, 1);
      const dot = this.add
        .circle(0, 0, 2.5, STATUS_COLOR[p.status] ?? 0x2f7d5b)
        .setStrokeStyle(1, 0x17324d);
      const emote = this.add
        .text(0, -AV_H - 16, '', { fontFamily: 'sans-serif' })
        .setOrigin(0.5, 1);
      const bubble = this.add
        .text(0, -AV_H - 14, '', {
          fontFamily: 'Atkinson Hyperlegible, sans-serif',
          color: '#17324D',
          backgroundColor: '#F3F6F8',
          align: 'center',
        })
        .setOrigin(0.5, 1)
        .setVisible(false);
      const over = this.add.container(0, 0, [label, dot, emote, bubble]).setDepth(D_OVERLAY);
      const chairBack = this.add.image(0, 0, 'chairback').setOrigin(0, 0).setVisible(false);
      v = {
        body,
        sprite,
        ring,
        over,
        label,
        dot,
        emote,
        bubble,
        chairBack,
        texKey: key,
        emoteUntil: 0,
        bubbleUntil: 0,
        pose: 'stand',
        poseAt: 0,
        x: 0,
        y: 0,
      };
      this.styleLabel(v);
      this.views.set(id, v);
      if (id === store.get().me) this.cameras.main.startFollow(body, true, 0.18, 0.18, 0, AV_H / 2);
    }
    if (v.texKey !== key) {
      v.sprite.setTexture(key, v.sprite.frame.name);
      v.texKey = key;
    }
    return v;
  }

  private destroyView(id: string) {
    const v = this.views.get(id);
    if (!v) return;
    v.body.destroy();
    v.over.destroy();
    v.chairBack.destroy();
    this.views.delete(id);
    rendered.delete(id);
  }

  // ───────────────────────────────────────────── messages
  private onMessage(m: S2CMsg) {
    if (m.t === 'welcome') {
      this.me.ready = false;
      this.syncMe();
    } else if (m.t === 'emote') {
      const v = this.views.get(m.id);
      if (v) {
        v.emote.setText(EMOTE_GLYPH[m.emote as Emote]);
        v.emoteUntil = performance.now() + EMOTE_MS;
      }
    } else if (m.t === 'chat' && m.msg.scope === 'nearby') {
      const v = this.views.get(m.msg.from);
      if (v) {
        const body = m.msg.body.length > 90 ? `${m.msg.body.slice(0, 88)}…` : m.msg.body;
        v.bubble.setText(body).setVisible(true);
        v.bubbleUntil = performance.now() + 5000;
      }
    } else if (m.t === 'map:edit') {
      this.build.onEdit(m.changes);
      this.blend?.onEdit(m.changes);
      this.propsView.sync();
      this.anim?.sync();
      if (m.changes.some((c) => c.l === 'walls' || c.l === 'furniture' || c.l === 'props'))
        this.scheduleRelight();
    } else if (m.t === 'leave') this.destroyView(m.id);
    else if (m.t === 'knock:result' && m.result === 'accepted') toast('knock.accepted');
  }

  // ───────────────────────────────────────────── movement helpers
  private blocked(x: number, y: number): boolean {
    const s = store.get();
    const spot = deskSpotAt(s.map!, x, y);
    if (!spot) return false;
    const mine = rendered.get(s.me ?? '');
    if (mine && deskSpotAt(s.map!, mine.x, mine.y)?.id === spot.id) return false;
    const d = s.desks.find((q) => q.id === spot.id);
    return !podAllows(d, d?.ownerId === s.me, s.admitted.includes(spot.id));
  }

  private sendMe(force = false) {
    world.sendMove(this.me.x, this.me.y, this.me.dir, this.me.moving, force, this.me.pose);
  }

  private sit() {
    const map = store.get().map!;
    const face = chairAt(map, this.me.x, this.me.y);
    if (!face) return;
    const seat = cellPos(map, cellOf(map, this.me.x, this.me.y));
    Object.assign(this.me, {
      x: seat.x,
      y: seat.y,
      dir: face,
      pose: 'sit',
      poseAt: performance.now(),
      moving: false,
    });
    this.sendMe(true);
  }

  private stand(suppress = true) {
    if (this.me.pose !== 'sit') return;
    const now = performance.now();
    Object.assign(this.me, {
      pose: 'stand',
      poseAt: now,
      standUntil: now + POSE_MS,
      suppressSit: suppress,
    });
    this.sendMe(true);
  }

  /** X key (or the touch action button): act on the current prompt. */
  private act() {
    const p = store.get().prompt;
    if (!p) return;
    if (p.kind === 'sit') {
      this.me.suppressSit = false;
      this.sit();
    } else if (p.kind === 'stand' || p.kind === 'claim') this.stand();
    else if (p.kind === 'knock') world.send({ t: 'knock', deskId: p.deskId });
    else if (p.kind === 'teleport') world.send({ t: 'teleport', to: p.to });
  }

  private clickTo(wx: number, wy: number) {
    const s = store.get();
    const map = s.map!;
    const cell = cellOf(map, wx, wy + 6);
    const target = cellPos(map, cell);
    const sit = !!chairAt(map, target.x, target.y);
    if (this.me.pose === 'sit') this.stand(false);
    const ok = this.nav.go(this.me.x, this.me.y, {
      cell,
      sit,
      onArrive: () => {
        this.pathGfx.clear();
        if (sit) {
          this.me.suppressSit = false;
          this.sit();
        }
      },
    });
    if (!ok) {
      // clicked a pod you may not enter: walk to its entrance instead
      const spot = deskSpotAt(map, target.x, target.y);
      if (spot && this.blocked(target.x, target.y))
        this.nav.go(this.me.x, this.me.y, { cell: spot.entrance });
    }
    this.drawPath();
  }

  private handleNav(
    r: Exclude<NonNullable<ReturnType<typeof store.get>['navRequest']>, { kind: 'act' }>,
  ) {
    const s = store.get();
    const map = s.map!;
    if (this.me.pose === 'sit') this.stand(false);
    if (r.kind === 'desk') {
      const spot = map.desks.find((d) => d.id === s.myDesk);
      if (!spot) return;
      this.nav.go(this.me.x, this.me.y, {
        cell: spot.chair,
        sit: true,
        onArrive: () => {
          this.pathGfx.clear();
          this.me.suppressSit = false;
          this.sit();
        },
      });
    } else if (r.kind === 'person') {
      const pos = rendered.get(r.id);
      if (!pos) return;
      const spot = deskSpotAt(map, pos.x, pos.y);
      const goal = spot && this.blocked(pos.x, pos.y) ? spot.entrance : cellOf(map, pos.x, pos.y);
      const ok = this.nav.go(this.me.x, this.me.y, {
        cell: goal,
        stopShort: spot && this.blocked(pos.x, pos.y) ? 0 : 1,
        onArrive: () => this.pathGfx.clear(),
      });
      if (!ok) toast('nav.unreachable');
    } else this.clickTo(r.x, r.y);
    this.drawPath();
  }

  private drawPath() {
    const g = this.pathGfx;
    g.clear();
    if (!this.nav.path.length) return;
    const map = store.get().map!;
    g.fillStyle(0xf3f6f8, 0.55);
    this.nav.path.forEach((c, i) => {
      if (i % 2) return;
      const p = cellPos(map, c);
      g.fillCircle(p.x, p.y - 4, 2);
    });
    const last = cellPos(map, this.nav.path[this.nav.path.length - 1]!);
    g.lineStyle(2, 0xf3f6f8, 0.8).strokeCircle(last.x, last.y - 4, 6);
  }

  private locate(id: string) {
    const v = this.views.get(id);
    if (!v) return;
    const cam = this.cameras.main;
    cam.stopFollow();
    this.following = false;
    cam.pan(v.x, v.y - AV_H / 2, reducedMotion() ? 0 : 500, 'Sine.easeInOut');
    this.time.delayedCall(2200, () => {
      const mine = this.views.get(store.get().me ?? '');
      if (mine) cam.startFollow(mine.body, true, 0.12, 0.12, 0, AV_H / 2);
      this.following = true;
    });
  }

  private applyCorrection() {
    const corr = world.lastCorrection;
    if (!corr) return;
    world.lastCorrection = null;
    if (corr.reason === 'teleport') {
      const land = () => {
        Object.assign(this.me, { x: corr.x, y: corr.y, pose: 'stand', dir: 'down', moving: false });
        this.nav.afterTeleport(corr.x, corr.y);
        this.drawPath();
        this.teleporting = false;
      };
      const cam = this.cameras.main;
      if (reducedMotion()) land();
      else {
        this.teleporting = true;
        cam.fadeOut(140, 10, 20, 30);
        this.time.delayedCall(150, () => {
          land();
          cam.resetFX();
          cam.fadeIn(240, 10, 20, 30);
        });
      }
      return;
    }
    this.me.x = corr.x;
    this.me.y = corr.y;
    if (corr.reason === 'blocked') this.nav.cancel();
  }

  // ───────────────────────────────────────────── frame
  override update() {
    const s = store.get();
    const map = s.map;
    if (!map || !s.me) return;
    if (!this.me.ready) this.syncMe();
    const now = performance.now();
    const dtMs = this.lastFrame ? now - this.lastFrame : 16;
    this.lastFrame = now;

    this.build.update(dtMs);
    this.blend?.update();
    if (this.anim && !reducedMotion()) this.anim.update(now);
    if (this.me.ready && !this.teleporting && this.build.active) this.applyCorrection();
    else if (this.me.ready && !this.teleporting) {
      this.applyCorrection();
      let [ix, iy] = inputVector();
      const navDriven = !ix && !iy && this.nav.active;
      if (ix || iy) {
        if (this.nav.active) {
          this.nav.cancel();
          this.pathGfx.clear();
        }
      } else if (navDriven) [ix, iy] = this.nav.steer(this.me.x, this.me.y);
      let moving = ix !== 0 || iy !== 0;
      if (moving && this.me.pose === 'sit') this.stand(false);
      if (now < this.me.standUntil) moving = false;
      if (moving) {
        let left = Math.min(dtMs, 500) / 1000;
        while (left > 0) {
          let step = Math.min(left, 0.05);
          if (navDriven) {
            // re-steer every sub-step and never overshoot a waypoint
            [ix, iy] = this.nav.steer(this.me.x, this.me.y);
            if (!ix && !iy) break;
            step = Math.min(
              step,
              Math.max(0.004, this.nav.remaining(this.me.x, this.me.y) / SPEED_PX),
            );
          }
          const n = stepMove(map, this.me.x, this.me.y, ix, iy, step, (x, y) => this.blocked(x, y));
          this.me.x = n.x;
          this.me.y = n.y;
          left -= step;
        }
        this.me.dir =
          Math.abs(ix) > Math.abs(iy) ? (ix < 0 ? 'left' : 'right') : iy < 0 ? 'up' : 'down';
        this.me.idleSince = now;
        this.me.moving = true;
        this.sendMe();
        if (!this.following) {
          this.following = true;
          const mine = this.views.get(s.me);
          if (mine) this.cameras.main.startFollow(mine.body, true, 0.18, 0.18, 0, AV_H / 2);
        }
      } else if (this.me.moving) {
        this.me.moving = false;
        this.me.idleSince = now;
        this.sendMe(true);
      }
      // auto-sit after a short pause on a chair
      const onChair = !!chairAt(map, this.me.x, this.me.y);
      if (!onChair) this.me.suppressSit = false;
      if (
        onChair &&
        this.me.pose === 'stand' &&
        !this.me.moving &&
        !this.nav.active &&
        s.settings.autoSit &&
        !this.me.suppressSit &&
        now - this.me.idleSince > 450
      )
        this.sit();
    }

    // ── avatars
    const renderT = now - INTERP_MS;
    const z = this.cameras.main.zoom;
    for (const id of Object.keys(s.profiles)) {
      const p = s.profiles[id]!;
      const v = this.viewFor(id);
      if (!v) continue;
      let x: number, y: number, dir: Dir, moving: boolean, pose: 'stand' | 'sit';
      if (id === s.me && this.me.ready) ({ x, y, dir, moving, pose } = this.me);
      else {
        const smp = world.sampleAt(id, renderT);
        if (!smp) {
          v.body.setVisible(false);
          v.over.setVisible(false);
          continue;
        }
        ({ x, y, d: dir, m: moving, p: pose } = smp);
      }
      if (pose !== v.pose) {
        v.pose = pose;
        v.poseAt = id === s.me ? this.me.poseAt : now;
      }
      v.x = x;
      v.y = y;
      rendered.set(id, { x, y });
      const rx = Math.round(x);
      const ry = Math.round(y);
      v.body.setVisible(true).setPosition(rx, ry).setDepth(y);
      v.over.setVisible(true).setPosition(rx, ry - (pose === 'sit' ? 5 : 0));
      const transitioning = now - v.poseAt < POSE_MS;
      if (transitioning) v.sprite.setFrame(`crouch-${dir}`);
      else if (pose === 'sit') v.sprite.setFrame(`sit-${dir}`);
      else v.sprite.setFrame(`${dir}-${moving ? WALK_SEQ[Math.floor(now / 130) % 4]! : 0}`);
      const seatedUp = pose === 'sit' && dir === 'up' && !transitioning;
      v.chairBack.setVisible(seatedUp);
      if (seatedUp) {
        const c = cellOf(map, x, y);
        v.chairBack.setPosition(c.cx * TILE, c.cy * TILE).setDepth(y + 0.5);
      }
      if (v.label.text !== p.name) v.label.setText(p.name);
      v.dot.setFillStyle(STATUS_COLOR[p.status] ?? 0x2f7d5b);
      v.dot.setPosition(-v.label.width / 2 - 6 / z, -AV_H - 2 - v.label.height / 2);
      v.body.setAlpha(!p.online ? 0.35 : p.status === 'away' ? 0.6 : 1);
      v.over.setAlpha(!p.online ? 0.5 : 1);
      const speaking = id === s.me ? s.speakingSelf : !!s.remote[id]?.speaking;
      v.ring.setVisible(speaking);
      if (p.hand) v.emote.setText(EMOTE_GLYPH.hand).setVisible(true);
      else v.emote.setVisible(now < v.emoteUntil);
      const bubbleOn = now < v.bubbleUntil;
      v.bubble.setVisible(bubbleOn);
      v.emote.setY(bubbleOn ? -AV_H - 14 - v.bubble.height - 2 : -AV_H - 16);
    }
    for (const id of [...this.views.keys()]) if (!s.profiles[id]) this.destroyView(id);

    // ── lamp flicker (respects reduced motion)
    if (this.glows.length && !reducedMotion()) {
      const t = now / 1000;
      for (const g of this.glows) {
        const amp = g.light.kind === 'fire' ? 0.25 : g.light.kind === 'portal' ? 0.15 : 0.05;
        const f =
          Math.sin(t * (g.light.kind === 'fire' ? 9 : 2.3) + g.seed) * 0.5 +
          Math.sin(t * 5.7 + g.seed * 2) * 0.5;
        g.img.setAlpha(Math.max(0, g.base * (1 + amp * f)));
      }
    }

    // Weak machine guard: lighting off if the frame rate stays low (once per session).
    if (this.lightImage && now - this.fpsCheckAt > 5000) {
      this.fpsCheckAt = now;
      const fps = this.game.loop.actualFps;
      this.lowFps = fps < 15 ? this.lowFps + 1 : 0;
      if (this.lowFps >= 3 && !new URLSearchParams(location.search).has('hour')) {
        const settings = { ...store.get().settings, lighting: false };
        saveSettings(settings);
        store.set({ settings });
        toast('toast.lightingOff', undefined, 6000);
      }
    }

    if (now - this.lastSlow > 300) {
      this.lastSlow = now;
      this.slowTick(now);
    }
  }

  /** ~3 Hz: presence areas, nearest list, my zone/region, contextual prompt. */
  private slowTick(_now: number) {
    const s = store.get();
    const map = s.map!;
    const areas: Record<string, string | null> = {};
    for (const id of Object.keys(s.profiles)) {
      const r = rendered.get(id);
      areas[id] = r ? (zoneAt(map, r.x, r.y)?.id ?? null) : null;
    }
    const meR = rendered.get(s.me!);
    const nearest = meR
      ? Object.keys(s.profiles)
          .filter((id) => id !== s.me && rendered.has(id))
          .sort((a, b) => distTiles(meR, rendered.get(a)!) - distTiles(meR, rendered.get(b)!))
      : [];
    const myZone = meR ? (zoneAt(map, meR.x, meR.y) ?? null) : null;
    const myRegion = meR ? (regionAt(map, meR.x, meR.y)?.id ?? null) : null;

    // contextual prompt
    let prompt: ReturnType<typeof store.get>['prompt'] = null;
    if (meR) {
      const spotHere = deskSpotAt(map, meR.x, meR.y);
      const deskHere = spotHere ? s.desks.find((d) => d.id === spotHere.id) : undefined;
      if (this.me.pose === 'sit') {
        const chair = spotHere && cellOf(map, meR.x, meR.y);
        const atDeskChair =
          chair && spotHere && chair.cx === spotHere.chair.cx && chair.cy === spotHere.chair.cy;
        prompt =
          atDeskChair && !deskHere?.ownerName
            ? { kind: 'claim', deskId: spotHere!.id, moving: !!s.myDesk }
            : { kind: 'stand' };
      } else if (chairAt(map, meR.x, meR.y)) prompt = { kind: 'sit' };
      else if (myZone?.kind === 'portal') {
        const to = String(myZone.props.to ?? 'hub');
        prompt = { kind: 'teleport', region: myRegion ?? 'hub', to: to === myRegion ? 'hub' : to };
      } else
        for (const d of map.desks) {
          // 1.9 tiles: the door of a pod with its desk at the back (entrance below the zone)
          // stands about 1.7 tiles from the zone edge, so 1.6 never showed the knock prompt there.
          if (distToPod(d, meR.x, meR.y) > 1.9 || d.id === spotHere?.id) continue;
          const st = s.desks.find((q) => q.id === d.id);
          if (!st?.ownerName || st.ownerId === s.me || st.access === 'open') continue;
          if (s.admitted.includes(d.id)) continue;
          prompt =
            st.access === 'knock'
              ? { kind: 'knock', deskId: d.id, owner: st.ownerName }
              : { kind: 'closed', deskId: d.id, owner: st.ownerName };
          break;
        }
    }
    const same = JSON.stringify(prompt) === JSON.stringify(s.prompt);
    store.set({ areas, nearest, myZone, myRegion, ...(same ? {} : { prompt }) });

    const zid = myZone?.id ?? null;
    if (this.lastZoneId !== undefined && zid !== this.lastZoneId) {
      if (myZone?.kind === 'private') toast('zone.enteredPrivate', undefined, 3000);
      else if (myZone?.kind === 'desk') toast('zone.enteredDesk', undefined, 3000);
      else if (myZone?.kind === 'quiet') toast('zone.enteredQuiet', undefined, 3000);
    }
    this.lastZoneId = zid;
    this.boundCamera();
    this.rebake();
    void POSTERS;
  }
}

export function zoneName(id: string | null | undefined): string {
  if (!id) return i18n.t('zone.floor');
  const s = store.get();
  const z = s.map?.zones.find((q) => q.id === id);
  if (!z) return i18n.t('zone.floor');
  if (z.kind === 'desk') {
    const d = s.desks.find((q) => q.id === id);
    if (d?.ownerName) return i18n.t('desk.of', { name: d.ownerName });
  }
  return i18n.language.startsWith('fr') ? z.nameFr : z.nameEn;
}
