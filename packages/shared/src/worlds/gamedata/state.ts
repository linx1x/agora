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
  /** Days per stage after the fertilizer's speed bonus was taken off at planting (crops.json has the full list). */
  readonly stages: readonly number[];
  /** Fertilizer item the crop was planted with, kept until the crop is cleared (its quality and retention apply). */
  readonly fertilizer: string | null;
}

export interface PlotState {
  readonly tilled: boolean;
  /**
   * The day whose 06:00 growth step reads this water (clock.ts `simulateDays`: growth on day N needs
   * `wateredOn === N`). A player watering on day D sets D + 1, so the water counts for the night D to
   * D + 1; a sprinkler run at the rollover into day N sets N + 1. 0 means never.
   */
  readonly wateredOn: number;
  readonly crop: CropState | null;
  /** Sprinkler item id on this cell (an item with a sprinkler effect), or null. */
  readonly sprinkler: string | null;
  /** Fertilizer item spread on the empty plot; it moves to the crop when one is planted. */
  readonly fertilizer: string | null;
}

export interface AnimalState {
  /** Unique id of this animal in the world. */
  readonly id: string;
  /** Animal id in animals.json. */
  readonly animal: string;
  /** The housing cell ("x,y") it lives in: a coop or a barn (P17.25). */
  readonly cell: string;
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
  /** Machine block id (blocks.json, a machine block). */
  readonly machine: string;
  /** Item the machine will hold when done. */
  readonly output: string;
  /** How many of the output it holds (the recipe's quantity). */
  readonly qty: number;
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
  /** Chests by cell key ("x,y"): stack key to quantity. Owner-only contents, so never in a chunk delta (P17.24). */
  readonly chests?: Readonly<Record<string, Readonly<Record<string, number>>>>;
  /** The shipping bin's stacks (stack key to quantity), sold at the next day change (P17.26). Owner-only, like chests. */
  readonly shipping?: Readonly<Record<string, number>>;
}

/** Our rule: an animal stops producing when this many products wait. */
export const MAX_PENDING_PRODUCT = 9;

export const cellKey = (x: number, y: number): string => `${x},${y}`;

/** A world with no farm yet, at `day`. */
export const emptySim = (day: number): WorldSimState => ({ day, plots: {}, animals: [], machines: [] });
