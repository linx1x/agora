/**
 * Build mode in the 2.5D view (P16.13, P16.14, ADR-021, ADR-039). The same edits as the flat
 * BuildMode (`game/BuildMode.ts`), the same shared rules (`planEdit`, `dropPoint`, `snapSpots`, the
 * stacking and stretch maths), and the same keys and panel. What differs is the picking: the cell
 * or prop under the pointer comes from a ray through the drawn faces (`pick3d.ts`), and the
 * previews are 3D shapes (`ghost3d.ts`). Only the picks and the drawing are three.js or canvas;
 * the decisions are the shared ones. The server still receives cells and 2D prop points.
 *
 * Points: a 3D point is drawn at the 2D point `(32·x, 32·(z − y))` (the 3/4 drawing), so a pick on
 * any face gives the 2D base point the server checks (`aimOf`).
 */
import * as THREE from 'three';
import {
  PALETTE,
  TILE,
  biomeAt,
  dropPoint,
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
  MAX_LIFT,
  type Biome,
  type Cell,
  type CellChange,
  type EditLayer,
  type MapChange,
  type PaintLayer,
  type PropChange,
  type WorldMap,
} from '@agora/shared';
import { store, toast, type BuildGroup, type BuildSel, type BuildState } from '../state/store';
import { onSelCmd, patchBuild, sendEdit, type SelCmd } from '../game/build';
import { isTyping } from '../game/input';
import {
  ARROW_DIR,
  DIRV,
  clampZ,
  growTile,
  groupLayer,
  runAt,
  type Dir,
  type Run,
} from '../game/buildMath';
import type { Cam, Pt, Rect } from './camera';
import { type Atlas, buildRegionMesh, disposeTree } from './meshes';
import type { PickResult } from './pick3d';
import type { BuildOverlay, Pt2 } from './buildOverlay';
import { ghostOf, type Ghost } from './ghost3d';
import { propQuad } from './propFaces';
import { propTo3D, surfaceHeightPx } from './props3d';
import type { Extents, V3 } from './scene';

/** NUDGE_IDLE_MS, DRAG_PX and HANDLE as the flat view (ADR-039). */
const NUDGE_IDLE_MS = 400;
const DRAG_PX = 4;
const HANDLE = 7;
const HANDLE_HIT_PX = 10;

type Drag = 'paint' | 'erase' | 'pan' | 'move' | 'stretch' | null;

/** What the Select tool holds (a run is found again from its anchor cell after every edit). */
type Sel =
  | { kind: 'prop'; id: string }
  | { kind: 'run'; ax: number; ay: number }
  | { kind: 'cell'; cx: number; cy: number };

/** The view's side of build mode: picking, the camera, the faces that step aside, and the art. */
export interface BuildHost {
  readonly scene: THREE.Scene;
  readonly cam: Cam;
  readonly ext: readonly Extents[];
  /** the built region's atlas and texture (for ghost art); null until a region is built */
  art(): { atlas: Atlas; tex: THREE.Texture } | null;
  /** what is drawn under a screen point (CSS px in the canvas); `skip` props are not picked */
  pick(sx: number, sy: number, skip?: ReadonlySet<string>): PickResult | null;
  /** the floor point (tiles) under a screen point, or null in the sky */
  floorAt(sx: number, sy: number): Pt | null;
  /** the region of this cell becomes the build focus; `center` also centres the camera on the cell */
  focus(c: Cell, center: boolean): void;
  /** move the camera target (tiles); the view keeps it inside the focus region */
  moveTarget(x: number, z: number): void;
  /** the target now (tiles) */
  target(): Pt;
  /** live faces of these cells step aside (null: show them again) */
  hideCells(cells: readonly Cell[] | null): void;
  /** live props with these ids step aside (null: show them again) */
  hideProps(ids: ReadonlySet<string> | null): void;
  /** the focus region (tiles), for the grid */
  region(): Rect;
  /** every region of the map (tiles), for the outlines */
  regions(): Rect[];
  /** the screen point of a 3D point, or null behind the camera */
  screen(p: V3): Pt2 | null;
  readonly overlay: BuildOverlay;
}

/** A 2D world point (px): the flat view's coordinates. */
export interface Px {
  x: number;
  y: number;
}

/** The 2D point a picked 3D point is drawn at (see the file comment). */
export const aimOf = (p: V3): Px => ({ x: p[0] * TILE, y: (p[2] - p[1]) * TILE });

const COLOR = {
  teal: '#5fd3c6',
  amber: '#f2a900',
  red: '#c2364b',
  purple: '#b49cff',
  white: '#f3f6f8',
  ink: '#17324d',
};

const cellKey = (c: { cx: number; cy: number }) => `${c.cx},${c.cy}`;

export class BuildMode3D {
  active = false;
  /** cell under the pointer or the keyboard cursor */
  cursor: Cell = { cx: 0, cy: 0 };
  /** the pick under the pointer (null after keyboard use or in the sky) */
  private hover: PickResult | null = null;
  /** the 2D point the pointer aims at (world px); null after keyboard use */
  private pt: Px | null = null;
  private drag: Drag = null;
  private stroke = new Map<string, CellChange>();
  private strokeLayer: EditLayer | null = null;
  private last: Cell | null = null;
  private panFrom: {
    sx: number;
    sy: number;
    fx: number;
    fz: number;
    tx: number;
    tz: number;
  } | null = null;
  private space = false;
  private alt = false;
  private locked: ReturnType<typeof lockedCells> | null = null;
  private lockedRev = -1;
  private unsub: (() => void)[] = [];
  private sel: Sel | null = null;
  /** id the next placed prop gets (stable while its ghost shows) */
  private nextId = newPropId();
  /** a press or drag on the selected prop; `off` keeps the pointer where it grabbed the item */
  private grab: {
    id: string;
    sx: number;
    sy: number;
    off: Px;
    moved: PropChange[] | null;
  } | null = null;
  /** keyboard nudge / raise waiting to be sent */
  private pend: { dx: number; dy: number; dz: number } | null = null;
  private pendTimer: ReturnType<typeof setTimeout> | undefined;
  private stretch: { dir: Dir; cells: CellChange[] } | null = null;
  /** the preview on screen, and the key of the changes it shows */
  private ghostKey = '';
  private ghost: { mesh: THREE.Object3D | null; info: Ghost | null } = { mesh: null, info: null };
  /** the cells the preview replaces (their live faces step aside) */
  private hiddenCells: Cell[] | null = null;
  /** cells the last preview changed (test read-out, as the flat preview's `changed`) */
  previewCount = 0;

  constructor(private host: BuildHost) {
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
    this.unsub = [];
    clearTimeout(this.pendTimer);
    this.clearGhost();
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
    this.drag = null;
    const mid = this.host.floorAt(this.host.cam.w / 2, this.host.cam.h / 2);
    this.cursor = mid
      ? { cx: Math.floor(mid.x), cy: Math.floor(mid.z) }
      : { cx: Math.floor(this.host.cam.tx), cy: Math.floor(this.host.cam.tz) };
    this.host.focus(this.cursor, false);
    this.refresh();
  }

  exit() {
    this.active = false;
    this.flushPending();
    this.cancelStroke();
    this.setSel(null);
    this.clearGhost();
    this.host.overlay.clear();
    this.hover = null;
    this.pt = null;
  }

  /** Build options changed (tool, tile, overlays). */
  refresh() {
    const s = this.state;
    if (!s) return;
    if (s.tool !== 'select' && this.sel) this.setSel(null);
    this.refreshGhost();
  }

  /** The keyboard or the pointer moved the cursor (or a stroke grew): the preview follows. */
  private refreshGhost() {
    if (!this.active || !this.state) return this.clearGhost();
    if (this.drag === 'move' || this.drag === 'stretch' || this.pend) return;
    if (this.drag === 'paint' || this.drag === 'erase')
      return this.showGhost([...this.stroke.values()]);
    const changes = this.hoverChanges();
    if (changes.length) this.showGhost(changes);
    else this.clearGhost();
  }

  /** The changes the current tool would make at the cursor (nothing for a pick or select). */
  private hoverChanges(): MapChange[] {
    const s = this.state;
    if (!s || s.tool === 'pick' || s.tool === 'select') return [];
    const layer = s.tool === 'paint' ? groupLayer(s.group) : this.eraseLayer(this.cursor);
    if (s.tool === 'paint' && layer === 'prop') {
      const c = this.newProp();
      return c ? [c] : [];
    }
    const ch = this.changeAt(
      this.cursor,
      s.tool === 'erase' ? 'erase' : 'paint',
      layer as EditLayer | null,
    );
    return ch ? [ch] : [];
  }

  // ───────────────────────────────────────────── the preview (3D shapes)
  /** Show the preview of `changes` (the server's plan, drawn as 3D shapes) and hide what it replaces. */
  private showGhost(changes: MapChange[]) {
    const key = JSON.stringify(changes) + this.map.width + store.get().mapRev;
    if (key === this.ghostKey) return;
    this.ghostKey = key;
    const ext = this.host.ext;
    const g = changes.length ? ghostOf(this.map, changes, ext) : null;
    this.applyGhost(g);
  }

  private applyGhost(g: Ghost | null) {
    this.clearGhostMesh();
    this.ghost.info = g;
    this.previewCount = g ? g.cells.length : 0;
    const art = this.host.art();
    if (!g || !art) {
      this.setHiddenCells(null);
      this.host.hideProps(null);
      return;
    }
    this.setHiddenCells(g.cells);
    this.host.hideProps(g.movedIds.size ? g.movedIds : null);
    const group = new THREE.Group();
    const add = (faces: typeof g.faces) => {
      if (!faces.length) return;
      const built = buildRegionMesh(
        { faces, lights: [], x0: 0, z0: 0, w: 0, d: 0 },
        art.atlas,
        art.tex,
      );
      built.mesh.material = ghostMaterial(art.tex, !g.ok);
      built.mesh.castShadow = false;
      built.mesh.receiveShadow = false;
      group.add(built.mesh);
    };
    add(g.faces);
    add(g.props);
    this.host.scene.add(group);
    this.ghost.mesh = group;
  }

  private setHiddenCells(cells: Cell[] | null) {
    this.hiddenCells = cells;
    this.host.hideCells(cells);
  }

  private clearGhostMesh() {
    if (this.ghost.mesh) {
      this.host.scene.remove(this.ghost.mesh);
      disposeTree(this.ghost.mesh);
      this.ghost.mesh = null;
    }
    this.ghost.info = null;
  }

  private clearGhost() {
    this.ghostKey = '';
    this.clearGhostMesh();
    this.previewCount = 0;
    if (this.hiddenCells) this.setHiddenCells(null);
    this.host.hideProps(null);
  }

  /** The region was rebuilt (an edit, another region): the preview's art is redrawn from it. */
  afterRebuild() {
    this.ghostKey = '';
    this.clearGhostMesh();
    this.refreshGhost();
    // the readout of the selection (its length, its prop) follows each map revision, as the echo lands
    this.publishSel();
  }

  /** Cells a preview currently shows (the cells its edit changes). */
  previewCells(): number {
    return this.previewCount;
  }

  // ───────────────────────────────────────────── input
  /** Keys: the flat view's, on the same shared rules (BuildMode.onKey). */
  private onKey(e: KeyboardEvent, down: boolean) {
    if (e.key === 'Alt') {
      this.alt = down && this.active;
      if (this.active) {
        e.preventDefault(); // no browser menu bar while placing
        this.refreshGhost();
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
    this.hover = null;
    this.cursor = {
      cx: Math.max(0, Math.min(m.width - 1, this.cursor.cx + dx)),
      cy: Math.max(0, Math.min(m.height - 1, this.cursor.cy + dy)),
    };
    const p = this.host.screen([this.cursor.cx + 0.5, 0, this.cursor.cy + 0.5]);
    const cam = this.host.cam;
    if (!p || p.x < 2 * TILE || p.x > cam.w - 2 * TILE || p.y < TILE || p.y > cam.h - TILE)
      this.host.focus(this.cursor, true);
    this.refreshGhost();
  }

  /**
   * What the pointer hits. With Alt the props are skipped: a free placement goes on the surface
   * under the pointer (ADR-039), as the flat view places to the pixel, not on an item drawn over it.
   */
  private pickUnder(sx: number, sy: number, alt: boolean, moving?: ReadonlySet<string>) {
    if (!alt) return this.host.pick(sx, sy, moving);
    const skip = new Set(this.map.props.map((p) => p.id));
    for (const id of moving ?? []) skip.add(id);
    return this.host.pick(sx, sy, skip);
  }

  /** Where a pointer hit lies in the 2D plane (the point the flat view's pointer would give). */
  private setPt(hit: PickResult | null, sx: number, sy: number) {
    if (hit) {
      this.pt = aimOf(hit.p);
      this.hover = hit;
      return;
    }
    const f = this.host.floorAt(sx, sy);
    this.hover = null;
    this.pt = f ? { x: f.x * TILE, y: f.z * TILE } : null;
  }

  private cellOf(hit: PickResult | null, sx: number, sy: number): Cell {
    if (hit) return hit.cell;
    const f = this.host.floorAt(sx, sy);
    const m = this.map;
    if (!f) return this.cursor;
    return {
      cx: Math.max(0, Math.min(m.width - 1, Math.floor(f.x))),
      cy: Math.max(0, Math.min(m.height - 1, Math.floor(f.z))),
    };
  }

  /** Pointer down. `sx, sy`: CSS px in the canvas; `button`: 0 left, 1 middle, 2 right. */
  pointerDown(sx: number, sy: number, button: number, alt: boolean) {
    (document.activeElement as HTMLElement | null)?.blur?.();
    this.alt = alt;
    const hit = this.pickUnder(sx, sy, alt);
    this.setPt(hit, sx, sy);
    if (button === 1 || (button === 0 && this.space)) {
      const f = this.host.floorAt(sx, sy);
      const t = this.host.target();
      this.drag = 'pan';
      this.panFrom = { sx, sy, fx: f?.x ?? t.x, fz: f?.z ?? t.z, tx: t.x, tz: t.z };
      return;
    }
    const cell = this.cellOf(hit, sx, sy);
    this.cursor = cell;
    this.host.focus(cell, false);
    const tool = this.state?.tool;
    if (button === 2) {
      if (hit?.prop) return sendEdit([{ l: 'prop', id: hit.prop, p: null }]);
      return this.beginStroke('erase', cell);
    }
    if (button !== 0) return;
    if (tool === 'pick') return this.pick(cell);
    if (tool === 'select') return this.selectAt(cell, { sx, sy, hit });
    if (tool === 'erase') {
      if (hit?.prop) return sendEdit([{ l: 'prop', id: hit.prop, p: null }]);
      return this.beginStroke('erase', cell);
    }
    if (this.state && groupLayer(this.state.group) === 'prop') return this.placeProp();
    this.beginStroke('paint', cell);
  }

  pointerMove(sx: number, sy: number, alt: boolean) {
    if (this.drag === 'pan' && this.panFrom) {
      const f = this.host.floorAt(sx, sy);
      if (f) {
        const p = this.panFrom;
        this.host.moveTarget(p.tx + (p.fx - f.x), p.tz + (p.fz - f.z));
      }
      return;
    }
    this.alt = alt;
    const moving = this.drag === 'move' && this.grab ? this.movingIds() : undefined;
    const hit = this.pickUnder(sx, sy, alt, moving);
    this.setPt(hit, sx, sy);
    const cell = this.cellOf(hit, sx, sy);
    if (this.drag === 'move' && this.grab) return this.dragProp(sx, sy);
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
    if (!sameCell) this.refreshGhost();
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
      this.host.hideProps(null);
      this.clearGhost();
      if (moved?.length) this.sendChecked(moved);
      this.refreshGhost();
      return;
    }
    if (this.drag === 'stretch') {
      const cells = this.stretch?.cells ?? [];
      this.drag = null;
      this.stretch = null;
      this.clearGhost();
      if (cells.length) this.sendChecked(cells);
      this.refreshGhost();
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
    this.refreshGhost();
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
    this.refreshGhost();
  }

  private endStroke() {
    if (this.drag === 'paint' || this.drag === 'erase') sendEdit([...this.stroke.values()]);
    this.cancelStroke();
    this.refreshGhost();
  }

  private cancelStroke() {
    this.drag = null;
    this.grab = null;
    this.stretch = null;
    this.stroke.clear();
    this.strokeLayer = null;
    this.last = null;
    this.clearGhost();
  }

  /** Topmost thing to erase at a cell: hanging decor, furniture, then walls. */
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

  /** The topmost prop whose base is in this cell (list order is stacking order). */
  private topPropIn(c: Cell): string | null {
    let best: string | null = null;
    for (const p of this.map.props) {
      const pc = propCell(p, this.map.tile);
      if (pc.cx === c.cx && pc.cy === c.cy) best = p.id;
    }
    return best;
  }

  private tileFor(c: Cell): string | null {
    const s = this.state!;
    const theme = s.theme === 'auto' ? biomeAt(this.map, c.cx, c.cy) : s.theme;
    return themedTile(s.base[s.group], theme);
  }

  private addCell(c: Cell) {
    const ch = this.changeAt(c, this.drag === 'paint' ? 'paint' : 'erase', this.strokeLayer);
    if (ch) this.stroke.set(cellKey(c), ch);
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

  /** The eyedropper: a prop under the pointer, else the topmost tile of the cell. */
  private pick(c: Cell) {
    const m = this.map;
    const s = this.state!;
    const prop = this.hover?.prop ? m.props.find((p) => p.id === this.hover!.prop) : null;
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
  private dropFor(skip?: Set<string>): Px | null {
    const m = this.map;
    const r = mapReader(m);
    const list = skip ? m.props.filter((p) => !skip.has(p.id)) : m.props;
    if (this.pt) return dropPoint(r, list, this.pt.x, this.pt.y, this.snap);
    const spots = snapSpots(r, this.cursor.cx, this.cursor.cy);
    return spots.reduce<Px | null>(
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
    this.refreshGhost();
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
        p: {
          t: p.t,
          x: p.x + dx,
          y: p.y + dy,
          z: k === i ? clampZ(p.z + dz, MAX_LIFT) : p.z,
          f: p.f,
        },
        // a dragged item goes to the top of the list so it can land on any stack
        ...(toTop ? { i: 100_000 } : {}),
      };
    });
  }

  /** The ids of a prop being dragged and what rests on it (they are not picked while they move). */
  private movingIds(): ReadonlySet<string> | undefined {
    const g = this.grab;
    if (!g) return undefined;
    const m = this.map;
    const i = m.props.findIndex((p) => p.id === g.id);
    if (i < 0) return undefined;
    const rest = resolveProps(mapReader(m), m.props);
    return new Set([i, ...ridersOf(rest, i)].map((k) => m.props[k]!.id));
  }

  // ───────────────────────────────────────────── Select tool (P9.17–P9.20)
  private setSel(sel: Sel | null) {
    if (this.pend) this.flushPending();
    this.sel = sel;
    this.publishSel();
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
          z: clampZ(p.z + (d?.dz ?? 0), MAX_LIFT),
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

  /**
   * Press (or Enter) with the Select tool: a stretch handle, a prop (maybe a drag), furniture, or
   * nothing. `p` is the pointer press; null for the keyboard (the cursor cell).
   */
  private selectAt(cell: Cell, p: { sx: number; sy: number; hit: PickResult | null } | null) {
    const m = this.map;
    if (p && this.sel?.kind === 'run') {
      const h = this.handleAt(p.sx, p.sy);
      if (h) {
        this.drag = 'stretch';
        this.stretch = { dir: h, cells: [] };
        return;
      }
    }
    const id = p ? (p.hit?.prop ?? null) : this.topPropIn(cell);
    if (id) {
      this.setSel({ kind: 'prop', id });
      const i = m.props.findIndex((q) => q.id === id);
      if (p && i >= 0) {
        // keep the pointer where it grabbed the item: aim at its drawn base point
        const prop = m.props[i]!;
        const aim = this.pt ?? { x: prop.x, y: prop.y };
        this.grab = {
          id,
          sx: p.sx,
          sy: p.sy,
          off: { x: prop.x - aim.x, y: prop.y - aim.y },
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
    this.refreshGhost();
  }

  /** A grabbed prop follows the pointer's aim; its preview shows where it would land. */
  private dragProp(sx: number, sy: number) {
    const g = this.grab!;
    if (!g.moved && Math.hypot(sx - g.sx, sy - g.sy) < DRAG_PX) return;
    const m = this.map;
    const prop = m.props.find((q) => q.id === g.id);
    if (!prop) return this.cancelStroke();
    const r = mapReader(m);
    const rest = resolveProps(r, m.props);
    const i = m.props.indexOf(prop);
    const moving = new Set([i, ...ridersOf(rest, i)].map((k) => m.props[k]!.id));
    const aim = this.pt ?? { x: prop.x, y: prop.y };
    const target = { x: aim.x + g.off.x, y: aim.y + g.off.y };
    const others = m.props.filter((q) => !moving.has(q.id));
    const d = dropPoint(r, others, target.x, target.y, this.snap);
    if (!d) {
      g.moved = null;
      // show it under the pointer, red: nothing there can hold it
      this.showGhostOf(
        this.moveChanges(
          g.id,
          Math.round(target.x) - prop.x,
          Math.round(target.y) - prop.y,
          0,
          true,
        ),
      );
      return;
    }
    const changes = this.moveChanges(g.id, d.x - prop.x, d.y - prop.y, 0, true);
    const plan = planEdit(m, changes);
    g.moved = plan.ok ? changes : null;
    this.showGhostOf(changes);
  }

  /** The preview of a prop move (always shown, red when refused). */
  private showGhostOf(changes: MapChange[]) {
    const key = `move${JSON.stringify(changes)}`;
    if (key === this.ghostKey) return;
    this.ghostKey = key;
    this.applyGhost(changes.length ? ghostOf(this.map, changes, this.host.ext) : null);
  }

  /** Run of the selection, or null. */
  private selRun(): Run | null {
    return this.sel?.kind === 'run' ? runAt(mapReader(this.map), this.sel.ax, this.sel.ay) : null;
  }

  /** Stretch handle centres of the selected run, per direction (tiles, on the run's top faces). */
  private handles(): Partial<Record<Dir, { x: number; z: number; y: number }>> {
    const run = this.selRun();
    if (!run) return {};
    const out: Partial<Record<Dir, { x: number; z: number; y: number }>> = {};
    const r = mapReader(this.map);
    for (const [d, c] of Object.entries(run.ends) as [Dir, Cell][]) {
      const [dx, dy] = DIRV[d];
      const hpx = surfaceHeightPx(r, c.cx, c.cy, this.host.ext);
      // the 2D handle point (on the top rows of the cell), lifted onto the top face
      const x2 = c.cx * TILE + 16 + dx * 16;
      const y2 = c.cy * TILE + 16 + dy * 16;
      out[d] = { x: x2 / TILE, y: hpx / TILE, z: (y2 + hpx) / TILE };
    }
    return out;
  }

  private handleAt(sx: number, sy: number): Dir | null {
    for (const [d, h] of Object.entries(this.handles()) as [
      Dir,
      { x: number; y: number; z: number },
    ][]) {
      const p = this.host.screen([h.x, h.y, h.z]);
      if (p && Math.hypot(p.x - sx, p.y - sy) <= HANDLE_HIT_PX) return d;
    }
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
    this.keepAnchor(st.cells);
    this.showGhostOf(st.cells);
  }

  /** A shrink that removes the anchor cell moves the anchor to what stays. */
  private keepAnchor(cells: CellChange[]) {
    if (this.sel?.kind !== 'run') return;
    const gone = new Set(cells.filter((c) => !c.t).map((c) => `${c.x},${c.y}`));
    if (!gone.has(`${this.sel.ax},${this.sel.ay}`)) return;
    const keep = this.selRun()?.cells.find((c) => !gone.has(`${c.cx},${c.cy}`));
    if (keep) this.sel = { kind: 'run', ax: keep.cx, ay: keep.cy };
  }

  /** Panel buttons and selection shortcuts (BuildMode.command). */
  private command(c: SelCmd): boolean | void {
    if (!this.active) return;
    const m = this.map;
    const sel = this.sel;
    if (c.t === 'cancel') {
      if (!this.pend) return false;
      clearTimeout(this.pendTimer);
      this.pend = null;
      this.clearGhost();
      this.publishSel();
      this.refreshGhost();
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
            : { ...d, dz: clampZ(p.z + d.dz + c.dz, MAX_LIFT) - p.z };
        const plan = planEdit(m, this.moveChanges(p.id, next.dx, next.dy, next.dz, false));
        if (!plan.ok) {
          toast(`build.refused.${plan.reason}`, undefined, 2500);
          return;
        }
        this.pend = next;
        clearTimeout(this.pendTimer);
        this.pendTimer = setTimeout(() => this.flushPending(), NUDGE_IDLE_MS);
        this.ghostKey = '';
        this.showGhostOf(this.moveChanges(p.id, next.dx, next.dy, next.dz, false));
        this.publishSel();
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
    }
  }

  /** Send a waiting keyboard nudge / raise as one edit. */
  private flushPending() {
    clearTimeout(this.pendTimer);
    const d = this.pend;
    this.pend = null;
    this.clearGhost();
    if (!d || this.sel?.kind !== 'prop') return;
    const changes = this.moveChanges(this.sel.id, d.dx, d.dy, d.dz, false);
    if (changes.length && (d.dx || d.dy || d.dz)) this.sendChecked(changes);
  }

  // ───────────────────────────────────────────── drawing (screen space)
  /** Draw the grid, collision, cursor, stroke and selection over the world (every frame). */
  update(): void {
    const ov = this.host.overlay;
    ov.clear();
    if (!this.active) return;
    const s = this.state;
    if (!s) return;
    const rect = this.host.region();
    if (s.grid) this.drawGrid(rect);
    this.drawRegions();
    if (s.collision) this.drawCollision(rect);
    this.drawStroke();
    this.drawCursor(s);
    this.drawSelection();
  }

  private poly3(cells: Pt[], y: number): Pt2[] | null {
    const out: Pt2[] = [];
    for (const c of cells) {
      const p = this.host.screen([c.x, y, c.z]);
      if (!p) return null;
      out.push(p);
    }
    return out;
  }

  /** A cell's square at height y (tiles), as screen points. */
  private cellPoly(cx: number, cy: number, y: number): Pt2[] | null {
    return this.poly3(
      [
        { x: cx, z: cy },
        { x: cx + 1, z: cy },
        { x: cx + 1, z: cy + 1 },
        { x: cx, z: cy + 1 },
      ],
      y,
    );
  }

  private drawGrid(rect: Rect) {
    const ov = this.host.overlay;
    const seg = (a: Pt2 | null, b: Pt2 | null) => {
      if (a && b) ov.line(a, b, COLOR.white, 1, 0.14);
    };
    for (let x = rect.x; x <= rect.x + rect.w; x++)
      seg(this.host.screen([x, 0, rect.z]), this.host.screen([x, 0, rect.z + rect.h]));
    for (let z = rect.z; z <= rect.z + rect.h; z++)
      seg(this.host.screen([rect.x, 0, z]), this.host.screen([rect.x + rect.w, 0, z]));
  }

  private drawRegions() {
    const ov = this.host.overlay;
    for (const r of this.host.regions()) {
      const pts = this.poly3(
        [
          { x: r.x, z: r.z },
          { x: r.x + r.w, z: r.z },
          { x: r.x + r.w, z: r.z + r.h },
          { x: r.x, z: r.z + r.h },
        ],
        0,
      );
      if (pts) ov.poly(pts, { stroke: COLOR.amber, line: 2, strokeAlpha: 0.35 });
    }
  }

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

  private drawCollision(rect: Rect) {
    const m = this.map;
    const ov = this.host.overlay;
    for (let cy = rect.z; cy < rect.z + rect.h; cy++)
      for (let cx = rect.x; cx < rect.x + rect.w; cx++) {
        const i = cy * m.width + cx;
        const pts = this.cellPoly(cx, cy, 0.01);
        if (!pts) continue;
        if (m.solid[i]) ov.poly(pts, { fill: COLOR.red, alpha: 0.32 });
        else if (m.sit[i]) ov.poly(pts, { fill: COLOR.teal, alpha: 0.3 });
        if (this.isLocked({ cx, cy }, null)) ov.poly(pts, { stroke: COLOR.purple, line: 1 });
      }
  }

  private drawStroke() {
    if (this.drag !== 'paint' && this.drag !== 'erase') return;
    const erase = this.drag === 'erase';
    const ov = this.host.overlay;
    for (const c of this.stroke.values()) {
      const pts = this.cellPoly(c.x, c.y, 0.012);
      if (!pts) continue;
      const bad = this.isLocked({ cx: c.x, cy: c.y }, c.l);
      ov.poly(pts, { fill: bad ? COLOR.red : erase ? COLOR.amber : COLOR.teal, alpha: 0.3 });
    }
  }

  /** The cursor, its spots and the outline of what the tool would act on. */
  private drawCursor(s: BuildState) {
    if (this.drag === 'move' || this.drag === 'stretch' || this.pend) return;
    if (this.drag === 'paint' || this.drag === 'erase') return;
    const ov = this.host.overlay;
    const { cx, cy } = this.cursor;
    const here = biomeAt(this.map, cx, cy);
    if (store.get().cursorBiome !== here) store.set({ cursorBiome: here });
    const layer = s.tool === 'paint' ? groupLayer(s.group) : this.eraseLayer(this.cursor);
    const bad = s.tool !== 'pick' && s.tool !== 'select' && this.isLocked(this.cursor, layer);
    const color = bad
      ? COLOR.red
      : s.tool === 'erase'
        ? COLOR.amber
        : s.tool === 'pick'
          ? COLOR.purple
          : s.tool === 'select'
            ? COLOR.teal
            : COLOR.white;
    const hy = this.hover && this.hover.top ? this.hover.top : 0;
    if (s.tool !== 'paint' || layer !== 'prop') {
      // a prop under the pointer is what the tool acts on; otherwise the cell
      const propHover = s.tool !== 'paint' && this.hover?.prop ? this.hover.prop : null;
      if (propHover) this.outlineProp(propHover, color);
      else {
        const pts = this.cellPoly(cx, cy, hy);
        if (pts) {
          if (s.tool === 'select') ov.poly(pts, { stroke: color, line: 1, strokeAlpha: 0.6 });
          else {
            ov.poly(pts, { stroke: COLOR.ink, line: 2, strokeAlpha: 0.9 });
            ov.poly(pts, { stroke: color, line: 2 });
          }
        }
      }
    }
    if (s.tool === 'paint' && layer === 'prop' && (!this.pt || this.snap)) {
      // the spots this cell offers, drawn on their surface
      const r = mapReader(this.map);
      const hpx = surfaceHeightPx(r, cx, cy, this.host.ext);
      for (const p of snapSpots(r, cx, cy)) {
        const q = this.host.screen(propTo3D({ x: p.x, y: p.y, z: 0 }, { lift: 0 }, hpx));
        if (q) ov.square(q, 3, COLOR.white, 0.8);
      }
    }
  }

  private outlineProp(id: string, color: string) {
    const m = this.map;
    const i = m.props.findIndex((p) => p.id === id);
    if (i < 0) return;
    const rest = resolveProps(mapReader(m), m.props);
    const quad = propQuad(m, m.props[i]!, rest[i]!, this.host.ext);
    if (!quad) return;
    const pts = quad.map((q) => this.host.screen(q));
    if (pts.some((p) => !p)) return;
    this.host.overlay.poly(pts as Pt2[], { stroke: color, line: 2 });
  }

  /** The selected prop, run or cell, and a run's stretch handles. */
  private drawSelection() {
    if (!this.sel || this.state?.tool !== 'select') return;
    const ov = this.host.overlay;
    const m = this.map;
    if (this.sel.kind === 'prop') {
      const sel = this.sel;
      const j = m.props.findIndex((p) => p.id === sel.id);
      if (j < 0) return;
      const rest = resolveProps(mapReader(m), m.props);
      const d = this.pend;
      const p = {
        ...m.props[j]!,
        x: m.props[j]!.x + (d?.dx ?? 0),
        y: m.props[j]!.y + (d?.dy ?? 0),
        z: clampZ(m.props[j]!.z + (d?.dz ?? 0), MAX_LIFT),
      };
      const quad = propQuad(m, p, rest[j]!, this.host.ext);
      if (!quad) return;
      const pts = quad.map((q) => this.host.screen(q));
      if (pts.some((q) => !q)) return;
      ov.poly(pts as Pt2[], { stroke: COLOR.ink, line: 3 });
      ov.poly(pts as Pt2[], { stroke: COLOR.teal, line: 2 });
      return;
    }
    const cells =
      this.sel.kind === 'run'
        ? (this.selRun()?.cells ?? [])
        : [{ cx: this.sel.cx, cy: this.sel.cy }];
    const r = mapReader(m);
    for (const c of cells) {
      const hpx = surfaceHeightPx(r, c.cx, c.cy, this.host.ext);
      const pts = this.cellPoly(c.cx, c.cy, hpx / TILE);
      if (!pts) continue;
      ov.poly(pts, { stroke: COLOR.ink, line: 3 });
      ov.poly(pts, { stroke: COLOR.teal, line: 2 });
    }
    if (this.sel.kind !== 'run') return;
    for (const h of Object.values(this.handles())) {
      const p = this.host.screen([h.x, h.y, h.z]);
      if (!p) continue;
      ov.square(p, HANDLE + 2, COLOR.ink);
      ov.square(p, HANDLE, COLOR.teal);
    }
  }
}

/** The material of a preview: the region's art, translucent, red when the server would refuse. */
function ghostMaterial(tex: THREE.Texture, bad: boolean): THREE.MeshLambertMaterial {
  return new THREE.MeshLambertMaterial({
    map: tex,
    vertexColors: true,
    alphaTest: 0.5,
    transparent: true,
    opacity: 0.72,
    depthWrite: false,
    color: bad ? 0xff9a9a : 0xffffff,
    side: THREE.DoubleSide,
    polygonOffset: true,
    polygonOffsetFactor: -2,
    polygonOffsetUnits: -2,
  });
}
