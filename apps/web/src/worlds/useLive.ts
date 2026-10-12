/**
 * The live environment of `use.ts` (P17.21c): the session's terrain and world, the HUD's item in
 * hand and panels, and the tab's action queue. Each world view builds one per input, so the input
 * reads what is current at the moment it happens. Only the view supplies the swing and the toast.
 */
import { loadGameData, type CellRef } from '@agora/shared';
import { worldActs } from './actLink';
import { worldSession } from './session';
import { worldHud } from './ui/hudState';
import type { UseEnv } from './use';

export function liveUse(
  swing: (at: CellRef, tier: number, speed: number) => void,
  toast: (key: string) => void,
): UseEnv {
  return {
    world: worldSession.worldId,
    hand: worldHud.get().inHand,
    bedAxis: worldHud.get().bedAxis,
    data: loadGameData(),
    cellAt: (cx, cy) => worldSession.terrain?.cellAt(cx, cy),
    submit: (world, act) => {
      worldActs.submit(world, act);
    },
    openPanel: (panel) => worldHud.openPanel(panel),
    swing,
    toast,
  };
}
