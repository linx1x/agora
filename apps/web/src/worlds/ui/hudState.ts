/**
 * What the world HUD shows (ADR-053, P17.20): the account's items, money and energy as the server
 * last said them, and the item in hand. The server owns every number; this module only keeps the
 * last `world:inv` and the player's hand choice. Pure reducer plus a small store that React reads.
 */
import type { CellRef, S2CMsg, WorldRefusal, WorldTime } from '@agora/shared';

/** Hotbar slots, selected with keys 1 to 9. */
export const HOTBAR_SLOTS = 9;

export interface HudState {
  /** stack key to quantity, as the server sent it */
  readonly items: Readonly<Record<string, number>>;
  readonly money: number;
  readonly energy: number;
  readonly maxEnergy: number;
  /** the item in hand, or null; cleared when the server no longer has it */
  readonly inHand: string | null;
  /** why the last action was refused, until the next action is approved; announced to screen readers */
  readonly notice: WorldRefusal | null;
  /** the game clock as the server last sent it (every 10 game minutes); null until the first `world:time` */
  readonly time: WorldTime | null;
  /** the chest I opened (P17.24): its cell and contents as the server last sent them; null when closed */
  readonly chest: ChestView | null;
}

/** A chest the person has opened: where it is and what it holds (stack key to quantity). */
export interface ChestView {
  readonly at: CellRef;
  readonly items: Readonly<Record<string, number>>;
}

export const initialHud = (): HudState => ({ items: {}, money: 0, energy: 0, maxEnergy: 0, inHand: null, notice: null, time: null, chest: null });

/** The stacks in the hotbar: the first nine, in the order the server listed them. */
export function hotbarItems(items: Readonly<Record<string, number>>): string[] {
  return Object.keys(items).slice(0, HOTBAR_SLOTS);
}

/** The hotbar index (0 to 8) of a digit key, or null for any other key. */
export function slotForKey(key: string): number | null {
  if (!/^[1-9]$/.test(key)) return null;
  return Number(key) - 1;
}

/** Applies one server message to the HUD: the clock (`world:time`), the account (`world:inv`) and notices. */
export function reduceHud(state: HudState, msg: S2CMsg): HudState {
  if (msg.t === 'world:refused') return { ...state, notice: msg.reason };
  if (msg.t === 'world:acted') return state.notice === null ? state : { ...state, notice: null };
  if (msg.t === 'world:time') return { ...state, time: msg.time };
  if (msg.t === 'world:chest') return { ...state, chest: { at: { x: msg.at.x, y: msg.at.y }, items: { ...msg.items } } };
  if (msg.t !== 'world:inv') return state;
  const inHand = state.inHand !== null && (msg.items[state.inHand] ?? 0) > 0 ? state.inHand : null;
  return { ...state, items: { ...msg.items }, money: msg.money, energy: msg.energy, maxEnergy: msg.maxEnergy, inHand };
}

export interface HudStore {
  get(): HudState;
  subscribe(listener: () => void): () => void;
  /** Feed a server message. Returns true when it changed the HUD (the clock, an inventory, money, energy or notice). */
  dispatch(msg: S2CMsg): boolean;
  /** Put an item in hand (null empties the hand). Only items the player holds can be picked. */
  pick(item: string | null): void;
  /** Closes the chest panel (the server keeps the chest as it is). */
  closeChest(): void;
}

export function createHudStore(): HudStore {
  let state = initialHud();
  const listeners = new Set<() => void>();
  const emit = () => listeners.forEach((listener) => listener());
  return {
    get: () => state,
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    dispatch(msg) {
      const next = reduceHud(state, msg);
      if (next === state) return false;
      state = next;
      emit();
      return true;
    },
    pick(item) {
      if (item !== null && (state.items[item] ?? 0) <= 0) return;
      if (item === state.inHand) return;
      state = { ...state, inHand: item };
      emit();
    },
    closeChest() {
      if (state.chest === null) return;
      state = { ...state, chest: null };
      emit();
    },
  };
}

/** The app's HUD store: the world screen feeds it with `applyWorldHudMessage` for every world message. */
export const worldHud = createHudStore();

/** Feeds one server message to the app's HUD. Call it from the world client's message handler. */
export function applyWorldHudMessage(msg: S2CMsg): boolean {
  return worldHud.dispatch(msg);
}
