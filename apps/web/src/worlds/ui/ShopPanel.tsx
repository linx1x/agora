import { useTranslation } from 'react-i18next';
import { loadGameData, stockOf, type CellRef } from '@agora/shared';
import { Dialog } from '../../ui/common';
import type { WorldAsk } from '../inputActs';

/**
 * The shop board (ADR-053, P17.25): every item the board sells, with its stable price. A buy asks the
 * server (`buy` at the board); the money and the bag change only when the server approves it, and a
 * refusal (not enough money, out of reach) shows in the HUD's notice.
 */
export function ShopPanel({ at, money, onAsk, onClose }: { at: CellRef; money: number; onAsk: WorldAsk; onClose: () => void }) {
  const { t } = useTranslation();
  const stock = stockOf(loadGameData());
  return (
    <Dialog title={t('worlds.shop.title')} onClose={onClose} className="wh-panel">
      <p className="wh-money">{t('worlds.hud.money', { amount: money })}</p>
      {stock.length === 0 ? (
        <p>{t('worlds.shop.empty')}</p>
      ) : (
        <ul className="wh-list">
          {stock.map(({ id, price }) => {
            const name = t(`worlds.item.${id}`);
            return (
              <li key={id}>
                <button type="button" aria-label={t('worlds.shop.buyLabel', { item: name, price })} onClick={() => onAsk('buy', at, id)}>
                  {name} <span>{t('worlds.shop.price', { price })}</span> <span className="wh-take">{t('worlds.shop.buy')}</span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </Dialog>
  );
}
