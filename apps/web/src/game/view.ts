/**
 * The seam between the world's logic and how it is drawn (P16.3, ADR-052).
 * `WorldController` (controller.ts) owns movement, paths, sitting, prompts and positions; a
 * renderer (the 2.5D Three.js view, World3DView) implements
 * `WorldView` and draws what the controller decides.
 */
import type { Cell } from '@agora/shared';

export interface WorldView {
  /** Draw the planned walking path (an empty list clears it). */
  drawPath(path: readonly Cell[]): void;
  /** Play the teleport transition and call `land` at its darkest point (at once under reduced motion). */
  teleport(land: () => void): void;
  /** Look at a world point for a moment, then follow me again (the People list's "locate"). */
  panTo(x: number, y: number): void;
  /** Make sure the camera follows my avatar (cheap to call every frame). */
  followMe(): void;
  /** Where a character (ADR-042) is drawn now, if it is drawn at all. */
  npcPosition(id: string): { x: number; y: number } | undefined;
  /** Build mode owns the pointer and the camera while it is on. */
  readonly buildActive: boolean;
}

/**
 * Renderer-neutral hooks for the e2e tests (`window.__agora.view`). The 2.5D views implement them,
 * so the specs do not depend on the renderer's internals.
 */
export interface ViewTestApi {
  readonly engine: '2d' | '2.5d'; // narrowed to '2.5d' in P16.21, with view2d
  /** Page (CSS px) point where a world pixel is drawn. */
  toClient(x: number, y: number): { x: number; y: number };
  /** Centre the camera on a world pixel. */
  centerOn(x: number, y: number): void;
  zoom(): number;
  setZoom(z: number): void;
  /** Texts drawn in the world (names, bubbles, labels); only the visible ones by default. */
  texts(all?: boolean): string[];
  /** Placed props currently drawn (P9.16). */
  propsCount(): number;
  /** Page point (CSS px) at the middle of a placed prop's drawn sprite; null when not drawn. */
  propScreen(id: string): { x: number; y: number } | null;
  /** The ADR-037 variant key of a furniture cell in this view (null: drawn with its plain tile). */
  blendKeyAt(cx: number, cy: number): string | null;
  /** Cells the build preview changes right now (0 when none is shown). */
  previewCells(): number;
  /** The view has drawn its region and has nothing pending. */
  settled(): boolean;
  /** A person's current frame: `<dir>-<walk frame>`, `sit-<dir>` or `crouch-<dir>`; null when not drawn. */
  avatarFrame(id: string): string | null;
  /** Pets (ADR-040) drawn and visible now. */
  petsDrawn(): number;
}

export function exposeTestApi(api: ViewTestApi | null): void {
  const w = window as unknown as { __agora?: Record<string, unknown> };
  if (w.__agora) w.__agora.view = api ?? undefined;
}
