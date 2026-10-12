import { chromium } from '@playwright/test';
import assert from 'node:assert/strict';

const browser = await chromium.launch({ channel: process.env.ART_REVIEW_BROWSER ?? 'msedge' });
const errors = [];
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (e) => {
    if (e.type() === 'error') errors.push(e.text());
  });
  await page.goto('http://localhost:5173/art-review.html');
  await page.waitForFunction(() => window.__artReview?.ready, { timeout: 60000 });
  const state = () => page.evaluate(() => window.__artReview.snapshot());
  assert.equal((await state()).cropCount, 24);
  assert.equal((await state()).orchardCount, 6);
  assert.equal((await state()).seedCount, 34);
  assert.equal((await state()).harvestCount, 34);
  const audit = await page.evaluate(async () => {
    const { loadReviewArt } = await import('/src/artReview/art.ts');
    const art = await loadReviewArt();
    const failures = [];
    const inspect = (source, id) => {
      const a = source.getContext('2d').getImageData(0, 0, source.width, source.height).data;
      let opaque = 0,
        clear = 0;
      for (let i = 3; i < a.length; i += 4) {
        if (a[i] > 128) opaque++;
        if (a[i] === 0) clear++;
      }
      if (opaque < 20 || clear < (a.length / 4) * 0.12) failures.push(id);
    };
    for (const [id, stages] of [...art.crops, ...art.orchard, ...art.growth])
      stages.forEach((s, i) => inspect(s, `${id}:${i}`));
    for (const [id, seed] of art.seeds) inspect(seed, `seed:${id}`);
    for (const [id, item] of art.harvest) inspect(item, `harvest:${id}`);
    return {
      failures,
      seeds: new Set([...art.seeds.values()].map((c) => c.toDataURL())).size,
      harvest: new Set([...art.harvest.values()].map((c) => c.toDataURL())).size,
    };
  });
  assert.deepEqual(
    audit.failures,
    [],
    'every growth sprite and icon has real artwork and clear alpha',
  );
  assert.equal(audit.seeds, 34);
  assert.equal(audit.harvest, 34);
  const crops = await page
    .locator('#crop-species option')
    .evaluateAll((options) => options.map((o) => o.value));
  assert.equal(crops.length, 24);
  for (const id of crops) {
    await page.locator('#crop-species').selectOption(id);
    assert.equal((await state()).cropSpecies, id);
    for (const stage of ['0', '1', '2', '3', '4']) {
      await page.locator('#crop-growth').selectOption(stage);
      assert.deepEqual((await state()).soilStages, Array(6).fill(Number(stage)));
    }
  }
  await page.locator('#crop-growth').selectOption('-1');
  const trees = await page
    .locator('#tree-species option')
    .evaluateAll((options) => options.map((o) => o.value));
  assert.equal(trees.length, 10);
  for (const id of trees) {
    await page.locator('#tree-species').selectOption(id);
    assert.equal((await state()).treeSpecies, id);
    for (const stage of [0, 1, 2, 3]) await page.locator(`[data-stage="${stage}"]`).click();
    if (id.startsWith('orchard_')) {
      assert.equal(await page.locator('#growth-preview canvas').count(), 5);
      await page.locator('#tree-bloom').click();
      assert.equal((await state()).treeBloom, true);
      await page.locator('#tree-bloom').click();
      assert.equal((await state()).treeBloom, false);
    } else assert.equal(await page.locator('#tree-bloom').isVisible(), false);
  }
  await page.locator('#plants-open').click();
  assert.equal(await page.locator('.plant-card').count(), 34);
  await page.locator('#plant-filter').selectOption('Flowers');
  assert.equal(await page.locator('.plant-card:visible').count(), 6);
  await page.locator('#plant-filter').selectOption('Orchard trees');
  assert.equal(await page.locator('.plant-card:visible').count(), 6);
  await page
    .locator('#plant-gallery')
    .screenshot({ path: 'art-src/review/orchard-collection.png' });
  await page.locator('#plant-filter').selectOption('all');
  await page.locator('#plant-search').fill('pea');
  assert.ok((await page.locator('.plant-card:visible').count()) >= 2);
  await page.locator('#plant-search').fill('');
  await page.locator('#plant-gallery').screenshot({ path: 'art-src/review/plant-collection.png' });
  await page.getByRole('button', { name: 'Preview Sunflower', exact: true }).click();
  assert.equal((await state()).cropSpecies, 'sunflower');
  assert.equal(await page.locator('#plant-gallery').isVisible(), false);
  await page.locator('#tree-species').selectOption('orchard_apple');
  await page.locator('#crop-species').selectOption('sun_tomato');
  await page.locator('#crop-growth').selectOption('4');
  await page.evaluate(() => {
    document.querySelector('.inspector').scrollTop = 0;
    scrollTo(0, 0);
  });
  await page.screenshot({ path: 'art-src/review/botanical-scene.png', fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.locator('#plants-open').click();
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  await page.keyboard.press('Escape');
  assert.deepEqual(errors, []);
  console.log(
    'Botanical collection passed: 24 field plants × 5 stages, 10 trees, 34 unique seed packets, 34 harvest/natural icons, alpha, gallery/search/filter, orchard blossoms/fruit, mobile.',
  );
} finally {
  await browser.close();
}
