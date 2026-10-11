import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { defineConfig } from '@playwright/test';

/**
 * E2E_PORT_OFFSET shifts every port below, so several checkouts (parallel worktrees) can run
 * the suite at the same time. Default 0 keeps the usual ports.
 */
const OFF = Number(process.env.E2E_PORT_OFFSET ?? 0) || 0;
const PORT = 3123 + OFF;
/** second server in AUTH_MODE=passkey; its owner setup link lands in SETUP_LINK_FILE */
export const PASSKEY_PORT = 3124 + OFF;
/** the server of the `2.5d` project: its own process, so its in-memory state starts fresh (see below) */
const VIEW_25D_PORT = 3125 + OFF;
// One file per run (workers inherit the env), outside test-results/ which Playwright empties.
process.env.AGORA_E2E_RUN ??= `${Date.now()}-${process.pid}`;
export const SETUP_LINK_FILE = join(tmpdir(), `agora-e2e-setup-${process.env.AGORA_E2E_RUN}.txt`);
/**
 * Media backend under test (ADR-031): set LIVEKIT_BIN to a livekit-server binary to run
 * the suite against a real LiveKit in --dev mode; without it the P2P fallback is tested.
 */
/**
 * Character voices (P15.6): the fake voice of apps/ml (beeps, no model) when python3 and ffmpeg are
 * there; e2e/npcs.spec.ts skips the voice test otherwise.
 */
const VOICE_PORT = 8793 + OFF;
const has = (cmd: string, args: string[]) => spawnSync(cmd, args, { stdio: 'ignore' }).status === 0;
const VOICE_E2E = has('python3', ['--version']) && has('ffmpeg', ['-version']);
process.env.AGORA_E2E_VOICE = VOICE_E2E ? '1' : '';
const LIVEKIT_BIN = process.env.LIVEKIT_BIN;
const LK_PORT = 7880 + OFF;
const livekitEnv = LIVEKIT_BIN
  ? {
      LIVEKIT_URL: `ws://127.0.0.1:${LK_PORT}`,
      LIVEKIT_API_KEY: 'devkey',
      LIVEKIT_API_SECRET: 'secret',
    }
  : {};
/**
 * The dev-login server the specs play against. The server keeps its state (people, desk pods,
 * positions) in memory for as long as it runs, so the projects that share a server would see each
 * other's people: the `2.5d` project has a server of its own.
 */
const devServer = (port: number) => ({
  command: `node apps/server/dist/index.js`,
  url: `http://localhost:${port}/healthz`,
  reuseExistingServer: false,
  env: {
    PORT: String(port),
    AUTH_DEV_LOGIN: 'true',
    NODE_ENV: 'test',
    LOG_LEVEL: 'warn',
    BUILDER_IDS: 'dev-alice',
    // the office cat is off by default until its art is approved (ADR-040);
    // the characters (ADR-042) at a fixed hour so their schedule puts them in the office
    FEATURE_FLAGS:
      'pets=true,npcs=true,npcTalk=true,npcMemory=true,npcSocial=true,npcVoice=true,world25d=true',
    ...(VOICE_E2E ? { NPC_VOICE_URL: `http://127.0.0.1:${VOICE_PORT}` } : {}),
    // a stand-in for the cloud model: its replies start with "(fake)" (P15.4)
    NPC_LLM_PROVIDER: 'fake',
    NPC_CLOCK: '10:30',
    ...livekitEnv,
  },
});

export default defineConfig({
  testDir: 'e2e',
  // One progress line instead of one line per test when output is piped (agent runs).
  reporter: process.stdout.isTTY ? 'list' : 'line',
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
  // The specs written for both world views (world, mobile, media) run once in each (P16.12, see
  // e2e/views.ts); the 2.5D-only specs (world25d*) run in the default `2d` project as before.
  projects: [
    { name: '2d' },
    {
      name: '2.5d',
      testMatch: /(world|mobile|media)\.spec\.ts$/,
      use: { baseURL: `http://localhost:${VIEW_25D_PORT}` },
    },
  ],
  webServer: [
    ...(VOICE_E2E
      ? [
          {
            command: `python3 -m agora_ml.server --fake --voice fake --port ${VOICE_PORT}`,
            cwd: 'apps/ml',
            url: `http://127.0.0.1:${VOICE_PORT}/health`,
            reuseExistingServer: false,
            stderr: 'ignore' as const,
          },
        ]
      : []),
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
    devServer(PORT),
    devServer(VIEW_25D_PORT),
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
