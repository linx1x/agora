/**
 * The location card of a personal world or cave (FIX-1, ADR-053): what the bottom-right card says
 * while a person is inside, and who can hear them there. Pure, so the wording is unit-tested; the
 * Hud translates the keys. The card never names a desk pod or an office zone (privacy promise).
 */
export type WorldPlace = 'world' | 'cave';

export interface WorldCardText {
  readonly titleKey: string;
  readonly titleVars?: { readonly owner: string };
  readonly hintKey: string;
}

/** The card for a place. An owner name that is not known yet gives the untitled wording. */
export function worldCardText(place: WorldPlace, owner: string): WorldCardText {
  const name = owner.trim();
  if (place === 'cave') {
    return name
      ? { titleKey: 'worlds.card.caveTitle', titleVars: { owner: name }, hintKey: 'worlds.card.caveHint' }
      : { titleKey: 'worlds.card.caveUntitled', hintKey: 'worlds.card.caveHint' };
  }
  return name
    ? { titleKey: 'worlds.card.title', titleVars: { owner: name }, hintKey: 'worlds.card.hint' }
    : { titleKey: 'worlds.card.untitled', hintKey: 'worlds.card.hint' };
}

/** A cave's world id is `cave:<worldId>:<n>` (P17.32); every other world id is a personal world. */
export function placeOfWorldId(worldId: string): WorldPlace {
  return worldId.startsWith('cave:') ? 'cave' : 'world';
}
