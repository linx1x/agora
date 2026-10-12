import { readFileSync } from 'node:fs';
import { expect, test, type Page } from '@playwright/test';
import type { ChunkDelta, PlotState, S2CMsg } from '@agora/shared';

/* eslint-disable @typescript-eslint/no-explicit-any */
/** Production renderer coverage. Fixtures enter through the real receive handler, without
 * writing a player's saved world or replacing WorldRoom3DView with the art-review scene. */
const generator = JSON.parse(readFileSync('packages/shared/data/worlds/worldgen.json', 'utf8'));
const crops: { id: string; stages: number[] }[] = JSON.parse(
  readFileSync('packages/shared/data/worlds/crops.json', 'utf8'),
).crops;
const biomes = [
  { id: 'meadow', ground: 'meadow_grass', tree: 'oak_tree', plants: ['tall_grass', 'flower'] },
  { id: 'jungle', ground: 'jungle_grass', tree: 'jungle_tree', plants: ['fern', 'fern'] },
  { id: 'desert', ground: 'desert_sand', tree: 'palm', plants: ['cactus', 'dead_bush'] },
  { id: 'taiga', ground: 'taiga_moss', tree: 'spruce', plants: ['spruce', 'spruce'] },
];

async function deliver(page: Page, message: S2CMsg) {
  await page.evaluate((msg) => (window as any).__worldArtReceive(msg), message);
}

function terrain(biome: (typeof biomes)[number]): ChunkDelta {
  const delta: ChunkDelta = {};
  for (let y = 0; y < 32; y++) {
    for (let x = 0; x < 32; x++) {
      delta[String(y * 32 + x)] = { level: 1, block: biome.ground, decor: '' };
    }
  }
  const put = (x: number, y: number, patch: ChunkDelta[string]) => {
    delta[String(y * 32 + x)] = { ...delta[String(y * 32 + x)], ...patch };
  };
  for (const [x, y] of [
    [10, 12],
    [14, 11],
    [20, 12],
    [22, 17],
  ])
    put(x!, y!, { decor: biome.tree });
  for (let x = 10; x < 23; x += 2) put(x, 14, { decor: biome.plants[(x / 2) % 2]! });
  for (let y = 16; y <= 20; y++)
    for (let x = 21; x <= 24; x++) put(x, y, { block: 'water', decor: '', level: 0 });
  put(11, 19, { decor: 'bed', bedAxis: 'vertical' });
  put(13, 19, { decor: 'bed', bedAxis: 'horizontal' });
  put(15, 19, { decor: 'workbench' });
  put(18, 19, { decor: 'torch' });
  put(18, 15, { decor: 'coop' });
  put(20, 15, { decor: 'barn' });
  if (biome.id === 'taiga') for (let x = 10; x <= 23; x++) put(x, 10, { block: 'taiga_snow' });
  return delta;
}

function plots(crop: (typeof crops)[number]): Record<string, PlotState> {
  return Object.fromEntries(
    Array.from({ length: 5 }, (_, stage) => [
      `${12 + stage},16`,
      {
        tilled: true,
        wateredOn: stage % 2 ? 2 : 0,
        sprinkler: null,
        fertilizer: null,
        crop: {
          crop: crop.id,
          stage,
          daysInStage: 0,
          ripe: stage === 4,
          regrowLeft: null,
          stages: crop.stages,
          fertilizer: null,
        },
      },
    ]),
  );
}

test('approved artwork renders in playable worlds across four biomes, crops and livestock', async ({
  browser,
}, testInfo) => {
  test.setTimeout(180_000);
  const context = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    locale: 'en-CA',
  });
  const page = await context.newPage();
  const errors: string[] = [];
  const loadedArt = new Set<string>();
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => {
    if (message.type() === 'error' && /THREE|shader|WebGL/i.test(message.text()))
      errors.push(message.text());
  });
  page.on('response', (response) => {
    if (response.url().includes('/assets/art-review/') && response.status() === 200)
      loadedArt.add(response.url());
  });
  await context.addInitScript(() =>
    localStorage.setItem(
      'agora.settings',
      JSON.stringify({
        lighting: false,
        sounds: false,
        autoSit: false,
        precheck: false,
      }),
    ),
  );
  try {
    await page.goto('/?hour=13');
    await page.getByRole('button', { name: 'Alice Tremblay' }).click();
    await Promise.race([
      page
        .getByRole('dialog')
        .getByRole('button', { name: /Entrer dans Agora|Enter Agora/ })
        .click()
        .catch(() => {}),
      page.locator('.control-bar').waitFor(),
    ]);
    await page.waitForFunction(() => {
      const a = (window as any).__agora;
      return a?.store.get().conn === 'online' && a.rendered.has(a.store.get().me);
    });
    await page.evaluate((gen) => {
      const ws = (window as any).__agoraWorld.ws as WebSocket;
      const receive = ws.onmessage!;
      const state = (window as any).__agora.store.get();
      const send = (message: unknown) =>
        receive.call(ws, new MessageEvent('message', { data: JSON.stringify(message) }));
      (window as any).__worldArtReceive = send;
      ws.onmessage = () => {};
      send({
        t: 'world:welcome',
        worldId: 'world-art-fixture',
        owner: 'Alice Tremblay',
        mine: true,
        you: state.me,
        seed: 3560865791,
        genVersion: gen.genVersion,
        params: gen.params,
        people: [
          {
            id: state.me,
            name: 'Alice Tremblay',
            avatar: state.profiles[state.me].avatar,
            x: 528,
            y: 560,
            d: 'down',
          },
        ],
      });
    }, generator);
    await deliver(page, {
      t: 'world:chunks',
      add: [{ cx: 0, cy: 0, rev: 1, delta: terrain(biomes[0]!) }],
      drop: [],
    });
    await deliver(page, {
      t: 'world:time',
      time: { day: 2, year: 1, season: 'spring', dayOfSeason: 2, hour: 13, minute: 0 },
      weather: { day: 2, today: 'clear', tomorrow: 'cloudy' },
    });
    await deliver(page, {
      t: 'world:farm',
      day: 2,
      plots: plots(crops[0]!),
      animals: [
        { id: 'art-hen', animal: 'plume_hen', cell: '18,15', fedOn: 2, progress: 0, pending: 1 },
        {
          id: 'art-sheep',
          animal: 'cloud_sheep',
          cell: '20,15',
          fedOn: 2,
          progress: 1,
          pending: 0,
        },
        { id: 'art-cow', animal: 'milk_cow', cell: '20,15', fedOn: 2, progress: 0, pending: 0 },
        { id: 'art-goat', animal: 'rune_goat', cell: '20,15', fedOn: 2, progress: 0, pending: 0 },
      ],
      machines: [],
    });
    await page.waitForFunction(
      () => (window as any).__agora.view?.world?.().id === 'world-art-fixture',
    );
    await page.evaluate(() => {
      const a = (window as any).__agora;
      a.store.set({ panelOpen: false });
      a.view.centerOn(16 * 32, 16 * 32);
      a.view.setZoom(1.4);
    });
    await page.waitForFunction(() => {
      const view = (window as any).__agora.view;
      return view.settled() && view.art().ready && view.art().wildlife.ready;
    });
    await expect.poll(() => loadedArt.size).toBeGreaterThan(10);
    const art = await page.evaluate(() => (window as any).__agora.view.art());
    expect(art.atlasSize[0]).toBeGreaterThan(0);
    expect(art.atlasSize[1]).toBeGreaterThan(0);
    expect(art.shadows).toBeGreaterThan(0);
    await testInfo.attach('production-art.json', {
      body: JSON.stringify(art, null, 2),
      contentType: 'application/json',
    });
    for (const [index, biome] of biomes.entries()) {
      await deliver(page, {
        t: 'world:chunks',
        add: [{ cx: 0, cy: 0, rev: index + 2, delta: terrain(biome) }],
        drop: [],
      });
      await page.waitForFunction((ground) => {
        const view = (window as any).__agora.view;
        return view.settled() && view.cellInfo(16, 17).block === ground;
      }, biome.ground);
      await page.waitForTimeout(700);
      const biomeArt = await page.evaluate(() => (window as any).__agora.view.art());
      expect(biomeArt.wildlife.count).toBeGreaterThan(0);
      await testInfo.attach(`${biome.id}-art.json`, {
        body: JSON.stringify(biomeArt, null, 2),
        contentType: 'application/json',
      });
      await page.screenshot({ path: testInfo.outputPath(`world-art-${biome.id}.png`) });
      expect(
        await page.evaluate(() => {
          const view = (window as any).__agora.view;
          return [
            view.walkableAt(16, 17),
            view.walkableAt(10, 12),
            view.walkableAt(22, 19),
            view.cellInfo(15, 19).decor,
          ];
        }),
      ).toEqual([true, false, false, 'workbench']);
    }
    for (const crop of crops) {
      await deliver(page, { t: 'world:farm', day: 2, plots: plots(crop) });
      await page.waitForFunction((id) => {
        const view = (window as any).__agora.view;
        return view.settled() && view.cellInfo(12, 16).plot.crop.crop === id;
      }, crop.id);
      expect(
        await page.evaluate(() =>
          Array.from({ length: 5 }, (_, stage) => {
            const crop = (window as any).__agora.view.cellInfo(12 + stage, 16).plot.crop;
            return [crop.stage, crop.ripe];
          }),
        ),
      ).toEqual([
        [0, false],
        [1, false],
        [2, false],
        [3, false],
        [4, true],
      ]);
    }
    // Real click projection still addresses the same world cells after oversized art is installed.
    // Nearby empty-hand clicks intentionally try harvesting; choose a point beyond action reach.
    const target = await page.evaluate(() =>
      (window as any).__agora.view.toClient(16 * 32 + 16, 22 * 32 + 16 - 12),
    );
    await page.mouse.click(target.x, target.y);
    await page
      .waitForFunction(
        () => {
          const state = (window as any).__agora.view.world();
          return state.cell.cx === 16 && state.cell.cy === 22 && state.path === 0;
        },
        undefined,
        { timeout: 10_000 },
      )
      .catch(async (error) => {
        await page.screenshot({ path: testInfo.outputPath('world-art-pointer-failure.png') });
        const detail = await page.evaluate(
          (target) => ({
            target,
            hit: document.elementFromPoint(target.x, target.y)?.outerHTML.slice(0, 500),
            world: (window as any).__agora.view.world(),
            art: (window as any).__agora.view.art(),
            prompt: (window as any).__agora.store.get().prompt,
          }),
          target,
        );
        await testInfo.attach('pointer-failure.json', {
          body: JSON.stringify(detail, null, 2),
          contentType: 'application/json',
        });
        throw error;
      });
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.setViewportSize({ width: 390, height: 844 });
    await page.waitForTimeout(500);
    await page.screenshot({ path: testInfo.outputPath('world-art-mobile.png') });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
    expect(errors).toEqual([]);
  } finally {
    await context.close();
  }
});
