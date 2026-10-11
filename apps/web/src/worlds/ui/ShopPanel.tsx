import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { loadGameData, stockOf } from '@agora/shared';
import { Dialog } from '../../ui/common';

/**
 * The shop board (ADR-053, P17.25): every item the board sells, with its stable price. A buy asks the
 * server (`buy` at the board); the money and the bag change only when the server approves it, and a
 * refusal (not enough money, out of reach) shows in the HUD's notice. The same panel serves the office
 * board (P17.26b), where a buy is `office:buy`.
 */
export function ShopPanel({
  money,
  onBuy,
  onClose,
  notice,
  footer,
}: {
  money: number;
  onBuy: (item: string) => void;
  onClose: () => void;
  /** why the last purchase was refused, if it was */
  notice?: string | null;
  /** P17.30: more at this board (the office board links to the marketplace) */
  footer?: ReactNode;
}) {
  const { t } = useTranslation();
  const stock = stockOf(loadGameData());
  return (
    <Dialog title={t('worlds.shop.title')} onClose={onClose} className="wh-panel">
      <p className="wh-money">{t('worlds.hud.money', { amount: money })}</p>
      {notice && (
        <p className="wh-notice" role="alert">
          {notice}
        </p>
      )}
      {stock.length === 0 ? (
        <p>{t('worlds.shop.empty')}</p>
      ) : (
        <ul className="wh-list">
          {stock.map(({ id, price }) => {
            const name = t(`worlds.item.${id}`);
            return (
              <li key={id}>
                <button type="button" aria-label={t('worlds.shop.buyLabel', { item: name, price })} onClick={() => onBuy(id)}>
                  {name} <span>{t('worlds.shop.price', { price })}</span> <span className="wh-take">{t('worlds.shop.buy')}</span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
      {footer}
    </Dialog>
  );
}
