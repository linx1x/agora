import { defineConfig } from 'vitest/config';
export default defineConfig({
  test: {
    // Compact output when piped (agent runs): failures + summary only.
    reporters: process.stdout.isTTY ? ['default'] : ['dot'],
    include: ['packages/**/*.test.ts', 'apps/**/*.test.ts', 'scripts/**/*.test.ts'],
  },
});
