import type { WorldCell } from '@agora/shared';

export type Habitat = 'meadow' | 'jungle' | 'desert' | 'taiga';
export function habitatOf(cell: Pick<WorldCell, 'block' | 'decor'>): Habitat | null {
  for (const id of ['meadow', 'jungle', 'desert', 'taiga'] as const)
    if (cell.block.startsWith(`${id}_`)) return id;
  return null;
}
/** Cosmetic wildlife can never cross a cliff, building, planted field or water cell. */
export function safeWildlifeStep(
  read: (x: number, z: number) => WorldCell,
  planted: (x: number, z: number) => boolean,
  from: { x: number; z: number },
  to: { x: number; z: number },
  level: number,
): boolean {
  const count = Math.max(1, Math.ceil(Math.hypot(to.x - from.x, to.z - from.z) * 5));
  for (let i = 0; i <= count; i++) {
    const x = Math.floor(from.x + ((to.x - from.x) * i) / count),
      z = Math.floor(from.z + ((to.z - from.z) * i) / count);
    const c = read(x, z);
    if (!c.walkable || c.liquid || c.decor || c.level !== level || planted(x, z) || !habitatOf(c))
      return false;
  }
  return true;
}
