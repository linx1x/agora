/** The owner's visitor panel, pure parts (P17.27): tested without a browser. */
import { CHOICE_KINDS, VISITOR_RULES, type ActionKind } from '@agora/shared';

/** A set of choice kinds with one turned on or off, in the stable order. */
export function toggled(kinds: readonly ActionKind[], kind: ActionKind, on: boolean): ActionKind[] {
  const want = new Set(kinds);
  if (on) want.add(kind);
  else want.delete(kind);
  return CHOICE_KINDS.filter((k) => want.has(k));
}

/** What a visitor is told they may do: the kinds worth naming (eating is everyone's, so left out). */
export function permsToShow(kinds: readonly ActionKind[]): ActionKind[] {
  return kinds.filter((k) => k !== 'eat' && VISITOR_RULES[k] !== 'deny');
}
