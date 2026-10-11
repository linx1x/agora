import { useEffect, useRef } from 'react';
import Phaser from 'phaser';
import { WorldScene } from './WorldScene';
import { WorldRoomScene } from '../worlds/view2d/WorldRoomScene';
import { installInput } from './input';
import { loadSheets } from './sprites';
import { chooseEngine, readStoredView, rememberView, rememberViewFromUrl } from '../game3d/engine';
import { store, toast, useStore } from '../state/store';

export function GameView() {
  const ref = useRef<HTMLDivElement>(null);
  const world25d = useStore((s) => s.config?.flags.world25d === true);
  const choice = useStore((s) => s.viewChoice);
  // 2.5D (P16.6) when the flag and this device ask for it, build mode included (P16.13).
  // A choice made in this session (Settings, or the automatic switch to 2D) wins.
  const engine = chooseEngine({ world25d }, location.search, readStoredView(), choice);
  // P17.14: inside a personal world the world view replaces the office view (a remount). P17.15: the
  // world has its own 2.5D view, the same engine choice as the office.
  // a cave (P17.32) is another world: a new id remounts the view, so its terrain and walker start fresh
  const worldKey = useStore((s) => s.worldId);
  const inWorld = worldKey !== null;

  useEffect(() => {
    installInput();
    rememberViewFromUrl(location.search);
  }, []);

  useEffect(() => {
    let cancelled = false;
    let unmount: (() => void) | undefined;
    void loadSheets().then(async () => {
      if (cancelled || !ref.current) return;
      const stop = inWorld
        ? engine === '2.5d'
          ? await start25dWorld(ref.current)
          : start2d(ref.current, WorldRoomScene)
        : engine === '2.5d'
          ? await start25d(ref.current)
          : start2d(ref.current, WorldScene);
      if (cancelled) stop();
      else unmount = stop;
    });
    return () => {
      cancelled = true;
      unmount?.();
    };
  }, [engine, inWorld, worldKey]);

  return <div ref={ref} className="world-canvas" aria-hidden="true" />;
}

/** Returns the teardown. The office and a personal world are two scenes; one is in the game at a time. */
function start2d(parent: HTMLDivElement, scene: typeof WorldScene | typeof WorldRoomScene): () => void {
  const game = new Phaser.Game({
    type: Phaser.AUTO,
    parent,
    pixelArt: true,
    roundPixels: true,
    backgroundColor: '#1b2733',
    scale: { mode: Phaser.Scale.RESIZE, width: '100%', height: '100%' },
    scene: [scene],
    banner: false,
    audio: { noAudio: true },
    input: { keyboard: false },
  });
  (window as unknown as { __agoraGame?: Phaser.Game }).__agoraGame = game;
  return () => game.destroy(true);
}

/**
 * Three.js is loaded only when the 2.5D view is chosen (its own chunk). A device that cannot start
 * it (no WebGL, or the chunk fails to load) gets the 2D view: remembered, with a toast (P16.11).
 */
async function start25d(parent: HTMLDivElement): Promise<() => void> {
  return start25dOr2d(parent, async () => {
    const { World3DView } = await import('../game3d/World3DView');
    return new World3DView(parent);
  });
}

/** The 2.5D view of a personal world (P17.15), its own chunk like the office's. */
async function start25dWorld(parent: HTMLDivElement): Promise<() => void> {
  return start25dOr2d(parent, async () => {
    const { WorldRoom3DView } = await import('../worlds/view3d/WorldRoom3DView');
    return new WorldRoom3DView(parent);
  });
}

/**
 * Start a 2.5D view, or fall back to 2D when it cannot start (no WebGL, or the chunk fails to load):
 * the choice is remembered and the device gets a toast (P16.11, P17.15).
 */
async function start25dOr2d(
  parent: HTMLDivElement,
  make: () => Promise<{ destroy(): void }>,
): Promise<() => void> {
  try {
    const view = await make();
    return () => view.destroy();
  } catch {
    // a half-built canvas must not stay under the 2D game
    parent.replaceChildren();
    rememberView('2d');
    store.set({ viewChoice: '2d' });
    toast('toast.worldViewNoGpu', undefined, 9000);
    return () => {};
  }
}
