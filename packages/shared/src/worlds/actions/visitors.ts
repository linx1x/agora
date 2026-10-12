/**
 * The visitor matrix of a personal world (P17.27, ADR-053 "Visitors"): what the owner lets visitors
 * do, for everyone and per person, and who may come in while the owner is away. Stored in the
 * world's `settings`; the server is the only writer and every `world:act` reads it (`canDo`).
 *
 *   settings.grants   choice kinds open to every visitor (the world default)
 *   settings.visitors per person (by user id, server-side only): their name, their own grants
 *                     (replacing the default; absent = the default) and whether they are on the list
 *   settings.away     who may come in while the owner is away: nobody, or the people on the list
 *
 * `allow` kinds are always open and `deny` kinds never are: a grant only opens a `choice` kind.
 * User ids never leave the server: the owner's client sees each person by an opaque `ref`.
 */
import { ACTION_KINDS, type ActionKind } from './kinds';
import { VISITOR_RULES } from './rules';

/** Who may come in while the owner is away (not in the office and not in their world). */
export const AWAY_RULES = ['nobody', 'list'] as const;
export type AwayRule = (typeof AWAY_RULES)[number];

/** The kinds an owner may open to visitors, in a stable order (the owner's panel lists them so). */
export const CHOICE_KINDS: readonly ActionKind[] = ACTION_KINDS.filter((k) => VISITOR_RULES[k] === 'choice');
/** The kinds always open to visitors. */
export const ALLOWED_KINDS: readonly ActionKind[] = ACTION_KINDS.filter((k) => VISITOR_RULES[k] === 'allow');

/** At most this many people in a world's visitor list (names and grants live in the settings row). */
export const VISITOR_CAP = 50;
/** A person's name as kept in the list (the display name when they were added). */
export const VISITOR_NAME_MAX = 40;

export interface VisitorEntry {
  readonly name: string;
  /** this person's own grants (choice kinds), replacing the world default; absent = the default */
  readonly grants?: readonly ActionKind[];
  /** on the owner's list (the away rule `list` lets them in) */
  readonly listed?: boolean;
}

const CHOICE = new Set<string>(CHOICE_KINDS);

/** Only choice kinds, each once, in the order of `CHOICE_KINDS` (anything else is dropped). */
export function cleanGrants(raw: unknown): ActionKind[] {
  if (!Array.isArray(raw)) return [];
  const want = new Set(raw.filter((k): k is string => typeof k === 'string' && CHOICE.has(k)));
  return CHOICE_KINDS.filter((k) => want.has(k));
}

/** The away rule of a world (`nobody` unless the owner chose the list). */
export function awayOf(settings: Readonly<Record<string, unknown>>): AwayRule {
  return settings.away === 'list' ? 'list' : 'nobody';
}

/** The per-person entries of a world, keyed by user id; malformed entries are dropped. */
export function visitorsOf(settings: Readonly<Record<string, unknown>>): Record<string, VisitorEntry> {
  const raw = settings.visitors;
  const out: Record<string, VisitorEntry> = {};
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return out;
  for (const [uid, v] of Object.entries(raw as Record<string, unknown>)) {
    if (!v || typeof v !== 'object' || Array.isArray(v)) continue;
    const e = v as Record<string, unknown>;
    if (typeof e.name !== 'string') continue;
    out[uid] = {
      name: e.name.slice(0, VISITOR_NAME_MAX),
      ...(e.grants !== undefined ? { grants: cleanGrants(e.grants) } : {}),
      ...(e.listed === true ? { listed: true } : {}),
    };
  }
  return out;
}

/** The choice kinds open to one visitor: their own grants when the owner set them, else the default. */
export function grantsFor(settings: Readonly<Record<string, unknown>>, uid: string): ActionKind[] {
  const own = visitorsOf(settings)[uid]?.grants;
  return own ? [...own] : cleanGrants(settings.grants);
}

/** Every kind a visitor may ask for in this world (the always-open kinds and their grants). */
export function visitorKinds(settings: Readonly<Record<string, unknown>>, uid: string): ActionKind[] {
  const granted = new Set<ActionKind>([...ALLOWED_KINDS, ...grantsFor(settings, uid)]);
  return ACTION_KINDS.filter((k) => granted.has(k));
}

/** Whether the away rule lets this person in while the owner is away. */
export function awayAllows(settings: Readonly<Record<string, unknown>>, uid: string): boolean {
  return awayOf(settings) === 'list' && visitorsOf(settings)[uid]?.listed === true;
}

/** One change the owner makes to the matrix. `uid` is resolved by the server from a ref or a person. */
export type VisitorEdit =
  | { readonly op: 'defaults'; readonly grants: readonly string[] }
  | { readonly op: 'away'; readonly rule: AwayRule }
  | { readonly op: 'person'; readonly uid: string; readonly name: string; readonly grants: readonly string[] | null }
  | { readonly op: 'list'; readonly uid: string; readonly name: string; readonly on: boolean }
  | { readonly op: 'forget'; readonly uid: string };

export type VisitorEditResult =
  | { readonly ok: true; readonly settings: Record<string, unknown> }
  | { readonly ok: false; readonly reason: 'full' | 'unknown' };

/**
 * The settings after one owner edit (pure). Other settings keys are kept as they are. A person entry
 * that is back to the default and off the list is removed, so the list holds only what the owner set.
 */
export function applyVisitorEdit(
  settings: Readonly<Record<string, unknown>>,
  edit: VisitorEdit,
): VisitorEditResult {
  const next: Record<string, unknown> = { ...settings };
  if (edit.op === 'defaults') {
    next.grants = cleanGrants(edit.grants);
    return { ok: true, settings: next };
  }
  if (edit.op === 'away') {
    next.away = edit.rule;
    return { ok: true, settings: next };
  }
  const people = visitorsOf(settings);
  if (edit.op === 'forget') {
    if (!people[edit.uid]) return { ok: false, reason: 'unknown' };
    delete people[edit.uid];
  } else {
    const before = people[edit.uid];
    if (!before && Object.keys(people).length >= VISITOR_CAP) return { ok: false, reason: 'full' };
    const name = edit.name.slice(0, VISITOR_NAME_MAX) || before?.name || '?';
    let grants = before?.grants;
    let listed = before?.listed === true;
    if (edit.op === 'person') grants = edit.grants === null ? undefined : cleanGrants(edit.grants);
    else listed = edit.on;
    if (grants === undefined && !listed) delete people[edit.uid];
    else people[edit.uid] = { name, ...(grants ? { grants } : {}), ...(listed ? { listed: true } : {}) };
  }
  next.visitors = people;
  return { ok: true, settings: next };
}
