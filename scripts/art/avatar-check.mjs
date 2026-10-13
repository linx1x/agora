/** Run after pnpm build. Isolated memory server; does not touch the running app or saved accounts. */
import { spawn } from 'node:child_process';
import { mkdir, readFile } from 'node:fs/promises';
import assert from 'node:assert/strict';
import { chromium } from '@playwright/test';

const output = 'test-results/avatar';
await mkdir(output, { recursive: true });
const port = 3359,
  url = `http://127.0.0.1:${port}`;
const server = spawn(process.execPath, ['apps/server/dist/index.js'], {
  windowsHide: true,
  env: {
    ...process.env,
    PORT: String(port),
    NODE_ENV: 'test',
    AUTH_DEV_LOGIN: 'true',
    AUTH_MODE: 'dev',
    DATABASE_URL: '',
    LOG_LEVEL: 'warn',
    MAP_SAVE_PATH: '',
    NPC_DIR: '',
    FEATURE_FLAGS: 'worlds=true',
  },
  stdio: ['ignore', 'pipe', 'pipe'],
});
let browser,
  log = '';
server.stdout.on('data', (d) => (log += d));
server.stderr.on('data', (d) => (log += d));
try {
  const deadline = Date.now() + 30000;
  while (
    !(await fetch(`${url}/healthz`).then(
      (r) => r.ok,
      () => false,
    ))
  ) {
    if (server.exitCode !== null || Date.now() > deadline) throw new Error(log);
    await new Promise((r) => setTimeout(r, 200));
  }
  browser = await chromium.launch({ channel: process.env.ART_REVIEW_BROWSER ?? 'msedge' });
  const context = await browser.newContext({
    viewport: { width: 1400, height: 1000 },
    locale: 'en-CA',
    reducedMotion: 'reduce',
  });
  await context.addInitScript(() => {
    localStorage.setItem('agora.lang', 'en');
    localStorage.setItem(
      'agora.settings',
      JSON.stringify({ lighting: false, sounds: false, precheck: false }),
    );
  });
  const page = await context.newPage(),
    errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(url);
  await page.getByRole('button', { name: 'Alice Tremblay' }).click();
  await Promise.race([
    page
      .getByRole('button', { name: 'Enter Agora', exact: true })
      .click()
      .catch(() => {}),
    page.locator('.control-bar').waitFor(),
  ]);
  await page.waitForFunction(() => {
    const s = window.__agora?.store.get();
    return s?.conn === 'online' && s.profiles[s.me];
  });
  // A deterministic legacy profile exercises the upgrade path through the real editor.
  await page.evaluate(() => {
    const store = window.__agora.store,
      s = store.get();
    store.set({
      profiles: {
        ...s.profiles,
        [s.me]: {
          ...s.profiles[s.me],
          avatar: {
            skin: 2,
            hair: 0,
            hairColor: 1,
            top: 1,
            bottom: 0,
            accessory: 0,
          },
        },
      },
      dialog: 'avatar',
    });
  });
  const dialog = page.getByRole('dialog'),
    preview = page.getByTestId('avatar-paper-preview');
  await preview.waitFor();
  const original = await preview.getAttribute('src');
  const dirs = new Set([original]);
  for (let i = 0; i < 4; i++) {
    await page.getByTestId('avatar-turn').click();
    dirs.add(await preview.getAttribute('src'));
  }
  assert.equal(dirs.size, 4);
  assert.equal(await preview.getAttribute('src'), original);
  await dialog.screenshot({ path: `${output}/editor-character.png` });
  const next = async (label) => {
    const before = await preview.getAttribute('src');
    await dialog
      .getByRole('group', { name: label, exact: true })
      .getByRole('button', { name: `Next ${label}`, exact: true })
      .click();
    assert.notEqual(await preview.getAttribute('src'), before, `${label} changes the live artwork`);
  };
  await next('Gender');
  await next('Hair style');
  await next('Skin tone');
  await next('Hair colour');
  await dialog.getByRole('button', { name: 'Clothing', exact: true }).click();
  for (const label of [
    'Top style',
    'Top colour',
    'Bottom style',
    'Bottom colour',
    'Shoes',
    'Shoe colour',
    'Vest',
    'Vest colour',
  ])
    await next(label);
  await dialog.screenshot({ path: `${output}/editor-clothing.png` });
  await dialog.getByRole('button', { name: 'Details', exact: true }).click();
  for (const label of ['Accessory', 'Belt', 'Buckle', 'Costume']) await next(label);
  await dialog.screenshot({ path: `${output}/editor-details.png` });
  const savedImage = await preview.getAttribute('src');
  await dialog.getByRole('button', { name: 'Save', exact: true }).click();
  await page.waitForFunction(() => {
    const s = window.__agora.store.get();
    return s.profiles[s.me].avatar.costume === 1;
  });
  const saved = await page.evaluate(() => {
    const s = window.__agora.store.get();
    return s.profiles[s.me].avatar;
  });
  for (const field of [
    'gender',
    'topStyle',
    'bottomStyle',
    'shoes',
    'shoeColor',
    'vest',
    'vestColor',
    'belt',
    'buckle',
    'costume',
  ])
    assert.equal(saved[field], 1);
  await page.reload();
  await page.waitForFunction(() => {
    const s = window.__agora?.store.get();
    return s?.conn === 'online' && s.profiles[s.me]?.avatar.costume === 1;
  });
  await page.evaluate(() => window.__agora.store.set({ dialog: 'avatar' }));
  await preview.waitFor();
  assert.equal(
    await preview.getAttribute('src'),
    savedImage,
    'saved appearance survives reload and reconnect',
  );
  await page.setViewportSize({ width: 390, height: 844 });
  await dialog.getByRole('button', { name: 'Clothing', exact: true }).click();
  assert.equal(
    await dialog.evaluate((el) => el.scrollWidth <= el.clientWidth),
    true,
    'mobile wardrobe has no horizontal overflow',
  );
  await dialog.screenshot({ path: `${output}/editor-mobile.png` });
  // Every available action can be previewed; pausing freezes the currently displayed pose.
  await page.setViewportSize({ width: 1400, height: 1000 });
  const chooser = dialog.getByLabel('Preview action');
  const clips = await chooser
    .locator('option')
    .evaluateAll((options) => options.map((option) => option.value));
  for (const clip of clips.filter((clip) => !['stand', 'sit', 'crouch'].includes(clip))) {
    await chooser.selectOption(clip);
    const first = await preview.getAttribute('src');
    await page.waitForFunction(
      (before) => document.querySelector('[data-testid="avatar-paper-preview"]').src !== before,
      first,
      { timeout: 2500 },
    );
  }
  await chooser.selectOption('chop');
  await dialog.getByRole('button', { name: 'Pause', exact: true }).click();
  const paused = await preview.getAttribute('src');
  await page.waitForTimeout(250);
  assert.equal(await preview.getAttribute('src'), paused, 'Pause holds its frame');
  await dialog.screenshot({ path: `${output}/editor-animation.png` });
  await page.setViewportSize({ width: 390, height: 844 });
  assert.equal(
    await dialog.evaluate((el) => el.scrollWidth <= el.clientWidth),
    true,
    'animated mobile preview fits',
  );
  await page.setViewportSize({ width: 1400, height: 1000 });
  await page.evaluate(() => window.__agora.store.set({ dialog: null }));
  // The real office emote response drives body animation, even under reduced motion.
  await page.evaluate(() => window.__agoraWorld.send({ t: 'emote', emote: 'clap' }));
  await page.waitForFunction(() =>
    window.__agora.view.avatarFrame(window.__agora.store.get().me)?.startsWith('clap-'),
  );

  // As in world-art.spec.ts, feed a disposable scene through the production receive handler.
  const generator = JSON.parse(await readFile('packages/shared/data/worlds/worldgen.json', 'utf8'));
  await page.evaluate((gen) => {
    const ws = window.__agoraWorld.ws,
      receive = ws.onmessage,
      state = window.__agora.store.get();
    window.__avatarReceive = (msg) =>
      receive.call(ws, new MessageEvent('message', { data: JSON.stringify(msg) }));
    ws.onmessage = () => {};
    window.__avatarReceive({
      t: 'world:welcome',
      worldId: 'avatar-animation-fixture',
      owner: 'Animation review',
      mine: true,
      you: state.me,
      seed: 3560865791,
      genVersion: gen.genVersion,
      params: gen.params,
      people: [
        {
          id: state.me,
          name: 'Alice',
          avatar: state.profiles[state.me].avatar,
          x: 528,
          y: 560,
          d: 'down',
        },
        {
          id: 'animation-peer',
          name: 'Animation preview',
          avatar: state.profiles[state.me].avatar,
          x: 560,
          y: 560,
          d: 'right',
        },
      ],
    });
    const delta = {};
    for (let y = 0; y < 32; y++)
      for (let x = 0; x < 32; x++)
        delta[y * 32 + x] = { level: 1, block: 'meadow_grass', decor: '' };
    window.__avatarReceive({ t: 'world:chunks', add: [{ cx: 0, cy: 0, rev: 1, delta }], drop: [] });
  }, generator);
  await page.waitForFunction(
    () =>
      window.__agora.view?.world?.().id === 'avatar-animation-fixture' &&
      window.__agora.view.avatarFrame('animation-peer'),
  );
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  const worldActions = clips.filter(
    (clip) =>
      ![
        'stand',
        'walk',
        'sit',
        'crouch',
        'idle',
        'talk',
        'sitDown',
        'standUp',
        'wave',
        'thumbs',
        'heart',
        'laugh',
        'hand',
        'clap',
      ].includes(clip),
  );
  for (const kind of worldActions) {
    await page.evaluate(
      (kind) =>
        window.__avatarReceive({
          t: 'world:action',
          id: 'animation-peer',
          kind,
          dir: 'right',
          at: { x: 18, y: 17 },
          ...(['till', 'water', 'chop', 'mine', 'raise', 'lower', 'remove'].includes(kind)
            ? { tier: 1, speed: 1 }
            : {}),
        }),
      kind,
    );
    await page.waitForFunction(
      (kind) => window.__agora.view.avatarFrame('animation-peer')?.startsWith(kind + '-'),
      kind,
    );
  }
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.evaluate(() =>
    window.__avatarReceive({
      t: 'world:action',
      id: 'animation-peer',
      kind: 'sleep',
      dir: 'right',
    }),
  );
  await page.waitForFunction(
    () => window.__agora.view.avatarFrame('animation-peer') === 'sleep-right-3',
  );
  await page.waitForTimeout(300);
  assert.equal(
    await page.evaluate(() => window.__agora.view.avatarFrame('animation-peer')),
    'sleep-right-3',
    'reduced motion uses a still action pose',
  );
  await page.screenshot({ path: `${output}/actions-in-world.png` });

  assert.deepEqual(errors, []);
  console.log(
    'Wardrobe passed: saved looks, all action previews, pause, mobile, live emotes, all 21 world actions, reduced motion, no browser errors.',
  );
} finally {
  await browser?.close();
  server.kill();
}
