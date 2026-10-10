// Spike tests: `npx vitest run --config spikes/world25d/vitest.config.ts` from the repo root.
import { defineConfig } from 'vitest/config';
import { resolve } from 'node:path';
const here = import.meta.dirname;
export default defineConfig({
  resolve: { alias: { '@agora/shared': resolve(here, '../../packages/shared/src/index.ts') } },
  test: { root: here, include: ['src/**/*.test.ts'], reporters: ['dot'] },
});
