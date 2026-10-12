import { chromium } from '@playwright/test';
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';

const biomeIds = ['meadow', 'jungle', 'desert', 'taiga'];
const output = 'art-src/review/biomes';
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ channel: process.env.ART_REVIEW_BROWSER ?? 'msedge' });
const errors = [];
const captureErrors = (page) => {
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text());
  });
};
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  captureErrors(page);
  await page.goto('http://localhost:5173/art-review.html');
  await page.waitForFunction(() => window.__biomeReview?.ready, { timeout: 60000 });
  const snapshot = () => page.evaluate(() => window.__biomeReview.snapshot());
  const select = async (id) => {
    await page.locator('#biome-select').selectOption(id);
    await page.waitForFunction((expected) => {
      const state = window.__biomeReview.snapshot();
      return state.biome === expected && !state.loading;
    }, id);
  };
  const choices = await page.locator('#biome-select option').evaluateAll((options) => options.map((o) => o.value));
  assert.deepEqual(new Set(choices), new Set(['studio', ...biomeIds]));

  // Inspect the exact extracted sprites consumed by the renderer, not only raw PNG metadata.
  const artwork = await page.evaluate(async () => {
    const { BIOME_DEFINITIONS, loadBiomeArt } = await import('/src/artReview/biomes/catalog.ts');
    const problems = [];
    const counts = [];
    for (const definition of BIOME_DEFINITIONS) {
      const art = await loadBiomeArt(definition.id);
      const inspect = (canvas, label) => {
        const pixels = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data;
        let clear = 0, solid = 0;
        for (let i = 3; i < pixels.length; i += 4) {
          if (pixels[i] === 0) clear++;
          if (pixels[i] > 128) solid++;
        }
        if (solid < 30 || clear < pixels.length / 4 * 0.08) problems.push(`${label}: empty sprite or missing transparency`);
      };
      art.props.forEach((canvas, i) => inspect(canvas, `${definition.id}/prop/${i}`));
      art.animals.forEach((frames, i) => {
        if (frames.length !== 4) problems.push(`${definition.id}/animal/${i}: expected four poses`);
        frames.forEach((canvas, frame) => inspect(canvas, `${definition.id}/animal/${i}/${frame}`));
        if (new Set(frames.map((canvas) => canvas.toDataURL())).size !== 4)
          problems.push(`${definition.id}/animal/${i}: duplicate animation poses`);
      });
      counts.push({ id: definition.id, props: art.props.length, animals: art.animals.length });
    }
    return { problems, counts };
  });
  assert.deepEqual(artwork.problems, [], 'all props and every animal pose contain distinct artwork with clear alpha');
  assert.equal(artwork.counts.length, 4);

  const encounteredKinds = new Set();
  for (const id of biomeIds) {
    await select(id);
    let state = await snapshot();
    assert.ok(state.propCount >= 6, `${id} contains biome vegetation and terrain props`);
    assert.ok(state.animals.length >= 3, `${id} contains several animal species`);
    for (const animal of state.animals) encounteredKinds.add(animal.kind);
    assert.ok(state.waterDepth > 0, `${id} has depth-aware water`);
    for (const animal of state.animals) {
      assert.equal(animal.position.length, 3);
      assert.ok(animal.position.every(Number.isFinite), `${id}/${animal.id} has a finite grounded position`);
      assert.ok(animal.frame >= 0 && animal.frame < 4);
    }

    if (!state.paused) await page.locator('#biome-pause').click();
    assert.equal((await snapshot()).paused, true);
    const samples = [];
    for (const time of [2, 2.18, 2.36, 5, 9, 14, 23]) {
      await page.evaluate((value) => window.__biomeReview.seek(value), time);
      samples.push(await snapshot());
    }
    assert.ok(samples.some((sample) => sample.animals.some((animal, i) => animal.frame !== samples[0].animals[i].frame)), `${id} advances animal animation frames`);
    assert.ok(samples.some((sample) => sample.animals.some((animal, i) => animal.position.some((v, axis) => v !== samples[0].animals[i].position[axis]))), `${id} animals move through their habitat`);
    const frozen = (await snapshot()).time;
    await page.waitForTimeout(180);
    assert.equal((await snapshot()).time, frozen, `${id} pause freezes scene time`);

    const farmIndex = state.animals.findIndex((animal) => animal.kind === 'farm');
    const selectedIndex = farmIndex >= 0 ? farmIndex : 0;
    await page.locator('#biome-animal-select').selectOption(String(selectedIndex));
    const beforeFeed = Number((await snapshot()).animals[selectedIndex].fed);
    await page.locator('#biome-feed').click();
    assert.ok(Number((await snapshot()).animals[selectedIndex].fed) > beforeFeed, `${id} feeding records selected animal interaction`);
    assert.equal((await snapshot()).animals[selectedIndex].state, 'feeding');
    assert.equal(await page.locator('#biome-feedback').isVisible(), true);
    assert.ok((await page.locator('#biome-feedback').innerText()).trim().length > 4);
    const beforePet = Number((await snapshot()).animals[selectedIndex].petted);
    await page.locator('#biome-pet').click();
    const afterPet = (await snapshot()).animals[selectedIndex];
    if (farmIndex >= 0) {
      assert.ok(Number(afterPet.petted) > beforePet, `${id} petting records selected farm animal interaction`);
      assert.equal(afterPet.state, 'content');
    } else {
      assert.equal(Number(afterPet.petted), beforePet, `${id} wildlife observation does not record a farm petting interaction`);
      assert.equal(afterPet.state, 'watching');
    }
    assert.ok((await page.locator('#biome-feedback').innerText()).trim().length > 4);

    state = await snapshot();
    await page.locator('#biome-dusk').click();
    assert.equal((await snapshot()).dusk, !state.dusk, `${id} lighting switches`);
    if ((await snapshot()).dusk) await page.locator('#biome-dusk').click();
    await page.evaluate(() => {
      window.__biomeReview.seek(7.5);
      document.querySelector('.inspector')?.scrollTo(0, 0);
      scrollTo(0, 0);
    });
    await page.screenshot({ path: `${output}/${id}-scene.png`, fullPage: true });
  }
  assert.ok(encounteredKinds.has('farm') && encounteredKinds.has('wild'), 'complete collection includes farm animals and wildlife');

  await page.setViewportSize({ width: 390, height: 844 });
  for (const id of biomeIds) {
    await select(id);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, `${id} mobile has no horizontal overflow`);
    assert.equal(await page.locator('#biome-animal-select').isVisible(), true);
  }
  await page.screenshot({ path: `${output}/biome-mobile.png`, fullPage: true });
  await select('studio');
  assert.equal(await page.evaluate(() => window.__artReview?.ready), true, 'approved plant studio remains available');

  const reduced = await browser.newPage({ viewport: { width: 1280, height: 900 }, reducedMotion: 'reduce' });
  captureErrors(reduced);
  await reduced.goto('http://localhost:5173/art-review.html');
  await reduced.waitForFunction(() => window.__biomeReview?.ready, { timeout: 60000 });
  await reduced.locator('#biome-select').selectOption('taiga');
  await reduced.waitForFunction(() => {
    const state = window.__biomeReview.snapshot();
    return state.biome === 'taiga' && !state.loading;
  });
  const before = await reduced.evaluate(() => window.__biomeReview.snapshot());
  assert.equal(before.paused, true, 'reduced motion starts biome animation paused');
  await reduced.waitForTimeout(180);
  assert.equal(await reduced.evaluate(() => window.__biomeReview.snapshot().time), before.time);
  await reduced.close();
  assert.deepEqual(errors, [], 'no browser runtime or console errors');
  console.log(`Biome review passed: ${artwork.counts.map((b) => `${b.id} (${b.props} props, ${b.animals} species)`).join(', ')}; alpha, distinct poses, habitat movement, feeding/petting, pause, dusk, studio return, mobile and reduced motion.`);
} finally {
  await browser.close();
}
