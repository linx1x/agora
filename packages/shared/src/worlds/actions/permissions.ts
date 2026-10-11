/**
 * Who may do what in a personal world (ADR-053, "Visitors"). The owner may do everything. A visitor
 * follows the default for each kind: `allow` kinds are always open, `choice` kinds are open only when
 * the owner granted them in the world settings, `deny` kinds never are.
 */
import { ACTION_KINDS, type ActionKind } from './kinds';

export type VisitorRule = 'allow' | 'choice' | 'deny';

/** The defaults from ADR-053. Changing one is a product decision, recorded in an ADR addendum. */
export const VISITOR_RULES: Readonly<Record<ActionKind, VisitorRule>> = {
  water: 'allow',
  eat: 'allow',
  harvest: 'choice',
  till: 'deny',
  plant: 'deny',
  fertilize: 'deny',
  place: 'deny',
  chop: 'deny',
  mine: 'deny',
  sleep: 'deny',
  raise: 'deny',
  lower: 'deny',
  remove: 'deny',
  open: 'choice',
  stash: 'choice',
  take: 'choice',
  // the farm, the shop and the bench are the owner's (P17.25)
  buy: 'deny',
  ship: 'deny',
  feed: 'deny',
  collect: 'deny',
  craft: 'deny',
};

export interface WorldAccess {
  readonly ownerId: string;
  readonly settings: Readonly<Record<string, unknown>>;
}

/** The kinds the owner granted to visitors, from `settings.grants` (unknown entries are ignored). */
export function grantsOf(settings: Readonly<Record<string, unknown>>): ActionKind[] {
  const raw = settings.grants;
  if (!Array.isArray(raw)) return [];
  const known = new Set<string>(ACTION_KINDS);
  return raw.filter((kind): kind is ActionKind => typeof kind === 'string' && known.has(kind));
}

/** Whether `actorId` may ask for `kind` in this world. The owner override comes first. */
export function canDo(world: WorldAccess, actorId: string, kind: ActionKind): boolean {
  if (actorId === world.ownerId) return true;
  const rule = VISITOR_RULES[kind];
  if (rule === 'allow') return true;
  if (rule === 'deny') return false;
  return grantsOf(world.settings).includes(kind);
}
