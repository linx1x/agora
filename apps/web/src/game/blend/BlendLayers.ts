/**
 * Blended tiles in the world (ADR-037, P9.10): two blank tilemap layers drawn just above the
 * floor and furniture layers, whose tiles come from a growing variant atlas. Each variant is
 * one composed cell, cached by its neighbourhood key (`groundKey` / `furnitureKey`), so equal
 * neighbourhoods (every desk pod of a wing) share one atlas slot.
 *
 * The first build is spread over frames, nearest the camera first; the plain tiles show until
 * a cell's variant is ready. Edits recompose the cells within BLEND_RADIUS of each change.
 */
import Phaser from 'phaser';
import {
  BLEND_RADIUS,
  TILE,
  furnitureKey,
  groundKey,
  mapReader,
  type CellChange,
  type TileReader,
  type WorldMap,
} from '@agora/shared';
import { T } from './compose';
import { composeCell, tileSource, type Kind } from './source';

export { composeCell, tileSource };

/**
 * The atlas is split into 512 px pages (256 variants each), each its own texture: an edit
 * re-uploads one page, not a 16 MB atlas. Up to 16 pages (4096 variants).
 */
const PAGE = 'blend-atlas-';
const PAGE_PX = 512;
const PAGE_COLS = PAGE_PX / T;
const PAGE_SLOTS = PAGE_COLS * PAGE_COLS;
const MAX_PAGES = 16;
const SLOTS = PAGE_SLOTS * MAX_PAGES;
/** gid of slot 0 in the blend tilemap */
const FIRST = 1;
/** time spent composing per frame during the first build */
const BUDGET_MS = 8;

interface Page {
  key: string;
  tex: Phaser.Textures.CanvasTexture;
  ts: Phaser.Tilemaps.Tileset;
  dirty: boolean;
}

export class BlendLayers {
  private pages: Page[] = [];
  /** composed pixels per slot (the preview reads these; no GPU readback) */
  private pix: Uint8ClampedArray[] = [];
  private ground: Phaser.Tilemaps.TilemapLayer;
  private furn: Phaser.Tilemaps.TilemapLayer;
  private slots = new Map<string, number>();
  private next = 0;
  private keys: Record<Kind, (string | null)[]>;
  /** keys waiting for their first composition, with the cells that use them */
  private pending = new Map<string, { kind: Kind; cells: number[] }>();
  private overflowed = false;
  private needRebuild = false;
  private queue: string[] | null = null;
  /** for the e2e test hook and the console */
  readonly stats = { variants: 0, composeMs: 0, cells: 0 };

  private tm: Phaser.Tilemaps.Tilemap;

  constructor(
    private scene: Phaser.Scene,
    private base: {
      floor: Phaser.Tilemaps.TilemapLayer | null;
      furniture: Phaser.Tilemaps.TilemapLayer | null;
    },
    private map: () => WorldMap,
  ) {
    const m = map();
    // A Tiled map refuses tilesets it was not loaded with, so the variants live on their own
    // blank tilemap of the same size, layered by depth between the map's layers.
    this.tm = scene.make.tilemap({ tileWidth: T, tileHeight: T, width: m.width, height: m.height });
    const first = this.newPage();
    const mk = (name: string, over: Phaser.Tilemaps.TilemapLayer | null) =>
      this.tm
        .createBlankLayer(name, first.ts, 0, 0, m.width, m.height, TILE, TILE)!
        .setDepth((over?.depth ?? 0) + 0.5);
    this.ground = mk('blend-ground', base.floor);
    this.furn = mk('blend-furniture', base.furniture);
    this.keys = {
      g: new Array(m.width * m.height).fill(null),
      f: new Array(m.width * m.height).fill(null),
    };
    tileSource();
    this.scanAll();
  }

  /** `restore`: show the plain furniture again (flag turned off); skip when the scene goes. */
  destroy(restore = false) {
    this.ground.destroy();
    this.furn.destroy();
    this.tm.destroy();
    if (restore) for (let i = 0; i < this.keys.f.length; i++) if (this.keys.f[i]) this.showBase(i);
    for (const p of this.pages)
      if (this.scene.textures.exists(p.key)) this.scene.textures.remove(p.key);
    this.pages = [];
  }

  private newPage(): Page {
    const n = this.pages.length;
    const key = `${PAGE}${n}`;
    if (this.scene.textures.exists(key)) this.scene.textures.remove(key);
    const tex = this.scene.textures.createCanvas(key, PAGE_PX, PAGE_PX)!;
    const ts = this.tm.addTilesetImage(key, key, T, T, 0, 0, FIRST + n * PAGE_SLOTS)!;
    const page = { key, tex, ts, dirty: false };
    this.pages.push(page);
    const all = this.pages.map((p) => p.ts);
    // TilemapLayer#setTilesets exists in Phaser 4 (TilemapLayer.js) but is not in its typings
    type WithSets = { setTilesets(t: Phaser.Tilemaps.Tileset[]): void };
    (this.ground as unknown as WithSets | undefined)?.setTilesets(all);
    (this.furn as unknown as WithSets | undefined)?.setTilesets(all);
    return page;
  }

  /** True while the first build is still composing. */
  get busy() {
    return this.pending.size > 0;
  }

  // ───────────────────────────────────────────── keys
  private scanAll() {
    const m = this.map();
    const r = mapReader(m);
    for (let y = 0; y < m.height; y++)
      for (let x = 0; x < m.width; x++) this.setKeys(r, x, y, false);
  }

  /** Recompute a cell's keys; put a ready variant or queue its composition. */
  private setKeys(r: TileReader, x: number, y: number, now: boolean) {
    const m = this.map();
    const i = y * m.width + x;
    for (const kind of ['g', 'f'] as const) {
      const k = kind === 'g' ? groundKey(r, x, y) : furnitureKey(r, x, y);
      const layer = kind === 'g' ? this.ground : this.furn;
      if (k === this.keys[kind][i] && (k === null || this.slots.has(k))) {
        if (k && kind === 'f') this.hideBase(i); // an edit may have re-put the plain tile
        continue;
      }
      const old = this.keys[kind][i];
      const waiting = old ? this.pending.get(old) : undefined;
      if (waiting) waiting.cells = waiting.cells.filter((c) => c !== i);
      this.keys[kind][i] = k;
      if (!k) {
        layer.removeTileAt(x, y);
        if (kind === 'f') this.showBase(i);
        continue;
      }
      const slot = this.slots.get(k);
      if (slot !== undefined) {
        this.put(kind, i, slot);
        continue;
      }
      if (now) {
        const s = this.compose(r, kind, x, y, k);
        if (s !== null) this.put(kind, i, s);
      } else {
        const p = this.pending.get(k);
        if (p) p.cells.push(i);
        else this.pending.set(k, { kind, cells: [i] });
      }
    }
  }

  private put(kind: Kind, i: number, slot: number) {
    const w = this.map().width;
    const x = i % w;
    const y = (i - x) / w;
    (kind === 'g' ? this.ground : this.furn).putTileAt(FIRST + slot, x, y);
    if (kind === 'f') this.hideBase(i);
  }
  private hideBase(i: number) {
    const w = this.map().width;
    const t = this.base.furniture?.getTileAt(i % w, Math.floor(i / w));
    if (t) t.setVisible(false);
  }
  private showBase(i: number) {
    const w = this.map().width;
    const t = this.base.furniture?.getTileAt(i % w, Math.floor(i / w));
    if (t) t.setVisible(true);
  }

  /** Compose a variant into a new atlas slot; null if the atlas is full. */
  private compose(r: TileReader, kind: Kind, x: number, y: number, key: string): number | null {
    if (this.next >= SLOTS) {
      if (!this.overflowed) this.needRebuild = true;
      return null;
    }
    const t0 = performance.now();
    const px = composeCell(r, kind, x, y);
    const slot = this.next++;
    const pi = Math.floor(slot / PAGE_SLOTS);
    const page = this.pages[pi] ?? this.newPage();
    const local = slot % PAGE_SLOTS;
    page.tex
      .getContext()
      .putImageData(
        new ImageData(px as Uint8ClampedArray<ArrayBuffer>, T, T),
        (local % PAGE_COLS) * T,
        Math.floor(local / PAGE_COLS) * T,
      );
    page.dirty = true;
    this.pix[slot] = px;
    this.slots.set(key, slot);
    this.stats.variants = this.slots.size;
    this.stats.composeMs += performance.now() - t0;
    return slot;
  }

  /** Atlas full of variants old edits left behind: start over with only the live ones. */
  private rebuild() {
    this.overflowed = true;
    this.slots.clear();
    this.next = 0;
    this.pix = [];
    for (const p of this.pages) {
      p.tex.clear();
      p.dirty = true;
    }
    this.pending.clear();
    this.queue = null;
    for (const kind of ['g', 'f'] as const) this.keys[kind].fill(null);
    this.ground.fill(-1);
    this.furn.fill(-1);
    this.scanAll();
    console.warn('[blend] variant atlas was full; rebuilt it');
  }

  // ───────────────────────────────────────────── build preview (P9.12)
  private scratch = new Map<string, Uint8ClampedArray>();
  private masked: number[] = [];

  /** Live key of a cell (null: plain tile). */
  keyAt(kind: Kind, i: number): string | null {
    return this.keys[kind][i] ?? null;
  }

  /**
   * Pixels of a cell as some reader would draw it: the live variant when it exists,
   * else composed into a small scratch cache that never touches the atlas.
   */
  pixelsFor(kind: Kind, key: string, r: TileReader, x: number, y: number): Uint8ClampedArray {
    const slot = this.slots.get(key);
    if (slot !== undefined && this.pix[slot]) return this.pix[slot];
    let px = this.scratch.get(key);
    if (!px) {
      px = composeCell(r, kind, x, y);
      if (this.scratch.size > 512) this.scratch.clear();
      this.scratch.set(key, px);
    }
    return px;
  }

  /** Hide the live furniture (blended and plain) under preview cells. */
  mask(cells: number[]) {
    this.unmask();
    const w = this.map().width;
    for (const i of cells) {
      const t = this.furn.getTileAt(i % w, Math.floor(i / w));
      if (t) t.setVisible(false);
      const b = this.base.furniture?.getTileAt(i % w, Math.floor(i / w));
      if (b) b.setVisible(false);
    }
    this.masked = cells;
  }

  unmask() {
    const w = this.map().width;
    for (const i of this.masked) {
      const t = this.furn.getTileAt(i % w, Math.floor(i / w));
      if (t) t.setVisible(true);
      if (!this.keys.f[i]) this.showBase(i);
    }
    this.masked = [];
  }

  /** Depth of the live blended layers (the preview sits just above them). */
  depthOf(kind: Kind) {
    return (kind === 'g' ? this.ground : this.furn).depth;
  }

  // ───────────────────────────────────────────── live
  /** Map changed (server echo): recompose what the changes can reach. */
  onEdit(changes: CellChange[]) {
    const m = this.map();
    const r = mapReader(m);
    const seen = new Set<number>();
    for (const c of changes)
      for (let dy = -BLEND_RADIUS; dy <= BLEND_RADIUS; dy++)
        for (let dx = -BLEND_RADIUS; dx <= BLEND_RADIUS; dx++) {
          const x = c.x + dx;
          const y = c.y + dy;
          if (x < 0 || y < 0 || x >= m.width || y >= m.height) continue;
          const i = y * m.width + x;
          if (seen.has(i)) continue;
          seen.add(i);
          this.setKeys(r, x, y, true);
        }
    this.flush();
  }

  /** Spend a slice of the frame on the first build, nearest the camera first. */
  update() {
    if (this.pending.size) {
      const w = this.map().width;
      if (!this.queue) {
        // nearest the camera first, decided once per build (re-sorting every frame costs more
        // than it saves)
        const cam = this.scene.cameras.main;
        const cx = cam.worldView.centerX / T;
        const cy = cam.worldView.centerY / T;
        const dist = (cells: number[]) => {
          let d = Infinity;
          for (const i of cells)
            d = Math.min(d, Math.abs((i % w) - cx) + Math.abs(Math.floor(i / w) - cy));
          return d;
        };
        this.queue = [...this.pending.entries()]
          .map(([k, p]) => ({ k, d: dist(p.cells) }))
          .sort((a, b) => a.d - b.d)
          .map((e) => e.k);
      }
      const r = mapReader(this.map());
      const t0 = performance.now();
      while (this.queue.length && performance.now() - t0 < BUDGET_MS) {
        const k = this.queue.shift()!;
        const p = this.pending.get(k);
        this.pending.delete(k);
        if (!p?.cells.length) continue;
        const i = p.cells[0]!;
        const slot = this.compose(r, p.kind, i % w, Math.floor(i / w), k);
        if (slot === null) continue;
        for (const c of p.cells) this.put(p.kind, c, slot);
      }
      if (!this.queue.length) {
        this.queue = null;
        // anything still pending was queued after the sort: next frame sorts again
      }
      this.stats.cells = this.keys.g.filter(Boolean).length + this.keys.f.filter(Boolean).length;
    }
    this.flush();
  }

  private flush() {
    if (this.needRebuild) {
      this.needRebuild = false;
      this.rebuild();
    }
    for (const p of this.pages)
      if (p.dirty) {
        p.dirty = false;
        p.tex.refresh();
      }
  }
}
