import { spawn } from 'node:child_process';
import { readFile, writeFile, mkdir, unlink } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import ts from 'typescript';
import { chromium } from '@playwright/test';

// Run the same production assertions without Playwright's TypeScript test loader.
// Useful on Windows hosts where that loader stalls before launching any tests.
const output = resolve('art-src/review/biomes/production');
const modulePath = resolve(output, 'world-art-fixture.mjs');
await mkdir(output, { recursive: true });
const port = 3323;
const url = `http://127.0.0.1:${port}`;
const server = spawn(process.execPath, ['apps/server/dist/index.js'], {
  windowsHide: true,
  env: {
    ...process.env,
    PORT: String(port),
    NODE_ENV: 'test',
    AUTH_DEV_LOGIN: 'true',
    DATABASE_URL: '',
    LOG_LEVEL: 'warn',
    BUILDER_IDS: 'dev-alice',
    FEATURE_FLAGS: 'worlds=true',
    MAP_SAVE_PATH: '',
    NPC_DIR: '',
  },
  stdio: ['ignore', 'pipe', 'pipe'],
});
let log = '';
server.stdout.on('data', (data) => {
  log += data;
});
server.stderr.on('data', (data) => {
  log += data;
});
let browser;
try {
  const deadline = Date.now() + 60_000;
  while (true) {
    if (server.exitCode !== null) throw new Error(`Fixture server exited: ${log}`);
    if (
      await fetch(`${url}/healthz`).then(
        (r) => r.ok,
        () => false,
      )
    )
      break;
    if (Date.now() > deadline) throw new Error(`Fixture server timed out: ${log}`);
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  browser = await chromium.launch({
    executablePath:
      process.env.PW_CHROMIUM || 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
    args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'],
  });
  const jobs = [];
  const test = (_name, run) => jobs.push(run);
  test.setTimeout = () => {};
  globalThis.__worldArtTest = test;
  const source = (await readFile('e2e/world-art.spec.ts', 'utf8')).replace(
    "import { expect, test, type Page } from '@playwright/test';",
    "import { expect } from '@playwright/test';\nconst test = globalThis.__worldArtTest;",
  );
  const compiled = ts.transpileModule(source, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext },
  }).outputText;
  await writeFile(modulePath, compiled);
  await import(pathToFileURL(modulePath).href);
  const testInfo = {
    outputPath: (name) => resolve(output, name),
    attach: async (name, value) => writeFile(resolve(output, name), value.body),
  };
  for (const run of jobs)
    await run(
      { browser: { newContext: (options) => browser.newContext({ baseURL: url, ...options }) } },
      testInfo,
    );
  console.log(
    'Production world art passed: four biomes, 18 crops × five stages, four livestock, atlas, shadows, wildlife, collision, pointer navigation, mobile and reduced motion.',
  );
  console.log(output);
} finally {
  delete globalThis.__worldArtTest;
  await browser?.close();
  server.kill();
  await unlink(modulePath).catch(() => {});
}
