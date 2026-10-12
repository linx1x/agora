/**
 * World contracts (P17.28, ADR-053): post, cancel and work, each one transaction with a ledger row.
 * The reward leaves the owner's account when the contract is posted (escrow in the contract row), and
 * goes to the first worker to reach the goal, or back to the owner on cancel, exactly once: the pay and
 * refund rows have fixed keys per contract, so a second payout cannot be written.
 */
import { createHash } from 'node:crypto';
import {
  advance,
  applyInventoryChanges,
  baseItemOf,
  contractFor,
  noChanges,
  planPost,
  type ActionKind,
  type Contract,
  type ContractKind,
  type ContractRefusal,
  type GameData,
} from '@agora/shared';
import { ConflictError } from './inventory';
import type { WorldTxn } from './worldTxn';
import type { WorldStore } from './worldStore';

export type ContractResult =
  | { readonly ok: true; readonly contract: Contract; readonly replayed: boolean }
  | { readonly ok: false; readonly reason: ContractRefusal };

/** A contract's id from the key it was posted with (a resend finds the same contract). */
export const contractIdOf = (worldId: string, key: string): string =>
  'c' + createHash('sha256').update(`${worldId}:${key}`).digest('hex').slice(0, 15);

/** Moves money in or out of an account inside the transaction (throws ConflictError when it changed). */
async function moveMoney(tx: WorldTxn, data: GameData, userId: string, money: number): Promise<boolean> {
  const account = await tx.accountOf(userId, true);
  const next = applyInventoryChanges(account.inventory, { ...noChanges(), money }, (key) => data.itemsById.get(baseItemOf(key))?.stack);
  if (!next.ok) return false;
  if ((await tx.saveAccount(userId, next.inventory, account.rev)) === null) throw new ConflictError();
  return true;
}

async function guarded<T>(run: () => Promise<T>, conflict: T): Promise<T> {
  try {
    return await run();
  } catch (err) {
    if (err instanceof ConflictError) return conflict;
    throw err;
  }
}

/** The owner posts a contract in their world: the reward leaves their account into the contract. */
export function postContract(
  store: WorldStore,
  data: GameData,
  req: { worldId: string; ownerId: string; kind: ContractKind; goal: number; reward: number; key: string; now: number },
): Promise<ContractResult> {
  return guarded(
    () =>
      store.withTxn(async (tx): Promise<ContractResult> => {
        const id = contractIdOf(req.worldId, req.key);
        const stored = await tx.ledgerOf(req.key);
        if (stored) {
          tx.abort();
          const c = await tx.contractById(id, false);
          if (stored.actor !== req.ownerId || stored.kind !== 'contract:post' || !c) return { ok: false, reason: 'invalid' };
          return { ok: true, contract: c, replayed: true };
        }
        if (!(await tx.lockWorld(req.worldId))) {
          tx.abort();
          return { ok: false, reason: 'gone' };
        }
        const open = await tx.contractsOf(req.worldId, true);
        const account = await tx.accountOf(req.ownerId, true);
        const plan = planPost(account.inventory.money, open.length, req);
        if (!plan.ok) {
          tx.abort();
          return plan;
        }
        const ok = await tx.insertLedger({
          key: req.key,
          actor: req.ownerId,
          worldId: req.worldId,
          kind: 'contract:post',
          delta: { ...noChanges(), money: -req.reward },
          at: req.now,
        });
        if (!ok) throw new ConflictError();
        if (!(await moveMoney(tx, data, req.ownerId, -req.reward))) throw new ConflictError();
        const contract: Contract = {
          id,
          worldId: req.worldId,
          ownerId: req.ownerId,
          kind: req.kind,
          goal: req.goal,
          reward: req.reward,
          progress: {},
          state: 'open',
          winner: null,
          createdAt: req.now,
          closedAt: null,
        };
        await tx.saveContract(contract);
        return { ok: true, contract, replayed: false };
      }),
    { ok: false, reason: 'conflict' } as ContractResult,
  );
}

/** The owner cancels an open contract: the reward goes back to them, once. */
export function cancelContract(
  store: WorldStore,
  data: GameData,
  req: { worldId: string; ownerId: string; id: string; now: number },
): Promise<ContractResult> {
  return guarded(
    () =>
      store.withTxn(async (tx): Promise<ContractResult> => {
        if (!(await tx.lockWorld(req.worldId))) {
          tx.abort();
          return { ok: false, reason: 'gone' };
        }
        const c = await tx.contractById(req.id, true);
        if (!c || c.worldId !== req.worldId) {
          tx.abort();
          return { ok: false, reason: 'gone' };
        }
        if (c.ownerId !== req.ownerId) {
          tx.abort();
          return { ok: false, reason: 'forbidden' };
        }
        if (c.state !== 'open') {
          tx.abort();
          return { ok: false, reason: 'gone' };
        }
        const ok = await tx.insertLedger({
          key: `contract-refund-${c.id}`,
          actor: c.ownerId,
          worldId: c.worldId,
          kind: 'contract:refund',
          delta: { ...noChanges(), money: c.reward },
          at: req.now,
        });
        if (!ok) throw new ConflictError();
        if (!(await moveMoney(tx, data, c.ownerId, c.reward))) throw new ConflictError();
        const closed: Contract = { ...c, state: 'cancelled', closedAt: req.now };
        await tx.saveContract(closed);
        return { ok: true, contract: closed, replayed: false };
      }),
    { ok: false, reason: 'conflict' } as ContractResult,
  );
}

export interface WorkResult {
  /** the contract this action counted on, after it (null: none of its kind, or counted before) */
  readonly contract: Contract | null;
  /** the reward paid to the worker by this action (0 when the goal was not reached) */
  readonly paid: number;
}

/**
 * One accepted world action by a visitor counts on the oldest open contract of its kind, once per
 * action key. Reaching the goal closes the contract and pays the worker in the same transaction.
 */
export function workContract(
  store: WorldStore,
  data: GameData,
  req: { worldId: string; actor: string; kind: ActionKind; key: string; now: number },
): Promise<WorkResult> {
  return guarded(
    () =>
      store.withTxn(async (tx): Promise<WorkResult> => {
        if (!(await tx.lockWorld(req.worldId))) {
          tx.abort();
          return { contract: null, paid: 0 };
        }
        const c = contractFor(await tx.contractsOf(req.worldId, true), req.kind);
        if (!c || c.ownerId === req.actor) {
          tx.abort();
          return { contract: null, paid: 0 };
        }
        // one count per action: a replayed or resent action finds its row and counts nothing
        const counted = await tx.insertLedger({
          key: `contract-step-${c.id}-${req.key}`,
          actor: req.actor,
          worldId: req.worldId,
          kind: 'contract:step',
          delta: noChanges(),
          at: req.now,
        });
        if (!counted) {
          tx.abort();
          return { contract: null, paid: 0 };
        }
        const { contract, done } = advance(c, req.actor, req.now);
        if (done) {
          const paid = await tx.insertLedger({
            key: `contract-pay-${c.id}`,
            actor: req.actor,
            worldId: req.worldId,
            kind: 'contract:pay',
            delta: { ...noChanges(), money: c.reward },
            at: req.now,
          });
          if (!paid) throw new ConflictError();
          if (!(await moveMoney(tx, data, req.actor, c.reward))) throw new ConflictError();
        }
        await tx.saveContract(contract);
        return { contract, paid: done ? c.reward : 0 };
      }),
    { contract: null, paid: 0 } as WorkResult,
  );
}

/** A world's open contracts. */
export function openContracts(store: WorldStore, worldId: string): Promise<Contract[]> {
  return store.withTxn(async (tx) => {
    const list = await tx.contractsOf(worldId, false);
    tx.abort();
    return list;
  });
}
