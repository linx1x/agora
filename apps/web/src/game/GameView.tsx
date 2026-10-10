import { useEffect, useRef } from 'react';
import Phaser from 'phaser';
import { WorldScene } from './WorldScene';
import { installInput } from './input';
import { loadSheets } from './sprites';
import { chooseEngine, readStoredView, rememberViewFromUrl } from '../game3d/engine';
import { useStore } from '../state/store';

export function GameView() {
  const ref = useRef<HTMLDivElement>(null);
  const build = useStore((s) => !!s.build);
  const world25d = useStore((s) => s.config?.flags.world25d === true);
  // 2.5D (P16.6) when the flag and this device ask for it; build mode is 2D until P16.13
  const engine = chooseEngine({ world25d }, location.search, readStoredView(), build);

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

/** Three.js is loaded only when the 2.5D view is chosen (its own chunk). */
async function start25d(parent: HTMLDivElement): Promise<() => void> {
  const { World3DView } = await import('../game3d/World3DView');
  const view = new World3DView(parent);
  return () => view.destroy();
}
