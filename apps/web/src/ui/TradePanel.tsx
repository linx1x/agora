import { useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import { useTranslation } from 'react-i18next';
import { TRADE_MONEY_MAX, baseItemOf, type TradeOffer } from '@agora/shared';
import { Dialog } from './common';
import { world } from '../net/client';
import { store, useStore } from '../state/store';
import { worldHud } from '../worlds/ui/hudState';
import { draftFromOffer, offerFromDraft, tradeableStacks } from '../worlds/tradeMath';
import '../worlds/ui/worldHud.css';

function OfferList({ offer, empty }: { offer: TradeOffer; empty: string }) {
  const { t } = useTranslation();
  const rows = Object.entries(offer.items);
  if (rows.length === 0 && offer.money === 0) return <p className="muted small">{empty}</p>;
  return (
    <ul className="tp-offer">
      {rows.map(([key, n]) => (
        <li key={key}>
          {t(`worlds.item.${baseItemOf(key)}`)} ×{n}
        </li>
      ))}
      {offer.money > 0 && <li>{t('trade.money', { amount: offer.money })}</li>}
    </ul>
  );
}

/**
 * A direct trade (P17.29, ADR-053): what I give (a draft I send as my offer), what I get, and both
 * confirmations. The swap is the server's: it happens only when both confirmed the same state, and
 * any change to either side clears both confirmations.
 */
export function TradePanel() {
  const { t } = useTranslation();
  const trade = useStore((s) => s.trade);
  const refused = useStore((s) => s.tradeRefused);
  const hud = useSyncExternalStore(worldHud.subscribe, worldHud.get, worldHud.get);
  const [draft, setDraft] = useState<Record<string, number>>({});
  const [money, setMoney] = useState(0);
  const id = trade?.id;
  const sent = trade?.you;
  // a new trade, or my offer as the server has it: the draft starts from there
  useEffect(() => {
    if (!sent) return;
    setDraft(draftFromOffer(sent));
    setMoney(sent.money);
  }, [id, sent]);
  useEffect(() => {
    if (id) world.send({ t: 'office:inv' });
  }, [id]);
  const stacks = useMemo(() => tradeableStacks(hud.items), [hud.items]);
  if (!trade) return null;
  const cancel = () => world.send({ t: 'trade:cancel', id: trade.id });
  const offer = offerFromDraft(draft, money);
  const changed = JSON.stringify(offer) !== JSON.stringify({ items: trade.you.items, money: trade.you.money });
  return (
    <Dialog title={t('trade.title', { name: trade.with })} onClose={cancel} className="wh-panel tp" wide>
      {refused && (
        <p className="wh-notice" role="alert">
          {t(`trade.refused.${refused}`)}
        </p>
      )}
      {trade.pending ? (
        <p role="status">{t('trade.waiting', { name: trade.with })}</p>
      ) : (
        <div className="tp-sides">
          <section aria-labelledby="tp-give">
            <h3 className="h-small" id="tp-give">
              {t('trade.give')}
            </h3>
            {stacks.length === 0 ? (
              <p className="muted small">{t('trade.nothing')}</p>
            ) : (
              <ul className="tp-stacks">
                {stacks.map(([key, have]) => {
                  const name = t(`worlds.item.${baseItemOf(key)}`);
                  return (
                    <li key={key}>
                      <label>
                        <span>
                          {name} <span className="muted">({t('trade.have', { count: have })})</span>
                        </span>
                        <input
                          type="number"
                          min={0}
                          max={have}
                          value={draft[key] ?? 0}
                          aria-label={t('trade.qty', { item: name })}
                          onChange={(e) =>
                            setDraft((d) => ({ ...d, [key]: Math.max(0, Math.min(have, Math.floor(Number(e.target.value) || 0))) }))
                          }
                        />
                      </label>
                    </li>
                  );
                })}
              </ul>
            )}
            <label className="tp-money">
              {t('trade.moneyLabel', { have: hud.money })}
              <input
                type="number"
                min={0}
                max={Math.min(TRADE_MONEY_MAX, hud.money)}
                value={money}
                onChange={(e) => setMoney(Math.max(0, Math.min(TRADE_MONEY_MAX, Math.floor(Number(e.target.value) || 0))))}
              />
            </label>
            <button
              type="button"
              className="btn secondary small-btn"
              disabled={!changed}
              onClick={() => {
                store.set({ tradeRefused: null });
                world.send({ t: 'trade:offer', id: trade.id, ...offer });
              }}
            >
              {t('trade.propose')}
            </button>
            <h4 className="small">{t('trade.youOffer')}</h4>
            <OfferList offer={trade.you} empty={t('trade.emptyOffer')} />
          </section>
          <section aria-labelledby="tp-get">
            <h3 className="h-small" id="tp-get">
              {t('trade.get', { name: trade.with })}
            </h3>
            <OfferList offer={trade.them} empty={t('trade.emptyOffer')} />
          </section>
        </div>
      )}
      {!trade.pending && (
        <>
          <p className="small" role="status">
            {trade.youConfirmed
              ? t('trade.youConfirmed', { name: trade.with })
              : trade.themConfirmed
                ? t('trade.themConfirmed', { name: trade.with })
                : t('trade.noneConfirmed')}
          </p>
          <p className="muted small">{t('trade.rules')}</p>
        </>
      )}
      <div className="row tp-actions">
        {!trade.pending && (
          <button
            type="button"
            className="btn primary small-btn"
            disabled={trade.youConfirmed || changed}
            onClick={() => {
              store.set({ tradeRefused: null });
              world.send({ t: 'trade:confirm', id: trade.id, rev: trade.rev });
            }}
          >
            {t('trade.confirm')}
          </button>
        )}
        <button type="button" className="btn secondary small-btn" onClick={cancel}>
          {t('trade.cancel')}
        </button>
      </div>
    </Dialog>
  );
}
