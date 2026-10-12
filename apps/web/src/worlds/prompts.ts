/**
 * What X does where a person stands in a personal world or a cave (P17.14, P17.32). Both views read
 * the same prompts from here, so they show and act on the same things. The client only asks: the
 * server checks the mouth, the cave's pad and the rights again on every step (`portal:enter`).
 */
import {
  CAVE_MOUTH_BLOCK,
  RETURN_PORTAL_ID,
  WORLD_CELL_PX,
  caveExitRect,
  caveIdOf,
  inPortal,
  isCaveId,
  type WorldTerrain,
} from '@agora/shared';
import type { Prompt } from '../state/store';
import { RETURN_RECT } from './starter';

/**
 * The prompt for the feet point `at` in the world (or cave) `worldId`, or null. A world's return pad
 * leads to the office; a cave's pad leads back to its world; a cave mouth opens its cave.
 */
export function worldPromptAt(
  worldId: string | null,
  terrain: WorldTerrain | null,
  at: { x: number; y: number },
): Prompt | null {
  if (worldId === null) return null;
  if (isCaveId(worldId)) return inPortal(caveExitRect(), at.x, at.y) ? { kind: 'caveExit' } : null;
  if (inPortal(RETURN_RECT, at.x, at.y)) return { kind: 'worldExit' };
  if (!terrain) return null;
  const x = Math.floor(at.x / WORLD_CELL_PX);
  const y = Math.floor(at.y / WORLD_CELL_PX);
  return terrain.cellAt(x, y).decor === CAVE_MOUTH_BLOCK
    ? { kind: 'cave', id: caveIdOf(worldId, x, y) }
    : null;
}

/** The `portal:enter` id that X sends for a prompt, or null when the prompt is not a portal. */
export function portalOfPrompt(prompt: Prompt | null | undefined): string | null {
  if (prompt?.kind === 'worldExit' || prompt?.kind === 'caveExit') return RETURN_PORTAL_ID;
  if (prompt?.kind === 'cave') return prompt.id;
  return null;
}
