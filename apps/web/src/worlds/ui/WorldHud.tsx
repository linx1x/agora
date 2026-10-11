import { useEffect, useState, useSyncExternalStore } from 'react';
import { useTranslation } from 'react-i18next';
import { INVENTORY_SLOTS, type WorldTime } from '@agora/shared';
import { Dialog } from '../../ui/common';
import { HOTBAR_SLOTS, hotbarItems, slotForKey, worldHud, type HudState, type HudStore } from './hudState';
import { ChestPanel } from './ChestPanel';
import { CraftPanel, batchAt } from './CraftPanel';
import { ShopPanel } from './ShopPanel';
import type { WorldAsk } from '../inputActs';
import './worldHud.css';

/**
 * The world HUD (ADR-053, P17.20, P17.23): the clock (time, day, season), the energy bar, money, a
 * nine-slot hotbar (keys 1 to 9 pick the item in hand), the inventory (key I), and the reason of the
 * last refused action. Everything is a labelled button, a meter or a live status line. Mount it inside
 * the world screen, only while the person is in a world: `<WorldHud />`, fed by `applyWorldHudMessage`
 * from the world client's message handler.
 */
export function WorldHud({ store = worldHud, onAsk = () => undefined }: { store?: HudStore; onAsk?: WorldAsk }) {
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
  // the panels stand outside the hotbar: its transform would make their fixed backdrops its own
  return (
    <>
      <nav className="wh-hud" aria-label={t('worlds.hud.hotbar')}>
        {(state.time !== null || state.maxEnergy > 0) && (
          <div className="wh-status">
            {state.time !== null && (
              <p className="wh-clock">
                {t('worlds.hud.clock', {
                  time: clockText(state.time),
                  day: state.time.day,
                  season: t(`worlds.hud.seasons.${state.time.season}`),
                })}
              </p>
            )}
            {state.maxEnergy > 0 && <EnergyBar energy={state.energy} max={state.maxEnergy} />}
          </div>
        )}
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
                  data-item={item ?? undefined}
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
        <p className="wh-hint">{t('worlds.hud.keys')}</p>
        <button type="button" className="wh-open" aria-haspopup="dialog" onClick={() => setInventoryOpen(true)}>
          {t('worlds.hud.inventory')}
        </button>
        <p className="wh-notice" role="status">
          {state.notice === null ? '' : t(`worlds.refused.${state.notice}`)}
        </p>
      </nav>
      {inventoryOpen && <InventoryPanel state={state} onPick={(item) => store.pick(item)} onClose={() => setInventoryOpen(false)} />}
      {state.chest !== null && (
        <ChestPanel chest={state.chest} hand={state.inHand} onAsk={onAsk} onClose={() => store.closeChest()} />
      )}
      {state.panel?.kind === 'shop' && (
        <ShopPanel at={state.panel.at} money={state.money} onAsk={onAsk} onClose={() => store.closePanel()} />
      )}
      {state.panel?.kind === 'craft' && (
        <CraftPanel
          at={state.panel.at}
          block={state.panel.block}
          batch={batchAt(state.machines, state.panel.at)}
          onAsk={onAsk}
          onClose={() => store.closePanel()}
        />
      )}
    </>
  );
}

/** The energy bar: a progress bar for screen readers, the numbers beside it. Low energy is marked by colour and by the label. */
function EnergyBar({ energy, max }: { energy: number; max: number }) {
  const { t } = useTranslation();
  const share = Math.max(0, Math.min(1, energy / max));
  const text = t('worlds.hud.energyValue', { energy, max });
  return (
    <div className="wh-energy" data-low={share < 0.2 ? 'true' : 'false'}>
      <span className="wh-energy-label" aria-hidden="true">
        {t('worlds.hud.energy')}
      </span>
      <div
        className="wh-energy-track"
        role="progressbar"
        aria-label={t('worlds.hud.energy')}
        aria-valuemin={0}
        aria-valuemax={max}
        aria-valuenow={energy}
        aria-valuetext={text}
      >
        <span className="wh-energy-fill" style={{ width: `${Math.round(share * 100)}%` }} />
      </div>
      <span className="wh-energy-text" aria-hidden="true">
        {text}
      </span>
    </div>
  );
}

/** The game clock as 24-hour digits (the day runs 06:00 to 02:00, so the hours go 6 to 23, then 0 to 2). */
export function clockText(time: WorldTime): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${pad(time.hour)}:${pad(time.minute)}`;
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
