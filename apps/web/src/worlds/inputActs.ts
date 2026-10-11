/**
 * What a click or Space asks the server for in a personal world (P17.21b, ADR-053). Pure: the
 * client picks the action from the item in hand and the cell; the server decides everything else.
 * `ActQueue` keeps one idempotency key per intent until the server answers (`world:acted` or
 * `world:refused`), and sends it again after a reconnect, so a resend cannot repeat an effect.
 */
import {
  BLOCKS,
  WORLD_CELL_PX,
  baseItemOf,
  getBlock,
  itemOfBlock,
  toolOf,
  type ActionKind,
  type C2SMsg,
  type CellRef,
  type Dir,
  type GameData,
  type WorldCell,
} from '@agora/shared';

/** The cell in front of the feet (Space acts on it). `feetX`, `feetY` are world pixels. */
export function faceCell(feetX: number, feetY: number, dir: Dir): CellRef {
  const cx = Math.floor(feetX / WORLD_CELL_PX);
  const cy = Math.floor(feetY / WORLD_CELL_PX);
  switch (dir) {
    case 'up':
      return { x: cx, y: cy - 1 };
    case 'down':
      return { x: cx, y: cy + 1 };
    case 'left':
      return { x: cx - 1, y: cy };
    case 'right':
      return { x: cx + 1, y: cy };
  }
}

/** The action a tool performs, by the tool's kind. A rod does nothing yet (fishing is P17.34). */
const TOOL_ACTION: Readonly<Record<string, ActionKind>> = {
  hoe: 'till',
  can: 'water',
  axe: 'chop',
  pick: 'mine',
};

/** What the cell holds, as the client needs it to pick an action (the server checks it again). */
export interface CellFacts {
  /** a chest: opened by an empty hand, stashed into with an item */
  readonly container: boolean;
  /** a block a person placed (it has an item): a pick takes it back into the bag */
  readonly removable: boolean;
  /** a housing (coop, barn): an empty hand collects its products, an animal or feed goes in */
  readonly housing: boolean;
  /** a machine (furnace): an empty hand collects its finished batch */
  readonly machine: boolean;
  /** a crafting station (bench, stove, furnace): an empty hand opens its recipes (a panel, not a server action) */
  readonly station: boolean;
  /** the shop board: an empty hand opens the stock (a panel, not a server action) */
  readonly shop: boolean;
  /** the shipping bin: a held item is put in it to be sold at the day change (P17.26) */
  readonly shipping: boolean;
}

export const NO_FACTS: CellFacts = {
  container: false,
  removable: false,
  housing: false,
  machine: false,
  station: false,
  shop: false,
  shipping: false,
};

/** The facts of a terrain cell: its decor block, read from the block registry. */
export function factsOf(cell: Pick<WorldCell, 'decor'>, data: GameData): CellFacts {
  const block = cell.decor === '' ? undefined : getBlock(BLOCKS, cell.decor);
  if (!block) return NO_FACTS;
  return {
    container: block.container,
    removable: block.placeable && itemOfBlock(data, block.id) !== undefined,
    housing: block.housing !== undefined,
    machine: block.machine === true,
    station: block.station !== undefined,
    shop: block.shop === true,
    shipping: block.shipping === true,
  };
}

/**
 * The action the held item asks for on the cell: empty hand harvests, opens a chest, or collects a
 * housing's or a machine's output; a shovel raises the ground (Shift lowers it), a pick takes a
 * placed block back, a tool does its work, a seed is planted, fertilizer spread, a building, a
 * machine or an animal placed, feed given to a housing, food eaten, any item put in a chest is
 * stashed there, and any item put in a shipping bin is shipped (the server refuses what is not produce).
 * `null` when the item does nothing on the cell (a rod, a material, feed on the ground), and for an
 * empty hand on a station, a shop board or a shipping bin (the scene opens a panel, or nothing happens).
 */
export function actionFor(item: string | null, data: GameData, facts: CellFacts = NO_FACTS, shift = false): ActionKind | null {
  if (item === null) {
    if (facts.container) return 'open';
    if (facts.housing || facts.machine) return 'collect';
    if (facts.station || facts.shop || facts.shipping) return null;
    return 'harvest';
  }
  if (facts.container) return 'stash';
  if (facts.shipping) return 'ship';
  const id = baseItemOf(item);
  const tool = toolOf(data, id);
  if (tool) {
    if (tool.tool === 'shovel') return shift ? 'lower' : 'raise';
    if (tool.tool === 'pick' && facts.removable) return 'remove';
    return TOOL_ACTION[tool.tool] ?? null;
  }
  switch (data.itemsById.get(id)?.kind) {
    case 'seed':
      return 'plant';
    case 'fertilizer':
      return 'fertilize';
    case 'building':
    case 'machine':
    case 'animal':
      return 'place';
    case 'feed':
      return facts.housing ? 'feed' : null;
    case 'food':
      return 'eat';
    default:
      return null;
  }
}

/** The request one intent sends (without its key and op). */
export interface ActItem {
  readonly kind: ActionKind;
  readonly at: CellRef;
  /** the held stack key, when the action needs an item (a tool, a seed, a building, an animal, feed) */
  readonly item?: string;
  /** the recipe of a craft, or the object an action names (the server checks it) */
  readonly target?: string;
}

/**
 * Asks the server for an action on a cell (the parent sends it through the action queue). The panels
 * (chest, shop, crafting) use it, and so does the scene for the held item.
 */
export type WorldAsk = (kind: ActionKind, at: CellRef, item?: string, target?: string) => void;

interface Pending {
  readonly key: string;
  readonly world: string;
  readonly act: ActItem;
  /** the op of the last message sent for this intent: the server echoes it in its answer */
  op: number;
}

export interface ActQueueDeps {
  readonly send: (m: C2SMsg) => void;
  /** a fresh idempotency key per intent (crypto.randomUUID in the app) */
  readonly newKey: () => string;
  /** the most intents kept unanswered at once; the oldest is dropped beyond it */
  readonly limit?: number;
}

export class ActQueue {
  private readonly pending = new Map<string, Pending>();
  private lastOp = 0;
  private readonly limit: number;

  constructor(private readonly deps: ActQueueDeps) {
    this.limit = deps.limit ?? 32;
  }

  /** Unanswered intents. */
  get size(): number {
    return this.pending.size;
  }

  /** Whether an intent with this key is still waiting for the server. */
  has(key: string): boolean {
    return this.pending.has(key);
  }

  /** A new intent in `world`: one key, sent now, kept until the server answers. Returns the key. */
  submit(world: string, act: ActItem): string {
    const key = this.deps.newKey();
    const entry: Pending = { key, world, act, op: 0 };
    this.pending.set(key, entry);
    while (this.pending.size > this.limit) this.pending.delete(this.pending.keys().next().value as string);
    this.transmit(entry);
    return key;
  }

  /** The server answered `op`: the intent it was about is done (approved or refused). */
  answer(op: number): void {
    for (const [key, entry] of this.pending) if (entry.op === op) this.pending.delete(key);
  }

  /**
   * The world was entered again (after a reconnect, or on arrival): every intent of `world` is sent
   * again with its own key, and the intents of other worlds are dropped (they cannot apply here).
   */
  resend(world: string): void {
    for (const [key, entry] of this.pending) if (entry.world !== world) this.pending.delete(key);
    for (const entry of this.pending.values()) this.transmit(entry);
  }

  private transmit(entry: Pending): void {
    entry.op = ++this.lastOp;
    const { act } = entry;
    this.deps.send({
      t: 'world:act',
      op: entry.op,
      kind: act.kind,
      at: { x: act.at.x, y: act.at.y },
      ...(act.item !== undefined ? { item: act.item } : {}),
      ...(act.target !== undefined ? { target: act.target } : {}),
      key: entry.key,
    });
  }
}
