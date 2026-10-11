import { useTranslation } from 'react-i18next';
import { CHEST_SLOTS } from '@agora/shared';
import { Dialog } from '../../ui/common';
import type { WorldAsk } from '../inputActs';
import type { ChestView } from './hudState';

/**
 * The chest panel (ADR-053, P17.24): the stacks a chest holds, each taken with its own button, and
 * the item in hand put in. Every button asks the server (`take`, `stash`); the server answers with
 * the chest as it now is (`world:chest`), so the list is never guessed here. Closing keeps the chest.
 */
export function ChestPanel({
  chest,
  hand,
  onAsk,
  onClose,
}: {
  chest: ChestView;
  hand: string | null;
  onAsk: WorldAsk;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const rows = Object.entries(chest.items).filter(([, qty]) => qty > 0);
  const ask = (kind: 'take' | 'stash', item: string) => onAsk(kind, chest.at, item);
  return (
    <Dialog title={t('worlds.chest.title')} onClose={onClose} className="wh-panel">
      <p className="wh-used">{t('worlds.chest.slotsUsed', { used: rows.length, max: CHEST_SLOTS })}</p>
      {rows.length === 0 ? (
        <p>{t('worlds.chest.empty')}</p>
      ) : (
        <ul className="wh-list">
          {rows.map(([item, qty]) => (
            <li key={item}>
              <button type="button" aria-label={t('worlds.chest.takeLabel', { item: t(`worlds.item.${item}`), count: qty })} onClick={() => ask('take', item)}>
                {t(`worlds.item.${item}`)} <span>×{qty}</span> <span className="wh-take">{t('worlds.chest.take')}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
      <div className="wh-chest-actions">
        <button type="button" disabled={hand === null} onClick={() => hand !== null && ask('stash', hand)}>
          {hand === null ? t('worlds.chest.stashNone') : t('worlds.chest.stash', { item: t(`worlds.item.${hand}`) })}
        </button>
        <button type="button" onClick={onClose}>
          {t('worlds.chest.close')}
        </button>
      </div>
    </Dialog>
  );
}
