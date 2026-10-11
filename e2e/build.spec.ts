import { expect, test, type Browser, type Page } from '@playwright/test';
import { runView } from './views';

/* eslint-disable @typescript-eslint/no-explicit-any */
const T = 32;

/**
 * Runs in both world views (P16.13): the `2.5d` project sets the view on the device; every check
 * below goes through `window.__agora.view`, which both views implement.
 */
async function enter(browser: Browser, devUser: number): Promise<Page> {
  const view = runView();
  const ctx = await browser.newContext();
  await ctx.addInitScript(
    ([v]) => {
      localStorage.setItem(
        'agora.settings',
        JSON.stringify({ lighting: false, sounds: false, autoSit: true, precheck: false }),
      );
      if (v === '2.5d') localStorage.setItem('agora.worldView', v);
    },
    [view] as const,
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
  expect(await page.evaluate(() => (window as any).__agora.view.engine)).toBe(
    view === '2.5d' ? '2.5d' : '2d',
  );
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
    ([x, y]) => (window as any).__agora.view.toClient(x * 32 + 16, y * 32 + 16),
    [cx, cy] as const,
  );
  return pt;
}

/** Centre the build camera on a cell. */
const look = (p: Page, cx: number, cy: number) =>
  p.evaluate(([x, y]) => (window as any).__agora.view.centerOn(x * 32 + 16, y * 32 + 16), [
    cx,
    cy,
  ] as const);

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

/** Blend cache key of a furniture cell on this client (null: plain tile). */
const blendKey = (p: Page, cx: number, cy: number) =>
  p.evaluate(([x, y]) => (window as any).__agora.view.blendKeyAt(x, y), [cx, cy] as const);

/** Placed props (P9.16) as this client sees them. */
const propsOf = (p: Page) =>
  p.evaluate(
    () =>
      (window as any).__agora.store.get().map.props as {
        id: string;
        t: string;
        x: number;
        y: number;
        z: number;
        f: boolean;
      }[],
  );
/** Screen point in the middle of a prop's drawn sprite (null-checked: the prop must be drawn). */
async function propPoint(p: Page, id: string) {
  const pt = await p.evaluate((pid) => (window as any).__agora.view.propScreen(pid), id);
  if (!pt) throw new Error(`prop ${id} is not drawn`);
  return pt as { x: number; y: number };
}
/** Screen point of a world pixel. */
async function screenPx(p: Page, x: number, y: number) {
  return p.evaluate(([wx, wy]) => (window as any).__agora.view.toClient(wx + 0.5, wy + 0.5), [
    x,
    y,
  ] as const);
}

test('blended tiles (P9.10–P9.12): joining previews, merges for everyone; props rest on surfaces', async ({
  browser,
}) => {
  test.setTimeout(180_000); // two clients composing blended tiles on software WebGL
  const alice = await enter(browser, 0);
  const ben = await enter(browser, 1);
  for (const p of [alice, ben])
    await p.waitForFunction(() => {
      const v = (window as any).__agora.view;
      return !!v && v.settled();
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
    .poll(() => alice.evaluate(() => (window as any).__agora.view.previewCells()))
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
  await expect.poll(async () => (await propsOf(ben)).length).toBe(1);
  const lamp = (await propsOf(ben))[0]!;
  expect([Math.floor(lamp.x / T), Math.floor(lamp.y / T)]).toEqual([tx, ty]);
  await expect.poll(() => ben.evaluate(() => (window as any).__agora.view.propsCount())).toBe(1);
  // a prop on bare floor is refused
  pt = await screenOf(alice, tx, ty + 4);
  await alice.mouse.click(pt.x, pt.y);
  await alice.waitForTimeout(400);
  expect(await propsOf(ben)).toHaveLength(1);
  // the eraser takes the prop under the pointer, and leaves the table
  pt = await propPoint(alice, lamp.id);
  await alice.mouse.click(pt.x, pt.y, { button: 'right' });
  await expect.poll(async () => (await propsOf(ben)).length).toBe(0);
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

test('placement (P9.16–P9.20): several items on a desk, Alt, nudge, stack, stretch, flip, undo', async ({
  browser,
}) => {
  test.setTimeout(180_000);
  const alice = await enter(browser, 0);
  const ben = await enter(browser, 1);
  await alice.getByRole('button', { name: /Mode construction|Build mode/ }).click();
  await alice.waitForFunction(() => !!(window as any).__agora.store.get().build);
  await alice.evaluate(() => {
    (window as any).__agora.view.setZoom(3);
  });

  // a desk on open Atrium floor
  const [cx, cy] = [42, 45];
  expect(await furnAt(alice, cx, cy)).toBe(0);
  await look(alice, cx, cy);
  await alice.getByRole('option', { name: /^Bureau$|^Desk$/ }).click();
  let pt = await screenOf(alice, cx, cy);
  await alice.mouse.click(pt.x, pt.y);
  await expect.poll(() => furnAt(ben, cx, cy)).toBeGreaterThan(0);
  const X = cx * T;
  const Y = cy * T;

  // snapping: a laptop aimed left lands on the left spot, a coffee aimed right on the right one
  await alice.getByRole('tab', { name: /Accessoires|Desk items/ }).click();
  await alice.getByRole('option', { name: /^Portable$|^Laptop$/ }).click();
  pt = await screenPx(alice, X + 6, Y + 15);
  await alice.mouse.click(pt.x, pt.y);
  await alice.getByRole('option', { name: /^Café$|^Coffee$/ }).click();
  pt = await screenPx(alice, X + 26, Y + 15);
  await alice.mouse.click(pt.x, pt.y);
  await expect.poll(async () => (await propsOf(ben)).length).toBe(2);
  let props = await propsOf(ben);
  expect(props.map((p) => [p.t, p.x - X])).toEqual([
    ['prop.laptopOpen', 8],
    ['prop.coffee', 24],
  ]);

  // Alt places to the pixel
  await alice.getByRole('option', { name: /^Tisane$|^Herbal tea$/ }).click();
  pt = await screenPx(alice, X + 13, Y + 12);
  await alice.keyboard.down('Alt');
  await alice.mouse.move(pt.x, pt.y);
  await alice.mouse.click(pt.x, pt.y);
  await alice.keyboard.up('Alt');
  await expect.poll(async () => (await propsOf(ben)).length).toBe(3);
  props = await propsOf(ben);
  expect(Math.abs(props[2]!.x - (X + 13))).toBeLessThanOrEqual(1);
  expect(Math.abs(props[2]!.y - (Y + 12))).toBeLessThanOrEqual(1);

  // Select tool: click the coffee, nudge it 3 px left with the arrows, then undo
  await alice.keyboard.press('c');
  const coffee = props[1]!;
  pt = await propPoint(alice, coffee.id);
  await alice.mouse.click(pt.x, pt.y);
  await expect(alice.locator('.build-sel')).toContainText(/Café|Coffee/);
  for (let i = 0; i < 3; i++) await alice.keyboard.press('ArrowLeft');
  await expect
    .poll(async () => (await propsOf(ben)).find((p) => p.id === coffee.id)!.x)
    .toBe(coffee.x - 3);
  // (an undo pressed before the echo arrives waits for it, so this only keeps the log tidy)
  await expect
    .poll(async () => (await propsOf(alice)).find((p) => p.id === coffee.id)!.x)
    .toBe(coffee.x - 3);
  await alice.keyboard.press('Control+z');
  await expect
    .poll(async () => (await propsOf(ben)).find((p) => p.id === coffee.id)!.x)
    .toBe(coffee.x);
  // F mirrors the selected item
  await alice.keyboard.press('f');
  await expect.poll(async () => (await propsOf(ben)).find((p) => p.id === coffee.id)!.f).toBe(true);

  // a stack: books on the desk next door, a lamp aimed at their top rests on them
  await alice.keyboard.press('Escape'); // lets go of the selection, stays in build mode
  await expect(alice.locator('.build-panel')).toHaveCount(1);
  await alice.keyboard.press('q');
  await alice.getByRole('tab', { name: /Objets|Objects/ }).click();
  await alice.getByRole('option', { name: /^Bureau$|^Desk$/ }).click();
  pt = await screenOf(alice, cx + 1, cy);
  await alice.mouse.click(pt.x, pt.y);
  await expect.poll(() => furnAt(ben, cx + 1, cy)).toBeGreaterThan(0);
  await alice.getByRole('tab', { name: /Accessoires|Desk items/ }).click();
  await alice.getByRole('option', { name: /Pile de livres|Stack of books/ }).click();
  pt = await screenPx(alice, X + 32 + 16, Y + 17);
  await alice.mouse.click(pt.x, pt.y);
  await expect.poll(async () => (await propsOf(ben)).length).toBe(4);
  const books = (await propsOf(ben))[3]!;
  await alice.getByRole('option', { name: /Lampe de bureau|Desk lamp/ }).click();
  pt = await screenPx(alice, books.x, books.y - 13);
  await alice.mouse.move(pt.x, pt.y);
  await alice.mouse.click(pt.x, pt.y);
  await expect.poll(async () => (await propsOf(ben)).length).toBe(5);
  const lamp = (await propsOf(ben))[4]!;
  expect(lamp.y).toBeLessThanOrEqual(books.y);
  // drawn raised by the books' height on Ben's screen: the lamp sits above the books
  expect((await propPoint(ben, lamp.id)).y).toBeLessThan((await propPoint(ben, books.id)).y);
  if (runView() === '2d') {
    // flat view only: the exact base offset of a prop resting on a 12 px surface
    const baseY = await ben.evaluate(
      (id) =>
        (window as any).__agoraGame.scene
          .getScene('world')
          .propsView.boxes.find((b: any) => b.id === id)?.baseY,
      lamp.id,
    );
    expect(baseY).toBe(lamp.y - 12);
  }

  // stretch: select the first desk's run and lengthen it west with Shift+←
  await alice.keyboard.press('c');
  pt = await screenPx(alice, X + 16, Y + 28); // the desk's front, not an item
  await alice.mouse.click(pt.x, pt.y);
  await expect(alice.locator('.build-sel')).toContainText(/2 cases|2 cells/);
  await alice.keyboard.press('Shift+ArrowLeft');
  await expect.poll(() => furnAt(ben, cx - 1, cy)).toBeGreaterThan(0);
  await expect(alice.locator('.build-sel')).toContainText(/3 cases|3 cells/);
  // and the panel button shortens it again
  await alice
    .getByRole('button', { name: /Raccourcir par la gauche|Shorten from the left/ })
    .click();
  await expect.poll(() => furnAt(ben, cx - 1, cy)).toBe(0);

  // erasing the books' desk takes the books and the lamp; undo brings both back
  await alice.keyboard.press('e');
  pt = await screenPx(alice, X + 32 + 16, Y + 28);
  await alice.mouse.click(pt.x, pt.y);
  await expect.poll(() => furnAt(ben, cx + 1, cy)).toBe(0);
  await expect.poll(async () => (await propsOf(ben)).length).toBe(3);
  await alice.keyboard.press('Control+z');
  await expect
    .poll(async () => (await propsOf(ben)).map((p) => p.id).slice(3))
    .toEqual([books.id, lamp.id]);

  // leave the server clean for other specs
  await alice
    .getByRole('button', { name: /Revenir à la carte générée|Reset to generated map/ })
    .click();
  await alice
    .getByRole('dialog')
    .getByRole('button', { name: /Réinitialiser|Reset/ })
    .click();
  await expect.poll(async () => (await propsOf(ben)).length).toBe(0);
  await alice.context().close();
  await ben.context().close();
  await new Promise((r) => setTimeout(r, 21_000));
});

test('placement parity (P16.14): a monitor turns (R), raises (PageUp) and flips (F); a coffee lands on the middle spot', async ({
  browser,
}) => {
  test.setTimeout(180_000);
  const alice = await enter(browser, 0);
  const ben = await enter(browser, 1);
  await alice.getByRole('button', { name: /Mode construction|Build mode/ }).click();
  await alice.waitForFunction(() => !!(window as any).__agora.store.get().build);
  await alice.evaluate(() => {
    (window as any).__agora.view.setZoom(3);
  });

  // a desk on the open Atrium floor, as the placement test (which leaves it clean)
  const [cx, cy] = [42, 45];
  expect(await furnAt(alice, cx, cy)).toBe(0);
  await look(alice, cx, cy);
  await alice.getByRole('option', { name: /^Bureau$|^Desk$/ }).click();
  let pt = await screenOf(alice, cx, cy);
  await alice.mouse.click(pt.x, pt.y);
  await expect.poll(() => furnAt(ben, cx, cy)).toBeGreaterThan(0);
  const X = cx * T;
  const Y = cy * T;

  // a monitor on the left spot; select it; R turns it to its back
  await alice.getByRole('tab', { name: /Accessoires|Desk items/ }).click();
  await alice.getByRole('option', { name: /^Écran$|^Monitor$/ }).click();
  pt = await screenPx(alice, X + 6, Y + 15);
  await alice.mouse.click(pt.x, pt.y);
  await expect.poll(async () => (await propsOf(ben)).length).toBe(1);
  const monitor = (await propsOf(ben))[0]!;
  expect([monitor.t, monitor.x - X]).toEqual(['prop.monitorFront', 8]);
  await alice.keyboard.press('c');
  pt = await propPoint(alice, monitor.id);
  await alice.mouse.click(pt.x, pt.y);
  await expect(alice.locator('.build-sel')).toContainText(/Écran|Monitor/);
  await alice.keyboard.press('r');
  await expect
    .poll(async () => (await propsOf(ben)).find((p) => p.id === monitor.id)!.t)
    .toBe('prop.monitorBack');

  // PageUp raises it one px (its own raise, on the desk); F mirrors it
  await alice.keyboard.press('PageUp');
  await expect.poll(async () => (await propsOf(ben)).find((p) => p.id === monitor.id)!.z).toBe(1);
  await alice.keyboard.press('f');
  await expect
    .poll(async () => (await propsOf(ben)).find((p) => p.id === monitor.id)!.f)
    .toBe(true);

  // the middle spot: a coffee aimed at the middle of the desk lands on it
  await alice.keyboard.press('Escape'); // lets go of the selection, stays in build mode
  await alice.keyboard.press('q'); // the paint tool: the palette shows
  await alice.getByRole('tab', { name: /Accessoires|Desk items/ }).click();
  await alice.getByRole('option', { name: /^Café$|^Coffee$/ }).click();
  pt = await screenPx(alice, X + 16, Y + 15);
  await alice.mouse.click(pt.x, pt.y);
  await expect.poll(async () => (await propsOf(ben)).length).toBe(2);
  const coffee = (await propsOf(ben))[1]!;
  expect([coffee.t, coffee.x - X]).toEqual(['prop.coffee', 16]);

  // leave the server clean for other specs
  await alice
    .getByRole('button', { name: /Revenir à la carte générée|Reset to generated map/ })
    .click();
  await alice
    .getByRole('dialog')
    .getByRole('button', { name: /Réinitialiser|Reset/ })
    .click();
  await expect.poll(async () => (await propsOf(ben)).length).toBe(0);
  await alice.context().close();
  await ben.context().close();
  await new Promise((r) => setTimeout(r, 21_000));
});
