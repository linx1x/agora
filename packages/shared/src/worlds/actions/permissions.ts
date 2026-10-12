/**
 * Who may do what in a personal world (ADR-053, "Visitors"). The owner may do everything. A visitor
 * follows the default for each kind: `allow` kinds are always open, `choice` kinds are open only when
 * the owner granted them in the world settings, `deny` kinds never are.
 */
import { ACTION_KINDS, type ActionKind } from './kinds';
import { VISITOR_RULES } from './rules';
import { grantsFor } from './visitors';
import { isContractKind } from '../contracts';

export { VISITOR_RULES, type VisitorRule } from './rules';

export interface WorldAccess {
  readonly ownerId: string;
  readonly settings: Readonly<Record<string, unknown>>;
  /** P17.28: kinds the world's open contracts open to visitors (contract kinds only) */
  readonly opened?: readonly ActionKind[];
}

/** The kinds the owner granted to visitors, from `settings.grants` (unknown entries are ignored). */
export function grantsOf(settings: Readonly<Record<string, unknown>>): ActionKind[] {
  const raw = settings.grants;
  if (!Array.isArray(raw)) return [];
  const known = new Set<string>(ACTION_KINDS);
  return raw.filter((kind): kind is ActionKind => typeof kind === 'string' && known.has(kind));
}

/**
 * Whether `actorId` may ask for `kind` in this world. The owner override comes first; a choice kind
 * follows the visitor's own grants when the owner set them, else the world default (P17.27).
 */
export function canDo(world: WorldAccess, actorId: string, kind: ActionKind): boolean {
  if (actorId === world.ownerId) return true;
  // an open contract is the owner's say-so for its task, and only for a contract kind
  if (world.opened?.includes(kind) && isContractKind(kind)) return true;
  const rule = VISITOR_RULES[kind];
  if (rule === 'allow') return true;
  if (rule === 'deny') return false;
  return grantsFor(world.settings, actorId).includes(kind);
}
