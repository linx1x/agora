import { defineConfig } from '@playwright/test';

/** Focused production-art run without optional voice or passkey services. */
const port = 3323 + (Number(process.env.E2E_PORT_OFFSET ?? 0) || 0);

export default defineConfig({
  testDir: '.',
  testMatch: 'world-art.spec.ts',
  workers: 1,
  reporter: 'line',
  timeout: 180_000,
  use: {
    baseURL: `http://localhost:${port}`,
    launchOptions: {
      executablePath: process.env.PW_CHROMIUM || undefined,
      args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'],
    },
  },
  webServer: {
    command: 'node apps/server/dist/index.js',
    cwd: '..',
    url: `http://localhost:${port}/healthz`,
    reuseExistingServer: false,
    timeout: 90_000,
    env: {
      PORT: String(port),
      NODE_ENV: 'test',
      AUTH_DEV_LOGIN: 'true',
      DATABASE_URL: '',
      LOG_LEVEL: 'warn',
      BUILDER_IDS: 'dev-alice',
      FEATURE_FLAGS: 'worlds=true',
    },
  },
});
