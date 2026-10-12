import { useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import {
  CONTRACT_GOAL_MAX,
  CONTRACT_KINDS,
  CONTRACT_OPEN_MAX,
  CONTRACT_REWARD_MAX,
  type ContractKind,
} from '@agora/shared';
import { Dialog } from '../../ui/common';
import { world } from '../../net/client';
import { store, useStore } from '../../state/store';

const newKey = (): string =>
  typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `c-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;

/** The owner's form: what to do, how many times, for how much (taken from their money now). */
function PostForm({ money, full }: { money: number; full: boolean }) {
  const { t } = useTranslation();
  const [kind, setKind] = useState<ContractKind>('water');
  const [goal, setGoal] = useState(10);
  const [reward, setReward] = useState(50);
  const valid =
    Number.isInteger(goal) &&
    goal >= 1 &&
    goal <= CONTRACT_GOAL_MAX &&
    Number.isInteger(reward) &&
    reward >= 1 &&
    reward <= Math.min(CONTRACT_REWARD_MAX, money);
  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!valid || full) return;
    store.set({ contractRefused: null });
    world.send({ t: 'contract:post', kind, goal, reward, key: newKey() });
  };
  return (
    <form className="cp-form" onSubmit={submit}>
      <h3 className="h-small">{t('contracts.post')}</h3>
      <label>
        {t('contracts.kindLabel')}
        <select value={kind} onChange={(e) => setKind(e.target.value as ContractKind)}>
          {CONTRACT_KINDS.map((k) => (
            <option key={k} value={k}>
              {t(`contracts.task.${k}`)}
            </option>
          ))}
        </select>
      </label>
      <label>
        {t('contracts.goalLabel')}
        <input
          type="number"
          min={1}
          max={CONTRACT_GOAL_MAX}
          value={goal}
          onChange={(e) => setGoal(Number(e.target.value))}
        />
      </label>
      <label>
        {t('contracts.rewardLabel')}
        <input
          type="number"
          min={1}
          max={CONTRACT_REWARD_MAX}
          value={reward}
          onChange={(e) => setReward(Number(e.target.value))}
        />
      </label>
      <p className="muted small">{t('contracts.escrow', { reward, money })}</p>
      <button type="submit" className="btn primary small-btn" disabled={!valid || full}>
        {t('contracts.postBtn')}
      </button>
      {full && <p className="muted small">{t('contracts.full', { max: CONTRACT_OPEN_MAX })}</p>}
    </form>
  );
}

/**
 * Contracts in a world (P17.28, ADR-053): the owner posts a task with a reward held from their money,
 * and cancels it to get the reward back; a visitor sees the open tasks and their own progress. Every
 * count and payment is the server's.
 */
export function ContractsPanel({ money }: { money: number }) {
  const { t } = useTranslation();
  const open = useStore((s) => s.contractsOpen && s.worldId !== null);
  const mine = useStore((s) => s.worldMine);
  const contracts = useStore((s) => s.contracts);
  const refused = useStore((s) => s.contractRefused);
  if (!open) return null;
  const close = () => store.set({ contractsOpen: false, contractRefused: null });
  return (
    <Dialog title={t('contracts.title')} onClose={close} className="wh-panel cp">
      {refused && (
        <p className="wh-notice" role="alert">
          {t(`contracts.refused.${refused}`)}
        </p>
      )}
      <p className="muted small">{t(mine ? 'contracts.aboutOwner' : 'contracts.aboutVisitor')}</p>
      {contracts.length === 0 ? (
        <p className="muted">{t('contracts.none')}</p>
      ) : (
        <ul className="cp-list">
          {contracts.map((c) => (
            <li key={c.id}>
              <strong>{t(`contracts.kind.${c.kind}`, { count: c.goal })}</strong>{' '}
              <span>{t('contracts.reward', { reward: c.reward })}</span>
              <div className="small">
                {mine
                  ? t('contracts.best', { best: c.best, goal: c.goal })
                  : t('contracts.progress', { mine: c.mine, goal: c.goal, best: c.best })}
              </div>
              {mine && (
                <button
                  type="button"
                  className="btn secondary small-btn"
                  onClick={() => {
                    store.set({ contractRefused: null });
                    world.send({ t: 'contract:cancel', id: c.id });
                  }}
                >
                  {t('contracts.cancel', { reward: c.reward })}
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
      {mine && <PostForm money={money} full={contracts.length >= CONTRACT_OPEN_MAX} />}
    </Dialog>
  );
}
