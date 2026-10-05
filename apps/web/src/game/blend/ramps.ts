/**
 * Colour ramps for blended tiles (ADR-037), darkest first. Values come from the biome master
 * palettes in `art-src/palettes.json` (sprites name colours; this is the same list as hex).
 */
import type { BlendMaterial, Biome } from '@agora/shared';

export type RGB = readonly [number, number, number];

const hex = (h: string): RGB => [
  parseInt(h.slice(1, 3), 16),
  parseInt(h.slice(3, 5), 16),
  parseInt(h.slice(5, 7), 16),
];
const ramp = (...h: string[]) => h.map(hex);

const WOOD: Record<Biome, RGB[]> = {
  hub: ramp('#3b2412', '#6a3f1d', '#9a5f2b', '#c78a42', '#e6b86a'),
  jungle: ramp('#3b2412', '#6a3f1d', '#9a5f2b', '#c78a42', '#e6b86a'),
  oasis: ramp('#7a5230', '#a97a44', '#cfa468', '#e8c88e', '#f6e2b2'),
  boreal: ramp('#2a170d', '#4a2a18', '#6e4026', '#98623a', '#bd8450'),
  zen: ramp('#4a2a18', '#7a4a2c', '#a97d58', '#d0a878', '#ecd2a8'),
};
const STONE: Record<Biome, RGB[]> = {
  hub: ramp('#2c332c', '#6f7466', '#9aa08a', '#e8d2ae'),
  jungle: ramp('#2c332c', '#4b5649', '#718068', '#9aab8c', '#bfa57c'),
  oasis: ramp('#8d6e48', '#b99a6b', '#d6bd92', '#ead9b6', '#f6e6c0'),
  boreal: ramp('#232b31', '#3e4a53', '#5f6d77', '#9aa9b3', '#c9d6de'),
  zen: ramp('#5d5a50', '#8a8576', '#b8b3a1', '#dcd8c8', '#e8e4d6'),
};

export interface MaterialLook {
  /** top face ramp and the level its plain surface sits at */
  top: RGB[];
  topLevel: number;
  /** front face ramp (a counter has stone on top, a wooden cabinet below) */
  front: RGB[];
  /** true: legs under a short apron; false: a solid plinth to the floor */
  legs: boolean;
  grain: 'planks' | 'stone';
  /** selective outline: the darkest wood, one step darker again, so edges read on plank floors */
  outline: RGB;
}

const darker = (c: RGB, f: number): RGB => [c[0] * f, c[1] * f, c[2] * f];

const looks = new Map<string, MaterialLook>();
/** One shared object per material and biome (the compositor compares them by identity). */
export function materialLook(mat: BlendMaterial, biome: Biome): MaterialLook {
  const k = `${mat}|${biome}`;
  let l = looks.get(k);
  if (!l) looks.set(k, (l = makeLook(mat, biome)));
  return l;
}

function makeLook(mat: BlendMaterial, biome: Biome): MaterialLook {
  const wood = WOOD[biome] ?? WOOD.hub;
  const outline = darker(wood[0]!, 0.62);
  if (mat === 'counter')
    return { top: STONE[biome], topLevel: 2.75, front: wood, legs: false, grain: 'stone', outline };
  return {
    top: wood,
    topLevel: mat === 'table' ? 3.1 : 3.35,
    front: wood,
    legs: true,
    grain: 'planks',
    outline,
  };
}

/** Rim where a green terrain meets dirt (jungle): lip shadow on the dirt, tips on the grass. */
export const RIM = {
  shadow: hex('#3a2716'),
  tipA: hex('#4a9a33'),
  tipB: hex('#44823a'),
};
