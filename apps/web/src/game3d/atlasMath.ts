/**
 * The texture atlas of one region in the 2.5D view (P16.12, ADR-052): which blended variants get
 * a slot, and which frame of an animated tile shows. Pure, so the rules are unit-tested; the
 * canvas work is in `meshes.ts`.
 */

/**
 * Blended variants one region can hold in the atlas. A region of a wing has a few dozen distinct
 * neighbourhoods; the rest draw their base tile, so a huge region cannot push the atlas past the
 * texture size of a phone.
 */
export const MAX_BLEND = 128;

export interface BlendSlot {
  /** the ADR-037 cache key (`g|…` ground, `f|…` furniture) */
  key: string;
  kind: 'g' | 'f';
  /** a cell that has this key: its neighbourhood gives the composed pixels */
  cx: number;
  cy: number;
  /** the slot index in the blend section of the atlas */
  slot: number;
}

/**
 * The distinct blend keys of a region, in first-seen order, one slot each up to `cap`. Faces
 * whose key has no slot draw their base tile. `slotOf` answers a face's key.
 */
export function blendSlots(
  faces: readonly { blend?: string; cx: number; cy: number }[],
  cap = MAX_BLEND,
): { slots: BlendSlot[]; slotOf: Map<string, number> } {
  const slots: BlendSlot[] = [];
  const slotOf = new Map<string, number>();
  for (const f of faces) {
    const key = f.blend;
    if (!key || slotOf.has(key) || slots.length >= cap) continue;
    const slot = slots.length;
    slotOf.set(key, slot);
    slots.push({ key, kind: key.startsWith('f|') ? 'f' : 'g', cx: f.cx, cy: f.cy, slot });
  }
  return { slots, slotOf };
}

/**
 * The frame of an animated tile at `ms` (its `fps` frames a second, looping). Reduced motion holds
 * the first frame, as the 2D view does.
 */
export function animFrame(ms: number, fps: number, frames: number, reduced: boolean): number {
  if (reduced || frames <= 1 || fps <= 0 || !Number.isFinite(ms)) return 0;
  return Math.floor((ms / 1000) * fps) % frames;
}
