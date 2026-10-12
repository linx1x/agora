/** Review-only mapping onto existing IDs. No game data, collision or item changes. */
export interface ReviewProp {
  id: string;
  label: string;
  source: 'world' | 'office';
  /** Measured source rectangle, not an assumed AI-generated grid. */
  rect: readonly [number, number, number, number];
}

export const PROPS: readonly ReviewProp[] = [
  { id: 'oak_tree', label: 'Oak tree', source: 'world', rect: [0, 0, 355, 382] },
  { id: 'spruce', label: 'Spruce', source: 'world', rect: [358, 0, 277, 382] },
  { id: 'palm', label: 'Palm', source: 'world', rect: [638, 0, 317, 383] },
  { id: 'jungle_tree', label: 'Jungle tree', source: 'world', rect: [956, 0, 298, 384] },
  { id: 'boulder', label: 'Boulder', source: 'world', rect: [0, 395, 330, 259] },
  { id: 'flower', label: 'Wildflowers', source: 'world', rect: [330, 390, 310, 272] },
  { id: 'fern', label: 'Fern', source: 'world', rect: [640, 383, 320, 261] },
  { id: 'cactus', label: 'Cactus', source: 'world', rect: [970, 383, 284, 282] },
  { id: 'chest', label: 'Chest', source: 'world', rect: [0, 681, 319, 245] },
  { id: 'workbench', label: 'Workbench', source: 'world', rect: [321, 673, 335, 249] },
  { id: 'torch', label: 'Torch', source: 'world', rect: [714, 644, 192, 288] },
  { id: 'fence', label: 'Fence', source: 'world', rect: [958, 691, 296, 235] },
  { id: 'hub.deskMonitor', label: 'Office desk', source: 'office', rect: [0, 935, 332, 307] },
  { id: 'chairDown', label: 'Office chair', source: 'office', rect: [363, 931, 256, 312] },
  { id: 'bed', label: 'Bed', source: 'world', rect: [636, 931, 329, 314] },
  { id: 'shipping_bin', label: 'Shipping bin', source: 'world', rect: [966, 944, 288, 300] },
];

export const ICONS = [
  { id: 'axe_1', label: 'Axe' },
  { id: 'pick_1', label: 'Pickaxe' },
  { id: 'can_1', label: 'Watering can' },
  { id: 'hoe_1', label: 'Hoe' },
  { id: 'dawn_radish_seed', label: 'Radish seeds' },
  { id: 'dawn_radish', label: 'Dawn radish' },
  { id: 'ui:coins', label: 'Coins' },
  { id: 'ui:bag', label: 'Backpack' },
] as const;

export interface Placement {
  id: string;
  x: number;
  z: number;
  growth?: number;
}
export const PLACEMENTS: readonly Placement[] = [
  { id: 'oak_tree', x: 1, z: 1 },
  { id: 'spruce', x: 4, z: 0 },
  { id: 'oak_tree', x: 7, z: 0 },
  { id: 'jungle_tree', x: 11, z: 1 },
  { id: 'palm', x: 12, z: 5 },
  { id: 'cactus', x: 12, z: 7 },
  { id: 'hub.deskMonitor', x: 3, z: 3 },
  { id: 'chairDown', x: 3, z: 4 },
  { id: 'workbench', x: 4, z: 5 },
  { id: 'chest', x: 4, z: 7 },
  { id: 'bed', x: 1, z: 4 },
  { id: 'shipping_bin', x: 4, z: 8 },
  { id: 'torch', x: 5, z: 5 },
  { id: 'torch', x: 7, z: 8 },
  { id: 'boulder', x: 11, z: 4 },
  { id: 'boulder', x: 0, z: 7 },
  { id: 'fern', x: 0, z: 3 },
  { id: 'fern', x: 7, z: 2 },
  { id: 'flower', x: 5, z: 2 },
  { id: 'flower', x: 11, z: 8 },
  { id: 'flower', x: 0, z: 9 },
  { id: 'flower', x: 8, z: 9 },
  { id: 'fence', x: 1, z: 9 },
  { id: 'fence', x: 2, z: 9 },
  { id: 'fence', x: 3, z: 9 },
  { id: 'oak_tree', x: 7, z: 3, growth: 0 },
  { id: 'oak_tree', x: 7, z: 4, growth: 1 },
  { id: 'oak_tree', x: 8, z: 5, growth: 2 },
];

export const WIDTH = 14;
export const DEPTH = 11;
/** The exact same cells are rendered in both comparison modes. */
export function groundAt(x: number, z: number): string {
  if (x >= 9 && x <= 12 && z >= 2 && z <= 4 && !(x === 9 && z === 2) && !(x === 12 && z === 4))
    return 'water';
  if (x >= 8 && x <= 12 && z >= 1 && z <= 5) return 'sand';
  if (x >= 1 && x <= 4 && z >= 3 && z <= 5) return 'wood_floor';
  if (x >= 1 && x <= 3 && z >= 7 && z <= 8) return 'tilled_soil';
  if ((x >= 5 && x <= 6) || z === 6) return 'meadow_dirt';
  return 'meadow_grass';
}
