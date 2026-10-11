/**
 * The flat view of a personal world (P17.14, ADR-053): the cells the camera can see, each lifted by
 * its level with a darker strip under a step, the farm layer over the ground, and the people, all
 * drawn in one depth order (`depthOf`). The world's rules are shared code: my walking is
 * `WorldWalker` (prediction), the terrain is `WorldSession.terrain` (seed plus the deltas in view).
 * The office scene is a different scene; GameView swaps between them on `store.worldId`.
 */
import Phaser from 'phaser';
import { AV_FRAMES, AV_H, AV_W, DIR_ROW, makeAvatarCanvas } from '../../game/avatars';
import { rendered } from '../../game/controller';
import { inputVector, isTyping } from '../../game/input';
import { exposeTestApi, type ViewTestApi } from '../../game/view';
import {
  RETURN_PORTAL_ID,
  avatarKey,
  inPortal,
  type Avatar,
  type Dir,
  type GridCell,
} from '@agora/shared';
import { world as link } from '../../net/client';
import { store, toast } from '../../state/store';
import { COMPACT_QUERY, matches } from '../../ui/layout';
import { worldSession } from '../session';
import { WorldWalker, cellFeet } from '../walker';
import { RETURN_RECT } from '../starter';
import { TEX, addWorldTextures } from './atlas';
import { cropFrameName } from './art';
import {
  CELL,
  RANK,
  cellBaseY,
  cellWindow,
  LEVEL_PX,
  depthOf,
  farmVisual,
  pickCell,
  sideStrip,
  topY,
  type CellWindow,
} from './math';

const D_PATH = 1e8;
/**
 * The shade of a side strip (FIX-1): a step is in shadow, a cliff of two or more levels darker
 * still. The tint multiplies the block's side colour, so a light side reads as a clear face.
 */
const STRIP_STEP = 0x8f8f8f;
const STRIP_STEEP = 0x555555;
const D_LABEL = 1e9;
const WALK_SEQ = [1, 0, 3, 2];
/** Height the phone dock covers at the bottom of the screen (as the office view). */
const DOCK_PX = 72;
/** How fast a person's drawn position catches up with the server's (per ms, lerp). */
const CATCH_UP_MS = 90;

export interface WorldTestApi {
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
  };
  /** the level of a cell (with stored edits) */
  levelAt(cx: number, cy: number): number;
  /** whether a cell can be walked on */
  walkableAt(cx: number, cy: number): boolean;
}

interface AvatarView {
  sprite: Phaser.GameObjects.Sprite;
  label: Phaser.GameObjects.Text;
  texKey: string;
}

interface CellView {
  sig: string;
  objects: Phaser.GameObjects.Image[];
}

export class WorldRoomScene extends Phaser.Scene {
  private walker!: WorldWalker;
  private readonly cells = new Map<string, CellView>();
  private win: CellWindow | null = null;
  private cellsDirty = true;
  private readonly avatars = new Map<string, AvatarView>();
  private readonly drawn = new Map<string, { x: number; y: number }>();
  private pathGfx!: Phaser.GameObjects.Graphics;
  private unsub: (() => void)[] = [];
  private onKey: ((e: KeyboardEvent) => void) | null = null;
  private lastFrame = 0;
  private lastSlow = 0;
  private followed: string | null = null;
  private pathLen = 0;

  constructor() {
    super('worldroom');
  }

  // ───────────────────────────────────────────── setup
  create() {
    if (!worldSession.active || !worldSession.terrain) return;
    addWorldTextures(this.textures);
    this.walker = new WorldWalker(worldSession);
    const me = worldSession.people.get(worldSession.you);
    const at = me ?? { x: 16, y: 26 };
    this.walker.place(at.x, at.y);
    this.pathGfx = this.add.graphics().setDepth(D_PATH);

    const cam = this.cameras.main;
    cam.setBackgroundColor('#1b2733');
    cam.setRoundPixels(true);
    cam.fadeIn(reducedMotion() ? 0 : 300, 10, 20, 30);
    this.fitZoom();
    this.scale.on('resize', () => this.fitZoom());

    // a click walks to the cell under the pointer (a touch tap, too: pinch and drag are not used)
    this.input.on('pointerdown', (p: Phaser.Input.Pointer) => {
      if (p.button !== 0) return;
      (document.activeElement as HTMLElement | null)?.blur?.();
      this.clickTo(p.worldX, p.worldY);
    });
    this.input.on('wheel', (_p: unknown, _o: unknown, _dx: number, dy: number) =>
      this.stepZoom(dy > 0 ? -1 : 1),
    );

    this.onKey = (e: KeyboardEvent) => {
      if (isTyping() || e.metaKey || e.ctrlKey || e.altKey || store.get().dialog) return;
      if (e.key === 'x' || e.key === 'X') this.act();
    };
    window.addEventListener('keydown', this.onKey);

    this.unsub.push(
      worldSession.on((change) => {
        if (change === 'chunks' || change === 'farm' || change === 'welcome')
          this.cellsDirty = true;
      }),
    );
    let lastZoom = store.get().zoom;
    this.unsub.push(
      store.subscribe(() => {
        const st = store.get();
        if (st.zoom !== lastZoom) {
          lastZoom = st.zoom;
          this.fitZoom();
        }
        const r = st.navRequest;
        if (r) {
          store.set({ navRequest: null });
          if (r.kind === 'act') this.act();
          else if (r.kind === 'point') this.clickTo(r.x, r.y);
          else if (r.kind === 'person') {
            const at = rendered.get(r.id);
            if (at) this.clickTo(at.x, at.y);
          }
        }
      }),
    );
    this.events.once('shutdown', () => this.cleanup());
    this.events.once('destroy', () => this.cleanup());
    exposeTestApi(this.testApi());
  }

  private cleanup() {
    this.unsub.forEach((u) => u());
    this.unsub = [];
    if (this.onKey) window.removeEventListener('keydown', this.onKey);
    this.onKey = null;
    for (const id of this.avatars.keys()) rendered.delete(id);
    exposeTestApi(null);
  }

  // ───────────────────────────────────────────── camera
  private fitZoom() {
    const cam = this.cameras.main;
    const { width, height } = this.scale;
    const fit = Math.max(
      1,
      Math.min(3, Math.round(Math.min(width / (22 * 32), height / (14 * 32)))),
    );
    // phones in portrait: the world stops above the dock, as in the office
    const dock =
      store.get().config?.flags.touchControls !== false &&
      matches(COMPACT_QUERY) &&
      matches('(orientation: portrait)')
        ? DOCK_PX
        : 0;
    cam.setViewport(0, 0, width, Math.max(1, height - dock));
    cam.setZoom(store.get().zoom ?? fit);
    for (const v of this.avatars.values()) this.styleLabel(v);
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
    v.label.setFontSize(13 / z).setResolution(z * (window.devicePixelRatio || 1));
    v.label.setStroke('#17324D', 3 / z);
  }

  // ───────────────────────────────────────────── input
  /** Walk to the cell under a world point (a click, a tap or the People list's "go to"). */
  clickTo(wx: number, wy: number): void {
    const t = worldSession.terrain;
    if (!t) return;
    const cell = pickCell(wx, wy, (cx, cy) => t.cellAt(cx, cy).level);
    if (!this.walker.goTo(cell)) toast('worlds.noRoute');
    this.drawPath();
  }

  /** X (or the touch button): act on the current prompt. */
  act(): void {
    const p = store.get().prompt;
    if (p?.kind === 'worldExit') link.send({ t: 'portal:enter', id: RETURN_PORTAL_ID });
  }

  private drawPath(): void {
    const g = this.pathGfx;
    g.clear();
    const path = this.walker.path;
    this.pathLen = path.length;
    if (!path.length) return;
    g.fillStyle(0xf3f6f8, 0.55);
    path.forEach((c, i) => {
      if (i % 2) return;
      const p = cellFeet(c);
      g.fillCircle(p.x, p.y - 4, 2);
    });
    const last = cellFeet(path[path.length - 1]!);
    g.lineStyle(2, 0xf3f6f8, 0.8).strokeCircle(last.x, last.y - 4, 6);
  }

  // ───────────────────────────────────────────── cells
  /** Draw the cells the camera sees, and remove those it left. Only changed cells are rebuilt. */
  private drawCells(win: CellWindow): void {
    const s = worldSession;
    const t = s.terrain!;
    const keep = new Set<string>();
    for (let cy = win.y0; cy <= win.y1; cy++)
      for (let cx = win.x0; cx <= win.x1; cx++) {
        const key = `${cx},${cy}`;
        keep.add(key);
        const cell = t.cellAt(cx, cy);
        const south = t.cellAt(cx, cy + 1);
        const plot = s.plots.get(key);
        const farm = farmVisual(plot, s.farmDay);
        const sig = `${cell.level}|${cell.block}|${cell.decor}|${south.level}|${farm ? `${farm.soil}${farm.watered}${farm.crop}${farm.sprinkler}${plot?.crop?.crop ?? ''}` : ''}`;
        const have = this.cells.get(key);
        if (have?.sig === sig) continue;
        have?.objects.forEach((o) => o.destroy());
        this.cells.set(key, {
          sig,
          objects: this.buildCell(
            cx,
            cy,
            cell.level,
            cell.block,
            cell.decor,
            south.level,
            farm,
            plot?.crop?.crop ?? null,
          ),
        });
      }
    for (const [key, v] of this.cells)
      if (!keep.has(key)) {
        v.objects.forEach((o) => o.destroy());
        this.cells.delete(key);
      }
    this.win = win;
    this.cellsDirty = false;
  }

  private buildCell(
    cx: number,
    cy: number,
    level: number,
    block: string,
    decor: string,
    southLevel: number,
    farm: ReturnType<typeof farmVisual>,
    cropId: string | null,
  ): Phaser.GameObjects.Image[] {
    const out: Phaser.GameObjects.Image[] = [];
    const base = cellBaseY(cy);
    const x = cx * CELL;
    const strip = sideStrip(cy, level, southLevel);
    if (strip) {
      out.push(
        this.add
          .image(x, strip.y, TEX.side, `side:${block}`)
          .setOrigin(0, 0)
          .setCrop(0, 0, CELL, strip.h)
          .setTint(strip.shade === 'steep' ? STRIP_STEEP : STRIP_STEP)
          .setDepth(depthOf(base, level, RANK.strip)),
      );
    }
    const y = topY(cy, level);
    out.push(
      this.add
        .image(x, y, TEX.top, `top:${block}`)
        .setOrigin(0, 0)
        .setDepth(depthOf(base, level, RANK.top)),
    );
    if (farm?.soil) {
      const soil = this.add
        .image(x, y, TEX.top, 'top:tilled_soil')
        .setOrigin(0, 0)
        .setDepth(depthOf(base, level, RANK.farm));
      if (farm.watered) soil.setTint(0x8fb4e0);
      out.push(soil);
    }
    if (decor)
      out.push(
        this.add
          .image(x, y, TEX.decor, `decor:${decor}`)
          .setOrigin(0, 0)
          .setDepth(depthOf(base, level, RANK.decor)),
      );
    if (farm?.sprinkler)
      out.push(
        this.add
          .image(x, y, TEX.crop, 'sprinkler')
          .setOrigin(0, 0)
          .setDepth(depthOf(base, level, RANK.crop)),
      );
    if (farm && farm.crop !== null && cropId)
      out.push(
        this.add
          .image(x, y, TEX.crop, cropFrameName(cropId, farm.crop))
          .setOrigin(0, 0)
          .setDepth(depthOf(base, level, RANK.crop)),
      );
    return out;
  }

  // ───────────────────────────────────────────── people
  private avatarView(id: string, avatar: Avatar, name: string): AvatarView {
    const key = avatarKey(avatar);
    let v = this.avatars.get(id);
    if (!v) {
      if (!this.textures.exists(key)) {
        const tex = this.textures.addCanvas(key, makeAvatarCanvas(avatar))!;
        for (const [dir, row] of Object.entries(DIR_ROW)) {
          for (let f = 0; f < AV_FRAMES; f++)
            tex.add(`${dir}-${f}`, 0, f * AV_W, row * AV_H, AV_W, AV_H);
          tex.add(`crouch-${dir}`, 0, row * AV_W, 4 * AV_H, AV_W, AV_H);
          tex.add(`sit-${dir}`, 0, row * AV_W, 5 * AV_H, AV_W, AV_H);
        }
      }
      const sprite = this.add.sprite(0, 0, key, 'down-0').setOrigin(0.5, 1);
      const label = this.add
        .text(0, 0, name, {
          fontFamily: 'Atkinson Hyperlegible, sans-serif',
          fontStyle: 'bold',
          color: '#F3F6F8',
        })
        .setOrigin(0.5, 1)
        .setDepth(D_LABEL);
      v = { sprite, label, texKey: key };
      this.avatars.set(id, v);
      this.styleLabel(v);
    }
    return v;
  }

  private syncAvatars(now: number, dtMs: number): void {
    const s = worldSession;
    const t = s.terrain!;
    for (const [id, v] of this.avatars) {
      if (s.people.has(id)) continue;
      v.sprite.destroy();
      v.label.destroy();
      this.avatars.delete(id);
      this.drawn.delete(id);
      rendered.delete(id);
    }
    for (const p of s.people.values()) {
      const mine = p.id === s.you;
      let x: number;
      let y: number;
      let d: Dir;
      let moving: boolean;
      if (mine) {
        ({ x, y, d, moving } = this.walker);
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
      const v = this.avatarView(p.id, p.avatar, p.name);
      const fx = Math.round(x);
      const fy = Math.round(y);
      const level = t.cellAt(Math.floor(fx / CELL), Math.floor(fy / CELL)).level;
      const frame = `${d}-${moving ? WALK_SEQ[Math.floor(now / 130) % 4]! : 0}`;
      // a raised cell is drawn LEVEL_PX up per level: the feet stand on its top, the depth stays on the base
      const lift = LEVEL_PX * level;
      v.sprite
        .setPosition(fx, fy - lift)
        .setFrame(frame)
        .setDepth(depthOf(fy, level, RANK.avatar));
      v.label.setPosition(fx, fy - lift - AV_H - 2);
      rendered.set(p.id, { x, y });
      if (mine && this.followed !== p.id) {
        this.followed = p.id;
        this.cameras.main.startFollow(v.sprite, true, 0.18, 0.18, 0, -AV_H / 2);
      }
    }
  }

  // ───────────────────────────────────────────── frame
  override update(time: number) {
    if (!worldSession.active || !worldSession.terrain || !this.walker) return;
    const now = time;
    const dtMs = this.lastFrame ? now - this.lastFrame : 16;
    this.lastFrame = now;

    this.walker.step(dtMs, inputVector());
    if (this.walker.path.length !== this.pathLen) {
      this.pathLen = this.walker.path.length;
      this.drawPath();
    }
    this.syncAvatars(now, dtMs);

    const win = cellWindow(this.cameras.main.worldView);
    const moved =
      !this.win ||
      win.x0 !== this.win.x0 ||
      win.y0 !== this.win.y0 ||
      win.x1 !== this.win.x1 ||
      win.y1 !== this.win.y1;
    if (this.cellsDirty || moved) this.drawCells(win);

    if (now - this.lastSlow > 300) {
      this.lastSlow = now;
      this.slowTick();
    }
  }

  /** ~3 Hz: the prompt for the return pad. */
  private slowTick(): void {
    const at = this.walker;
    const prompt = inPortal(RETURN_RECT, at.x, at.y) ? ({ kind: 'worldExit' } as const) : null;
    const cur = store.get().prompt;
    if (JSON.stringify(prompt) !== JSON.stringify(cur ?? null)) store.set({ prompt });
  }

  // ───────────────────────────────────────────── e2e handles
  private testApi(): ViewTestApi & WorldTestApi {
    const cam = () => this.cameras.main;
    const rect = () => this.game.canvas.getBoundingClientRect();
    return {
      engine: '2d',
      toClient: (x, y) => {
        const c = cam();
        const r = rect();
        return {
          x: r.left + c.x + (x - c.worldView.x) * c.zoom,
          y: r.top + c.y + (y - c.worldView.y) * c.zoom,
        };
      },
      centerOn: (x, y) => cam().centerOn(x, y),
      zoom: () => cam().zoom,
      setZoom: (z) => cam().setZoom(z),
      texts: (all = false) => {
        const out: string[] = [];
        for (const v of this.avatars.values()) if (all || v.label.visible) out.push(v.label.text);
        return out;
      },
      propsCount: () => 0,
      // no props, office blends or build preview inside a personal world (P16.13–14 hooks)
      propScreen: () => null,
      blendKeyAt: () => null,
      previewCells: () => 0,
      settled: () => !this.cellsDirty,
      avatarFrame: (id) => this.avatars.get(id)?.sprite.frame.name ?? null,
      petsDrawn: () => 0,
      world: () => {
        const cell = { cx: Math.floor(this.walker.x / CELL), cy: Math.floor(this.walker.y / CELL) };
        return {
          id: worldSession.worldId,
          x: Math.round(this.walker.x),
          y: Math.round(this.walker.y),
          level: worldSession.terrain?.cellAt(cell.cx, cell.cy).level ?? -1,
          cell,
          people: worldSession.people.size,
          cellsDrawn: this.cells.size,
          plots: worldSession.plots.size,
          farmDay: worldSession.farmDay,
          path: this.walker.path.length,
        };
      },
      levelAt: (cx, cy) => worldSession.terrain?.cellAt(cx, cy).level ?? -1,
      walkableAt: (cx, cy) => worldSession.terrain?.cellAt(cx, cy).walkable ?? false,
    };
  }
}

function reducedMotion(): boolean {
  return window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
}
