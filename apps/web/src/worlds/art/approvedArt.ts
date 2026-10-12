/** The approved review artwork, mapped onto existing production IDs without changing saves. */
import { BLOCKS } from '@agora/shared';
import { PROPS, ICONS } from '../../artReview/catalog';
import { PLANT_ATLASES } from '../../artReview/plantAtlas';
import { PLANT_ITEM_ATLASES } from '../../artReview/plantItemAtlas';
import { REVIEW_CROPS, REVIEW_TREES } from '../../artReview/plantCatalog';
import { plantedSoilTexture, plantingDepth } from '../../artReview/cropSoil';
import jungle from '../../artReview/biomes/jungle.json';
import desert from '../../artReview/biomes/desert.json';
import taiga from '../../artReview/biomes/taiga.json';
import { loadBedArt } from '../bedArt';
import { cropFrameName } from '../blockArt';
import { canvas, extract, image } from './pixels';
import { terrainTexture } from './terrain';

export interface SpriteMetrics {
  width: number;
  height: number;
  footDepth: number;
  bottom: number;
  burial?: number;
}
export interface ApprovedWorldArt {
  decor: Map<string, HTMLCanvasElement>;
  crops: Map<string, HTMLCanvasElement>;
  animals: Map<string, HTMLCanvasElement[]>;
  icons: Map<string, HTMLCanvasElement>;
  terrain: Map<string, HTMLCanvasElement>;
  metrics: Map<string, SpriteMetrics>;
  growth: Map<string, HTMLCanvasElement[]>;
  birds: HTMLCanvasElement[];
  butterflies: HTMLCanvasElement[];
  torches: HTMLCanvasElement[];
}
const SIZES: Record<string, readonly [number, number, number]> = {
  oak_tree: [3.3, 4.4, 0.18],
  spruce: [2.5, 4.8, 0.12],
  palm: [2.9, 4.3, 0.1],
  jungle_tree: [3.4, 4.6, 0.18],
  flower: [0.75, 0.55, 0.045],
  fern: [0.9, 0.7, 0.07],
  cactus: [0.8, 1.3, 0.045],
  torch: [0.65, 1.1, 0.035],
  bed: [1.85, 1.85, 0.4],
  'bed:horizontal': [2.2, 1.65, 0.35],
  workbench: [1.85, 1.4, 0.18],
  boulder: [1, 0.85, 0.12],
  chest: [1, 1, 0.12],
  shipping_bin: [1.2, 1.2, 0.18],
  fence: [1.2, 1, 0.055],
};
export function spriteMetrics(
  source: HTMLCanvasElement,
  width: number,
  height: number,
  footDepth = 0.04,
): SpriteMetrics {
  const data = source.getContext('2d')!.getImageData(0, 0, source.width, source.height).data;
  let bottom = 1;
  outer: for (let y = source.height - 1; y >= 0; y--)
    for (let x = 0; x < source.width; x++) {
      if (data[(y * source.width + x) * 4 + 3]! >= 128) {
        bottom = (y + 1) / source.height;
        break outer;
      }
    }
  return { width, height, footDepth, bottom };
}
let pending: Promise<ApprovedWorldArt> | undefined;
export function loadApprovedWorldArt(): Promise<ApprovedWorldArt> {
  return (pending ??= load().catch((error) => {
    pending = undefined;
    throw error;
  }));
}
async function load(): Promise<ApprovedWorldArt> {
  const decor = new Map<string, HTMLCanvasElement>(),
    crops = new Map<string, HTMLCanvasElement>();
  const animals = new Map<string, HTMLCanvasElement[]>(),
    icons = new Map<string, HTMLCanvasElement>();
  const terrain = new Map<string, HTMLCanvasElement>(),
    metrics = new Map<string, SpriteMetrics>();
  const growth = new Map<string, HTMLCanvasElement[]>();
  const [props, originalCrops, seeds, harvest, iconSheet, ambient, treeGrowth, beds] =
    await Promise.all([
      image('/assets/art-review/props.png'),
      image('/assets/art-review/crops.png'),
      image('/assets/art-review/seed-packets.png'),
      image('/assets/art-review/harvest-icons.png'),
      image('/assets/art-review/icons.png'),
      image('/assets/art-review/ambient.png'),
      image('/assets/art-review/tree-growth.png'),
      loadBedArt(),
    ]);
  const putDecor = (id: string, source: HTMLCanvasElement, size = SIZES[id] ?? [1, 1, 0.04]) => {
    decor.set(id, source);
    icons.set(id, source);
    metrics.set(`decor:${id}`, spriteMetrics(source, size[0]!, size[1]!, size[2]!));
  };
  for (const prop of PROPS)
    if (prop.source === 'world') putDecor(prop.id, extract(props, prop.rect, 128));
  putDecor('bed', beds.vertical);
  putDecor('bed:horizontal', beds.horizontal);
  const putCrop = (id: string, frames: HTMLCanvasElement[]) => {
    const definition = REVIEW_CROPS.find((c) => c.id === id);
    if (!definition?.existing) return;
    frames.forEach((source, stage) => {
      const key = cropFrameName(id, stage);
      crops.set(key, source);
      metrics.set(key, {
        ...spriteMetrics(source, definition.size, definition.size, 0),
        burial: plantingDepth(definition.id, stage),
      });
    });
  };
  const xs = [0, 240, 500, 800, 1180, 1619],
    ys = [0, 332, 614, 971];
  ['dawn_radish', 'meadow_kale', 'honey_pea'].forEach((id, row) =>
    putCrop(
      id,
      [0, 1, 2, 3, 4].map((col) =>
        extract(
          originalCrops,
          [xs[col]!, ys[row]!, xs[col + 1]! - xs[col]!, ys[row + 1]! - ys[row]!],
          96,
          436,
        ),
      ),
    ),
  );
  await Promise.all(
    PLANT_ATLASES.filter(
      (a) =>
        a.kind !== 'tree' &&
        a.rows.some((r) => REVIEW_CROPS.some((c) => c.id === r.id && c.existing)),
    ).map(async (atlas) => {
      const sheet = await image(`/assets/art-review/${atlas.file}`);
      for (const row of atlas.rows)
        putCrop(
          row.id,
          row.rects.map((rect) => extract(sheet, rect, 96, row.extent)),
        );
    }),
  );
  REVIEW_CROPS.forEach((crop, i) => {
    if (!crop.existing) return;
    icons.set(`${crop.id}_seed`, extract(seeds, PLANT_ITEM_ATLASES[0]!.rects[i]!, 48));
    icons.set(crop.id, extract(harvest, PLANT_ITEM_ATLASES[1]!.rects[i]!, 48));
  });
  const cuts = [0, 443, 887, 1354, 1774];
  ICONS.forEach((icon, i) => {
    if (!icons.has(icon.id))
      icons.set(
        icon.id,
        extract(
          iconSheet,
          [cuts[i % 4]!, Math.floor(i / 4) * 443, cuts[(i % 4) + 1]! - cuts[i % 4]!, 443],
          48,
        ),
      );
  });
  for (const tree of REVIEW_TREES.filter((t) =>
    ['oak_tree', 'spruce', 'palm', 'jungle_tree'].includes(t.id),
  )) {
    const col = ['oak_tree', 'spruce', 'palm', 'jungle_tree'].indexOf(tree.id),
      x = [0, 370, 721, 1093, 1448],
      y = [145, 395, 692, 1086];
    growth.set(
      tree.id,
      [0, 1, 2].map((row) =>
        extract(treeGrowth, [x[col]!, y[row]!, x[col + 1]! - x[col]!, y[row + 1]! - y[row]!], 96),
      ),
    );
  }
  await Promise.all(
    [jungle, desert, taiga].map(async (definition) => {
      const [p, a] = await Promise.all([
        image(`/assets/art-review/biomes/${definition.propsImage}`),
        image(`/assets/art-review/biomes/${definition.animalsImage}`),
      ]);
      for (const prop of definition.props) {
        const size = Math.max(prop.width, prop.height);
        putDecor(prop.id, extract(p, prop.rect, 128), [
          size,
          size,
          /tree|palm|spruce/.test(prop.id) ? 0.13 : 0.04,
        ]);
      }
      for (const animal of definition.animals) {
        const extent = Math.max(...animal.rects.map((r) => Math.max(r[2]!, r[3]!)));
        const frames = animal.rects.map((r) => extract(a, r, 128, extent));
        animals.set(`${definition.id}:${animal.id}`, frames);
        const size = Math.max(animal.width, animal.height);
        metrics.set(
          `animal:${definition.id}:${animal.id}`,
          spriteMetrics(frames[0]!, size, size, 0.04),
        );
      }
    }),
  );
  const meadow = await image('/assets/art-review/biomes/meadow-animals.png'),
    mx = [0, 319, 634, 949, 1254],
    my = [0, 350, 627, 897, 1254];
  ['cow', 'pig', 'hen', 'deer'].forEach((id, row) => {
    const extent = Math.max(319, my[row + 1]! - my[row]!);
    const frames = [0, 1, 2, 3].map((col) =>
      extract(
        meadow,
        [mx[col]!, my[row]!, mx[col + 1]! - mx[col]!, my[row + 1]! - my[row]!],
        128,
        extent,
      ),
    );
    animals.set(`meadow:${id}`, frames);
    const size = [1.8, 1.1, 0.65, 1.6][row]!;
    metrics.set(`animal:meadow:${id}`, spriteMetrics(frames[0]!, size, size, 0.045));
  });
  for (const [target, source] of [
    ['spruce', 'snow_spruce'],
    ['palm', 'oasis_palm'],
    ['cactus', 'flowering_cactus'],
    ['dead_bush', 'dry_bush'],
  ] as const) {
    const frame = decor.get(source);
    if (frame) {
      decor.set(target, frame);
      icons.set(target, frame);
      metrics.set(`decor:${target}`, metrics.get(`decor:${source}`)!);
    }
  }
  for (const [kind, source] of [
    ['plume_hen', 'meadow:hen'],
    ['milk_cow', 'meadow:cow'],
    ['cloud_sheep', 'taiga:shaggy_sheep'],
  ] as const) {
    const frames = animals.get(source);
    if (frames) {
      animals.set(kind, frames);
      metrics.set(`animal:${kind}`, metrics.get(`animal:${source}`)!);
    }
  }
  const goat = await image('/assets/art-review/biomes/rune-goat.png');
  const goatFrames = [
    [0, 0, 635, 640],
    [635, 0, 619, 640],
    [0, 640, 635, 614],
    [635, 640, 619, 614],
  ].map((r) => extract(goat, r, 128, 640));
  animals.set('rune_goat', goatFrames);
  metrics.set('animal:rune_goat', spriteMetrics(goatFrames[0]!, 1.1, 1.1, 0.045));
  const ambientFrames = (y: number, h: number, centres = [200, 556, 908, 1262]) =>
    centres.map((x) => {
      const cv = canvas(96),
        ctx = cv.getContext('2d')!,
        k = 92 / Math.max(350, h);
      ctx.imageSmoothingEnabled = false;
      ctx.drawImage(ambient, x - 175, y, 350, h, (96 - 350 * k) / 2, 95 - h * k, 350 * k, h * k);
      return cv;
    });
  const birds = ambientFrames(0, 355),
    butterflies = ambientFrames(385, 250),
    torches = ambientFrames(630, 435, [209, 551, 900, 1256]);
  torches.slice(1).forEach((frame) => {
    const c = frame.getContext('2d')!;
    c.clearRect(0, 38, 96, 58);
    c.drawImage(torches[0]!, 0, 38, 96, 58, 0, 38, 96, 58);
  });
  putDecor('torch', torches[0]!);
  for (const block of BLOCKS.list) {
    const surface = terrainTexture(block.id);
    if (surface) terrain.set(block.id, surface);
  }
  for (let stage = 0; stage < 5; stage++)
    terrain.set(`tilled_soil:${stage}`, plantedSoilTexture(terrain.get('tilled_soil')!, stage, 13));
  return { decor, crops, animals, icons, terrain, metrics, growth, birds, butterflies, torches };
}
