import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import '@fontsource/atkinson-hyperlegible/400.css';
import '@fontsource/atkinson-hyperlegible/700.css';
import './i18n';
import './styles.css';
import { App } from './App';
import { setHeld } from './game/input';
import { store } from './state/store';
import { rendered } from './game/WorldScene';
import { world } from './net/client';
import { media } from './media/MediaManager';

// Test/automation hooks (no data leaves the page).
(window as unknown as Record<string, unknown>).__agora = { store, setHeld, rendered };
(window as unknown as Record<string, unknown>).__agoraWorld = world;
(window as unknown as Record<string, unknown>).__agoraMedia = media;

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
