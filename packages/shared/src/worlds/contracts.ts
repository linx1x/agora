/**
 * World contracts (P17.28, ADR-053): the owner posts a task in their world (water N crops, harvest N,
 * gather N wood or N ore) with a money reward taken from their own account at once (held in escrow
 * by the contract). Visitors work it with ordinary world actions; the server counts each accepted
 * action once (by its key), and the first person to reach the goal is paid the whole reward, in the
 * same transaction that closes the contract. The owner may cancel an open contract: the reward goes
 * back to them. Money is never created or lost: owner + escrow + workers is constant.
 *
 * An open contract opens its action kind to visitors in that world while it is open, even a kind the
 * visitor matrix keeps closed (chop, mine): posting a wood contract is the owner's say-so.
 */
import type { ActionKind } from './actions/kinds';

/** The tasks a contract can ask for, each one world action kind. */
export const CONTRACT_KINDS = ['water', 'harvest', 'chop', 'mine'] as const;
export type ContractKind = (typeof CONTRACT_KINDS)[number];

export const CONTRACT_GOAL_MAX = 100;
export const CONTRACT_REWARD_MAX = 5000;
/** Open contracts per world at once. */
export const CONTRACT_OPEN_MAX = 3;

/** Why a contract request did nothing; each has an i18n key `contracts.refused.<reason>`. */
export const CONTRACT_REFUSALS = [
  'disabled',
  'rate',
  'forbidden',
  'invalid',
  'money',
  'limit',
  'gone',
  'conflict',
] as const;
export type ContractRefusal = (typeof CONTRACT_REFUSALS)[number];

export type ContractState = 'open' | 'done' | 'cancelled';

export interface Contract {
  readonly id: string;
  readonly worldId: string;
  readonly ownerId: string;
  readonly kind: ContractKind;
  readonly goal: number;
  readonly reward: number;
  /** accepted actions per worker (user id, server-side only) */
  readonly progress: Readonly<Record<string, number>>;
  readonly state: ContractState;
  /** who reached the goal (user id), once done */
  readonly winner: string | null;
  readonly createdAt: number;
  readonly closedAt: number | null;
}

/** What one person sees of a contract: their own progress and the best so far, never anyone's id. */
export interface ContractView {
  readonly id: string;
  readonly kind: ContractKind;
  readonly goal: number;
  readonly reward: number;
  readonly mine: number;
  readonly best: number;
}

export function isContractKind(kind: string): kind is ContractKind {
  return (CONTRACT_KINDS as readonly string[]).includes(kind);
}

/** Whether the owner may post this contract now: the numbers, the open limit, and the money. */
export function planPost(
  money: number,
  openCount: number,
  req: { kind: string; goal: number; reward: number },
): { ok: true } | { ok: false; reason: ContractRefusal } {
  if (!isContractKind(req.kind)) return { ok: false, reason: 'invalid' };
  if (!Number.isInteger(req.goal) || req.goal < 1 || req.goal > CONTRACT_GOAL_MAX)
    return { ok: false, reason: 'invalid' };
  if (!Number.isInteger(req.reward) || req.reward < 1 || req.reward > CONTRACT_REWARD_MAX)
    return { ok: false, reason: 'invalid' };
  if (openCount >= CONTRACT_OPEN_MAX) return { ok: false, reason: 'limit' };
  if (money < req.reward) return { ok: false, reason: 'money' };
  return { ok: true };
}

/**
 * One accepted action by a worker on an open contract. The goal reached closes it with that worker as
 * the winner (the caller pays the reward in the same transaction).
 */
export function advance(c: Contract, uid: string, now: number): { contract: Contract; done: boolean } {
  if (c.state !== 'open' || uid === c.ownerId) return { contract: c, done: false };
  const n = (c.progress[uid] ?? 0) + 1;
  const progress = { ...c.progress, [uid]: n };
  if (n < c.goal) return { contract: { ...c, progress }, done: false };
  return { contract: { ...c, progress, state: 'done', winner: uid, closedAt: now }, done: true };
}

/** The contract an action works on: the oldest open one of its kind (one action counts once). */
export function contractFor(contracts: readonly Contract[], kind: ActionKind): Contract | null {
  let best: Contract | null = null;
  for (const c of contracts)
    if (c.state === 'open' && c.kind === kind && (!best || c.createdAt < best.createdAt || (c.createdAt === best.createdAt && c.id < best.id)))
      best = c;
  return best;
}

/** The kinds open contracts open to visitors. */
export function contractKinds(contracts: readonly Contract[]): ActionKind[] {
  const kinds = new Set<ActionKind>();
  for (const c of contracts) if (c.state === 'open') kinds.add(c.kind);
  return [...kinds];
}

/** A contract as one person sees it. */
export function contractView(c: Contract, uid: string): ContractView {
  const values = Object.values(c.progress);
  return {
    id: c.id,
    kind: c.kind,
    goal: c.goal,
    reward: c.reward,
    mine: c.progress[uid] ?? 0,
    best: values.length ? Math.max(...values) : 0,
  };
}
