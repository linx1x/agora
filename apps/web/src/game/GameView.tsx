import { useEffect, useRef } from 'react';
import { installInput } from './input';
import { loadSheets } from './sprites';
import { toast, useStore } from '../state/store';

/** The view saved by the removed 2D choice (ADR-054): nothing reads it any more, so it is taken out. */
const RETIRED_VIEW_KEY = 'agora.worldView';

/**
 * The world canvas. The office and a personal world are both drawn in 2.5D (ADR-054): the office
 * view, or the world's own view inside a world (P17.14, P17.15).
 */
export function GameView() {
  const ref = useRef<HTMLDivElement>(null);
  // a cave (P17.32) is another world: a new id remounts the view, so its terrain and walker start fresh
  const worldKey = useStore((s) => s.worldId);
  const inWorld = worldKey !== null;

  useEffect(() => {
    installInput();
    forgetRetiredView();
  }, []);

  useEffect(() => {
    let cancelled = false;
    let unmount: (() => void) | undefined;
    void loadSheets().then(async () => {
      if (cancelled || !ref.current) return;
      const stop = await (inWorld ? start25dWorld(ref.current) : start25d(ref.current));
      if (cancelled) stop();
      else unmount = stop;
    });
    return () => {
      cancelled = true;
      unmount?.();
    };
  }, [inWorld, worldKey]);

  return <div ref={ref} className="world-canvas" aria-hidden="true" />;
}

/** Three.js is loaded only when the world is drawn (its own chunk). */
async function start25d(parent: HTMLDivElement): Promise<() => void> {
  return startOrNotice(parent, async () => {
    const { World3DView } = await import('../game3d/World3DView');
    return new World3DView(parent);
  });
}

/** The 2.5D view of a personal world (P17.15), its own chunk like the office's. */
async function start25dWorld(parent: HTMLDivElement): Promise<() => void> {
  return startOrNotice(parent, async () => {
    const { WorldRoom3DView } = await import('../worlds/view3d/WorldRoom3DView');
    return new WorldRoom3DView(parent);
  });
}

/**
 * Start a 2.5D view. It needs WebGL and its chunk; when either fails there is no other view to show
 * (ADR-054), so the canvas is cleared and the device is told once. The People list still works.
 */
async function startOrNotice(
  parent: HTMLDivElement,
  make: () => Promise<{ destroy(): void }>,
): Promise<() => void> {
  try {
    const view = await make();
    return () => view.destroy();
  } catch {
    // a half-built canvas must not stay on the page
    parent.replaceChildren();
    toast('toast.worldUnavailable', undefined, 12000);
    return () => {};
  }
}

function forgetRetiredView(): void {
  try {
    localStorage.removeItem(RETIRED_VIEW_KEY);
  } catch {
    // storage blocked: nothing was saved there
  }
}
