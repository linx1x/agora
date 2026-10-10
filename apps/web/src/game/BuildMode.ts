/**
 * Build mode inside the world canvas (ADR-021): cursor, stroke preview, grid and
 * collision overlays, camera panning, and turning pointer strokes into edits.
 * The server validates every edit; this class only previews and sends.
 *
 * Phase 9c (ADR-039) adds Paralives-style placement: props snap to spots on a top face (Alt or
 * the Snap toggle places them to the pixel), the Select tool picks up, drags and nudges a prop
 * (its riders follow), raises, flips and turns it, and stretches a desk run with handles.
 */
import Phaser from 'phaser';
import {
  PALETTE,
  TILE,
  TILESET_NAME,
  TILE_DEFS,
  MAX_LIFT,
  applyPropChange,
  biomeAt,
  cellChanges,
  dropPoint,
  joinMask,
  lockedCells,
  mapReader,
  newPropId,
  planEdit,
  propCell,
  resolveProps,
  ridersOf,
  rotatedBase,
  rotatedTile,
  snapSpots,
  themedTile,
  tileDef,
  tileNameAt,
  type Biome,
  type Cell,
  type CellChange,
  type EditLayer,
  type MapChange,
  type PaintLayer,
  type PropChange,
  type TileReader,
  type WorldMap,
} from '@agora/shared';
import { store, toast, type BuildGroup, type BuildSel, type BuildState } from '../state/store';
import { onSelCmd, patchBuild, sendEdit, type SelCmd } from './build';
import { isTyping, panVector } from './input';
import type { BlendLayers } from './blend/BlendLayers';
import { tileSource } from './blend/BlendLayers';
import { placedSprite } from './blend/compose';
import { BlendPreview } from './blend/preview';
import type { PropsView } from './blend/PropsView';

const D_BUILD = 100500;
const PAN_SPEED = 14 * TILE;
/** keyboard nudges and raises are sent once the keys rest this long (one undo step) */
const NUDGE_IDLE_MS = 400;
/** a press on a prop becomes a drag after this many screen px */
const DRAG_PX = 4;
const HANDLE = 7;

type Layers = Record<EditLayer, Phaser.Tilemaps.TilemapLayer | null>;
type Drag = 'paint' | 'erase' | 'pan' | 'move' | 'stretch' | null;
type Dir = 'n' | 'e' | 's' | 'w';
const DIRV: Record<Dir, [number, number]> = { n: [0, -1], e: [1, 0], s: [0, 1], w: [-1, 0] };
const ARROW_DIR: Record<string, Dir> = {
  ArrowUp: 'n',
  ArrowRight: 'e',
  ArrowDown: 's',
  ArrowLeft: 'w',
};

/** What the Select tool holds. A run is found again from its anchor cell after every edit. */
type Sel =
  | { kind: 'prop'; id: string }
  | { kind: 'run'; ax: number; ay: number }
  | { kind: 'cell'; cx: number; cy: number };

const groupLayer = (g: BuildGroup): PaintLayer => PALETTE.find((p) => p.group === g)!.layer;
const frameOf = (name: string) => String(TILE_DEFS.findIndex((d) => d.name === name));
const clampZ = (z: number) => Math.max(0, Math.min(MAX_LIFT, z));

/** A straight run of joined furniture through a cell, and where it can grow (P9.18). */
export interface Run {
  cells: Cell[];
  axes: ('h' | 'v')[];
  /** end cell per direction it can grow or shrink towards */
  ends: Partial<Record<Dir, Cell>>;
}
export function runAt(r: TileReader, x: number, y: number): Run | null {
  const d = r.def('furniture', x, y);
  if (!d?.join) return null;
  const m = joinMask(r, x, y);
  const walk = (dx: number, dy: number, bit: number) => {
    const out: Cell[] = [];
    let cx = x;
    let cy = y;
    while (joinMask(r, cx, cy) & bit) {
      cx += dx;
      cy += dy;
      out.push({ cx, cy });
      if (out.length > 200) break;
    }
    return out;
  };
  if (m & 10 || (!(m & 5) && d.join.eastWestOnly)) {
    const w = walk(-1, 0, 8).reverse();
    const e = walk(1, 0, 2);
    const cells = [...w, { cx: x, cy: y }, ...e];
    return { cells, axes: ['h'], ends: { w: cells[0]!, e: cells.at(-1)! } };
  }
  if (m & 5) {
    const n = walk(0, -1, 1).reverse();
    const s = walk(0, 1, 4);
    const cells = [...n, { cx: x, cy: y }, ...s];
    return { cells, axes: ['v'], ends: { n: cells[0]!, s: cells.at(-1)! } };
  }
  // a lone joinable tile can start a run either way
  const c = { cx: x, cy: y };
  return { cells: [c], axes: ['h', 'v'], ends: { n: c, e: c, s: c, w: c } };
}

/** Tile a run grows with: its end's tile, but a desk with a monitor grows as a plain desk. */
export function growTile(name: string): string {
  const def = TILE_DEFS.find((d) => d.name === name);
  if (def?.join?.prop && def.biome) return `${def.biome}.deskH`;
  return name;
}

export class BuildMode {
  active = false;
  /** cell under the pointer or the keyboard cursor */
  cursor: Cell = { cx: 0, cy: 0 };
  private gridGfx: Phaser.GameObjects.Graphics;
  private collGfx: Phaser.GameObjects.Graphics;
  private strokeGfx: Phaser.GameObjects.Graphics;
  private cursorGfx: Phaser.GameObjects.Graphics;
  private selGfx: Phaser.GameObjects.Graphics;
  private ghost: Phaser.GameObjects.Image;
  private ghostTop: Phaser.GameObjects.Image;
  private propGhosts: Phaser.GameObjects.Image[] = [];
  private drag: Drag = null;
  private stroke = new Map<string, CellChange>();
  private strokeLayer: EditLayer | null = null;
  private last: Cell | null = null;
  private panFrom: { x: number; y: number; sx: number; sy: number } | null = null;
  private space = false;
  private alt = false;
  /** pointer in world px; null after keyboard use (the cursor cell's spot is used instead) */
  private pt: { x: number; y: number } | null = null;
  private locked: ReturnType<typeof lockedCells> | null = null;
  private lockedRev = -1;
  private unsub: (() => void)[] = [];
  private preview: BlendPreview;
  private sel: Sel | null = null;
  /** id the next placed prop gets (stable while its ghost shows) */
  private nextId = newPropId();
  /** a press or drag on the selected prop */
  private grab: {
    id: string;
    sx: number;
    sy: number;
    off: { x: number; y: number };
    moved: PropChange[] | null;
  } | null = null;
  /** keyboard nudge / raise waiting to be sent */
  private pend: { dx: number; dy: number; dz: number } | null = null;
  private pendTimer: ReturnType<typeof setTimeout> | undefined;
  private stretch: { dir: Dir; cells: CellChange[] } | null = null;

  constructor(
    private scene: Phaser.Scene,
    private layers: Layers,
    private blend: () => BlendLayers | null = () => null,
    private props: () => PropsView | null = () => null,
  ) {
    const add = scene.add;
    this.gridGfx = add.graphics().setDepth(D_BUILD).setVisible(false);
    this.collGfx = add
      .graphics()
      .setDepth(D_BUILD + 1)
      .setVisible(false);
    this.strokeGfx = add.graphics().setDepth(D_BUILD + 3);
    this.cursorGfx = add.graphics().setDepth(D_BUILD + 4);
    this.selGfx = add.graphics().setDepth(D_BUILD + 5);
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
    const onBlur = () => {
      this.alt = false;
      this.space = false;
    };
    window.addEventListener('keydown', onKey);
    window.addEventListener('keyup', onUp);
    window.addEventListener('blur', onBlur);
    this.unsub.push(() => window.removeEventListener('keydown', onKey));
    this.unsub.push(() => window.removeEventListener('keyup', onUp));
    this.unsub.push(() => window.removeEventListener('blur', onBlur));
    this.unsub.push(onSelCmd((c) => this.command(c)));
  }

  destroy() {
    this.unsub.forEach((u) => u());
    clearTimeout(this.pendTimer);
    this.preview.destroy();
  }

  private get map(): WorldMap {
    return store.get().map!;
  }
  private get state(): BuildState | null {
    return store.get().build;
  }
  /** Phase 9c tools (flag `placement`) */
  private get placement(): boolean {
    return store.get().config?.flags.placement !== false;
  }
  /** Snap props to spots? The panel toggle, inverted while Alt is held. */
  private get snap(): boolean {
    if (!this.placement) return true;
    return (this.state?.snap ?? true) !== this.alt;
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
    this.flushPending();
    this.cancelStroke();
    this.setSel(null);
    this.gridGfx.setVisible(false);
    this.collGfx.setVisible(false);
    this.hideCursor();
  }

  /** Build options changed (tool, tile, overlays). */
  refresh() {
    const s = this.state;
    if (!s) return;
    if (s.tool !== 'select' && this.sel) this.setSel(null);
    this.gridGfx.setVisible(s.grid);
    this.collGfx.setVisible(s.collision);
    if (s.collision) this.drawCollision();
    this.drawCursor();
  }

  /** Map changed (after PropsView synced): tiles for the changed cells, overlays, selection. */
  onEdit(changes: MapChange[]) {
    const map = this.map;
    for (const c of cellChanges(changes)) {
      const layer = this.layers[c.l];
      if (!layer) continue;
      const g = map.layers[c.l]?.[c.y * map.width + c.x] ?? 0;
      if (g) layer.putTileAt(g, c.x, c.y);
      else layer.removeTileAt(c.x, c.y);
    }
    if (
      this.sel?.kind === 'prop' &&
      !map.props.some((p) => p.id === (this.sel as { id: string }).id)
    )
      this.setSel(null);
    else if (this.sel?.kind === 'run' && !runAt(mapReader(map), this.sel.ax, this.sel.ay))
      this.setSel(null);
    else if (this.sel?.kind === 'cell' && !tileNameAt(map, 'furniture', this.sel.cx, this.sel.cy))
      this.setSel(null);
    else this.publishSel();
    if (this.active && this.state?.collision) this.drawCollision();
    if (this.active) this.drawCursor();
  }

  // ───────────────────────────────────────────── input
  private onKey(e: KeyboardEvent, down: boolean) {
    if (e.key === 'Alt') {
      this.alt = down && this.active;
      if (this.active) {
        e.preventDefault(); // no browser menu bar while placing
        this.drawCursor();
      }
      return;
    }
    if (e.code === 'Space') this.space = down && this.active && !isTyping();
    if (!down || !this.active || isTyping() || store.get().dialog) return;
    if (e.metaKey) return;
    // Enter on a focused button belongs to that button, not the canvas cursor
    const onControl = !!(document.activeElement as HTMLElement | null)?.closest?.('button, a');
    const s = this.state;
    const dir = ARROW_DIR[e.key];
    const k = e.key.toLowerCase();
    // Select tool: arrows nudge a prop, Shift+arrow grows a run, Ctrl+Shift+arrow shrinks it
    if (s?.tool === 'select' && this.sel && dir && !e.altKey) {
      if (this.sel.kind === 'prop' && !e.ctrlKey) {
        e.preventDefault();
        const step = e.shiftKey ? 4 : 1;
        const [dx, dy] = DIRV[dir];
        return this.command({ t: 'nudge', dx: dx * step, dy: dy * step });
      }
      if (this.sel.kind === 'run' && e.shiftKey) {
        e.preventDefault();
        return this.command({ t: e.ctrlKey ? 'shrink' : 'grow', dir });
      }
    }
    if (e.ctrlKey || e.altKey) return;
    if (dir) {
      e.preventDefault();
      const [dx, dy] = DIRV[dir];
      this.moveCursor(dx, dy);
    } else if (e.key === 'Enter' && !onControl) {
      e.preventDefault();
      e.stopImmediatePropagation();
      if (s?.tool === 'select') return this.selectAt(this.cursor, null);
      if (s?.tool === 'paint' && groupLayer(s.group) === 'prop') return this.placeProp();
      this.beginStroke(s?.tool === 'erase' ? 'erase' : 'paint', this.cursor);
      this.endStroke();
    } else if ((e.key === 'Delete' || e.key === 'Backspace') && !onControl) {
      e.preventDefault();
      if (this.sel) return this.command({ t: 'delete' });
      this.eraseAtCursor();
    } else if (!this.placement) return;
    else if (k === 'f' && !onControl) {
      if (this.sel?.kind === 'prop') this.command({ t: 'flip' });
      else if (s?.tool === 'paint' && s.group === 'props') patchBuild({ flip: !s.flip });
    } else if (k === 'r' && !onControl) {
      if (this.sel) this.command({ t: 'rotate' });
      else if (s?.tool === 'paint') {
        const next = rotatedBase(s.base[s.group]);
        if (next && PALETTE.find((p) => p.group === s.group)?.bases.includes(next))
          patchBuild({ base: { ...s.base, [s.group]: next } });
      }
    } else if ((e.key === 'PageUp' || e.key === 'PageDown') && this.sel?.kind === 'prop') {
      e.preventDefault();
      this.command({ t: 'raise', dz: e.key === 'PageUp' ? 1 : -1 });
    }
  }

  private moveCursor(dx: number, dy: number) {
    const m = this.map;
    this.pt = null;
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

  private trackAlt(p: Phaser.Input.Pointer) {
    const ev = p.event as MouseEvent | undefined;
    if (ev && typeof ev.altKey === 'boolean') this.alt = ev.altKey;
  }

  pointerDown(p: Phaser.Input.Pointer) {
    (document.activeElement as HTMLElement | null)?.blur?.();
    this.trackAlt(p);
    this.pt = { x: p.worldX, y: p.worldY };
    if (p.button === 1 || (p.button === 0 && this.space)) {
      const cam = this.scene.cameras.main;
      this.drag = 'pan';
      this.panFrom = { x: p.x, y: p.y, sx: cam.scrollX, sy: cam.scrollY };
      return;
    }
    const cell = this.cellAt(p);
    this.cursor = cell;
    const tool = this.state?.tool;
    if (p.button === 2) {
      const hit = this.props()?.hit(p.worldX, p.worldY);
      if (hit) return sendEdit([{ l: 'prop', id: hit.id, p: null }]);
      return this.beginStroke('erase', cell);
    }
    if (p.button !== 0) return;
    if (tool === 'pick') return this.pick(cell);
    if (tool === 'select') return this.selectAt(cell, p);
    if (tool === 'erase') {
      const hit = this.props()?.hit(p.worldX, p.worldY);
      if (hit) return sendEdit([{ l: 'prop', id: hit.id, p: null }]);
      return this.beginStroke('erase', cell);
    }
    if (this.state && groupLayer(this.state.group) === 'prop') return this.placeProp();
    this.beginStroke('paint', cell);
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
    this.trackAlt(p);
    this.pt = { x: p.worldX, y: p.worldY };
    const cell = this.cellAt(p);
    if (this.drag === 'move' && this.grab) return this.dragProp(p);
    if (this.drag === 'stretch') {
      this.cursor = cell;
      return this.dragStretch();
    }
    const sameCell = cell.cx === this.cursor.cx && cell.cy === this.cursor.cy;
    this.cursor = cell;
    if (this.drag === 'paint' || this.drag === 'erase') {
      if (!sameCell) this.extendStroke(cell);
      return;
    }
    this.drawCursor();
  }

  pointerUp() {
    if (this.drag === 'pan') {
      this.drag = null;
      this.panFrom = null;
      return;
    }
    if (this.drag === 'move') {
      const moved = this.grab?.moved;
      this.grab = null;
      this.drag = null;
      this.props()?.dim(new Set());
      this.hidePropGhosts();
      if (moved?.length) this.sendChecked(moved);
      this.drawCursor();
      return;
    }
    if (this.drag === 'stretch') {
      const cells = this.stretch?.cells ?? [];
      this.drag = null;
      this.stretch = null;
      this.strokeGfx.clear();
      this.preview.hide(this.blend());
      if (cells.length) this.sendChecked(cells);
      this.drawCursor();
      return;
    }
    this.grab = null;
    this.endStroke();
  }

  // ───────────────────────────────────────────── strokes
  private beginStroke(kind: 'paint' | 'erase', cell: Cell) {
    this.cancelStroke();
    const layer = kind === 'paint' ? groupLayer(this.state!.group) : this.eraseLayer(cell);
    if (layer === 'prop') return;
    this.drag = kind;
    this.strokeLayer = layer;
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
    if (this.drag === 'move') this.props()?.dim(new Set());
    this.drag = null;
    this.grab = null;
    this.stretch = null;
    this.stroke.clear();
    this.strokeLayer = null;
    this.last = null;
    this.strokeGfx.clear();
    this.hidePropGhosts();
    this.preview.hide(this.blend());
  }

  /** Topmost thing to erase at a cell: hanging decor, furniture, then walls (props: by hit). */
  private eraseLayer(c: Cell): EditLayer | null {
    const m = this.map;
    const above = tileDef(m.layers.above?.[c.cy * m.width + c.cx] ?? 0);
    if (above && above.base !== 'treeTop') return 'above';
    if (tileNameAt(m, 'furniture', c.cx, c.cy)) return 'furniture';
    if (tileNameAt(m, 'walls', c.cx, c.cy)) return 'walls';
    return null;
  }

  /** Keyboard erase: the topmost prop whose base is in the cursor cell, else the cell. */
  private eraseAtCursor() {
    const top = this.topPropIn(this.cursor);
    if (top) return sendEdit([{ l: 'prop', id: top, p: null }]);
    this.beginStroke('erase', this.cursor);
    this.endStroke();
  }

  private topPropIn(c: Cell): string | null {
    const boxes = this.props()?.boxes ?? [];
    let best: { id: string; depth: number } | null = null;
    for (const b of boxes) {
      const p = this.map.props[b.index];
      if (!p) continue;
      const pc = propCell(p, this.map.tile);
      if (pc.cx === c.cx && pc.cy === c.cy && (!best || b.depth > best.depth)) best = b;
    }
    return best?.id ?? null;
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
    const s = this.state!;
    const hit = this.pt ? this.props()?.hit(this.pt.x, this.pt.y) : null;
    const prop = hit ? m.props[hit.index] : null;
    if (prop) {
      patchBuild({
        tool: 'paint',
        group: 'props',
        base: { ...s.base, props: prop.t },
        ...(this.placement ? { flip: prop.f } : {}),
      });
      return;
    }
    const i = c.cy * m.width + c.cx;
    const order: [EditLayer, BuildGroup][] = [
      ['above', 'overhead'],
      ['furniture', 'objects'],
      ['walls', 'walls'],
      ['floor', 'floor'],
    ];
    for (const [l, group] of order) {
      const def = tileDef(m.layers[l]?.[i] ?? 0);
      if (!def || def.base === 'treeTop') continue;
      const base = def.base === 'wallFront' ? 'wallTop' : def.base;
      if (!PALETTE.find((p) => p.group === group)?.bases.includes(base)) continue;
      patchBuild({
        tool: 'paint',
        group,
        base: { ...s.base, [group]: base },
        theme: def.biome ? (def.biome as Biome) : s.theme,
      });
      return;
    }
  }

  // ───────────────────────────────────────────── props (P9.16, P9.17)
  /** Base point a new prop would get: under the pointer, or the cursor cell's middle spot. */
  private dropFor(skip?: Set<string>): { x: number; y: number } | null {
    const m = this.map;
    const r = mapReader(m);
    const list = skip ? m.props.filter((p) => !skip.has(p.id)) : m.props;
    if (this.pt) return dropPoint(r, list, this.pt.x, this.pt.y, this.snap);
    const spots = snapSpots(r, this.cursor.cx, this.cursor.cy);
    return spots.reduce<{ x: number; y: number } | null>(
      (a, b) =>
        !a ||
        Math.abs(b.x - (this.cursor.cx * TILE + 16)) < Math.abs(a.x - (this.cursor.cx * TILE + 16))
          ? b
          : a,
      null,
    );
  }

  /** The prop the brush would place now, or null when nothing here can hold it. */
  private newProp(): PropChange | null {
    const s = this.state!;
    const d = this.dropFor();
    if (!d) return null;
    const t = this.tileFor(this.cursor)!;
    return {
      l: 'prop',
      id: this.nextId,
      p: { t, x: d.x, y: d.y, z: 0, f: this.placement && s.flip },
    };
  }

  private placeProp() {
    const c = this.newProp();
    if (!c) return toast('build.refused.no_surface', undefined, 3000);
    this.nextId = newPropId();
    this.sendChecked([c]);
    this.drawCursor();
  }

  /** Validate locally first so a refusal shows at once (the server checks again). */
  private sendChecked(changes: MapChange[]): boolean {
    const plan = planEdit(this.map, changes);
    if (!plan.ok) {
      toast(`build.refused.${plan.reason}`, undefined, 4000);
      return false;
    }
    if (plan.changes.length) sendEdit(changes);
    return true;
  }

  /** Changes that move prop `id` (and what rests on it) by (dx, dy), its own raise by dz. */
  private moveChanges(
    id: string,
    dx: number,
    dy: number,
    dz: number,
    toTop: boolean,
  ): PropChange[] {
    const m = this.map;
    const rest = resolveProps(mapReader(m), m.props);
    const i = m.props.findIndex((p) => p.id === id);
    if (i < 0) return [];
    return [i, ...ridersOf(rest, i)].map((k) => {
      const p = m.props[k]!;
      return {
        l: 'prop',
        id: p.id,
        p: { t: p.t, x: p.x + dx, y: p.y + dy, z: k === i ? clampZ(p.z + dz) : p.z, f: p.f },
        // a dragged item goes to the top of the list so it can land on any stack
        ...(toTop ? { i: 100_000 } : {}),
      };
    });
  }

  private ghostPool(n: number): Phaser.GameObjects.Image {
    while (this.propGhosts.length <= n)
      this.propGhosts.push(
        this.scene.add
          .image(0, 0, TILESET_NAME, '0')
          .setOrigin(0, 0)
          .setDepth(D_BUILD + 2)
          .setVisible(false),
      );
    return this.propGhosts[n]!;
  }

  private hidePropGhosts() {
    for (const g of this.propGhosts) g.setVisible(false);
  }

  /** Draw the props `changes` would place, tinted red when the edit would be refused. */
  private showPropGhosts(changes: PropChange[], bad: boolean) {
    const m = this.map;
    const hyp = m.props.slice();
    for (const c of changes) applyPropChange(hyp, c);
    const rest = resolveProps(mapReader(m), hyp);
    const src = tileSource();
    let n = 0;
    for (const c of changes) {
      if (!c.p) continue;
      const i = hyp.findIndex((q) => q.id === c.id);
      const p = hyp[i]!;
      const px = src.tile(p.t);
      if (!px) continue;
      const s = placedSprite(px, p, rest[i]!.lift);
      this.ghostPool(n++)
        .setFrame(frameOf(p.t))
        .setPosition(s.ox, s.oy)
        .setFlipX(p.f)
        .setTint(bad ? 0xff8080 : 0xffffff)
        .setAlpha(bad ? 0.75 : 0.9)
        .setVisible(true);
    }
    for (let k = n; k < this.propGhosts.length; k++) this.propGhosts[k]!.setVisible(false);
  }

  // ───────────────────────────────────────────── Select tool (P9.17–P9.20)
  private setSel(sel: Sel | null) {
    if (this.pend) this.flushPending();
    this.sel = sel;
    this.publishSel();
    this.drawSel();
  }

  private publishSel() {
    const m = this.map;
    const sel = this.sel;
    let out: BuildSel | null = null;
    if (sel?.kind === 'prop') {
      const p = m.props.find((q) => q.id === sel.id);
      if (p) {
        const d = this.pend;
        out = {
          kind: 'prop',
          id: p.id,
          t: p.t,
          x: p.x + (d?.dx ?? 0),
          y: p.y + (d?.dy ?? 0),
          z: clampZ(p.z + (d?.dz ?? 0)),
          f: p.f,
          turn: !!rotatedTile(p.t),
        };
      }
    } else if (sel?.kind === 'run') {
      const run = runAt(mapReader(m), sel.ax, sel.ay);
      const t = tileNameAt(m, 'furniture', sel.ax, sel.ay);
      if (run && t) out = { kind: 'run', t, axes: run.axes, len: run.cells.length };
    } else if (sel?.kind === 'cell') {
      const t = tileNameAt(m, 'furniture', sel.cx, sel.cy);
      if (t) out = { kind: 'cell', t, turn: !!rotatedTile(t) };
    }
    const cur = store.get().buildSel;
    if (JSON.stringify(cur) !== JSON.stringify(out)) store.set({ buildSel: out });
  }

  /** Press with the Select tool: a handle, a prop (maybe a drag), furniture, or nothing. */
  private selectAt(cell: Cell, p: Phaser.Input.Pointer | null) {
    const m = this.map;
    if (p && this.sel?.kind === 'run') {
      const h = this.handleAt(p.worldX, p.worldY);
      if (h) {
        this.drag = 'stretch';
        this.stretch = { dir: h, cells: [] };
        return;
      }
    }
    const hit = p ? this.props()?.hit(p.worldX, p.worldY, 1) : null;
    const id = hit?.id ?? (p ? null : this.topPropIn(cell));
    if (id) {
      this.setSel({ kind: 'prop', id });
      const i = m.props.findIndex((q) => q.id === id);
      const box = this.props()?.boxes[i];
      if (p && box) {
        const prop = m.props[i]!;
        // keep the pointer where it grabbed the item: aim at its drawn base point
        this.grab = {
          id,
          sx: p.x,
          sy: p.y,
          off: { x: prop.x - p.worldX, y: box.baseY - p.worldY },
          moved: null,
        };
        this.drag = 'move';
      }
      return;
    }
    const def = tileDef(m.layers.furniture?.[cell.cy * m.width + cell.cx] ?? 0);
    if (def?.join && this.placement) this.setSel({ kind: 'run', ax: cell.cx, ay: cell.cy });
    else if (def) this.setSel({ kind: 'cell', cx: cell.cx, cy: cell.cy });
    else this.setSel(null);
    this.drawCursor();
  }

  private dragProp(p: Phaser.Input.Pointer) {
    const g = this.grab!;
    if (!g.moved && Math.hypot(p.x - g.sx, p.y - g.sy) < DRAG_PX) return;
    const m = this.map;
    const prop = m.props.find((q) => q.id === g.id);
    if (!prop) return this.cancelStroke();
    const r = mapReader(m);
    const rest = resolveProps(r, m.props);
    const i = m.props.indexOf(prop);
    const moving = new Set([i, ...ridersOf(rest, i)].map((k) => m.props[k]!.id));
    this.props()?.dim(moving);
    const aim = { x: p.worldX + g.off.x, y: p.worldY + g.off.y };
    const others = m.props.filter((q) => !moving.has(q.id));
    const d = dropPoint(r, others, aim.x, aim.y, this.snap);
    if (!d) {
      g.moved = null;
      // show it under the pointer, red: nothing there can hold it
      this.showPropGhosts(
        this.moveChanges(g.id, Math.round(aim.x) - prop.x, Math.round(aim.y) - prop.y, 0, true),
        true,
      );
      return;
    }
    const changes = this.moveChanges(g.id, d.x - prop.x, d.y - prop.y, 0, true);
    const plan = planEdit(m, changes);
    g.moved = plan.ok ? changes : null;
    this.showPropGhosts(changes, !plan.ok);
  }

  /** Run of the selection, or null. */
  private selRun(): Run | null {
    return this.sel?.kind === 'run' ? runAt(mapReader(this.map), this.sel.ax, this.sel.ay) : null;
  }

  /** Handle centres of the selected run, per direction (world px). */
  private handles(): Partial<Record<Dir, { x: number; y: number }>> {
    const run = this.selRun();
    if (!run) return {};
    const out: Partial<Record<Dir, { x: number; y: number }>> = {};
    for (const [d, c] of Object.entries(run.ends) as [Dir, Cell][]) {
      const [dx, dy] = DIRV[d];
      out[d] = { x: c.cx * TILE + 16 + dx * 16, y: c.cy * TILE + 16 + dy * 16 };
    }
    return out;
  }

  private handleAt(x: number, y: number): Dir | null {
    const zoom = this.scene.cameras.main.zoom;
    const r = Math.max(HANDLE, 10 / zoom);
    for (const [d, h] of Object.entries(this.handles()) as [Dir, { x: number; y: number }][])
      if (Math.abs(x - h.x) <= r && Math.abs(y - h.y) <= r) return d;
    return null;
  }

  /** Cell writes that grow (n > 0) or shrink (n < 0) the selected run at one end. */
  private stretchChanges(dir: Dir, n: number): CellChange[] {
    const run = this.selRun();
    const end = run?.ends[dir];
    if (!run || !end || !n) return [];
    const m = this.map;
    const [dx, dy] = DIRV[dir];
    const out: CellChange[] = [];
    if (n > 0) {
      const t = growTile(tileNameAt(m, 'furniture', end.cx, end.cy)!);
      for (let k = 1; k <= n; k++) {
        const x = end.cx + dx * k;
        const y = end.cy + dy * k;
        if (x < 0 || y < 0 || x >= m.width || y >= m.height) break;
        if (tileNameAt(m, 'furniture', x, y) !== t) out.push({ l: 'furniture', x, y, t });
      }
      return out;
    }
    // shrinking walks back along the run, never below one cell
    const along = run.cells.length;
    const take = Math.min(-n, along - 1);
    for (let k = 0; k < take; k++)
      out.push({ l: 'furniture', x: end.cx - dx * k, y: end.cy - dy * k, t: null });
    return out;
  }

  private dragStretch() {
    const st = this.stretch!;
    const run = this.selRun();
    const end = run?.ends[st.dir];
    if (!run || !end) return;
    const [dx, dy] = DIRV[st.dir];
    const n = dx ? (this.cursor.cx - end.cx) * dx : (this.cursor.cy - end.cy) * dy;
    st.cells = this.stretchChanges(st.dir, Math.max(-(run.cells.length - 1), Math.min(30, n)));
    const g = this.strokeGfx;
    g.clear();
    const plan = st.cells.length ? planEdit(this.map, st.cells) : null;
    for (const c of st.cells) {
      g.fillStyle(plan && !plan.ok ? 0xc2364b : c.t ? 0x5fd3c6 : 0xf2a900, 0.3);
      g.fillRect(c.x * TILE, c.y * TILE, TILE, TILE);
    }
    this.keepAnchor(st.cells);
    this.showPreview(st.cells);
    this.drawSel();
  }

  /** A shrink that removes the anchor cell moves the anchor to what stays. */
  private keepAnchor(cells: CellChange[]) {
    if (this.sel?.kind !== 'run') return;
    const gone = new Set(cells.filter((c) => !c.t).map((c) => `${c.x},${c.y}`));
    if (!gone.has(`${this.sel.ax},${this.sel.ay}`)) return;
    const keep = this.selRun()?.cells.find((c) => !gone.has(`${c.cx},${c.cy}`));
    if (keep) this.sel = { kind: 'run', ax: keep.cx, ay: keep.cy };
  }

  /** Panel buttons and selection shortcuts. */
  private command(c: SelCmd): boolean | void {
    if (!this.active) return;
    const m = this.map;
    const sel = this.sel;
    if (c.t === 'cancel') {
      if (!this.pend) return false;
      clearTimeout(this.pendTimer);
      this.pend = null;
      this.props()?.dim(new Set());
      this.hidePropGhosts();
      this.publishSel();
      this.drawSel();
      return true;
    }
    if (c.t === 'clear') return this.setSel(null);
    if (!sel) return;
    if (sel.kind === 'prop') {
      const p = m.props.find((q) => q.id === sel.id);
      if (!p) return this.setSel(null);
      if (c.t === 'nudge' || c.t === 'raise') {
        const d = this.pend ?? { dx: 0, dy: 0, dz: 0 };
        const next =
          c.t === 'nudge'
            ? { ...d, dx: d.dx + c.dx, dy: d.dy + c.dy }
            : { ...d, dz: clampZ(p.z + d.dz + c.dz) - p.z };
        const plan = planEdit(m, this.moveChanges(p.id, next.dx, next.dy, next.dz, false));
        if (!plan.ok) {
          toast(`build.refused.${plan.reason}`, undefined, 2500);
          return;
        }
        this.pend = next;
        clearTimeout(this.pendTimer);
        this.pendTimer = setTimeout(() => this.flushPending(), NUDGE_IDLE_MS);
        this.props()?.dim(new Set([p.id]));
        this.showPropGhosts(this.moveChanges(p.id, next.dx, next.dy, next.dz, false), false);
        this.publishSel();
        this.drawSel();
        return;
      }
      this.flushPending();
      if (c.t === 'flip')
        this.sendChecked([{ l: 'prop', id: p.id, p: { t: p.t, x: p.x, y: p.y, z: p.z, f: !p.f } }]);
      else if (c.t === 'rotate') {
        const t = rotatedTile(p.t);
        if (t)
          this.sendChecked([{ l: 'prop', id: p.id, p: { t, x: p.x, y: p.y, z: p.z, f: p.f } }]);
      } else if (c.t === 'delete') {
        this.sendChecked([{ l: 'prop', id: p.id, p: null }]);
        this.setSel(null);
      }
      return;
    }
    if (sel.kind === 'cell' || (sel.kind === 'run' && (c.t === 'rotate' || c.t === 'delete'))) {
      const x = sel.kind === 'cell' ? sel.cx : sel.ax;
      const y = sel.kind === 'cell' ? sel.cy : sel.ay;
      const t = tileNameAt(m, 'furniture', x, y);
      if (!t) return this.setSel(null);
      if (c.t === 'rotate') {
        const next = rotatedTile(t);
        if (next) this.sendChecked([{ l: 'furniture', x, y, t: next }]);
      } else if (c.t === 'delete') {
        if (this.sendChecked([{ l: 'furniture', x, y, t: null }])) this.setSel(null);
      }
      return;
    }
    if (sel.kind === 'run' && (c.t === 'grow' || c.t === 'shrink')) {
      const run = this.selRun();
      if (!run?.ends[c.dir]) return;
      const cells = this.stretchChanges(c.dir, c.t === 'grow' ? 1 : -1);
      if (!cells.length) return;
      const before = this.sel;
      this.keepAnchor(cells);
      if (!this.sendChecked(cells)) this.sel = before;
      this.drawSel();
    }
  }

  /** Send a waiting keyboard nudge / raise as one edit. */
  private flushPending() {
    clearTimeout(this.pendTimer);
    const d = this.pend;
    this.pend = null;
    this.props()?.dim(new Set());
    this.hidePropGhosts();
    if (!d || this.sel?.kind !== 'prop') return;
    const changes = this.moveChanges(this.sel.id, d.dx, d.dy, d.dz, false);
    if (changes.length && (d.dx || d.dy || d.dz)) this.sendChecked(changes);
  }

  private drawSel() {
    const g = this.selGfx;
    g.clear();
    if (!this.active || !this.sel) return;
    const m = this.map;
    g.lineStyle(1, 0x17324d, 0.9);
    const color = 0x5fd3c6;
    if (this.sel.kind === 'prop') {
      const sel = this.sel;
      const i = m.props.findIndex((p) => p.id === sel.id);
      const b = this.props()?.boxes[i];
      if (!b) return;
      const d = this.pend;
      const ox = d?.dx ?? 0;
      const oy = (d?.dy ?? 0) - (d?.dz ?? 0);
      g.strokeRect(b.x0 - 2 + ox, b.y0 - 2 + oy, b.x1 - b.x0 + 5, b.baseY - b.y0 + 5);
      g.lineStyle(1, color, 1).strokeRect(
        b.x0 - 1 + ox,
        b.y0 - 1 + oy,
        b.x1 - b.x0 + 3,
        b.baseY - b.y0 + 3,
      );
      return;
    }
    const cells =
      this.sel.kind === 'run'
        ? (this.selRun()?.cells ?? [])
        : [{ cx: this.sel.cx, cy: this.sel.cy }];
    if (!cells.length) return;
    const x0 = Math.min(...cells.map((c) => c.cx)) * TILE;
    const y0 = Math.min(...cells.map((c) => c.cy)) * TILE;
    const x1 = (Math.max(...cells.map((c) => c.cx)) + 1) * TILE;
    const y1 = (Math.max(...cells.map((c) => c.cy)) + 1) * TILE;
    g.strokeRect(x0 - 2, y0 - 2, x1 - x0 + 4, y1 - y0 + 4);
    g.lineStyle(2, color, 1).strokeRect(x0, y0, x1 - x0, y1 - y0);
    if (this.sel.kind !== 'run') return;
    for (const h of Object.values(this.handles())) {
      g.fillStyle(0x17324d, 1).fillRect(
        h.x - HANDLE / 2 - 1,
        h.y - HANDLE / 2 - 1,
        HANDLE + 2,
        HANDLE + 2,
      );
      g.fillStyle(color, 1).fillRect(h.x - HANDLE / 2, h.y - HANDLE / 2, HANDLE, HANDLE);
    }
  }

  // ───────────────────────────────────────────── drawing
  private isLocked(c: Cell, l: PaintLayer | null): boolean {
    const s = store.get();
    if (this.lockedRev !== s.mapRev || !this.locked) {
      this.locked = lockedCells(this.map);
      this.lockedRev = s.mapRev;
    }
    const lock = this.locked.get(c.cy * 100000 + c.cx);
    if (!lock) return false;
    return lock === 'locked_portal' || l === 'furniture' || l === 'walls' || l === 'prop';
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
    this.preview.show(blend, this.map, cellChanges(plan.changes), this.cursor, skip);
    return cells.some((c) => c.l === 'floor' || c.l === 'furniture');
  }

  private hideCursor() {
    this.cursorGfx.clear();
    this.selGfx.clear();
    this.ghost.setVisible(false);
    this.ghostTop.setVisible(false);
    this.hidePropGhosts();
    this.preview.hide(this.blend());
  }

  /** Outline the prop under the pointer (erase, pick and select tools). */
  private hoverProp(g: Phaser.GameObjects.Graphics, color: number): boolean {
    if (!this.pt) return false;
    const b = this.props()?.hit(this.pt.x, this.pt.y, 1);
    if (!b) return false;
    g.lineStyle(1, color, 1).strokeRect(b.x0 - 1, b.y0 - 1, b.x1 - b.x0 + 3, b.baseY - b.y0 + 3);
    return true;
  }

  drawCursor() {
    const s = this.state;
    if (!this.active || !s) return this.hideCursor();
    this.drawSel();
    if (this.drag === 'move' || this.drag === 'stretch' || this.pend) return;
    const { cx, cy } = this.cursor;
    const here = biomeAt(this.map, cx, cy);
    if (store.get().cursorBiome !== here) store.set({ cursorBiome: here });
    const g = this.cursorGfx;
    g.clear();
    const x = cx * TILE;
    const y = cy * TILE;
    const layer = s.tool === 'paint' ? groupLayer(s.group) : this.eraseLayer(this.cursor);
    const bad = s.tool !== 'pick' && s.tool !== 'select' && this.isLocked(this.cursor, layer);
    const color = bad
      ? 0xc2364b
      : s.tool === 'erase'
        ? 0xf2a900
        : s.tool === 'pick'
          ? 0xb49cff
          : s.tool === 'select'
            ? 0x5fd3c6
            : 0xf3f6f8;
    if (s.tool !== 'paint') {
      this.ghost.setVisible(false);
      this.ghostTop.setVisible(false);
      this.hidePropGhosts();
      // a prop under the pointer is what the tool acts on; otherwise the cell
      if (this.hoverProp(g, color)) {
        this.preview.hide(this.blend());
        return;
      }
    }
    if (s.tool === 'select') {
      // a light hint only: the selection outline is what matters here
      g.lineStyle(1, color, 0.6).strokeRect(x + 0.5, y + 0.5, TILE - 1, TILE - 1);
    } else if (s.tool !== 'paint' || layer !== 'prop') {
      g.lineStyle(2, 0x17324d, 0.9).strokeRect(x - 1, y - 1, TILE + 2, TILE + 2);
      g.lineStyle(2, color, 1).strokeRect(x, y, TILE, TILE);
    }
    if (s.tool === 'select') return this.preview.hide(this.blend());
    if (layer === 'prop') {
      // the item where it would land: a snap spot, a stack, or the pixel under the pointer
      this.ghost.setVisible(false);
      this.ghostTop.setVisible(false);
      this.preview.hide(this.blend());
      const c = this.newProp();
      const plan = c ? planEdit(this.map, [c]) : null;
      if (c && plan) {
        this.showPropGhosts([c], !plan.ok || bad);
        if (!this.pt || this.snap) {
          // the spots this cell offers
          g.fillStyle(0xf3f6f8, 0.8);
          for (const p of snapSpots(mapReader(this.map), cx, cy)) g.fillRect(p.x - 1, p.y, 3, 1);
        }
        return;
      }
      this.hidePropGhosts();
      g.lineStyle(2, 0xc2364b, 1).strokeRect(x, y, TILE, TILE);
      return;
    }
    // while a stroke is open, drawStroke owns the preview
    const shown =
      !this.drag && s.tool !== 'pick' && !bad
        ? this.showPreview(
            [
              this.changeAt(
                this.cursor,
                s.tool === 'erase' ? 'erase' : 'paint',
                layer as EditLayer | null,
              ),
            ].filter((c): c is CellChange => !!c),
          )
        : !!this.drag;
    if (!this.drag && (s.tool === 'pick' || bad)) this.preview.hide(this.blend());
    if (s.tool !== 'paint') return;
    const name = this.tileFor(this.cursor)!;
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
