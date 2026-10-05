/**
 * Third-party sprite sheets (Kenney, CC0 — see assets/registry.json and ADR-020).
 * 16×16 tiles with a 1 px gap; drawn at 2× (nearest neighbour) into 32×32 cells.
 */
export type SheetId = 'rpg' | 'ind';
export const SHEET_URLS: Record<SheetId, string> = {
  rpg: '/assets/kenney/roguelike-rpg.png',
  ind: '/assets/kenney/roguelike-indoor.png',
};
export const sheets: Partial<Record<SheetId, HTMLImageElement>> = {};

/**
 * Original Agora art (ADR-022). Hand-drawn 32 px sprites in `assets/agora/<sheet>.png` with a
 * `<sheet>.json` manifest {sprites: {name: {x, y, w, h, frames, fps}}}. Sprite names equal tile keys
 * from `tileset.ts` (e.g. 'jungle.deskH', 'chairUp'). Frame 0 is the still / reduced-motion frame.
 */
export const ART_SHEETS = ['common', 'hub', 'jungle', 'oasis', 'boreal', 'zen'] as const;
export interface ArtSprite {
  img: HTMLImageElement;
  x: number;
  y: number;
  w: number;
  h: number;
  frames: number;
  fps: number;
}
export const art: Record<string, ArtSprite> = {};

function loadArtSheet(id: string): Promise<void> {
  return new Promise<void>((resolve) => {
    const img = new Image();
    img.onload = () => {
      fetch(`/assets/agora/${id}.json`)
        .then((r) => r.json())
        .then((m: { sprites: Record<string, Omit<ArtSprite, 'img'>> }) => {
          for (const [name, d] of Object.entries(m.sprites)) art[name] = { ...d, img };
        })
        .catch(() => undefined)
        .finally(resolve);
    };
    img.onerror = () => resolve();
    img.src = `/assets/agora/${id}.png`;
  });
}

/** Draw frame `frame` of an Agora art sprite at (dx, dy) 1:1. Returns false if it is not loaded. */
export function drawArt(
  c: CanvasRenderingContext2D,
  name: string,
  dx = 0,
  dy = 0,
  frame = 0,
  srcY = 0,
  srcH?: number,
): boolean {
  const a = art[name];
  if (!a) return false;
  const h = srcH ?? a.h - srcY;
  c.imageSmoothingEnabled = false;
  c.drawImage(a.img, a.x + frame * a.w, a.y + srcY, a.w, h, dx, dy + srcY, a.w, h);
  return true;
}

/** Draw frame `frame` of the 32×32 slice (col, row) of a bigger Agora art sprite at (dx, dy). */
export function drawArtSlice(
  c: CanvasRenderingContext2D,
  name: string,
  col: number,
  row: number,
  dx = 0,
  dy = 0,
  frame = 0,
): boolean {
  const a = art[name];
  if (!a) return false;
  c.imageSmoothingEnabled = false;
  c.drawImage(a.img, a.x + frame * a.w + col * 32, a.y + row * 32, 32, 32, dx, dy, 32, 32);
  return true;
}

let loading: Promise<void> | null = null;
/** Load every sheet once; resolves even if one fails (procedural art is the fallback). */
export function loadSheets(): Promise<void> {
  loading ??= Promise.all([
    ...(Object.keys(SHEET_URLS) as SheetId[]).map(
      (id) =>
        new Promise<void>((resolve) => {
          const img = new Image();
          img.onload = () => {
            sheets[id] = img;
            resolve();
          };
          img.onerror = () => resolve();
          img.src = SHEET_URLS[id];
        }),
    ),
    ...ART_SHEETS.map(loadArtSheet),
  ]).then(() => undefined);
  return loading;
}

export type Sprite = [SheetId, number, number];

/** Draw a 16 px source tile at (dx, dy) scaled ×`scale`. Returns false if the sheet is missing. */
export function drawSprite(
  c: CanvasRenderingContext2D,
  [id, col, row]: Sprite,
  dx = 0,
  dy = 0,
  scale = 2,
  srcY = 0,
  srcH = 16,
): boolean {
  const img = sheets[id];
  if (!img) return false;
  c.imageSmoothingEnabled = false;
  c.drawImage(
    img,
    col * 17,
    row * 17 + srcY,
    16,
    srcH,
    dx,
    dy + srcY * scale,
    16 * scale,
    srcH * scale,
  );
  return true;
}
