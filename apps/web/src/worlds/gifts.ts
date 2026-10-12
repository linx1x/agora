/** What the Talk box offers to give a character (P17.26b): pure, so it is tested without a browser. */
import { giftable, loadGameData } from '@agora/shared';

/** The stacks of a bag one can give to a character, in the order the server listed them. */
export function giftableStacks(items: Readonly<Record<string, number>>): [string, number][] {
  const data = loadGameData();
  return Object.entries(items).filter(([key, n]) => n > 0 && giftable(data, key));
}
