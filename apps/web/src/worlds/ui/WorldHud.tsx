import { useEffect, useState, useSyncExternalStore } from 'react';
import { useTranslation } from 'react-i18next';
import { INVENTORY_SLOTS } from '@agora/shared';
import { Dialog } from '../../ui/common';
import { HOTBAR_SLOTS, hotbarItems, slotForKey, worldHud, type HudState, type HudStore } from './hudState';
import './worldHud.css';

/**
 * The world HUD (ADR-053, P17.20): money, a nine-slot hotbar (keys 1 to 9 pick the item in hand),
 * the inventory (key I), and the reason of the last refused action. Everything is a labelled button
 * or a live status line. Mount it inside the world screen, only while the person is in a world:
 * `<WorldHud />`, fed by `applyWorldHudMessage` from the world client's message handler.
 */
export function WorldHud({ store = worldHud }: { store?: HudStore }) {
  const { t } = useTranslation();
  const state = useSyncExternalStore(store.subscribe, store.get, store.get);
  const [inventoryOpen, setInventoryOpen] = useState(false);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.ctrlKey || e.metaKey || e.altKey || isTyping(e.target)) return;
      if (e.key === 'i' || e.key === 'I') {
        e.preventDefault();
        setInventoryOpen((open) => !open);
        return;
      }
      const slot = slotForKey(e.key);
      if (slot === null) return;
      e.preventDefault();
      store.pick(hotbarItems(store.get().items)[slot] ?? null);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [store]);

  const slots = hotbarItems(state.items);
  return (
    <nav className="wh-hud" aria-label={t('worlds.hud.hotbar')}>
      <p className="wh-money">{t('worlds.hud.money', { amount: state.money })}</p>
      <ol className="wh-slots">
        {Array.from({ length: HOTBAR_SLOTS }, (_, i) => {
          const item = slots[i] ?? null;
          const n = i + 1;
          const held = item !== null && item === state.inHand;
          const label =
            item === null
              ? t('worlds.hud.slotEmpty', { n })
              : t('worlds.hud.slot', { n, item: t(`worlds.item.${item}`), count: state.items[item] ?? 0 });
          return (
            <li key={n}>
              <button
                type="button"
                className="wh-slot"
                aria-pressed={held}
                aria-label={label}
                onClick={() => store.pick(item)}
              >
                <span className="wh-key" aria-hidden="true">
                  {n}
                </span>
                {item !== null && <span className="wh-name">{t(`worlds.item.${item}`)}</span>}
                {item !== null && (
                  <span className="wh-count" aria-hidden="true">
                    {state.items[item]}
                  </span>
                )}
              </button>
            </li>
          );
        })}
      </ol>
      <p className="wh-hand">
        {state.inHand === null
          ? t('worlds.hud.nothingInHand')
          : t('worlds.hud.inHand', { item: t(`worlds.item.${state.inHand}`) })}
      </p>
      <button type="button" className="wh-open" aria-haspopup="dialog" onClick={() => setInventoryOpen(true)}>
        {t('worlds.hud.inventory')}
      </button>
      <p className="wh-notice" role="status">
        {state.notice === null ? '' : t(`worlds.refused.${state.notice}`)}
      </p>
      {inventoryOpen && <InventoryPanel state={state} onPick={(item) => store.pick(item)} onClose={() => setInventoryOpen(false)} />}
    </nav>
  );
}

function InventoryPanel({
  state,
  onPick,
  onClose,
}: {
  state: HudState;
  onPick: (item: string) => void;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const rows = Object.entries(state.items);
  return (
    <Dialog title={t('worlds.hud.inventoryTitle')} onClose={onClose} className="wh-panel">
      <p className="wh-used">{t('worlds.hud.slotsUsed', { used: rows.length, max: INVENTORY_SLOTS })}</p>
      <p className="wh-money">{t('worlds.hud.money', { amount: state.money })}</p>
      {rows.length === 0 ? (
        <p>{t('worlds.hud.empty')}</p>
      ) : (
        <ul className="wh-list">
          {rows.map(([item, qty]) => (
            <li key={item}>
              <button type="button" aria-pressed={item === state.inHand} onClick={() => onPick(item)}>
                {t(`worlds.item.${item}`)} <span>×{qty}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </Dialog>
  );
}

/** Keys typed into a field are text, not commands. */
function isTyping(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return target.isContentEditable || target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement || target instanceof HTMLSelectElement;
}
