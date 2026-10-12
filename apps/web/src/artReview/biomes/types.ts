export type BiomeId = 'meadow' | 'jungle' | 'desert' | 'taiga';
export interface BiomeProp {
  id: string;
  label: string;
  rect: number[];
  width: number;
  height: number;
}
export interface BiomeAnimal {
  id: string;
  label: string;
  kind: string;
  rects: number[][];
  width: number;
  height: number;
  behavior: string;
}
export interface BiomeDefinition {
  id: string;
  label: string;
  description: string;
  colors: {
    grass: string;
    dirt: string;
    stone: string;
    water: string;
    edge: string;
    accent: string;
  };
  propsImage: string;
  animalsImage: string;
  props: BiomeProp[];
  animals: BiomeAnimal[];
}
export interface BiomeArt {
  definition: BiomeDefinition;
  props: HTMLCanvasElement[];
  animals: HTMLCanvasElement[][];
}
