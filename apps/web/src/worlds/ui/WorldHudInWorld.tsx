import { useSyncExternalStore } from 'react';
import { useTranslation } from 'react-i18next';
import { store, useStore } from '../../state/store';
import { permsToShow } from '../visitorsMath';
import { useCompactLayout } from '../../ui/layout';
import { worldActs } from '../actLink';
import { worldSession } from '../session';
import { WorldHud } from './WorldHud';
import { ContractsPanel } from './ContractsPanel';
import { worldHud } from './hudState';

/** The HUD while the person is in a world, and nothing in the office (which has its own controls). */
export function WorldHudInWorld() {
  const inWorld = useStore((s) => s.worldId !== null);
  // P17.15c: on a phone the People / Chat sheet covers the bottom of the screen; the hotbar steps aside
  const sheetOpen = useStore((s) => s.panelOpen);
  const compact = useCompactLayout();
  const { t } = useTranslation();
  const mine = useStore((s) => s.worldMine);
  const perms = useStore((s) => s.worldPerms);
  const contracts = useStore((s) => s.contracts.length);
  const money = useSyncExternalStore(
    worldHud.subscribe,
    () => worldHud.get().money,
    () => 0,
  );
  if (!inWorld) return null;
  // P17.28: contracts, for the owner always and for visitors when there are some
  const contractsBtn =
    mine || contracts > 0 ? (
      <button
        type="button"
        className="wh-open"
        aria-haspopup="dialog"
        onClick={() => store.set({ contractsOpen: true })}
      >
        {t('contracts.open', { count: contracts })}
      </button>
    ) : null;
  // P17.27: the owner sets what visitors may do; a visitor is told what they may do here
  const extra = (
    <>
      {contractsBtn}
      {mine ? (
        <button
          type="button"
          className="wh-open"
          aria-haspopup="dialog"
          onClick={() => store.set({ visitorsOpen: true })}
        >
          {t('visitors.open')}
        </button>
      ) : perms ? (
        <p className="wh-perms small">
          {t('visitors.youMay', {
            kinds: permsToShow(perms)
              .map((k) => t(`visitors.kind.${k}`))
              .join(', '),
          })}
        </p>
      ) : null}
    </>
  );
  return (
    <>
      <ContractsPanel money={money} />
      <WorldHud
        extra={extra}
        barHidden={compact && sheetOpen}
        onAsk={(kind, at, item, target) => {
          const world = worldSession.worldId;
          if (world !== null)
            worldActs.submit(world, {
              kind,
              at,
              ...(item !== undefined ? { item } : {}),
              ...(target !== undefined ? { target } : {}),
            });
        }}
      />
    </>
  );
}
