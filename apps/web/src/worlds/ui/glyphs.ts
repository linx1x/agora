/**
 * The icon of an item in the hotbar (P17.21d): a small code-drawn glyph chosen from the item's kind
 * (and its id for materials), tinted by its family. A tool takes its tier's colour, so the tier reads
 * on the slot as it does on the card. Pure: the HUD draws the glyph (`ItemGlyph.tsx`), and the names
 * stay in the tooltip and the accessible name. No image files, so no registry row.
 */
import { baseItemOf, loadGameData, toolOf, type GameData } from '@agora/shared';
import { tierOverlay } from '../tools/overlay';

/** The drawn shapes: a plant or a product, a material, a food, an animal, a building, a tool. */
export const GLYPHS = [
  'sprout',
  'bloom',
  'leaf',
  'stone',
  'log',
  'fiber',
  'gem',
  'ingot',
  'drop',
  'sack',
  'paw',
  'gear',
  'house',
  'bowl',
  'fish',
  'hoe',
  'can',
  'axe',
  'pick',
  'shovel',
  'rod',
] as const;
export type Glyph = (typeof GLYPHS)[number];

export interface ItemGlyph {
  readonly glyph: Glyph;
  /** the fill of the shape (a tool's tier colour, a family colour otherwise) */
  readonly tint: string;
}

const KIND_GLYPH: Readonly<Record<string, Glyph>> = {
  seed: 'sprout',
  crop: 'bloom',
  forage: 'leaf',
  product: 'drop',
  feed: 'sack',
  fertilizer: 'sack',
  animal: 'paw',
  machine: 'gear',
  building: 'house',
  food: 'bowl',
  fish: 'fish',
};

const KIND_TINT: Readonly<Record<string, string>> = {
  seed: '#7fb35a',
  crop: '#e0a02e',
  forage: '#4f9a5a',
  product: '#f4efe2',
  feed: '#c49a52',
  fertilizer: '#8a6a3c',
  animal: '#a47a52',
  machine: '#8c97a3',
  building: '#b98050',
  food: '#e8793a',
  fish: '#4f90c4',
};

const TOOL_GLYPH: Readonly<Record<string, Glyph>> = {
  hoe: 'hoe',
  can: 'can',
  axe: 'axe',
  pick: 'pick',
  shovel: 'shovel',
  rod: 'rod',
};

/** Ore and bar tints by the ore's family (the id's first word: dull, ember, lumen). */
const FAMILY_TINT: Readonly<Record<string, string>> = {
  dull: '#8a94a0',
  ember: '#ff8a4c',
  lumen: '#8fe3ff',
};

const FALLBACK: ItemGlyph = { glyph: 'sack', tint: '#9aa0a6' };

/** The glyph of a material by its id: stone, wood, fibre, ore and bar (an ore is a gem, a bar an ingot). */
function materialGlyph(id: string): ItemGlyph {
  const family = id.split('_')[0] ?? '';
  const tint = FAMILY_TINT[family] ?? '#9aa0a6';
  if (id.endsWith('_ore')) return { glyph: 'gem', tint };
  if (id.endsWith('_bar')) return { glyph: 'ingot', tint };
  if (id.endsWith('wood')) return { glyph: 'log', tint: '#b07a45' };
  if (id === 'fiber') return { glyph: 'fiber', tint: '#c9b26b' };
  if (id === 'stone') return { glyph: 'stone', tint: '#a3a9b0' };
  return FALLBACK;
}

/**
 * The glyph of an item (a stack key, with its quality suffix, is read as its base item). A tool
 * takes its tier colour from `tierOverlay`; an item of an unknown kind gets the plain sack.
 */
export function glyphOf(stackKey: string, data: GameData = loadGameData()): ItemGlyph {
  const id = baseItemOf(stackKey);
  const item = data.itemsById.get(id);
  if (!item) return FALLBACK;
  if (item.kind === 'tool') {
    const tool = toolOf(data, id);
    const tint = tool ? tierOverlay(tool.tier).color : '#d9a46a';
    return { glyph: TOOL_GLYPH[tool?.tool ?? ''] ?? 'hoe', tint };
  }
  if (item.kind === 'material') return materialGlyph(id);
  const glyph = KIND_GLYPH[item.kind];
  if (!glyph) return FALLBACK;
  return { glyph, tint: KIND_TINT[item.kind] ?? FALLBACK.tint };
}
