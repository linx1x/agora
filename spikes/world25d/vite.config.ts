/**
 * P16.1 / P16.2 spike (ADR-052). Reuses the app's tile art (apps/web/src/game) and shared map code.
 * `npm run dev` serves index.html (menu), three.html, phaser.html and stills.html.
 * `PAGE=three SINGLE=1 npm run build` makes one self-contained HTML page (for phones).
 */
import { defineConfig } from 'vite';
import { resolve } from 'node:path';
import { viteSingleFile } from 'vite-plugin-singlefile';

const here = import.meta.dirname;
const root = resolve(here, '../..');
const page = process.env.PAGE;
const single = process.env.SINGLE === '1';

export default defineConfig({
  root: here,
  // relative URLs so a split build can be served from any folder (the benchmark artifact)
  base: './',
  publicDir: false,
  resolve: {
    alias: {
      '@agora/shared': resolve(root, 'packages/shared/src/index.ts'),
      '@web': resolve(root, 'apps/web/src'),
      zod: resolve(here, 'node_modules/zod'),
    },
  },
  server: { port: 5190, fs: { allow: [root] } },
  plugins: single ? [viteSingleFile()] : [],
  build: {
    outDir: single ? `dist-single/${page}` : process.env.OUT ?? 'dist',
    emptyOutDir: true,
    assetsInlineLimit: single || process.env.OUT ? 100_000_000 : 4096,
    chunkSizeWarningLimit: 4000,
    rollupOptions: {
      input: page
        ? { [page]: resolve(here, `${page}.html`) }
        : {
            index: resolve(here, 'index.html'),
            three: resolve(here, 'three.html'),
            phaser: resolve(here, 'phaser.html'),
            stills: resolve(here, 'stills.html'),
          },
    },
  },
});
