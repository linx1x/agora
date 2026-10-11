import { useStore } from '../../state/store';
import { worldActs } from '../actLink';
import { worldSession } from '../session';
import { WorldHud } from './WorldHud';

/** The HUD while the person is in a world, and nothing in the office (which has its own controls). */
export function WorldHudInWorld() {
  const inWorld = useStore((s) => s.worldId !== null);
  if (!inWorld) return null;
  return (
    <WorldHud
      onAsk={(kind, at, item, target) => {
        const world = worldSession.worldId;
        if (world !== null) worldActs.submit(world, { kind, at, ...(item !== undefined ? { item } : {}), ...(target !== undefined ? { target } : {}) });
      }}
    />
  );
}
