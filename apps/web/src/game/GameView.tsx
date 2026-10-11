import { useEffect, useRef } from 'react';
import Phaser from 'phaser';
import { WorldScene } from './WorldScene';
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

  useEffect(() => {
    installInput();
    rememberViewFromUrl(location.search);
  }, []);

  useEffect(() => {
    let cancelled = false;
    let unmount: (() => void) | undefined;
    void loadSheets().then(async () => {
      if (cancelled || !ref.current) return;
      const stop = engine === '2.5d' ? await start25d(ref.current) : start2d(ref.current);
      if (cancelled) stop();
      else unmount = stop;
    });
    return () => {
      cancelled = true;
      unmount?.();
    };
  }, [engine]);

  return <div ref={ref} className="world-canvas" aria-hidden="true" />;
}

/** Returns the teardown. */
function start2d(parent: HTMLDivElement): () => void {
  const game = new Phaser.Game({
    type: Phaser.AUTO,
    parent,
    pixelArt: true,
    roundPixels: true,
    backgroundColor: '#1b2733',
    scale: { mode: Phaser.Scale.RESIZE, width: '100%', height: '100%' },
    scene: [WorldScene],
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
  try {
    const { World3DView } = await import('../game3d/World3DView');
    const view = new World3DView(parent);
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
