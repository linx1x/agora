/**
 * World actions (ADR-053, P17.20): the closed vocabulary a player can ask the server for, the
 * reasons it can say no, and the change record that the reply and the ledger both carry. The
 * client asks; the server decides (`apps/server/src/worlds/actions.ts`). Rules live next to this
 * file, one per kind, and are pure.
 */

/** What the player asks for. Permission is decided per kind (permissions.ts). */
export const ACTION_KINDS = [
  'till',
  'water',
  'plant',
  'harvest',
  'fertilize',
  'place',
  'chop',
  'mine',
  'eat',
  'sleep',
  'raise',
  'lower',
  'remove',
  'open',
  'stash',
  'take',
] as const;
export type ActionKind = (typeof ACTION_KINDS)[number];

/**
 * Why an action did nothing. A closed union: every reason has an i18n key `worlds.refused.<reason>`.
 * `conflict` means the world changed under the request and nothing was written; the client may retry.
 */
export const WORLD_REFUSALS = [
  'disabled',
  'rate',
  'forbidden',
  'far',
  'invalid',
  'tool',
  'tier',
  'energy',
  'gone',
  'missing',
  'full',
  'cap',
  'key_taken',
  'conflict',
  'asleep',
  'occupied',
  'trap',
] as const;
export type WorldRefusal = (typeof WORLD_REFUSALS)[number];

/**
 * What one accepted action changed for the actor. Item deltas are keyed by stack key (the item id
 * for now). Signed. Zero entries are left out. The same record is stored in the ledger, so the
 * reply to a resend is exactly what the first attempt said.
 */
export interface ActionChanges {
  readonly items: Readonly<Record<string, number>>;
  readonly money: number;
  readonly energy: number;
  /** skill id to xp gained */
  readonly xp: Readonly<Record<string, number>>;
}

export const noChanges = (): ActionChanges => ({ items: {}, money: 0, energy: 0, xp: {} });

/** True when nothing changed. */
export function changesAreEmpty(c: ActionChanges): boolean {
  return c.money === 0 && c.energy === 0 && Object.keys(c.items).length === 0 && Object.keys(c.xp).length === 0;
}

/** A player's request, as the rules see it (the protocol adds `op` and `key`). */
export interface ActionRequest {
  readonly kind: ActionKind;
  /** The cell the action is aimed at (world cells, not pixels). */
  readonly at?: { readonly x: number; readonly y: number };
  /** The item in the player's hand: a tool, a seed, food, a building. */
  readonly item?: string;
  /** Reserved for actions aimed at an object (an animal, a machine). */
  readonly target?: string;
}
