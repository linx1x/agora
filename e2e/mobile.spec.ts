/**
 * P8.2 touch controls and the compact phone layout: dock, More sheet, panel as a
 * sheet, joystick, tap-to-move on release (a drag never walks), pinch zoom, and
 * touch prompts. Real touches go through CDP so the browser makes the pointer events.
 */
import { expect, test, type Browser, type CDPSession, type Page } from '@playwright/test';

/** The pages this file opened: each is left and its context closed after its test (no ghost person in a shared space). */
const opened: Page[] = [];
test.afterEach(async () => {
  for (const p of opened.splice(0)) {
    await p
      .evaluate(() =>
        (window as unknown as { __agoraWorld?: { leave?: () => void } }).__agoraWorld?.leave?.(),
      )
      .catch(() => {});
    await p
      .context()
      .close()
      .catch(() => {});
  }
});

/* eslint-disable @typescript-eslint/no-explicit-any */
const S = (p: Page) => p.evaluate(() => (window as any).__agora.store.get());
const myPos = (p: Page) =>
  p.evaluate(() => {
    const a = (window as any).__agora;
    return a.rendered.get(a.store.get().me) as { x: number; y: number };
  });
/** Screen position (CSS px) of my avatar's feet. */
const myScreen = (p: Page) =>
  p.evaluate(() => {
    const a = (window as any).__agora;
    const pos = a.rendered.get(a.store.get().me);
    return a.view.toClient(pos.x, pos.y);
  });

type Pt = { x: number; y: number; id?: number };
const touch = (cdp: CDPSession, type: string, pts: Pt[]) =>
  cdp.send('Input.dispatchTouchEvent', {
    type,
    touchPoints: pts.map((p, i) => ({ x: p.x, y: p.y, id: p.id ?? i, radiusX: 4, radiusY: 4 })),
  });

/** The compact phone layout of the 2.5D view (the only view, ADR-054). */
async function enterPhone(browser: Browser): Promise<{ page: Page; cdp: CDPSession }> {
  const ctx = await browser.newContext({
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 2,
    isMobile: true,
    hasTouch: true,
  });
  await ctx.addInitScript(() => {
    localStorage.setItem(
      'agora.settings',
      JSON.stringify({ lighting: false, sounds: false, autoSit: false, precheck: false }),
    );
  });
  const page = await ctx.newPage();
  opened.push(page);
  page.on('pageerror', (e) => console.log('[pageerror]', e.message));
  await page.goto('/?hour=13');
  await page.getByRole('button', { name: 'Chloé Roy' }).click();
  const enterBtn = page
    .getByRole('dialog')
    .getByRole('button', { name: /Entrer dans Agora|Enter Agora/ });
  await Promise.race([enterBtn.click().catch(() => {}), page.locator('.control-bar').waitFor()]);
  await page.waitForFunction(() => {
    const a = (window as any).__agora;
    const s = a.store.get();
    return s.conn === 'online' && !!s.me && a.rendered.has(s.me);
  });
  expect(await page.evaluate(() => (window as any).__agora.view.engine)).toBe('2.5d');
  await page.waitForTimeout(500);
  return { page, cdp: await ctx.newCDPSession(page) };
}

/** Leave the space right away so later specs don't count a reconnecting ghost. */
async function leave(page: Page) {
  await page.evaluate(() => (window as any).__agoraWorld.leave());
  await page.context().close();
}

test('phone layout: dock, panel sheet and More sheet', async ({ browser }) => {
  const { page } = await enterPhone(browser);
  const dock = page.getByRole('navigation', { name: 'Commandes' });
  await expect(dock).toHaveClass(/dock/);
  // the world starts in view: panel and minimap closed, joystick shown
  expect((await S(page)).panelOpen).toBe(false);
  await expect(page.locator('.joystick')).toBeVisible();
  // every dock control fits on one row and is a comfortable touch target
  const boxes = await dock.locator(':scope > button, :scope > .menu-wrap > button').all();
  const tops = new Set<number>();
  for (const b of boxes) {
    const r = (await b.boundingBox())!;
    expect(r.height).toBeGreaterThanOrEqual(44);
    expect(r.x + r.width).toBeLessThanOrEqual(390);
    tops.add(Math.round(r.y));
  }
  expect(tops.size).toBe(1);

  // chat and people open as a sheet; the joystick steps aside; close returns
  await dock.getByRole('button', { name: /panneau/ }).tap();
  const panel = page.getByRole('complementary', { name: 'Panneau latéral' });
  await expect(panel).toHaveClass(/sheet-panel/);
  await expect(page.locator('.joystick')).toHaveCount(0);
  await panel.getByRole('button', { name: 'Fermer' }).tap();
  await expect(panel).toHaveCount(0);

  // More sheet: status and everything that left the bar
  await dock.getByRole('button', { name: /Plus d’options/ }).tap();
  const sheet = page.getByRole('dialog', { name: /Plus d’options/ });
  await sheet.getByRole('radio', { name: 'Occupé' }).tap();
  expect((await S(page)).status).toBe('busy');
  await sheet.getByRole('button', { name: 'Réglages' }).tap();
  const settings = page.getByRole('dialog', { name: 'Réglages' });
  await expect(settings.getByText('Joystick à l’écran')).toBeVisible();
  await settings.getByRole('button', { name: 'Fermer' }).tap();

  // prompts get a button instead of "press X": walk to a chair (not a desk), stand up
  await page.evaluate(() => {
    const a = (window as any).__agora;
    const s = a.store.get();
    const m = s.map;
    const me = a.rendered.get(s.me);
    const r = m.regions.find((q: any) => q.id === s.myRegion);
    const desk = new Set(m.desks.map((d: any) => `${d.chair.cx},${d.chair.cy}`));
    let best: { x: number; y: number; d: number } | null = null;
    for (let i = 0; i < m.width * m.height; i++) {
      if (!m.sit[i]) continue;
      const cx = i % m.width;
      const cy = Math.floor(i / m.width);
      const x = cx * m.tile + m.tile / 2;
      const y = cy * m.tile + m.tile - 6;
      if (desk.has(`${cx},${cy}`) || x < r.x || y < r.y || x > r.x + r.w || y > r.y + r.h) continue;
      const d = Math.hypot(x - me.x, y - me.y);
      if (!best || d < best.d) best = { x, y, d };
    }
    a.store.set({ navRequest: { kind: 'point', x: best!.x, y: best!.y } });
  });
  const stand = page.getByRole('button', { name: 'Se lever' });
  await expect(stand).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText(/^X :/)).toHaveCount(0);
  await stand.tap();
  await expect(page.getByRole('button', { name: 'S’asseoir' })).toBeVisible();
  // standing up on a chair offers to sit again
  await expect.poll(async () => (await S(page)).prompt?.kind).toBe('sit');
  await leave(page);
});

test('joystick walks, a drag on the map does not, a tap does, pinch zooms', async ({ browser }) => {
  const { page, cdp } = await enterPhone(browser);

  // joystick: push up for a moment, then let go
  const j = (await page.locator('.joystick').boundingBox())!;
  const c = { x: j.x + j.width / 2, y: j.y + j.height / 2 };
  const before = await myPos(page);
  await touch(cdp, 'touchStart', [c]);
  await touch(cdp, 'touchMove', [{ x: c.x, y: c.y - 45 }]);
  await page.waitForTimeout(700);
  await touch(cdp, 'touchEnd', []);
  await page.waitForTimeout(250);
  const walked = await myPos(page);
  expect(walked.y).toBeLessThan(before.y - 40);
  expect(Math.abs(walked.x - before.x)).toBeLessThan(8);
  await page.waitForTimeout(400);
  expect((await myPos(page)).y).toBeCloseTo(walked.y, 0);

  // dragging across the map never starts a walk
  const me = await myScreen(page);
  await touch(cdp, 'touchStart', [{ x: me.x + 60, y: me.y - 120 }]);
  await touch(cdp, 'touchMove', [{ x: me.x + 60, y: me.y - 60 }]);
  await touch(cdp, 'touchMove', [{ x: me.x + 60, y: me.y - 10 }]);
  await touch(cdp, 'touchEnd', []);
  await page.waitForTimeout(700);
  const still = await myPos(page);
  expect(Math.hypot(still.x - walked.x, still.y - walked.y)).toBeLessThan(2);

  // a tap walks there: the floor three tiles north of me, where the view draws it (the 2.5D tilt
  // foreshortens the screen, so a fixed screen offset is not a fixed distance on the floor)
  const north = await page.evaluate(() => {
    const a = (window as any).__agora;
    const pos = a.rendered.get(a.store.get().me);
    return a.view.toClient(pos.x, pos.y - 96);
  });
  await page.touchscreen.tap(north.x, north.y);
  await page.waitForFunction(
    (y0) => {
      const a = (window as any).__agora;
      return a.rendered.get(a.store.get().me).y < y0 - 64;
    },
    still.y,
    { timeout: 10_000 },
  );

  // pinch out: one zoom step in
  const z0 = await page.evaluate(() => (window as any).__agora.view.zoom());
  const mid = { x: 195, y: 380 };
  await touch(cdp, 'touchStart', [
    { x: mid.x - 30, y: mid.y, id: 1 },
    { x: mid.x + 30, y: mid.y, id: 2 },
  ]);
  for (const d of [45, 60, 80, 100]) {
    await touch(cdp, 'touchMove', [
      { x: mid.x - d, y: mid.y, id: 1 },
      { x: mid.x + d, y: mid.y, id: 2 },
    ]);
  }
  await touch(cdp, 'touchEnd', []);
  await expect
    .poll(() => page.evaluate(() => (window as any).__agora.view.zoom()))
    .toBeGreaterThan(z0);
  await leave(page);
});
