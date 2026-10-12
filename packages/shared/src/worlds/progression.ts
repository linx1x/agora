/**
 * Progression (ADR-053, P17.31): five skills, the xp each action earns, the level an xp total has
 * reached, the unlock that a level opens (tools of tier 2 and 3) and the badge a person shows. Every
 * number is data (progression.json). Pure: the server decides with it inside the action transaction
 * (`progressionStep`, called from apps/server/src/worlds/actions.ts); the client never does.
 *
 * Shared activities: xp and unlocks belong to the person who did the action. A visitor's action in
 * someone else's world counts for the visitor. The owner's skills, grants and settings are never an
 * input here, so they cannot open an unlock for anyone else.
 */
import { loadGameData } from './gamedata/load';
import type { GameData } from './gamedata/load';
import type { Progression, Skill, Unlock, XpGrant } from './gamedata/schema';
import { skillLevelOf } from './actions/tools';
import type { ActionChanges, ActionKind, ActionRequest } from './actions/kinds';

/** The xp sources of progression.json: each one is granted by one kind of action. */
export type XpSource = keyof Progression['xp'];

/** The actions that earn xp, and the source each one earns. Every other action earns none. */
export const XP_SOURCE_OF: Readonly<Partial<Record<ActionKind, XpSource>>> = {
  harvest: 'harvest',
  chop: 'chop',
  mine: 'mine',
};

/** The grant a source earns: its skill and its amount, from the table. */
export function xpFor(source: XpSource, progression: Progression): XpGrant {
  return progression.xp[source];
}

/** The level (0 to SKILL_LEVEL_MAX) an xp total has reached. One curve, `levelXp`, for every skill. */
export function levelOfXp(
  xp: number,
  levelXp: readonly number[] = loadGameData().progression.levelXp,
): number {
  return skillLevelOf(xp, levelXp);
}

/** The unlock of an item, if a level opens it. Starter tools and everything else have none. */
export function unlockOf(progression: Progression, item: string): Unlock | undefined {
  return progression.unlocks.find((unlock) => unlock.item === item);
}

/** Whether the person's own xp has reached the level an unlock needs. */
export function isUnlocked(
  skills: Readonly<Record<string, number>>,
  unlock: Unlock,
  progression: Progression,
): boolean {
  return levelOfXp(skills[unlock.skill] ?? 0, progression.levelXp) >= unlock.level;
}

export type ProgressionStep =
  | { readonly ok: true; readonly changes: ActionChanges }
  | { readonly ok: false; readonly reason: 'locked' };

/**
 * The one progression hook, run after the rule and before anything is written. It refuses a held
 * item whose unlock the person has not earned (`locked`). It sets the xp the action earns from the
 * table: the figure a rule wrote is replaced, and an action that earned no xp keeps none, so a rule
 * cannot pay itself xp. Every other change of the plan passes through untouched.
 */
export function progressionStep(
  data: Pick<GameData, 'progression'>,
  req: ActionRequest,
  skills: Readonly<Record<string, number>>,
  changes: ActionChanges,
): ProgressionStep {
  const { progression } = data;
  const unlock = req.item ? unlockOf(progression, req.item) : undefined;
  if (unlock && !isUnlocked(skills, unlock, progression)) return { ok: false, reason: 'locked' };
  const source = XP_SOURCE_OF[req.kind];
  const grant =
    source !== undefined && Object.keys(changes.xp).length > 0
      ? xpFor(source, progression)
      : undefined;
  return { ok: true, changes: { ...changes, xp: grant ? { [grant.skill]: grant.amount } : {} } };
}

/** What a person shows on the card: the skill they chose, at the level they have earned in it. */
export interface Badge {
  readonly skill: Skill;
  readonly level: number;
}

/**
 * The badge for the skill a person chose (none when nothing is chosen). Its level is the one the
 * person's own xp gives, so a level that is not earned never shows, and none shows before level 1.
 */
export function badgeFrom(
  skills: Readonly<Record<string, number>>,
  shown: Skill | null | undefined,
  progression: Progression,
): Badge | undefined {
  if (!shown) return undefined;
  const level = levelOfXp(skills[shown] ?? 0, progression.levelXp);
  return level > 0 ? { skill: shown, level } : undefined;
}
