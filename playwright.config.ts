import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { defineConfig } from '@playwright/test';

const PORT = 3123;
/** second server in AUTH_MODE=passkey; its owner setup link lands in SETUP_LINK_FILE */
export const PASSKEY_PORT = 3124;
// One file per run (workers inherit the env), outside test-results/ which Playwright empties.
process.env.AGORA_E2E_RUN ??= `${Date.now()}-${process.pid}`;
export const SETUP_LINK_FILE = join(tmpdir(), `agora-e2e-setup-${process.env.AGORA_E2E_RUN}.txt`);
/**
 * Media backend under test (ADR-031): set LIVEKIT_BIN to a livekit-server binary to run
 * the suite against a real LiveKit in --dev mode; without it the P2P fallback is tested.
 */
const LIVEKIT_BIN = process.env.LIVEKIT_BIN;
const LK_PORT = 7880;
const livekitEnv = LIVEKIT_BIN
  ? {
      LIVEKIT_URL: `ws://127.0.0.1:${LK_PORT}`,
      LIVEKIT_API_KEY: 'devkey',
      LIVEKIT_API_SECRET: 'secret',
    }
  : {};
export default defineConfig({
  testDir: 'e2e',
  timeout: 60_000,
  fullyParallel: false,
  workers: 1,
  use: {
    baseURL: `http://localhost:${PORT}`,
    viewport: { width: 1280, height: 800 },
    locale: 'fr-CA',
    launchOptions: {
      executablePath: process.env.PW_CHROMIUM || undefined,
      args: [
        '--use-fake-ui-for-media-stream',
        '--use-fake-device-for-media-stream',
        '--autoplay-policy=no-user-gesture-required',
      ],
    },
    permissions: ['camera', 'microphone'],
  },
  webServer: [
    ...(LIVEKIT_BIN
      ? [
          {
            command: `${LIVEKIT_BIN} --dev --bind 127.0.0.1 --port ${LK_PORT}`,
            url: `http://127.0.0.1:${LK_PORT}`,
            reuseExistingServer: false,
            stderr: 'ignore' as const,
          },
        ]
      : []),
    {
      command: `node apps/server/dist/index.js`,
      url: `http://localhost:${PORT}/healthz`,
      reuseExistingServer: false,
      env: {
        PORT: String(PORT),
        AUTH_DEV_LOGIN: 'true',
        NODE_ENV: 'test',
        LOG_LEVEL: 'warn',
        BUILDER_IDS: 'dev-alice',
        ...livekitEnv,
      },
    },
    // Invite-only accounts with passkeys (e2e/auth.spec.ts)
    {
      command: `node apps/server/dist/index.js`,
      url: `http://localhost:${PASSKEY_PORT}/healthz`,
      reuseExistingServer: false,
      env: {
        PORT: String(PASSKEY_PORT),
        NODE_ENV: 'test',
        LOG_LEVEL: 'warn',
        AUTH_MODE: 'passkey',
        SESSION_SECRET: 'e2e-passkey-secret-0123456789abcdef',
        SETUP_LINK_FILE: SETUP_LINK_FILE,
        ...livekitEnv,
      },
    },
  ],
});
