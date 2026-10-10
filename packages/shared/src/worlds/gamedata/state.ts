/**
 * Simulation state of one personal world (ADR-053, P17.19). Plain JSON data:
 * no Maps and no class instances, so it can be stored as the world's delta and
 * sent to clients. Days are absolute, 1-based; 0 means "never".
 */

export interface CropState {
  /** Crop id in crops.json. */
  readonly crop: string;
  /** Index into the crop's stages. */
  readonly stage: number;
  /** Days completed in the current stage. */
  readonly daysInStage: number;
  readonly ripe: boolean;
  /** Watered days still needed after a harvest before the crop is ripe again; null when not regrowing. */
  readonly regrowLeft: number | null;
}

export interface PlotState {
  readonly tilled: boolean;
  /** Day the plot was last watered: by the player that day, or by a sprinkler the night before. */
  readonly wateredOn: number;
  readonly crop: CropState | null;
  /** Sprinkler item id on this cell (an item with a sprinkler effect), or null. */
  readonly sprinkler: string | null;
}

export interface AnimalState {
  /** Unique id of this animal in the world. */
  readonly id: string;
  /** Animal id in animals.json. */
  readonly animal: string;
  /** Day the animal was last fed. */
  readonly fedOn: number;
  /** Fed days toward the next product. */
  readonly progress: number;
  /** Products waiting to be collected (capped at MAX_PENDING_PRODUCT). */
  readonly pending: number;
}

export interface MachineState {
  readonly id: string;
  /** Cell key of the machine. */
  readonly cell: string;
  /** Machine item id (kind machine). */
  readonly machine: string;
  /** Item the machine will hold when done. */
  readonly output: string;
  /** Days left until the output is ready; 0 means ready. */
  readonly daysLeft: number;
}

export interface WorldSimState {
  /** Last simulated day. */
  readonly day: number;
  /** Plots by cell key ("x,y"). */
  readonly plots: Readonly<Record<string, PlotState>>;
  readonly animals: readonly AnimalState[];
  readonly machines: readonly MachineState[];
}

/** Our rule: an animal stops producing when this many products wait. */
export const MAX_PENDING_PRODUCT = 9;

export const cellKey = (x: number, y: number): string => `${x},${y}`;
