import { extract, image } from '../art';
import type { BiomeArt, BiomeDefinition } from './types';
import jungle from './jungle.json';
import desert from './desert.json';
import taiga from './taiga.json';

const xs = [0, 319, 634, 949, 1254],
  ys = [0, 350, 627, 897, 1254];
const meadow: BiomeDefinition = {
  id: 'meadow',
  label: 'Meadow',
  description: 'A sunlit pasture, wildflower banks and an oak-shaded pond.',
  colors: {
    grass: '#829b50',
    dirt: '#9c8056',
    stone: '#879184',
    water: '#4d989a',
    edge: '#485638',
    accent: '#c7bd70',
  },
  propsImage: '../props.png',
  animalsImage: 'meadow-animals.png',
  props: [
    { id: 'oak_tree', label: 'Old oak', rect: [0, 0, 355, 382], width: 3.6, height: 4.5 },
    { id: 'flower', label: 'Wildflower bank', rect: [330, 390, 310, 272], width: 1, height: 0.85 },
    { id: 'fern', label: 'Meadow fern', rect: [640, 383, 320, 261], width: 1.1, height: 0.8 },
    { id: 'boulder', label: 'Lichen boulder', rect: [0, 395, 330, 259], width: 1.5, height: 1.2 },
    { id: 'fence', label: 'Pasture fence', rect: [958, 691, 296, 235], width: 1.5, height: 1.05 },
    { id: 'flower', label: 'Clover flowers', rect: [330, 390, 310, 272], width: 0.65, height: 0.5 },
  ],
  animals: ['Dairy cow', 'Pig', 'Hen', 'Deer'].map((label, row) => ({
    id: ['cow', 'pig', 'hen', 'deer'][row]!,
    label,
    kind: row === 3 ? 'wild' : 'farm',
    width: [1.8, 1.1, 0.65, 1.6][row]!,
    height: [1.8, 1.1, 0.65, 1.6][row]!,
    behavior: [
      'Grazes, wanders and accepts a gentle pat.',
      'Roots around in the pasture.',
      'Pecks for seeds between the grasses.',
      'Pauses to listen, then grazes by the tree line.',
    ][row]!,
    rects: [0, 1, 2, 3].map((col) => [
      xs[col]!,
      ys[row]!,
      xs[col + 1]! - xs[col]!,
      ys[row + 1]! - ys[row]!,
    ]),
  })),
};
export const BIOME_DEFINITIONS: readonly BiomeDefinition[] = [meadow, jungle, desert, taiga];
const loaded = new Map<string, Promise<BiomeArt>>();
export function loadBiomeArt(id: string): Promise<BiomeArt> {
  let promise = loaded.get(id);
  if (!promise) {
    promise = (async () => {
      const definition = BIOME_DEFINITIONS.find((b) => b.id === id)!;
      const [props, animals] = await Promise.all([
        image(`/assets/art-review/biomes/${definition.propsImage}`),
        image(`/assets/art-review/biomes/${definition.animalsImage}`),
      ]);
      return {
        definition,
        props: definition.props.map((p) => extract(props, p.rect, 192)),
        animals: definition.animals.map((a) => {
          // A common scale per species prevents the feeding frame growing or shrinking.
          const extent = Math.max(...a.rects.map((r) => Math.max(r[2]!, r[3]!)));
          return a.rects.map((r) => extract(animals, r, 128, extent));
        }),
      };
    })();
    loaded.set(id, promise);
    void promise.catch(() => loaded.delete(id));
  }
  return promise;
}
