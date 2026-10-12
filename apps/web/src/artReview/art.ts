import { BLOCKS, type Avatar } from '@agora/shared';
import { loadSheets } from '../game/sprites';
import { tileThumb } from '../game/tiles';
import { paperFrame } from '../game3d/paperAvatar';
import type { PaperDir } from '../game3d/paperLayout';
import { renderTile, tileCanvas } from '../worlds/placeholders';
import { cropPixels, topPixels } from '../worlds/blockArt';
import { PROPS, PLACEMENTS, WIDTH, groundAt } from './catalog';
import { loadBedArt, type BedAxis } from '../worlds/bedArt';
import { REVIEW_CROPS, type ReviewCrop } from './crops';
import { REVIEW_TREES } from './plantCatalog';
import { PLANT_ATLASES } from './plantAtlas';
import { PLANT_ITEM_ATLASES } from './plantItemAtlas';

export type ArtMode = 'new' | 'old';
export const DIRECTIONS: readonly PaperDir[] = ['down', 'left', 'right', 'up'];
const AVATAR: Avatar = { skin: 2, hair: 0, hairColor: 1, top: 1, bottom: 0, accessory: 0 };

export function canvas(w = 64, h = w): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return c;
}
function context(c: HTMLCanvasElement): CanvasRenderingContext2D {
  const ctx = c.getContext('2d', { willReadFrequently: true });
  if (!ctx) throw new Error('Canvas is unavailable');
  ctx.imageSmoothingEnabled = false;
  return ctx;
}
export async function image(url: string): Promise<HTMLImageElement> {
  const img = new Image();
  img.src = url;
  await img.decode();
  return img;
}

/** Extract by measured source bounds. Alpha trim removes padding, never scene content. */
export function extract(
  img: HTMLImageElement,
  r: readonly number[],
  size = 64,
  extent?: number,
): HTMLCanvasElement {
  const [x = 0, y = 0, w = 1, h = 1] = r;
  const raw = canvas(w, h);
  const rc = context(raw);
  rc.drawImage(img, x, y, w, h, 0, 0, w, h);
  const data = rc.getImageData(0, 0, w, h).data;
  let left = w,
    top = h,
    right = 0,
    bottom = 0;
  for (let yy = 0; yy < h; yy++)
    for (let xx = 0; xx < w; xx++) {
      if (data[(yy * w + xx) * 4 + 3]! < 200) continue;
      left = Math.min(left, xx);
      top = Math.min(top, yy);
      right = Math.max(right, xx);
      bottom = Math.max(bottom, yy);
    }
  const out = canvas(size);
  const c = context(out);
  if (left > right) return out;
  const sw = right - left + 1,
    sh = bottom - top + 1;
  const k = (size - 4) / (extent ?? Math.max(sw, sh));
  const dw = Math.round(sw * k),
    dh = Math.round(sh * k);
  c.drawImage(raw, left, top, sw, sh, Math.floor((size - dw) / 2), size - dh - 1, dw, dh);
  return out;
}

export interface ReviewArt {
  crops: Map<ReviewCrop, HTMLCanvasElement[]>;
  orchard: Map<string, HTMLCanvasElement[]>;
  seeds: Map<string, HTMLCanvasElement>;
  harvest: Map<string, HTMLCanvasElement>;
  beds: Record<BedAxis, HTMLCanvasElement>;
  birds: HTMLCanvasElement[];
  butterflies: HTMLCanvasElement[];
  torches: HTMLCanvasElement[];
  props: Record<ArtMode, Map<string, HTMLCanvasElement>>;
  growth: Map<string, HTMLCanvasElement[]>;
  icons: HTMLCanvasElement[];
  avatars: Record<ArtMode, HTMLCanvasElement[][]>;
}
export async function loadReviewArt(): Promise<ReviewArt> {
  const [props, avatar, icons, growth, ambient, beds, crops] = await Promise.all([
    image('/assets/art-review/props.png'),
    image('/assets/art-review/avatar.png'),
    image('/assets/art-review/icons.png'),
    image('/assets/art-review/tree-growth.png'),
    image('/assets/art-review/ambient.png'),
    loadBedArt(),
    image('/assets/art-review/crops.png'),
    loadSheets(),
  ]);
  const fresh = new Map<string, HTMLCanvasElement>();
  const old = new Map<string, HTMLCanvasElement>();
  const growthFrames = new Map<string, HTMLCanvasElement[]>();
  // Measured gutters; shared scale within each species preserves true seedling proportions.
  const cropFrames = new Map<ReviewCrop, HTMLCanvasElement[]>();
  const cropXs = [0, 240, 500, 800, 1180, 1619];
  const cropYs = [0, 332, 614, 971];
  (['dawn_radish', 'meadow_kale', 'honey_pea'] as const).forEach((id, row) => {
    cropFrames.set(
      id,
      [0, 1, 2, 3, 4].map((col) =>
        extract(
          crops,
          [
            cropXs[col]!,
            cropYs[row]!,
            cropXs[col + 1]! - cropXs[col]!,
            cropYs[row + 1]! - cropYs[row]!,
          ],
          96,
          436,
        ),
      ),
    );
  });
  const orchard = new Map<string, HTMLCanvasElement[]>();
  await Promise.all(
    PLANT_ATLASES.map(async (atlas) => {
      const img = await image(`/assets/art-review/${atlas.file}`);
      for (const row of atlas.rows) {
        const frames = row.rects.map((rect) =>
          extract(
            img,
            rect,
            atlas.kind === 'tree' ? 128 : 96,
            atlas.kind === 'tree' ? undefined : row.extent,
          ),
        );
        if (atlas.kind === 'tree') orchard.set(row.id, frames);
        else cropFrames.set(row.id as ReviewCrop, frames);
      }
    }),
  );
  const [seedAtlas, harvestAtlas, treeItems] = await Promise.all([
    image('/assets/art-review/seed-packets.png'),
    image('/assets/art-review/harvest-icons.png'),
    image('/assets/art-review/tree-items.png'),
  ]);
  const seeds = new Map<string, HTMLCanvasElement>(),
    harvest = new Map<string, HTMLCanvasElement>();
  const iconCell = (img: HTMLImageElement, index: number, atlas: number) =>
    extract(img, PLANT_ITEM_ATLASES[atlas]!.rects[index]!, 48);
  REVIEW_CROPS.forEach((crop, i) => {
    seeds.set(crop.id, iconCell(seedAtlas, i, 0));
    harvest.set(crop.id, iconCell(harvestAtlas, i, 1));
  });
  REVIEW_TREES.forEach((tree, i) => {
    seeds.set(tree.id, iconCell(treeItems, i, 2));
    harvest.set(tree.id, iconCell(treeItems, i + 10, 2));
  });
  // Fixed windows preserve animation registration; do not alpha-trim each pose independently.
  const frames = (y: number, h: number, centres = [200, 556, 908, 1262]) =>
    [0, 1, 2, 3].map((col) => {
      const cv = canvas(96),
        c = context(cv);
      const scale = 92 / Math.max(350, h),
        w = 350 * scale,
        height = h * scale;
      c.drawImage(ambient, centres[col]! - 175, y, 350, h, (96 - w) / 2, 95 - height, w, height);
      return cv;
    });
  const torches = frames(630, 435, [209, 551, 900, 1256]);
  // Keep one rigid post underneath all four flame poses; the hardware must never wobble.
  for (const frame of torches.slice(1)) {
    const c = context(frame);
    c.clearRect(0, 38, 96, 58);
    c.drawImage(torches[0]!, 0, 38, 96, 58, 0, 38, 96, 58);
  }
  ['oak_tree', 'spruce', 'palm', 'jungle_tree'].forEach((id, col) => {
    // Measured gutters in the generated 1448 x 1086 atlas, not assumed square cells.
    const xs = [0, 370, 721, 1093, 1448];
    const ys = [145, 395, 692, 1086];
    growthFrames.set(
      id,
      [0, 1, 2].map((row) =>
        extract(growth, [xs[col]!, ys[row]!, xs[col + 1]! - xs[col]!, ys[row + 1]! - ys[row]!], 96),
      ),
    );
  });
  for (const prop of PROPS) {
    fresh.set(prop.id, extract(props, prop.rect, growthFrames.has(prop.id) ? 128 : 96));
    if (prop.source === 'office') {
      const im = await image(tileThumb(prop.id));
      const cv = canvas(32);
      context(cv).drawImage(im, 0, 0, 32, 32);
      old.set(prop.id, cv);
    } else {
      const block = BLOCKS.list.find((b) => b.id === prop.id);
      if (!block) throw new Error(`Unknown existing item: ${prop.id}`);
      old.set(prop.id, tileCanvas(renderTile(block)));
    }
  }
  fresh.set('bed', beds.vertical);
  const avatarFrames: HTMLCanvasElement[][] = [];
  // Measured columns/rows: the generator's gutters are not an exact regular grid.
  // Use a fixed source size, not per-frame trimming, to preserve proportions through the walk.
  const centres = [208, 485, 761, 1043];
  const rowTops = [12, 325, 639, 951];
  for (let row = 0; row < 4; row++) {
    const frames: HTMLCanvasElement[] = [];
    for (let col = 0; col < 4; col++) {
      const cv = canvas(48, 72);
      const c = context(cv);
      c.drawImage(avatar, centres[col]! - 100, rowTops[row]!, 200, 290, 0, 0, 48, 72);
      frames.push(cv);
    }
    avatarFrames.push(frames);
  }
  const iconCuts = [0, 443, 887, 1354, 1774];
  const iconFrames = Array.from({ length: 8 }, (_, i) =>
    extract(
      icons,
      [iconCuts[i % 4]!, Math.floor(i / 4) * 443, iconCuts[(i % 4) + 1]! - iconCuts[i % 4]!, 443],
      32,
    ),
  );
  return {
    crops: cropFrames,
    orchard,
    seeds,
    harvest,
    beds,
    birds: frames(0, 355),
    butterflies: frames(385, 250),
    torches,
    props: { new: fresh, old },
    growth: growthFrames,
    icons: iconFrames,
    avatars: {
      new: avatarFrames,
      old: DIRECTIONS.map((dir) =>
        Array.from({ length: 4 }, (_, f) => paperFrame(AVATAR, dir, 'walk', f, 1)),
      ),
    },
  };
}

function random(seed: number): () => number {
  let n = seed >>> 0;
  return () => {
    n = (Math.imul(n, 1664525) + 1013904223) >>> 0;
    return n / 4294967296;
  };
}
/** Editable, tileable material art. Pixel geometry is separate from block geometry. */
export function groundTexture(
  id: string,
  variant: number,
  mode: ArtMode,
  frame = 0,
  edges = 0,
): HTMLCanvasElement {
  if (mode === 'old') {
    const b = BLOCKS.list.find((b) => b.id === id);
    if (b) {
      const cv = canvas(32);
      context(cv).putImageData(new ImageData(topPixels(renderTile(b)), 32, 32), 0, 0);
      return cv;
    }
  }
  const cv = canvas(64);
  const c = context(cv);
  const rand = random(variant * 917 + 421);
  const r = (x: number, y: number, w: number, h: number, colour: string) => {
    c.fillStyle = colour;
    c.fillRect(x, y, w, h);
  };
  const tx = variant % WIDTH,
    tz = Math.floor(variant / WIDTH);
  // Broad fields span tile boundaries; they are not a repeating noise stamp per cell.
  const field = (x: number, z: number) =>
    Math.sin(x * 1.6 + Math.sin(z * 1.8)) * 0.5 + Math.sin(z * 2.1 - x * 0.7) * 0.3;
  if (id === 'meadow_grass') {
    for (let y = 0; y < 64; y += 2)
      for (let x = 0; x < 64; x += 2) {
        const wx = tx + x / 64,
          wz = tz + y / 64;
        const f = field(wx, wz);
        r(x, y, 2, 2, f < -0.35 ? '#708d48' : f > 0.35 ? '#91a45a' : '#819a50');
        // Exposed earth and leaf litter follow trunks and stones, tying them to their habitat.
        for (const p of PLACEMENTS) {
          if (
            !['oak_tree', 'spruce', 'jungle_tree', 'boulder'].includes(p.id) ||
            p.growth !== undefined
          )
            continue;
          const d = Math.hypot((wx - p.x - 0.5) / 0.85, (wz - p.z - 0.5) / 0.55);
          if (d < 0.8 + field(wx * 7, wz * 7) * 0.25)
            r(x, y, 2, 2, d < 0.4 ? '#7c7047' : f > 0 ? '#82834a' : '#6c7d43');
        }
      }
    // Widely spaced asymmetric clusters; empty midtone areas keep the ground quiet.
    for (let i = 0; i < 12; i++) {
      const x = Math.floor(rand() * 60),
        y = Math.floor(rand() * 60);
      r(x, y, 5, 2, '#7a9249');
      r(x + 1, y - 1, 2, 1, '#8da556');
      if (i % 3 === 0) {
        r(x + 1, y + 1, 1, 3, '#687f42');
        r(x + 2, y, 1, 3, '#aec06b');
      }
    }
  } else if (id === 'meadow_dirt' || id === 'sand') {
    const sand = id === 'sand';
    for (let y = 0; y < 64; y += 2)
      for (let x = 0; x < 64; x += 2) {
        const f = field(tx + x / 64, tz + y / 64);
        const rough = field((tx + x / 64) * 6, (tz + y / 64) * 6);
        r(
          x,
          y,
          2,
          2,
          sand
            ? f < -0.2
              ? '#b6a77b'
              : '#c8b684'
            : f + rough * 0.18 < -0.25
              ? '#99845d'
              : f > 0.25
                ? '#b6a071'
                : '#aa9063',
        );
      }
    for (let i = 0; i < 30; i++) {
      const x = Math.floor(rand() * 62),
        y = Math.floor(rand() * 62);
      r(x, y, i % 4 === 0 ? 4 : 2, 1, sand ? '#c4ab75' : '#ac8e62');
      if (i % 4 === 0) r(x, y - 1, 3, 1, sand ? '#e5cf97' : '#d0b482');
      if (!sand && i % 7 === 0) {
        r(x, y + 1, 5, 2, '#8e7958');
        r(x + 1, y, 3, 1, '#c1b08b');
      }
    }
  } else if (id === 'wood_floor') {
    r(0, 0, 64, 64, '#a77a4e');
    for (let y = 0; y < 64; y += 16) {
      r(0, y, 64, 1, '#674b37');
      r(0, y + 1, 64, 1, '#d1a46b');
      const seam = ((y / 16) % 2) * 32 + 15;
      r(seam, y, 1, 16, '#755238');
      r(seam + 2, y + 3, 1, 1, '#5a4535');
      for (let i = 0; i < 7; i++)
        r(
          Math.floor(rand() * 52),
          y + 4 + Math.floor(rand() * 10),
          4 + Math.floor(rand() * 9),
          1,
          i % 2 ? '#b98c58' : '#946b44',
        );
    }
  } else if (id === 'tilled_soil') {
    r(0, 0, 64, 64, '#6d523b');
    for (let y = 4; y < 64; y += 12) {
      for (let x = 0; x < 64; x += 4) {
        const dy = Math.floor(rand() * 3);
        if (rand() > 0.12) r(x, y + dy, 4, 2 + Math.floor(rand() * 3), '#493e30');
        if (rand() > 0.25) r(x, y + dy + 4, 4, 1, '#927048');
      }
      for (let x = 4; x < 64; x += 13) r(x + Math.floor(rand() * 4), y + 7, 3, 1, '#a07950');
    }
    for (let i = 0; i < 40; i++) {
      const x = Math.floor(rand() * 64),
        y = Math.floor(rand() * 64);
      r(x, y, 2 + Math.floor(rand() * 5), 2, i % 3 ? '#5d4936' : '#826443');
    }
  } else if (id === 'water') {
    r(0, 0, 64, 64, '#498b91');
    for (let i = 0; i < 13; i++) {
      const x = (Math.floor(rand() * 64) + frame * 2) % 64,
        y = Math.floor(rand() * 32) * 2;
      const w = 5 + Math.floor(rand() * 10);
      r(x, y, w, 1, i % 3 === 0 ? '#a1ccc1' : '#63a7a7');
      r(x - 64, y, w, 1, i % 3 === 0 ? '#a1ccc1' : '#63a7a7');
      if (i % 4 === 0) r(x + 2, y + 2, 5, 1, '#3e7c85');
    }
  } else {
    r(0, 0, 64, 64, '#897e69');
    for (let y = 0; y < 64; y += 16) {
      r(0, y, 64, 1, '#655e51');
      r(0, y + 1, 64, 1, '#aaa087');
      for (let x = ((y / 16) % 2) * 16; x < 64; x += 32) r(x, y, 1, 16, '#655e51');
    }
  }
  // Shore and path transitions stay INSIDE the same block. N/E/S/W bit mask, no geometry changes.
  if (id === 'water' || id === 'meadow_dirt' || id === 'sand') {
    for (let edge = 0; edge < 4; edge++) {
      if (!(edges & (1 << edge))) continue;
      c.save();
      c.translate(32, 32);
      c.rotate((edge * Math.PI) / 2);
      c.translate(-32, -32);
      for (let x = 0; x < 64; x += 4) {
        const depth = 3 + Math.floor((Math.sin((x + variant * 7) * 0.17) + 1) * 5);
        if (id === 'water') {
          r(x, 0, 4, depth, '#bba579');
          r(x, depth, 4, 2, '#86b5a6');
          r(x, depth + 2, 4, 1, '#62a19d');
        } else {
          r(x, 0, 4, depth, '#82994e');
          r(x + 1, depth, 2, 1, '#a1aa63');
          if (x % 12 === 0) r(x + 2, depth - 1, 1, 3, '#698348');
        }
      }
      c.restore();
    }
  }
  // Ragged cultivated edges and occasional escaped weeds; the cell contract is unchanged.
  if (id === 'tilled_soil' || id === 'wood_floor') {
    for (let edge = 0; edge < 4; edge++) {
      const [dx, dz] = [
        [0, -1],
        [1, 0],
        [0, 1],
        [-1, 0],
      ][edge]!;
      if (groundAt(tx + dx!, tz + dz!) === id) continue;
      c.save();
      c.translate(32, 32);
      c.rotate((edge * Math.PI) / 2);
      c.translate(-32, -32);
      for (let x = 0; x < 64; x += 3) {
        const d = 1 + Math.floor(rand() * (id === 'tilled_soil' ? 7 : 3));
        if (id === 'tilled_soil') r(x, 0, 3, d, '#82934d');
        if (rand() > 0.5) {
          r(x, d, 1, 3, '#587440');
          r(x + 1, d - 1, 1, 3, '#9bb35f');
        }
      }
      c.restore();
    }
  }
  return cv;
}

/** Transparent moving glints above the separately modelled pond bed. */
export function waterSurfaceTexture(frame: number): HTMLCanvasElement {
  const cv = canvas(128),
    c = context(cv);
  const rand = random(831);
  for (let i = 0; i < 36; i++) {
    const x = (Math.floor(rand() * 128) + frame * 2) % 128;
    const y = Math.floor(rand() * 128);
    c.fillStyle = i % 5 === 0 ? '#c6e1c699' : '#97c8b14d';
    c.fillRect(x, y, 3 + Math.floor(rand() * 9), 1);
  }
  return cv;
}

/** Native foliage details for transitions: sparse blades and bank reeds, not item sprites. */
export function vergeTexture(reeds = false): HTMLCanvasElement {
  const cv = canvas(32),
    c = context(cv),
    rand = random(reeds ? 85 : 32);
  for (let i = 0; i < (reeds ? 8 : 12); i++) {
    const x = 5 + Math.floor(rand() * 23),
      h = (reeds ? 12 : 3) + Math.floor(rand() * 12);
    c.fillStyle = i % 2 ? '#668544' : '#415f39';
    c.fillRect(x, 30 - h, 1, h);
    c.fillStyle = '#9cad61';
    c.fillRect(x + 1, 32 - h, 1, h - 2);
    if (reeds && i % 3 === 0) {
      c.fillStyle = '#796041';
      c.fillRect(x - 1, 28 - h, 3, 5);
    }
  }
  return cv;
}

/** Legacy crop art retained only for the comparison view. */
export function cropTexture(stage: number): HTMLCanvasElement {
  const cv = canvas(32);
  context(cv).putImageData(new ImageData(cropPixels(stage, [222, 70, 70]), 32, 32), 0, 0);
  return cv;
}
