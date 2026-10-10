import { defineConfig } from 'vitest/config';

// The root config only picks up packages/, apps/ and scripts/; run with
// `pnpm vitest run --config spikes/npc-brain/vitest.config.ts`.
export default defineConfig({
  test: { root: import.meta.dirname, include: ['src/**/*.test.ts'] },
});
