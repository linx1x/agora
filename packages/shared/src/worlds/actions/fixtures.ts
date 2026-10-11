/**
 * Test fixtures for the action rules: a read-only view of a world built from plain options. Not
 * exported from the barrel; the rule tests import it directly.
 */
import type { WorldCell } from '../cells';
import type { GameData } from '../gamedata/load';
import { cellKey, emptySim, type PlotState, type WorldSimState } from '../gamedata/state';
import { createRng } from '../noise';
import type { ActionEnv, ActionView } from './plan';

export interface ViewOptions {
  readonly day?: number;
  readonly energy?: number;
  /** the clock hour and minute; 06:00 when not given */
  readonly time?: { readonly hour: number; readonly minute: number };
  /** total xp per skill */
  readonly skills?: Readonly<Record<string, number>>;
  /** stack key to quantity */
  readonly items?: Readonly<Record<string, number>>;
  readonly money?: number;
  readonly plots?: Readonly<Record<string, PlotState>>;
  /** overrides per cell, keyed "x,y"; every other cell is dry meadow ground with nothing on it */
  readonly cells?: Readonly<Record<string, Partial<WorldCell>>>;
}

const GROUND: WorldCell = { level: 0, block: 'meadow_grass', decor: '', solid: false, liquid: false, ramp: false, walkable: true };

/** A decor cell as the terrain reports it: a tree, a boulder or a wall (solid, not walkable). */
export const DECOR: Partial<WorldCell> = { solid: true, walkable: false };

export function viewOf(o: ViewOptions = {}): ActionView {
  const day = o.day ?? 3;
  const cells = o.cells ?? {};
  const sim: WorldSimState = { ...emptySim(day), plots: { ...(o.plots ?? {}) } };
  return {
    day,
    actor: { x: 0, y: 0 },
    inventory: { items: { ...(o.items ?? {}) }, money: o.money ?? 0 },
    energy: o.energy ?? 270,
    time: o.time ?? { hour: 6, minute: 0 },
    skills: { ...(o.skills ?? {}) },
    sim,
    cell: (x, y) => ({ ...GROUND, ...(cells[cellKey(x, y)] ?? {}) }),
  };
}

export function envOf(data: GameData, seed = 7): ActionEnv {
  return { data, rng: createRng(seed) };
}
