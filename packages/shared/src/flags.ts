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
  /** Phase 9c (ADR-039): Select tool, free (Alt) placement, stretch handles, stacking, flip */
  placement: true,
  /** ADR-040: the office cat (and later personal cats); off until Vincent approves the art (checkpoint F) */
  pets: false,
  /** ADR-042: server-run characters (Zoé, Félix, Théo); off until checkpoint G. Spaces: NPC_SPACES */
  npcs: false,
  /** P15.4 (ADR-045): talking with the characters (the Talk box); needs `npcs` */
  npcTalk: false,
  /** P15.5 (ADR-046): characters remember people (summaries, "Forget me"); needs `npcTalk` */
  npcMemory: false,
  /** P15.5 (ADR-046): moods and characters chatting with each other when someone is listening; needs `npcs` */
  npcSocial: false,
  /** P15.6 (ADR-048): characters' replies can be heard (a voice service on the operator's machine); needs `npcTalk` */
  npcVoice: false,
  /** P15.8 (ADR-049): characters may search the public web (your own SearXNG) for some questions; needs `npcTalk` and a cloud model */
  npcWeb: false,
  /** Phase 17 (ADR-053): personal worlds behind desks (procedural biomes, farming, economy); off until checkpoint O */
  worlds: false,
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
