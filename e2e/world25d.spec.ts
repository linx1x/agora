/**
 * P16.6 (ADR-052): the 2.5D view. The tilted camera draws the region I am in, and a click on the
 * floor (ray-cast) walks me there through the same navigation as the office's walking. Zoom, resize and the compact
 * phone layout keep working. The 2.5D view is the only view (ADR-054): there is no choice to make.
 */
import { expect, test, type Browser, type Page } from '@playwright/test';

/* eslint-disable @typescript-eslint/no-explicit-any */
const T = 32;

type Viewport = { width: number; height: number };

/** The pages this file opened: closed after each test, so a later test does not meet a ghost person. */
const opened: Page[] = [];

test.afterEach(async () => {
  for (const p of opened.splice(0)) {
    await p.evaluate(() => (window as any).__agoraWorld?.leave()).catch(() => {});
    await p
      .context()
      .close()
      .catch(() => {});
  }
});

async function enter(
  browser: Browser,
  opts: { user: string; viewport?: Viewport; phone?: boolean; hour?: number },
): Promise<Page> {
  const ctx = await browser.newContext(
    opts.phone
      ? {
          viewport: opts.viewport!,
          deviceScaleFactor: 2,
          isMobile: true,
          hasTouch: true,
          locale: 'fr-CA',
        }
      : { viewport: opts.viewport ?? { width: 1280, height: 800 }, locale: 'fr-CA' },
  );
  await ctx.addInitScript(() => {
    localStorage.setItem(
      'agora.settings',
      JSON.stringify({ lighting: false, sounds: false, autoSit: false, precheck: false }),
    );
  });
  const page = await ctx.newPage();
  opened.push(page);
  page.on('pageerror', (e) => console.log(`[pageerror ${opts.user}]`, e.message));
  await page.goto(`/?hour=${opts.hour ?? 13}`);
  await page.getByRole('button', { name: opts.user }).click();
  const enterBtn = page
    .getByRole('dialog')
    .getByRole('button', { name: /Entrer dans Agora|Enter Agora/ });
  await Promise.race([enterBtn.click().catch(() => {}), page.locator('.control-bar').waitFor()]);
  await page.waitForFunction(() => {
    const a = (window as any).__agora;
    const s = a.store.get();
    return s.conn === 'online' && !!s.me && a.rendered.has(s.me);
  });
  await page.waitForTimeout(400);
  return page;
}

/**
 * A walkable cell 3–5 steps from me whose floor point is on screen, not under the UI, and outside
 * the desk pods, private rooms and teleporters (those have their own rules). Found in the page
 * from the map the client already holds, so the test does not copy the collision maths.
 */
async function pickCell(p: Page): Promise<{ cx: number; cy: number; x: number; y: number }> {
  const found = await p.evaluate((T) => {
    const a = (window as any).__agora;
    const s = a.store.get();
    const m = s.map;
    const me = a.rendered.get(s.me);
    const region = s.myRegion ? m.regions.find((r: any) => r.id === s.myRegion) : null;
    const canvas = document.querySelector('.world-canvas canvas') as HTMLCanvasElement;
    const box = canvas.getBoundingClientRect();
    const meCx = Math.floor(me.x / T);
    const meCy = Math.floor((me.y - 1) / T);
    const inZone = (px: number, py: number) =>
      m.zones.some(
        (z: any) =>
          ['desk', 'private', 'portal'].includes(z.kind) &&
          px >= z.x &&
          py >= z.y &&
          px < z.x + z.w &&
          py < z.y + z.h,
      );
    const out: { cx: number; cy: number; x: number; y: number }[] = [];
    for (let d = 3; d <= 5; d++)
      for (let dx = -d; dx <= d; dx++)
        for (const dy of [d - Math.abs(dx), -(d - Math.abs(dx))]) {
          const cx = meCx + dx;
          const cy = meCy + dy;
          if (cx < 0 || cy < 0 || cx >= m.width || cy >= m.height) continue;
          const i = cy * m.width + cx;
          if (m.solid[i] || m.sit[i]) continue;
          const px = cx * T + 16;
          const py = cy * T + 16;
          if (
            region &&
            (px < region.x ||
              py < region.y ||
              px >= region.x + region.w ||
              py >= region.y + region.h)
          )
            continue;
          if (inZone(px, py)) continue;
          const sc = a.view.toClient(px, py);
          if (
            sc.x < box.left + 40 ||
            sc.x > box.right - 40 ||
            sc.y < box.top + 40 ||
            sc.y > box.bottom - 40
          )
            continue;
          const hit = document.elementFromPoint(sc.x, sc.y);
          if (hit !== canvas) continue;
          out.push({ cx, cy, x: sc.x, y: sc.y });
        }
    return out[0] ?? null;
  }, T);
  if (!found) throw new Error('no free floor cell on screen near me');
  return found;
}

/** Walk until I stand within 16 px of a cell's centre. */
async function waitAt(p: Page, cx: number, cy: number) {
  await p.waitForFunction(
    ([x, y]) => {
      const a = (window as any).__agora;
      const me = a.rendered.get(a.store.get().me);
      return !!me && Math.hypot(me.x - x, me.y - y) < 16;
    },
    [cx * T + 16, cy * T + 16] as const,
    { timeout: 20_000, polling: 100 },
  );
}

test('the 2.5D view is the only view: a new device gets it too, with one canvas (ADR-054)', async ({
  browser,
}) => {
  const a = await enter(browser, { user: 'Alice Tremblay' });
  const info = await a.evaluate(() => {
    const w = window as any;
    return {
      engine: w.__agora.view.engine,
      canvases: document.querySelectorAll('.world-canvas canvas').length,
      region: w.__agora.view3d?.builtRegion(),
      myRegion: w.__agora.store.get().myRegion,
    };
  });
  expect(info.engine).toBe('2.5d');
  expect(info.canvases).toBe(1);
  expect(info.region).toBe(info.myRegion);

  const b = await enter(browser, { user: 'Benoît Gagnon' });
  expect(await b.evaluate(() => (window as any).__agora.view.engine)).toBe('2.5d');
});

test('click-to-move: a click on the floor walks me there in 2.5D', async ({ browser }) => {
  const a = await enter(browser, { user: 'Alice Tremblay' });
  const cell = await pickCell(a);
  await a.mouse.click(cell.x, cell.y);
  await waitAt(a, cell.cx, cell.cy);
});

test('zoom keeps click-to-move working at the new level', async ({ browser }) => {
  const a = await enter(browser, { user: 'Alice Tremblay' });
  const before = await a.evaluate(() => (window as any).__agora.view.zoom());
  await a.keyboard.press('+');
  await a.waitForFunction((z) => (window as any).__agora.view.zoom() > z, before, {
    timeout: 5000,
  });
  const cell = await pickCell(a);
  await a.mouse.click(cell.x, cell.y);
  await waitAt(a, cell.cx, cell.cy);
});

test('resize: the avatar stays on screen and clicks still walk', async ({ browser }) => {
  const a = await enter(browser, { user: 'Alice Tremblay' });
  await a.setViewportSize({ width: 900, height: 600 });
  await a.waitForFunction(() => {
    const c = document.querySelector('.world-canvas canvas') as HTMLCanvasElement;
    return c && Math.abs(c.clientHeight - 600) < 2;
  });
  const onScreen = await a.evaluate(() => {
    const w = window as any;
    const me = w.__agora.rendered.get(w.__agora.store.get().me);
    const c = document.querySelector('.world-canvas canvas') as HTMLCanvasElement;
    const r = c.getBoundingClientRect();
    const p = w.__agora.view.toClient(me.x, me.y);
    return p.x > r.left && p.x < r.right && p.y > r.top && p.y < r.bottom;
  });
  expect(onScreen).toBe(true);
  const cell = await pickCell(a);
  await a.mouse.click(cell.x, cell.y);
  await waitAt(a, cell.cx, cell.cy);
});

test('compact phone layout: the view stops above the dock and a tap walks', async ({ browser }) => {
  const page = await enter(browser, {
    user: 'Chloé Roy',
    phone: true,
    viewport: { width: 390, height: 844 },
  });
  const h = await page.evaluate(() => {
    const c = document.querySelector('.world-canvas canvas') as HTMLCanvasElement;
    return { canvas: c.clientHeight, inner: innerHeight };
  });
  expect(h.canvas).toBe(h.inner - 72);
  const cell = await pickCell(page);
  await page.touchscreen.tap(cell.x, cell.y);
  await waitAt(page, cell.cx, cell.cy);
});

/**
 * Walk onto a portal and take it. The teleport menu marks the portal's own destination as the
 * primary button, so the test does not depend on region names.
 */
async function takePortal(a: Page, zone: { x: number; y: number }) {
  await a.evaluate(
    ([x, y]) => (window as any).__agora.store.set({ navRequest: { kind: 'point', x, y } }),
    [Math.floor(zone.x / T) * T + 16, Math.floor(zone.y / T) * T + 20] as const,
  );
  await a.waitForFunction(
    () => (window as any).__agora.store.get().prompt?.kind === 'teleport',
    undefined,
    { timeout: 30_000, polling: 200 },
  );
  const before = await a.evaluate(() => (window as any).__agora.store.get().myRegion);
  await a.locator('.teleport-menu button.primary').click();
  await a.waitForFunction((was) => (window as any).__agora.store.get().myRegion !== was, before, {
    timeout: 15_000,
    polling: 200,
  });
  await a.waitForTimeout(600);
}

test('a portal moves me to another region and only that region is built', async ({ browser }) => {
  test.setTimeout(120_000);
  // Alice may be left in a wing by an earlier spec: take the way back to the hub first
  const a = await enter(browser, { user: 'Alice Tremblay', hour: 20 });
  const back = await a.evaluate(() => {
    const s = (window as any).__agora.store.get();
    if (s.myRegion === 'hub' || !s.myRegion) return null;
    const r = s.map.regions.find((q: any) => q.id === s.myRegion);
    return (
      s.map.zones.find(
        (z: any) =>
          z.kind === 'portal' &&
          z.x + z.w / 2 >= r.x &&
          z.x + z.w / 2 < r.x + r.w &&
          z.y + z.h / 2 >= r.y &&
          z.y + z.h / 2 < r.y + r.h,
      ) ?? null
    );
  });
  if (back) {
    await takePortal(a, back);
    await a.waitForFunction(
      () => (window as any).__agora.store.get().myRegion === 'hub',
      undefined,
      {
        timeout: 15_000,
        polling: 200,
      },
    );
  }
  const map = await a.evaluate(() => (window as any).__agora.store.get().map);
  await takePortal(
    a,
    map.zones.find((z: any) => z.id === 'portal-hub-jungle'),
  );
  const built = await a.evaluate(() => {
    const w = window as any;
    return { built: w.__agora.view3d.builtRegion(), myRegion: w.__agora.store.get().myRegion };
  });
  expect(built.myRegion).not.toBe('hub');
  expect(built.built).toBe(built.myRegion);
});

test('a slow device steps the 2.5D quality down after 15 s under 20 fps, and says so once (ADR-054)', async ({
  browser,
}) => {
  // the 15 s hold on top of the entry, on a busy host (the portal test uses the same budget)
  test.setTimeout(120_000);
  const a = await enter(browser, { user: 'Alice Tremblay' });
  // the ladder reads this frame rate instead of the measured one (`?hour=` pins the device checks)
  await a.evaluate(() => (window as any).__agora.view3d.forceFps(5));
  await a.waitForFunction(() => (window as any).__agora.view3d.rung() >= 1, undefined, {
    timeout: 40_000,
    polling: 250,
  });
  // the first rung down is the render scale 0.75; the view stays 2.5D
  expect(await a.evaluate(() => (window as any).__agora.view3d.lighting().scale)).toBe(0.75);
  expect(await a.evaluate(() => (window as any).__agora.view.engine)).toBe('2.5d');
  await expect(
    a.getByRole('status').filter({ hasText: /Qualité réduite|Quality lowered/ }),
  ).toBeVisible();
});
