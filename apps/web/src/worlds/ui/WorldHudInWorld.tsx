import { useStore } from '../../state/store';
import { useCompactLayout } from '../../ui/layout';
import { worldActs } from '../actLink';
import { worldSession } from '../session';
import { WorldHud } from './WorldHud';

/** The HUD while the person is in a world, and nothing in the office (which has its own controls). */
export function WorldHudInWorld() {
  const inWorld = useStore((s) => s.worldId !== null);
  // P17.15c: on a phone the People / Chat sheet covers the bottom of the screen; the hotbar steps aside
  const sheetOpen = useStore((s) => s.panelOpen);
  const compact = useCompactLayout();
  if (!inWorld) return null;
  return (
    <WorldHud
      barHidden={compact && sheetOpen}
      onAsk={(kind, at, item, target) => {
        const world = worldSession.worldId;
        if (world !== null) worldActs.submit(world, { kind, at, ...(item !== undefined ? { item } : {}), ...(target !== undefined ? { target } : {}) });
      }}
    />
  );
}
