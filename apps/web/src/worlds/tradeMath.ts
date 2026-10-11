/** The trade panel, pure parts (P17.29): tested without a browser. */
import { loadGameData, tradeable, type TradeOffer } from '@agora/shared';

/** The stacks of a bag that can be offered (open and limited items), in the order the server listed them. */
export function tradeableStacks(items: Readonly<Record<string, number>>): [string, number][] {
  const data = loadGameData();
  return Object.entries(items).filter(([key, n]) => n > 0 && tradeable(data, key));
}

/** The panel's draft from an offer (quantities per stack). */
export function draftFromOffer(offer: TradeOffer): Record<string, number> {
  return { ...offer.items };
}

/** The offer a draft makes: stacks with a positive quantity, and the money. */
export function offerFromDraft(draft: Readonly<Record<string, number>>, money: number): TradeOffer {
  const items: Record<string, number> = {};
  for (const [k, n] of Object.entries(draft)) if (n > 0) items[k] = n;
  return { items, money };
}
