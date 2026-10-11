import { useEffect, useMemo, useState, useSyncExternalStore, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { MARKET_EXPIRY_MS, MARKET_PRICE_MAX, MARKET_QTY_MAX, baseItemOf, listingFee } from '@agora/shared';
import { Dialog } from './common';
import { world } from '../net/client';
import { store, useStore } from '../state/store';
import { worldHud } from '../worlds/ui/hudState';
import { tradeableStacks } from '../worlds/tradeMath';
import '../worlds/ui/worldHud.css';

const newKey = (): string =>
  typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `m-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;

function SellForm({ items, money }: { items: Readonly<Record<string, number>>; money: number }) {
  const { t } = useTranslation();
  const stacks = useMemo(() => tradeableStacks(items), [items]);
  const [item, setItem] = useState('');
  const [qty, setQty] = useState(1);
  const [price, setPrice] = useState(20);
  const chosen = stacks.find(([k]) => k === item) ?? stacks[0];
  const key = chosen?.[0] ?? '';
  const have = chosen?.[1] ?? 0;
  const fee = listingFee(price);
  const valid = !!key && qty >= 1 && qty <= Math.min(have, MARKET_QTY_MAX) && price >= 1 && price <= MARKET_PRICE_MAX && fee <= money;
  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!valid) return;
    store.set({ marketRefused: null });
    world.send({ t: 'market:list', item: key, qty, price, key: newKey() });
  };
  if (stacks.length === 0) return <p className="muted small">{t('market.nothingToSell')}</p>;
  return (
    <form className="cp-form" onSubmit={submit}>
      <h3 className="h-small">{t('market.sell')}</h3>
      <label>
        {t('market.itemLabel')}
        <select value={key} onChange={(e) => setItem(e.target.value)}>
          {stacks.map(([k, n]) => (
            <option key={k} value={k}>
              {t(`worlds.item.${baseItemOf(k)}`)} ({n})
            </option>
          ))}
        </select>
      </label>
      <label>
        {t('market.qtyLabel')}
        <input type="number" min={1} max={Math.min(have, MARKET_QTY_MAX)} value={qty} onChange={(e) => setQty(Math.floor(Number(e.target.value) || 0))} />
      </label>
      <label>
        {t('market.priceLabel')}
        <input type="number" min={1} max={MARKET_PRICE_MAX} value={price} onChange={(e) => setPrice(Math.floor(Number(e.target.value) || 0))} />
      </label>
      <p className="muted small">{t('market.feeNote', { fee, days: MARKET_EXPIRY_MS / 86_400_000 })}</p>
      <button type="submit" className="btn primary small-btn" disabled={!valid}>
        {t('market.listBtn')}
      </button>
    </form>
  );
}

/**
 * The marketplace board at the office (P17.30, ADR-053): what people put up for sale (never who), a
 * buy takes the whole listing; my own listings can be taken back. The fee, the limits, every count
 * and every exchange are the server's.
 */
export function MarketPanel() {
  const { t, i18n } = useTranslation();
  const open = useStore((s) => s.officeMarket && s.worldId === null);
  const board = useStore((s) => s.market);
  const refused = useStore((s) => s.marketRefused);
  const hud = useSyncExternalStore(worldHud.subscribe, worldHud.get, worldHud.get);
  useEffect(() => {
    if (!open) return;
    world.send({ t: 'market:browse' });
    world.send({ t: 'office:inv' });
  }, [open]);
  if (!open) return null;
  const close = () => store.set({ officeMarket: false, marketRefused: null });
  const date = (ms: number) =>
    new Intl.DateTimeFormat(i18n.language === 'fr' ? 'fr-CA' : 'en-CA', { dateStyle: 'medium', timeStyle: 'short' }).format(ms);
  return (
    <Dialog title={t('market.title')} onClose={close} className="wh-panel cp">
      <p className="wh-money">{t('worlds.hud.money', { amount: hud.money })}</p>
      {refused && (
        <p className="wh-notice" role="alert">
          {t(`market.refused.${refused}`)}
        </p>
      )}
      {board && (
        <p className="muted small">
          {t('market.limits', {
            listed: board.listedToday,
            list: board.limits.list,
            bought: board.boughtToday,
            buy: board.limits.buy,
          })}
        </p>
      )}
      {!board ? (
        <p className="muted">…</p>
      ) : board.listings.length === 0 ? (
        <p className="muted">{t('market.none')}</p>
      ) : (
        <ul className="cp-list">
          {board.listings.map((l) => {
            const name = t(`worlds.item.${baseItemOf(l.item)}`);
            return (
              <li key={l.id}>
                <strong>
                  {name} ×{l.qty}
                </strong>{' '}
                <span>{t('market.price', { price: l.price })}</span>
                <div className="muted small">{t('market.until', { date: date(l.expiresAt) })}</div>
                {l.mine ? (
                  <button
                    type="button"
                    className="btn secondary small-btn"
                    onClick={() => {
                      store.set({ marketRefused: null });
                      world.send({ t: 'market:cancel', id: l.id });
                    }}
                  >
                    {t('market.takeBack')}
                  </button>
                ) : (
                  <button
                    type="button"
                    className="btn primary small-btn"
                    aria-label={t('market.buyLabel', { item: name, qty: l.qty, price: l.price })}
                    onClick={() => {
                      store.set({ marketRefused: null });
                      world.send({ t: 'market:buy', id: l.id, key: newKey() });
                    }}
                  >
                    {t('market.buy')}
                  </button>
                )}
              </li>
            );
          })}
        </ul>
      )}
      <SellForm items={hud.items} money={hud.money} />
      <button
        type="button"
        className="btn secondary small-btn wh-market-link"
        onClick={() => store.set({ officeMarket: false, marketRefused: null, officeShop: true })}
      >
        {t('market.backToShop')}
      </button>
    </Dialog>
  );
}
