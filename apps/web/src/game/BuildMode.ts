/**
 * Build mode inside the world canvas (ADR-021): cursor, stroke preview, grid and
 * collision overlays, camera panning, and turning pointer strokes into edits.
 * The server validates every edit; this class only previews and sends.
 */
import Phaser from 'phaser';
import {
  PALETTE,
  TILE,
  TILESET_NAME,
  TILE_DEFS,
  biomeAt,
  lockedCells,
  mapReader,
  planEdit,
  themedTile,
  tileDef,
  tileNameAt,
  type Biome,
  type Cell,
  type CellChange,
  type EditLayer,
  type WorldMap,
} from '@agora/shared';
import { store, type BuildGroup, type BuildState } from '../state/store';
import { patchBuild, sendEdit } from './build';
import { isTyping, panVector } from './input';
import type { BlendLayers } from './blend/BlendLayers';
import { tileSource } from './blend/BlendLayers';
import { propPlacement } from './blend/compose';
import { BlendPreview } from './blend/preview';

const D_BUILD = 100500;
const PAN_SPEED = 14 * TILE;

type Layers = Record<EditLayer, Phaser.Tilemaps.TilemapLayer | null>;
type Drag = 'paint' | 'erase' | 'pan' | null;

const groupLayer = (g: BuildGroup): EditLayer => PALETTE.find((p) => p.group === g)!.layer;
const frameOf = (name: string) => String(TILE_DEFS.findIndex((d) => d.name === name));

export class BuildMode {
  active = false;
  /** cell under the pointer or the keyboard cursor */
  cursor: Cell = { cx: 0, cy: 0 };
  private gridGfx: Phaser.GameObjects.Graphics;
  private collGfx: Phaser.GameObjects.Graphics;
  private strokeGfx: Phaser.GameObjects.Graphics;
  private cursorGfx: Phaser.GameObjects.Graphics;
  private ghost: Phaser.GameObjects.Image;
  private ghostTop: Phaser.GameObjects.Image;
  private drag: Drag = null;
  private stroke = new Map<string, CellChange>();
  private strokeLayer: EditLayer | null = null;
  private last: Cell | null = null;
  private panFrom: { x: number; y: number; sx: number; sy: number } | null = null;
  private space = false;
  private locked: ReturnType<typeof lockedCells> | null = null;
  private lockedRev = -1;
  private unsub: (() => void)[] = [];
  private preview: BlendPreview;

  constructor(
    private scene: Phaser.Scene,
    private layers: Layers,
    private blend: () => BlendLayers | null = () => null,
  ) {
    const add = scene.add;
    this.gridGfx = add.graphics().setDepth(D_BUILD).setVisible(false);
    this.collGfx = add
      .graphics()
      .setDepth(D_BUILD + 1)
      .setVisible(false);
    this.strokeGfx = add.graphics().setDepth(D_BUILD + 3);
    this.cursorGfx = add.graphics().setDepth(D_BUILD + 4);
    this.ghost = add
      .image(0, 0, TILESET_NAME, '0')
      .setOrigin(0, 0)
      .setAlpha(0.7)
      .setDepth(D_BUILD + 2);
    this.ghostTop = add
      .image(0, 0, TILESET_NAME, '0')
      .setOrigin(0, 0)
      .setAlpha(0.7)
      .setDepth(D_BUILD + 2);
    this.preview = new BlendPreview(scene, D_BUILD + 3);
    this.hideCursor();
    const onKey = (e: KeyboardEvent) => this.onKey(e, true);
    const onUp = (e: KeyboardEvent) => this.onKey(e, false);
    window.addEventListener('keydown', onKey);
    window.addEventListener('keyup', onUp);
    this.unsub.push(() => window.removeEventListener('keydown', onKey));
    this.unsub.push(() => window.removeEventListener('keyup', onUp));
  }

  destroy() {
    this.unsub.forEach((u) => u());
    this.preview.destroy();
  }

  private get map(): WorldMap {
    return store.get().map!;
  }
  private get state(): BuildState | null {
    return store.get().build;
  }

  // ───────────────────────────────────────────── mode
  enter() {
    this.active = true;
    const cam = this.scene.cameras.main;
    cam.stopFollow();
    cam.setBounds(0, 0, this.map.pxWidth, this.map.pxHeight, true);
    const mid = cam.getWorldPoint(cam.width / 2, cam.height / 2);
    this.cursor = { cx: Math.floor(mid.x / TILE), cy: Math.floor(mid.y / TILE) };
    this.drawGrid();
    this.refresh();
  }

  exit() {
    this.active = false;
    this.cancelStroke();
    this.gridGfx.setVisible(false);
    this.collGfx.setVisible(false);
    this.hideCursor();
  }

  /** Build options changed (tool, tile, overlays). */
  refresh() {
    const s = this.state;
    if (!s) return;
    this.gridGfx.setVisible(s.grid);
    this.collGfx.setVisible(s.collision);
    if (s.collision) this.drawCollision();
    this.drawCursor();
  }

  /** Map changed: update tiles for the changed cells and the overlays. */
  onEdit(changes: CellChange[]) {
    const map = this.map;
    for (const c of changes) {
      const layer = this.layers[c.l];
      if (!layer) continue;
      const g = map.layers[c.l]?.[c.y * map.width + c.x] ?? 0;
      if (g) layer.putTileAt(g, c.x, c.y);
      else layer.removeTileAt(c.x, c.y);
    }
    if (this.active && this.state?.collision) this.drawCollision();
    if (this.active) this.drawCursor();
  }

  // ───────────────────────────────────────────── input
  private onKey(e: KeyboardEvent, down: boolean) {
    if (e.code === 'Space') this.space = down && this.active && !isTyping();
    if (!down || !this.active || isTyping() || store.get().dialog) return;
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    // Enter on a focused button belongs to that button, not the canvas cursor
    const onControl = !!(document.activeElement as HTMLElement | null)?.closest?.('button, a');
    const arrows: Record<string, [number, number]> = {
      ArrowUp: [0, -1],
      ArrowDown: [0, 1],
      ArrowLeft: [-1, 0],
      ArrowRight: [1, 0],
    };
    const a = arrows[e.key];
    if (a) {
      e.preventDefault();
      this.moveCursor(a[0], a[1]);
    } else if (e.key === 'Enter' && !onControl) {
      e.preventDefault();
      e.stopImmediatePropagation();
      this.beginStroke(this.state?.tool === 'erase' ? 'erase' : 'paint', this.cursor);
      this.endStroke();
    } else if ((e.key === 'Delete' || e.key === 'Backspace') && !onControl) {
      e.preventDefault();
      this.beginStroke('erase', this.cursor);
      this.endStroke();
    }
  }

  private moveCursor(dx: number, dy: number) {
    const m = this.map;
    this.cursor = {
      cx: Math.max(0, Math.min(m.width - 1, this.cursor.cx + dx)),
      cy: Math.max(0, Math.min(m.height - 1, this.cursor.cy + dy)),
    };
    const cam = this.scene.cameras.main;
    const v = cam.worldView;
    const x = this.cursor.cx * TILE;
    const y = this.cursor.cy * TILE;
    if (x < v.x + TILE || x > v.right - 2 * TILE || y < v.y + TILE || y > v.bottom - 2 * TILE)
      cam.centerOn(x + TILE / 2, y + TILE / 2);
    this.drawCursor();
  }

  private cellAt(p: Phaser.Input.Pointer): Cell {
    const m = this.map;
    return {
      cx: Math.max(0, Math.min(m.width - 1, Math.floor(p.worldX / TILE))),
      cy: Math.max(0, Math.min(m.height - 1, Math.floor(p.worldY / TILE))),
    };
  }

  pointerDown(p: Phaser.Input.Pointer) {
    (document.activeElement as HTMLElement | null)?.blur?.();
    if (p.button === 1 || (p.button === 0 && this.space)) {
      const cam = this.scene.cameras.main;
      this.drag = 'pan';
      this.panFrom = { x: p.x, y: p.y, sx: cam.scrollX, sy: cam.scrollY };
      return;
    }
    const cell = this.cellAt(p);
    this.cursor = cell;
    if (p.button === 2) return this.beginStroke('erase', cell);
    if (p.button !== 0) return;
    if (this.state?.tool === 'pick') return this.pick(cell);
    this.beginStroke(this.state?.tool === 'erase' ? 'erase' : 'paint', cell);
  }

  pointerMove(p: Phaser.Input.Pointer) {
    if (this.drag === 'pan' && this.panFrom) {
      const cam = this.scene.cameras.main;
      cam.setScroll(
        this.panFrom.sx - (p.x - this.panFrom.x) / cam.zoom,
        this.panFrom.sy - (p.y - this.panFrom.y) / cam.zoom,
      );
      return;
    }
    const cell = this.cellAt(p);
    if (cell.cx === this.cursor.cx && cell.cy === this.cursor.cy && this.drag) return;
    this.cursor = cell;
    if (this.drag === 'paint' || this.drag === 'erase') this.extendStroke(cell);
    this.drawCursor();
  }

  pointerUp() {
    if (this.drag === 'pan') {
      this.drag = null;
      this.panFrom = null;
      return;
    }
    this.endStroke();
  }

  // ───────────────────────────────────────────── strokes
  private beginStroke(kind: 'paint' | 'erase', cell: Cell) {
    this.cancelStroke();
    this.drag = kind;
    this.strokeLayer = kind === 'paint' ? groupLayer(this.state!.group) : this.eraseLayer(cell);
    this.last = cell;
    this.addCell(cell);
    this.drawStroke();
  }

  private extendStroke(to: Cell) {
    const from = this.last ?? to;
    // Bresenham so fast drags leave no gaps
    let x = from.cx;
    let y = from.cy;
    const dx = Math.abs(to.cx - x);
    const dy = -Math.abs(to.cy - y);
    const sx = x < to.cx ? 1 : -1;
    const sy = y < to.cy ? 1 : -1;
    let err = dx + dy;
    for (let guard = 0; guard < 400; guard++) {
      this.addCell({ cx: x, cy: y });
      if (x === to.cx && y === to.cy) break;
      const e2 = 2 * err;
      if (e2 >= dy) {
        err += dy;
        x += sx;
      }
      if (e2 <= dx) {
        err += dx;
        y += sy;
      }
    }
    this.last = to;
    this.drawStroke();
  }

  private endStroke() {
    if (this.drag === 'paint' || this.drag === 'erase') sendEdit([...this.stroke.values()]);
    this.cancelStroke();
  }

  private cancelStroke() {
    this.drag = null;
    this.stroke.clear();
    this.strokeLayer = null;
    this.last = null;
    this.strokeGfx.clear();
    this.preview.hide(this.blend());
  }

  /** Topmost thing to erase at a cell: hanging decor, props, furniture, then walls. */
  private eraseLayer(c: Cell): EditLayer | null {
    const m = this.map;
    const above = tileDef(m.layers.above?.[c.cy * m.width + c.cx] ?? 0);
    if (above && above.base !== 'treeTop') return 'above';
    if (tileNameAt(m, 'props', c.cx, c.cy)) return 'props';
    if (tileNameAt(m, 'furniture', c.cx, c.cy)) return 'furniture';
    if (tileNameAt(m, 'walls', c.cx, c.cy)) return 'walls';
    return null;
  }

  private tileFor(c: Cell): string | null {
    const s = this.state!;
    const theme = s.theme === 'auto' ? biomeAt(this.map, c.cx, c.cy) : s.theme;
    return themedTile(s.base[s.group], theme);
  }

  private addCell(c: Cell) {
    const ch = this.changeAt(c, this.drag === 'paint' ? 'paint' : 'erase', this.strokeLayer);
    if (ch) this.stroke.set(`${c.cx},${c.cy}`, ch);
  }

  /** The cell write a paint or erase would make here (null: nothing would change). */
  private changeAt(c: Cell, kind: 'paint' | 'erase', layer: EditLayer | null): CellChange | null {
    const l = layer;
    if (!l) return null;
    const m = this.map;
    let t: string | null;
    if (kind === 'paint') t = this.tileFor(c);
    else t = l === 'floor' ? themedTile('floor', biomeAt(m, c.cx, c.cy)) : null;
    if (tileNameAt(m, l, c.cx, c.cy) === t) return null;
    return { l, x: c.cx, y: c.cy, t };
  }

  private pick(c: Cell) {
    const m = this.map;
    const i = c.cy * m.width + c.cx;
    const order: [EditLayer, BuildGroup][] = [
      ['above', 'overhead'],
      ['props', 'props'],
      ['furniture', 'objects'],
      ['walls', 'walls'],
      ['floor', 'floor'],
    ];
    for (const [l, group] of order) {
      const def = tileDef(m.layers[l]?.[i] ?? 0);
      if (!def || def.base === 'treeTop') continue;
      const base = def.base === 'wallFront' ? 'wallTop' : def.base;
      if (!PALETTE.find((p) => p.group === group)?.bases.includes(base)) continue;
      const s = this.state!;
      patchBuild({
        tool: 'paint',
        group,
        base: { ...s.base, [group]: base },
        theme: def.biome ? (def.biome as Biome) : s.theme,
      });
      return;
    }
  }

  // ───────────────────────────────────────────── drawing
  private isLocked(c: Cell, l: EditLayer | null): boolean {
    const s = store.get();
    if (this.lockedRev !== s.mapRev || !this.locked) {
      this.locked = lockedCells(this.map);
      this.lockedRev = s.mapRev;
    }
    const lock = this.locked.get(c.cy * 100000 + c.cx);
    if (!lock) return false;
    return lock === 'locked_portal' || l === 'furniture' || l === 'walls' || l === 'props';
  }

  private drawStroke() {
    const g = this.strokeGfx;
    g.clear();
    const erase = this.drag === 'erase';
    for (const c of this.stroke.values()) {
      const bad = this.isLocked({ cx: c.x, cy: c.y }, c.l);
      g.fillStyle(bad ? 0xc2364b : erase ? 0xf2a900 : 0x5fd3c6, 0.3);
      g.fillRect(c.x * TILE, c.y * TILE, TILE, TILE);
    }
    this.showPreview([...this.stroke.values()]);
  }

  /**
   * Blended preview (P9.12) of the edit the server would make. Returns true when it shows the
   * result, so the plain ghost tile can step aside.
   */
  private showPreview(cells: CellChange[]): boolean {
    const blend = this.blend();
    if (!blend || !cells.length) {
      this.preview.hide(blend);
      return false;
    }
    const plan = planEdit(this.map, cells);
    if (!plan.ok || !plan.changes.length) {
      this.preview.hide(blend);
      return false;
    }
    const skip = new Set(cells.map((c) => c.y * this.map.width + c.x));
    this.preview.show(blend, this.map, plan.changes, this.cursor, skip);
    return cells.some((c) => c.l === 'floor' || c.l === 'furniture');
  }

  private hideCursor() {
    this.cursorGfx.clear();
    this.ghost.setVisible(false);
    this.ghostTop.setVisible(false);
    this.preview.hide(this.blend());
  }

  drawCursor() {
    const s = this.state;
    if (!this.active || !s) return this.hideCursor();
    const { cx, cy } = this.cursor;
    const here = biomeAt(this.map, cx, cy);
    if (store.get().cursorBiome !== here) store.set({ cursorBiome: here });
    const g = this.cursorGfx;
    g.clear();
    const x = cx * TILE;
    const y = cy * TILE;
    const layer = s.tool === 'paint' ? groupLayer(s.group) : this.eraseLayer(this.cursor);
    const bad = s.tool !== 'pick' && this.isLocked(this.cursor, layer);
    const color = bad
      ? 0xc2364b
      : s.tool === 'erase'
        ? 0xf2a900
        : s.tool === 'pick'
          ? 0xb49cff
          : 0xf3f6f8;
    g.lineStyle(2, 0x17324d, 0.9).strokeRect(x - 1, y - 1, TILE + 2, TILE + 2);
    g.lineStyle(2, color, 1).strokeRect(x, y, TILE, TILE);
    // while a stroke is open, drawStroke owns the preview
    const shown =
      !this.drag && s.tool !== 'pick' && !bad
        ? this.showPreview(
            [this.changeAt(this.cursor, s.tool === 'erase' ? 'erase' : 'paint', layer)].filter(
              (c): c is CellChange => !!c,
            ),
          )
        : !!this.drag;
    if (!this.drag && (s.tool === 'pick' || bad)) this.preview.hide(this.blend());
    if (s.tool !== 'paint') {
      this.ghost.setVisible(false);
      this.ghostTop.setVisible(false);
      return;
    }
    const name = this.tileFor(this.cursor)!;
    if (layer === 'props') {
      // a prop rests on the surface under it; red where there is none
      const px = tileSource().tile(name);
      const p = px && propPlacement(mapReader(this.map), px, cx, cy, !!this.blend());
      this.ghost
        .setFrame(frameOf(name))
        .setPosition(p ? p.ox : x, p ? p.oy : y)
        .setTint(bad || !p ? 0xff8080 : 0xffffff)
        .setVisible(true);
      if (!p) g.lineStyle(2, 0xc2364b, 1).strokeRect(x, y, TILE, TILE);
      this.ghostTop.setVisible(false);
      return;
    }
    this.ghost.setFrame(frameOf(name)).setPosition(x, y).setVisible(!shown);
    this.ghost.setTint(bad ? 0xff8080 : 0xffffff);
    const top = name.endsWith('.treeBase') ? name.replace('treeBase', 'treeTop') : null;
    this.ghostTop.setVisible(!!top && cy > 0);
    if (top) this.ghostTop.setFrame(frameOf(top)).setPosition(x, y - TILE);
  }

  private drawGrid() {
    const m = this.map;
    const g = this.gridGfx;
    g.clear();
    g.lineStyle(1, 0xf3f6f8, 0.12);
    for (let x = 0; x <= m.width; x++) g.lineBetween(x * TILE, 0, x * TILE, m.pxHeight);
    for (let y = 0; y <= m.height; y++) g.lineBetween(0, y * TILE, m.pxWidth, y * TILE);
    g.lineStyle(2, 0xf2a900, 0.35);
    for (const r of m.regions) g.strokeRect(r.x, r.y, r.w, r.h);
  }

  private drawCollision() {
    const m = this.map;
    const g = this.collGfx;
    g.clear();
    for (let i = 0; i < m.width * m.height; i++) {
      const cx = i % m.width;
      const cy = (i - cx) / m.width;
      if (m.solid[i]) {
        g.fillStyle(0xc2364b, 0.32);
        g.fillRect(cx * TILE, cy * TILE, TILE, TILE);
      } else if (m.sit[i]) {
        g.fillStyle(0x5fd3c6, 0.3);
        g.fillRect(cx * TILE, cy * TILE, TILE, TILE);
      }
    }
    if (!this.locked || this.lockedRev !== store.get().mapRev)
      this.isLocked({ cx: 0, cy: 0 }, null);
    g.lineStyle(1, 0xb49cff, 0.9);
    for (const k of this.locked!.keys()) {
      const cx = k % 100000;
      const cy = Math.floor(k / 100000);
      g.strokeRect(cx * TILE + 3, cy * TILE + 3, TILE - 6, TILE - 6);
    }
  }

  // ───────────────────────────────────────────── frame
  update(dtMs: number) {
    if (!this.active) return;
    const [ix, iy] = panVector();
    if (ix || iy) {
      const cam = this.scene.cameras.main;
      const step = (PAN_SPEED * Math.min(dtMs, 100)) / 1000 / Math.max(0.5, cam.zoom / 2);
      cam.setScroll(cam.scrollX + ix * step, cam.scrollY + iy * step);
    }
  }
}
