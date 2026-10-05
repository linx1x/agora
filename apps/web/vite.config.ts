import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    // changeOrigin false: the server must see Host localhost:5173, the address in the
    // browser, for its same-origin check on POSTs and for passkeys (WebAuthn origin).
    // (The string shorthand would rewrite Host to the target and every POST gets 403.)
    proxy: {
      '/api': { target: 'http://127.0.0.1:3000', changeOrigin: false },
      '/healthz': { target: 'http://127.0.0.1:3000', changeOrigin: false },
      '/world': { target: 'ws://127.0.0.1:3000', ws: true, changeOrigin: false },
    },
  },
  build: { outDir: 'dist', chunkSizeWarningLimit: 2000 },
});
