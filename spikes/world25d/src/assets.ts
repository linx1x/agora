/**
 * Loads the app's sprite sheets (ADR-020, ADR-022) from apps/web/public through Vite imports, so a
 * single-file build carries them inline, then fills the `art` / `sheets` records that tiles.ts reads.
 */
import { art, sheets, type ArtSprite } from '@web/game/sprites';
import { tilesetCanvas } from '@web/game/tiles';

const pngs = import.meta.glob('../../../apps/web/public/assets/agora/*.png', {
  query: '?url',
  import: 'default',
  eager: true,
}) as Record<string, string>;
const manifests = import.meta.glob('../../../apps/web/public/assets/agora/*.json', {
  import: 'default',
  eager: true,
}) as Record<string, { sprites: Record<string, Omit<ArtSprite, 'img'>> }>;
const kenney = import.meta.glob('../../../apps/web/public/assets/kenney/*.png', {
  query: '?url',
  import: 'default',
  eager: true,
}) as Record<string, string>;

const img = (src: string) =>
  new Promise<HTMLImageElement>((ok, ko) => {
    const i = new Image();
    i.onload = () => ok(i);
    i.onerror = ko;
    i.src = src;
  });

let ready: Promise<HTMLCanvasElement> | null = null;
/** Every tile of the app's tileset drawn into one canvas (8 columns × 32 px), as the game does. */
export function loadTileset(): Promise<HTMLCanvasElement> {
  ready ??= (async () => {
    for (const [path, url] of Object.entries(pngs)) {
      const m = manifests[path.replace('.png', '.json')];
      if (!m) continue;
      const im = await img(url);
      for (const [name, d] of Object.entries(m.sprites)) art[name] = { ...d, img: im };
    }
    for (const [path, url] of Object.entries(kenney)) {
      const im = await img(url);
      if (path.includes('roguelike-rpg')) sheets.rpg = im;
      if (path.includes('roguelike-indoor')) sheets.ind = im;
    }
    return tilesetCanvas();
  })();
  return ready;
}
