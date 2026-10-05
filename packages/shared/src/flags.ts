/**
 * Feature flags (CLAUDE.md: each phase's features sit behind a flag).
 * Server can override at runtime with FEATURE_FLAGS="media=false,chat=true".
 */
export const DEFAULT_FLAGS = {
  /** Phase 2 */
  avatarEditor: true,
  emotes: true,
  status: true,
  /** Phase 3: LiveKit SFU, or P2P WebRTC as a fallback (ADR-009, ADR-031) */
  media: true,
  /** P7.1 screen sharing (LiveKit backend only, ADR-031) */
  screenShare: true,
  /** Phase 4 */
  chat: true,
  /** v2: desk pods, lighting, navigation */
  desks: true,
  lighting: true,
  minimap: true,
  clickToMove: true,
  /** P8.2: compact phone layout, joystick, tap-to-move on release, pinch zoom */
  touchControls: true,
  /** Later phases, not built yet */
  whiteboard: false,
  doors: false,
  /** Phase 2: several spaces and invite links (P2.3, P2.4) */
  spaces: true,
  /** Phase 9: build mode (only for BUILDER_IDS / BUILDER_CODE users) */
  builder: true,
  /** P9.10 (ADR-037): ground and joined furniture drawn from formulas instead of one tile per cell;
   *  FEATURE_FLAGS=blendTiles=false brings back the plain tiles */
  blendTiles: true,
} as const;

export type Flags = { [K in keyof typeof DEFAULT_FLAGS]: boolean };

export function parseFlags(spec: string | undefined, base: Flags = { ...DEFAULT_FLAGS }): Flags {
  const out: Flags = { ...base };
  if (!spec) return out;
  for (const part of spec.split(',')) {
    const [k, v] = part.split('=').map((s) => s.trim());
    if (k && k in out) (out as Record<string, boolean>)[k] = v !== 'false' && v !== '0';
  }
  return out;
}
