import { useSyncExternalStore } from 'react';
import { useTranslation } from 'react-i18next';
import { world } from '../net/client';
import { store, useStore } from '../state/store';
import { ShopPanel } from '../worlds/ui/ShopPanel';
import { worldHud } from '../worlds/ui/hudState';
import '../worlds/ui/worldHud.css';

/** A fresh idempotency key for one purchase (the server replays the first answer for a resend). */
const newKey = (): string =>
  typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `b-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;

/**
 * The office shop board (P17.26b): the same stock and stable prices as a world's board. Open while
 * standing at it; the server checks the place, the money and the bag (`office:buy`), and the bag and
 * money shown are the server's (`world:inv`).
 */
export function OfficeShop() {
  const { t } = useTranslation();
  const open = useStore((s) => s.officeShop && s.worldId === null);
  const refused = useStore((s) => s.officeShopRefused);
  const hud = useSyncExternalStore(worldHud.subscribe, worldHud.get, worldHud.get);
  if (!open) return null;
  return (
    <ShopPanel
      money={hud.money}
      notice={refused ? t(`gift.shopRefused.${refused}`) : null}
      onBuy={(item) => {
        store.set({ officeShopRefused: null });
        world.send({ t: 'office:buy', item, key: newKey() });
      }}
      onClose={() => store.set({ officeShop: false, officeShopRefused: null })}
      footer={
        <button
          type="button"
          className="btn secondary small-btn wh-market-link"
          onClick={() => store.set({ officeShop: false, officeShopRefused: null, officeMarket: true })}
        >
          {t('market.open')}
        </button>
      }
    />
  );
}
