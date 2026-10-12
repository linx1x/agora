/** The visitor default for each action kind (ADR-053 "Visitors"); see `permissions.ts` and `visitors.ts`. */
import type { ActionKind } from './kinds';

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
  // the shop, the bin and the products are the owner's (P17.25); feeding animals and crafting
  // stations are the owner's choice, as ADR-053 sets it (P17.27)
  buy: 'deny',
  ship: 'deny',
  feed: 'choice',
  collect: 'deny',
  craft: 'choice',
};
