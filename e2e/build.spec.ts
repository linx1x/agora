import { expect, test, type Browser, type Page } from '@playwright/test';

/* eslint-disable @typescript-eslint/no-explicit-any */
const T = 32;

async function enter(browser: Browser, devUser: number): Promise<Page> {
  const ctx = await browser.newContext();
  await ctx.addInitScript(() =>
    localStorage.setItem(
      'agora.settings',
      JSON.stringify({ lighting: false, sounds: false, autoSit: true, precheck: false }),
    ),
  );
  const page = await ctx.newPage();
  page.on('pageerror', (e) => console.log(`[pageerror ${devUser}]`, e.message));
  await page.goto('/?hour=13');
  await page
    .getByRole('button', { name: ['Alice Tremblay', 'Benoît Gagnon', 'Chloé Roy'][devUser]! })
    .click();
  const enterBtn = page
    .getByRole('dialog')
    .getByRole('button', { name: /Entrer dans Agora|Enter Agora/ });
  await Promise.race([enterBtn.click().catch(() => {}), page.locator('.control-bar').waitFor()]);
  await page.waitForFunction(() => {
    const w = window as any;
    const s = w.__agora.store.get();
    return s.conn === 'online' && !!s.me && w.__agora.rendered.has(s.me);
  });
  return page;
}

/** Furniture tile gid at a global cell, as this client sees it. */
const furnAt = (p: Page, cx: number, cy: number) =>
  p.evaluate(
    ([x, y]) => {
      const m = (window as any).__agora.store.get().map;
      return m.layers.furniture[y * m.width + x] as number;
    },
    [cx, cy] as const,
  );

/** Screen point of a cell centre through the world camera. */
async function screenOf(p: Page, cx: number, cy: number) {
  const pt = await p.evaluate(
    ([x, y]) => {
      const cam = (window as any).__agoraGame.scene.getScene('world').cameras.main;
      const r = (
        document.querySelector('.world-canvas canvas') as HTMLCanvasElement
      ).getBoundingClientRect();
      return {
        x: r.left + (x * 32 + 16 - cam.worldView.x) * cam.zoom,
        y: r.top + (y * 32 + 16 - cam.worldView.y) * cam.zoom,
      };
    },
    [cx, cy] as const,
  );
  return pt;
}

/** Centre the build camera on a cell. */
const look = (p: Page, cx: number, cy: number) =>
  p.evaluate(
    ([x, y]) =>
      (window as any).__agoraGame.scene
        .getScene('world')
        .cameras.main.centerOn(x * 32 + 16, y * 32 + 16),
    [cx, cy] as const,
  );

test('build mode: a builder places and erases decor live, others see it, undo works', async ({
  browser,
}) => {
  test.setTimeout(180_000); // two clients composing blended tiles on software WebGL
  const alice = await enter(browser, 0); // dev-alice is in BUILDER_IDS
  const ben = await enter(browser, 1);

  // Only builders get the build button.
  await expect(ben.getByRole('button', { name: /Mode construction|Build mode/ })).toHaveCount(0);
  await alice.getByRole('button', { name: /Mode construction|Build mode/ }).click();
  await expect(
    alice.getByRole('complementary', { name: /Mode construction|Build mode/ }),
  ).toBeVisible();

  // Reception floor in the Atrium, open and away from the desk and spawn.
  const cx = 36 + 6;
  const cy = 45;
  expect(await furnAt(alice, cx, cy)).toBe(0);
  await look(alice, cx, cy);
  await alice.getByRole('option', { name: /Plante A|Plant A/ }).click();
  let pt = await screenOf(alice, cx, cy);
  await alice.mouse.click(pt.x, pt.y);
  await expect.poll(() => furnAt(ben, cx, cy)).toBeGreaterThan(0);
  await expect.poll(() => furnAt(alice, cx, cy)).toBeGreaterThan(0);
  // the new plant collides for everyone
  expect(
    await ben.evaluate(
      ([x, y]) => {
        const m = (window as any).__agora.store.get().map;
        return m.solid[y * m.width + x];
      },
      [cx, cy] as const,
    ),
  ).toBe(1);

  // Drag a short row
  pt = await screenOf(alice, cx, cy + 2);
  const end = await screenOf(alice, cx + 3, cy + 2);
  await alice.mouse.move(pt.x, pt.y);
  await alice.mouse.down();
  await alice.mouse.move(end.x, end.y, { steps: 6 });
  await alice.mouse.up();
  for (let i = 0; i <= 3; i++)
    await expect.poll(() => furnAt(ben, cx + i, cy + 2)).toBeGreaterThan(0);

  // Undo removes the row, redo brings it back
  await alice.keyboard.press('Control+z');
  for (let i = 0; i <= 3; i++) await expect.poll(() => furnAt(ben, cx + i, cy + 2)).toBe(0);
  await alice.keyboard.press('Control+Shift+z');
  await expect.poll(() => furnAt(ben, cx + 3, cy + 2)).toBeGreaterThan(0);

  // Right-click erases
  pt = await screenOf(alice, cx, cy);
  await alice.mouse.click(pt.x, pt.y, { button: 'right' });
  await expect.poll(() => furnAt(ben, cx, cy)).toBe(0);

  // Desk pods are locked: the server refuses and nothing changes
  const chair = await alice.evaluate(() => {
    const m = (window as any).__agora.store.get().map;
    return m.desks[0]?.chair ?? null;
  });
  if (chair) {
    const before = await furnAt(ben, chair.cx, chair.cy);
    await look(alice, chair.cx, chair.cy);
    pt = await screenOf(alice, chair.cx, chair.cy);
    await alice.mouse.click(pt.x, pt.y, { button: 'right' });
    await alice.waitForTimeout(300);
    expect(await furnAt(ben, chair.cx, chair.cy)).toBe(before);
  }

  // Reset to the generated map: everyone reloads it (also leaves the server clean for other specs)
  const genBefore = await ben.evaluate(() => (window as any).__agora.store.get().mapGen);
  await alice
    .getByRole('button', { name: /Revenir à la carte générée|Reset to generated map/ })
    .click();
  await alice
    .getByRole('dialog')
    .getByRole('button', { name: /Réinitialiser|Reset/ })
    .click();
  await expect
    .poll(() => ben.evaluate(() => (window as any).__agora.store.get().mapGen))
    .toBeGreaterThan(genBefore);
  await expect.poll(() => furnAt(ben, cx + 3, cy + 2)).toBe(0);
  await alice.waitForFunction(() => !!(window as any).__agora.store.get().build);

  // Esc leaves build mode
  await alice.keyboard.press('Escape');
  await expect(alice.locator('.build-panel')).toHaveCount(0);
  await alice.context().close();
  await ben.context().close();
  // let the server drop the held seats (reconnect grace) so later specs start alone
  await new Promise((r) => setTimeout(r, 21_000));
  void T;
});

/** Gid on any layer at a global cell, as this client sees it. */
const tileAt = (p: Page, l: string, cx: number, cy: number) =>
  p.evaluate(
    ([layer, x, y]) => {
      const m = (window as any).__agora.store.get().map;
      return (m.layers[layer]?.[(y as number) * m.width + (x as number)] ?? 0) as number;
    },
    [l, cx, cy] as const,
  );
/** Blend cache key of a furniture cell on this client (null: plain tile). */
const blendKey = (p: Page, cx: number, cy: number) =>
  p.evaluate(
    ([x, y]) => {
      const sc = (window as any).__agoraGame.scene.getScene('world');
      const m = (window as any).__agora.store.get().map;
      return sc.blend?.keyAt('f', y * m.width + x) ?? null;
    },
    [cx, cy] as const,
  );

test('blended tiles (P9.10–P9.12): joining previews, merges for everyone; props rest on surfaces', async ({
  browser,
}) => {
  test.setTimeout(180_000); // two clients composing blended tiles on software WebGL
  const alice = await enter(browser, 0);
  const ben = await enter(browser, 1);
  for (const p of [alice, ben])
    await p.waitForFunction(() => {
      const sc = (window as any).__agoraGame.scene.getScene('world');
      return !!sc.blend && !sc.blend.busy;
    });

  await alice.getByRole('button', { name: /Mode construction|Build mode/ }).click();
  await alice.waitForFunction(() => !!(window as any).__agora.store.get().build);

  // Atrium bench row (40..42, 4): a table at its open end joins it.
  const [bx, by] = [43, 4];
  expect(await furnAt(alice, bx, by)).toBe(0);
  expect(await blendKey(ben, 42, by)).not.toBeNull();
  const before = await blendKey(ben, 42, by);
  await look(alice, bx, by + 3);
  await alice.getByRole('option', { name: /^Table$/ }).click();
  let pt = await screenOf(alice, bx, by);
  await alice.mouse.move(pt.x, pt.y);
  // the preview shows the joined row before anything is sent
  await expect
    .poll(() =>
      alice.evaluate(
        () => (window as any).__agoraGame.scene.getScene('world').build.preview.changed.length,
      ),
    )
    .toBeGreaterThan(1);
  expect(await furnAt(ben, bx, by)).toBe(0);
  await alice.mouse.click(pt.x, pt.y);
  await expect.poll(() => furnAt(ben, bx, by)).toBeGreaterThan(0);
  // Ben's client merged it: the new cell and its neighbour have new blended variants
  await expect.poll(() => blendKey(ben, bx, by)).not.toBeNull();
  await expect.poll(() => blendKey(ben, 42, by)).not.toBe(before);

  // Props: a desk lamp on the meeting-room table rests on it, for everyone.
  const [tx, ty] = [41, 14];
  await look(alice, tx, ty);
  await alice.getByRole('tab', { name: /Accessoires|Desk items/ }).click();
  await alice.getByRole('option', { name: /Lampe de bureau|Desk lamp/ }).click();
  pt = await screenOf(alice, tx, ty);
  await alice.mouse.click(pt.x, pt.y);
  await expect.poll(() => tileAt(ben, 'props', tx, ty)).toBeGreaterThan(0);
  await expect
    .poll(() =>
      ben.evaluate(() => (window as any).__agoraGame.scene.getScene('world').propsView.count),
    )
    .toBe(1);
  // a prop on bare floor is refused by the server
  pt = await screenOf(alice, tx, ty + 4);
  await alice.mouse.click(pt.x, pt.y);
  await alice.waitForTimeout(400);
  expect(await tileAt(ben, 'props', tx, ty + 4)).toBe(0);
  // the eraser takes the prop first, then the table
  pt = await screenOf(alice, tx, ty);
  await alice.mouse.click(pt.x, pt.y, { button: 'right' });
  await expect.poll(() => tileAt(ben, 'props', tx, ty)).toBe(0);
  expect(await furnAt(ben, tx, ty)).toBeGreaterThan(0);

  // leave the server clean for other specs
  await alice
    .getByRole('button', { name: /Revenir à la carte générée|Reset to generated map/ })
    .click();
  await alice
    .getByRole('dialog')
    .getByRole('button', { name: /Réinitialiser|Reset/ })
    .click();
  await expect.poll(() => furnAt(ben, bx, by)).toBe(0);
  await alice.context().close();
  await ben.context().close();
  await new Promise((r) => setTimeout(r, 21_000));
});
