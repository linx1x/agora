/** Run against `pnpm dev`: node scripts/art/review-check.mjs [http://localhost:5173]. */
import { chromium } from '@playwright/test';
import { mkdir } from 'node:fs/promises';
import assert from 'node:assert/strict';

const base = process.argv[2] ?? 'http://localhost:5173';
await mkdir('test-results/art-review', { recursive: true });
const browser = await chromium.launch({ channel: process.env.ART_REVIEW_BROWSER ?? 'msedge' });
const errors = [];
try {
  const page = await browser.newPage({
    viewport: { width: 1440, height: 1000 },
    deviceScaleFactor: 1,
  });
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text());
  });
  page.on('response', (r) => {
    if (r.status() >= 400 && r.url().includes('/assets/')) errors.push(`${r.status()} ${r.url()}`);
  });
  await page.goto(`${base}/art-review.html`);
  await page.waitForFunction(() => window.__artReview?.ready, { timeout: 30000 });
  const state = () => page.evaluate(() => window.__artReview.snapshot());
  const bedRatios = await page.evaluate(async () => {
    const { buildWorldAtlas } = await import('/src/worlds/view3d/atlas3d.ts');
    const atlas = buildWorldAtlas();
    await atlas.ready;
    return ['decor:bed', 'decor:bed:horizontal'].map((name) => {
      const uv = atlas.uv(name),
        c = atlas.canvas,
        ctx = c.getContext('2d');
      const x = Math.floor(uv.u0 * c.width),
        y = Math.floor((1 - uv.vt) * c.height);
      const data = ctx.getImageData(x, y, 32, 32).data;
      let left = 32,
        right = 0,
        top = 32,
        bottom = 0;
      for (let j = 0; j < 32; j++)
        for (let i = 0; i < 32; i++)
          if (data[(j * 32 + i) * 4 + 3] > 128) {
            left = Math.min(left, i);
            right = Math.max(right, i);
            top = Math.min(top, j);
            bottom = Math.max(bottom, j);
          }
      return (right - left + 1) / (bottom - top + 1);
    });
  });
  assert.ok(
    bedRatios[0] < 0.8 && bedRatios[1] > 1.4,
    'production atlas loads separate vertical and horizontal bed views',
  );
  assert.equal((await state()).tilt, 35);
  assert.equal((await state()).mode, 'new');
  assert.equal((await state()).grounding, 'alpha-silhouette-and-contact');
  await page.locator('#animate').click();
  assert.equal((await state()).solidDepth, true);
  assert.equal((await state()).growthSpecies, 4);
  assert.ok((await state()).pondSurface < 0, 'water lies below the surrounding bank');
  assert.equal(await page.locator('#growth-preview canvas').count(), 4);
  for (const stage of [0, 1, 2, 3]) {
    await page.locator(`[data-stage="${stage}"]`).click();
    assert.equal((await state()).treeStage, stage);
    await page.waitForTimeout(80);
    await page.screenshot({ path: `test-results/art-review/growth-${stage}.png`, fullPage: true });
  }
  await page.evaluate(() => {
    scrollTo(0, 0);
    document.querySelector('.inspector').scrollTop = 0;
  });
  for (const id of ['chest', 'hub.deskMonitor', 'oak_tree']) {
    const result = await page.evaluate((id) => window.__artReview.depthProbe(id), id);
    assert.ok(result.coveredPixels > 20, `${id}: probe sees opaque sprite pixels`);
    assert.equal(result.behind, 0, `${id}: rear avatar cannot draw through the prop`);
    assert.ok(result.front > 5, `${id}: front avatar covers the prop`);
  }
  await page.screenshot({ path: 'test-results/art-review/new-art.png', fullPage: true });
  for (const species of ['dawn_radish', 'meadow_kale', 'honey_pea']) {
    await page.locator(`[data-crop="${species}"]`).click();
    assert.equal((await state()).cropSpecies, species);
    assert.equal((await state()).cropStages, 5);
    assert.equal(await page.locator('#crop-preview canvas').count(), 5);
    const coverage = await page.locator('#crop-preview canvas').evaluateAll((canvases) =>
      canvases.map((c) => {
        const pixels = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
        let count = 0;
        for (let i = 3; i < pixels.length; i += 4) if (pixels[i] >= 128) count++;
        return count;
      }),
    );
    assert.ok(
      coverage.every((n) => n > 25),
      `${species}: all five sprites contain visible artwork`,
    );
    assert.ok(
      coverage[4] > coverage[0] * 5,
      `${species}: seedlings retain their smaller natural proportions`,
    );
    const before = (await state()).cropOffsets;
    await page.waitForTimeout(220);
    assert.notDeepEqual((await state()).cropOffsets, before, `${species}: foliage moves`);
    assert.equal(new Set((await state()).cropOffsets).size, 6, 'plots do not sway in lockstep');
    await page.screenshot({ path: `test-results/art-review/crops-${species}.png`, fullPage: true });
  }
  await page.locator('#water-crops').click();
  await page.waitForTimeout(120);
  assert.equal((await state()).cropSplash, true);
  await page.screenshot({ path: 'test-results/art-review/crops-watered.png', fullPage: true });
  await page.locator('#ambience').click();
  const frozenCrops = (await state()).cropOffsets;
  await page.waitForTimeout(150);
  assert.deepEqual((await state()).cropOffsets, frozenCrops, 'pause freezes crop geometry');
  await page.locator('#ambience').click();
  await page.locator('[data-crop="dawn_radish"]').click();
  for (const stage of [0, 1, 2, 3, 4]) {
    await page.locator('#crop-growth').selectOption(String(stage));
    assert.equal((await state()).cropStage, stage);
    assert.deepEqual((await state()).soilStages, Array(6).fill(stage));
    assert.ok(
      (await state()).plantingDepths.every((n) => n > 0),
      'crop bases sit below the earth',
    );
    await page.waitForTimeout(70);
    await page.screenshot({
      path: `test-results/art-review/planted-stage-${stage}.png`,
      fullPage: true,
    });
  }
  const soilPatterns = await page.evaluate(async () => {
    const { plantedSoilTexture } = await import('/src/artReview/cropSoil.ts');
    const { groundTexture } = await import('/src/artReview/art.ts');
    const base = groundTexture('tilled_soil', 99, 'new');
    return [0, 1, 2, 3, 4].map((stage) => plantedSoilTexture(base, stage, 99).toDataURL());
  });
  assert.equal(new Set(soilPatterns).size, 5, 'five distinct soil states accompany the crop ages');
  await page.locator('#crop-growth').selectOption('-1');
  assert.deepEqual((await state()).soilStages, [0, 1, 2, 3, 4, 4]);
  await page.evaluate(() => {
    scrollTo(0, 0);
    document.querySelector('.inspector').scrollTop = 0;
  });
  const flameFrames = new Set();
  for (let i = 0; i < 8; i++) {
    await page.waitForTimeout(90);
    flameFrames.add((await state()).torchFrame);
  }
  assert.equal(flameFrames.size, 4, 'all flame textures animate');
  for (const time of [6, 18]) {
    await page.evaluate((time) => window.__artReview.seekAmbience(time), time);
    await page.waitForTimeout(60);
    assert.ok((await state()).birdStates.includes(time === 6 ? 'fly' : 'peck'));
    await page.screenshot({ path: `test-results/art-review/wildlife-${time}.png`, fullPage: true });
  }
  const stopped = (await state()).lifeTime;
  await page.waitForTimeout(180);
  assert.equal((await state()).lifeTime, stopped, 'ambient pause freezes all wildlife and flicker');
  await page.locator('#ambience').click();
  for (const axis of ['horizontal', 'vertical']) {
    await page.locator(`[data-bed="${axis}"]`).click();
    assert.equal((await state()).bedAxis, axis);
    await page.waitForTimeout(60);
    await page.screenshot({ path: `test-results/art-review/bed-${axis}.png`, fullPage: true });
  }
  await page.evaluate(() => (document.querySelector('.inspector').scrollTop = 0));
  for (const [label, z] of [
    ['behind', 6.7],
    ['front', 8.2],
  ]) {
    await page.evaluate((z) => window.__artReview.pose(4.5, z), z);
    await page.waitForTimeout(80);
    await page.screenshot({
      path: `test-results/art-review/occlusion-${label}.png`,
      fullPage: true,
    });
  }
  await page.evaluate(() => window.__artReview.pose(6.3, 6.8));
  await page.locator('#old-art').click();
  assert.equal((await state()).mode, 'old');
  await page.screenshot({ path: 'test-results/art-review/current-art.png', fullPage: true });
  await page.locator('#new-art').click();
  await page.locator('#stage canvas').focus();
  const before = await state();
  await page.keyboard.down('ArrowDown');
  await page.waitForTimeout(350);
  await page.keyboard.up('ArrowDown');
  assert.ok((await state()).position[1] > before.position[1], 'avatar moves through a free cell');
  await page.getByRole('button', { name: 'Back', exact: true }).click();
  assert.equal((await state()).direction, 'up');
  await page.locator('#animate').click();
  const frames = new Set();
  for (let i = 0; i < 9; i++) {
    await page.waitForTimeout(85);
    frames.add((await state()).frame);
  }
  assert.equal(frames.size, 4, 'all walk frames play');
  assert.ok(
    (await state()).shadowFrames >= 4,
    'moving avatar has matching shadow geometry for its frames',
  );
  await page.locator('#gallery-open').click();
  assert.equal(await page.locator('#gallery-props .gallery-item').count(), 16);
  assert.equal(await page.locator('#gallery-icons .gallery-item').count(), 8);
  await page.screenshot({ path: 'test-results/art-review/gallery.png', fullPage: true });
  await page.keyboard.press('Escape');
  assert.equal(await page.locator('#sprite-gallery').isVisible(), false);
  await page.getByRole('button', { name: 'Watering can', exact: true }).click();
  assert.match(await page.locator('#item-status').textContent(), /Watering can/);
  await page.locator('#light').click();
  assert.equal(await page.locator('#scene-time').textContent(), '6:40 PM');
  await page.screenshot({ path: 'test-results/art-review/dusk.png', fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: 'test-results/art-review/mobile.png', fullPage: true });
  assert.equal(
    await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
    true,
    'no horizontal overflow',
  );
  const reduced = await browser.newPage({
    viewport: { width: 1280, height: 900 },
    reducedMotion: 'reduce',
  });
  await reduced.goto(`${base}/art-review.html`);
  await reduced.waitForFunction(() => window.__artReview?.ready);
  assert.equal(await reduced.locator('#animate').textContent(), 'Play');
  await reduced.waitForTimeout(200);
  assert.equal(await reduced.evaluate(() => window.__artReview.snapshot().frame), 0);
  assert.equal(await reduced.evaluate(() => window.__artReview.snapshot().lifeTime), 0);
  assert.equal(await reduced.locator('#ambience').textContent(), 'Play wildlife');
  const reducedCrops = await reduced.evaluate(() => window.__artReview.snapshot().cropOffsets);
  await reduced.locator('#water-crops').click();
  await reduced.waitForTimeout(180);
  assert.deepEqual(
    await reduced.evaluate(() => window.__artReview.snapshot().cropOffsets),
    reducedCrops,
  );
  assert.equal(await reduced.evaluate(() => window.__artReview.snapshot().cropSplash), false);
  assert.deepEqual(errors, []);
  console.log(
    'Art review passed: three crops / five stages, crop motion / watering / pause, production bed atlas, both bed orientations, wildlife, flames, tree ages, water, GPU occlusion, movement, gallery, dusk, mobile and reduced motion.',
  );
} finally {
  await browser.close();
}
