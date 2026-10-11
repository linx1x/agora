/**
 * What a click, Space or a key asks of the server with the item in hand (P17.21c, ADR-054). View-
 * neutral: the 2.5D world view calls it, and so does the flat scene until that view is removed. The
 * functions take what they need (my feet and facing, the cell, the terrain, the action queue, the
 * panels, a toast) and return whether the input was handled, so a click that acts does not also
 * walk. The server decides every result; this module only picks the request. Pure: the app's stores
 * are read in `useLive.ts`.
 */
import {
  baseItemOf,
  inReach,
  toolOf,
  type CellRef,
  type Dir,
  type GameData,
  type WorldCell,
} from '@agora/shared';
import { actionFor, factsOf, faceCell, NO_FACTS, type ActItem } from './inputActs';
import type { PanelView } from './ui/hudState';

/** What the input needs from the world around it. */
export interface UseEnv {
  /** the world I am in; null outside one, where nothing is asked */
  readonly world: string | null;
  /** the item in hand (its stack key), or null for an empty hand */
  readonly hand: string | null;
  readonly data: GameData;
  /** the terrain cell at (cx, cy) (its decor is what the facts read), or undefined off the map */
  readonly cellAt: (cx: number, cy: number) => Pick<WorldCell, 'decor'> | undefined;
  /** asks the server for an action in `world` (the action queue sends it and resends it) */
  readonly submit: (world: string, act: ActItem) => void;
  /** opens the shop board or a station's recipes; a panel, not a server action */
  readonly openPanel: (panel: PanelView) => void;
  /** my own tool swing on `at`, at the tool's tier and playback speed */
  readonly swing: (at: CellRef, tier: number, speed: number) => void;
  /** a short status line, given as its i18n key */
  readonly toast: (key: string) => void;
}

/** Where I stand: the feet in world pixels, and the way I face. */
export interface Feet {
  readonly x: number;
  readonly y: number;
  readonly d: Dir;
}

/** The state of the keyboard: a key that is busy with something else does nothing. */
export interface KeyContext {
  /** a text field has the focus */
  readonly typing: boolean;
  /** Ctrl, Meta or Alt is held */
  readonly modifier: boolean;
  /** a dialog of the app is open */
  readonly dialog: boolean;
  /** the chest panel is open */
  readonly chest: boolean;
  /** the shop or crafting panel is open */
  readonly panel: boolean;
}

/** True when a world key (X, Space, a hotbar digit) must do nothing right now. */
export function keysBusy(k: KeyContext): boolean {
  return k.typing || k.modifier || k.dialog || k.chest || k.panel;
}

/**
 * The item in hand acts on a cell: an empty hand on a shop board or a station opens its panel
 * (nothing is asked of the server), otherwise the held item's action is asked, and a tool swings.
 * True when the input was handled (the action was asked, or the panel opened), false when the
 * item does nothing on that cell.
 */
export function useOn(env: UseEnv, at: CellRef, shift = false): boolean {
  if (env.world === null) return false;
  const cell = env.cellAt(at.x, at.y);
  const facts = cell ? factsOf(cell, env.data) : NO_FACTS;
  if (env.hand === null && cell && (facts.shop || facts.station)) {
    const panelAt = { x: at.x, y: at.y };
    env.openPanel(
      facts.shop ? { kind: 'shop', at: panelAt } : { kind: 'craft', at: panelAt, block: cell.decor },
    );
    return true;
  }
  const kind = actionFor(env.hand, env.data, facts, shift);
  if (kind === null) return false;
  env.submit(env.world, {
    kind,
    at: { x: at.x, y: at.y },
    ...(env.hand !== null ? { item: env.hand } : {}),
  });
  const tool = env.hand === null ? undefined : toolOf(env.data, baseItemOf(env.hand));
  if (tool) env.swing({ x: at.x, y: at.y }, tool.tier, tool.speed);
  return true;
}

/**
 * Space: the item in hand acts on the cell in front of my feet. With nothing to do there the status
 * line says so, and the result is false.
 */
export function useFaced(env: UseEnv, me: Feet, shift = false): boolean {
  const done = useOn(env, faceCell(me.x, me.y, me.d), shift);
  if (!done) env.toast('worlds.hud.nothingToDo');
  return done;
}

/**
 * A click on a cell: the item in hand acts on it when it is within reach of my feet. Otherwise (or
 * when the item does nothing there) the click is a walk, and this returns false.
 */
export function useAt(env: UseEnv, me: Feet, at: CellRef, shift = false): boolean {
  return inReach(me.x, me.y, at) && useOn(env, at, shift);
}
