/**
 * Who the People panel lists inside a personal world (P17.15b): the people of that world only, me
 * first, then by name. The office roster is not shown there (it is stale while I am away, and the
 * world is its own place, ADR-053).
 */
import type { Avatar, WorldPerson } from '@agora/shared';

export interface WorldPeopleRow {
  id: string;
  name: string;
  avatar: Avatar;
  you: boolean;
}

/** The rows for a world: its people, with me added when the world's list does not carry me. */
export function worldPeopleRows(
  people: Iterable<WorldPerson>,
  you: string,
  mine?: { name: string; avatar: Avatar },
): WorldPeopleRow[] {
  const rows = new Map<string, WorldPeopleRow>();
  for (const p of people)
    rows.set(p.id, { id: p.id, name: p.name, avatar: p.avatar, you: p.id === you });
  if (you && !rows.has(you) && mine)
    rows.set(you, { id: you, name: mine.name, avatar: mine.avatar, you: true });
  return [...rows.values()].sort((a, b) => (a.you ? -1 : b.you ? 1 : a.name.localeCompare(b.name)));
}
