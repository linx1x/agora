import { useEffect, useRef } from 'react';
import Phaser from 'phaser';
import { WorldScene } from './WorldScene';
import { installInput } from './input';
import { loadSheets } from './sprites';

export function GameView() {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    installInput();
    let game: Phaser.Game | null = null;
    let cancelled = false;
    void loadSheets().then(() => {
      if (cancelled || !ref.current) return;
      game = start(ref.current);
    });
    return () => {
      cancelled = true;
      game?.destroy(true);
    };
  }, []);
  return <div ref={ref} className="world-canvas" aria-hidden="true" />;
}

function start(parent: HTMLDivElement): Phaser.Game {
  {
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
    return game;
  }
}
