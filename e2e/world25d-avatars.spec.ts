/**
 * P16.8 (ADR-052): people and characters in the 2.5D view are paper cut-out cards. Each card
 * stands on the floor with a blob shadow; a left-right turn plays a short card flip (instant under
 * prefers-reduced-motion); a seated card sits at seat height; names, emotes and nearby-chat bubbles
 * are screen-space overlays above the head. The view is chosen per device by `agora.worldView`
 * (the flag `world25d` is on in playwright.config.ts), the way e2e/world25d.spec.ts does it.
 */
import { expect, test, type Browser, type Page } from '@playwright/test';

/* eslint-disable @typescript-eslint/no-explicit-any */
const T = 32;
/** the first emote key (1) is wave (packages/shared EMOTES) */
const WAVE = '👋';
// two dev users without a desk: both spawn in the Atrium whatever ran before (world.spec gives
// Alice a desk, and desk owners spawn at their desk in the Jungle)
const NAME_A = 'Chloé Roy';
const NAME_B = 'Benoît Gagnon';

const opened: Page[] = [];

test.afterEach(async () => {
  for (const p of opened.splice(0)) {
    // leave first so later specs do not count a ghost, then drop the browser context
    await p.evaluate(() => (window as any).__agoraWorld?.leave()).catch(() => {});
    await p
      .context()
      .close()
      .catch(() => {});
  }
});

/** Dev login, then into the world in 2.5D (the device chose it through its storage). */
async function enter(
  browser: Browser,
  opts: { user: string; reducedMotion?: boolean },
): Promise<Page> {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 }, locale: 'fr-CA' });
  await ctx.addInitScript(() => {
    localStorage.setItem(
      'agora.settings',
      JSON.stringify({ lighting: false, sounds: false, autoSit: false, precheck: false }),
    );
    localStorage.setItem('agora.worldView', '2.5d');
  });
  const page = await ctx.newPage();
  opened.push(page);
  if (opts.reducedMotion) await page.emulateMedia({ reducedMotion: 'reduce' });
  page.on('pageerror', (e) => console.log(`[pageerror ${opts.user}]`, e.message));
  await page.goto('/?hour=13');
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

const myId = (p: Page) => p.evaluate(() => (window as any).__agora.store.get().me as string);
/** The card of a person as the 2.5D view draws it (null when not drawn). */
const figure = (p: Page, id: string) =>
  p.evaluate((id) => (window as any).__agora.view3d?.figure(id) ?? null, id);
const frameOf = (p: Page, id: string) =>
  p.evaluate((id) => (window as any).__agora.view.avatarFrame(id), id);
const textsOf = (p: Page) => p.evaluate(() => (window as any).__agora.view.texts() as string[]);
const gap = (p: Page, a: string, b: string) =>
  p.evaluate(
    ([a, b]) => {
      const r = (window as any).__agora.rendered as Map<string, { x: number; y: number }>;
      const pa = r.get(a);
      const pb = r.get(b);
      return pa && pb ? Math.hypot(pa.x - pb.x, pa.y - pb.y) : Infinity;
    },
    [a, b] as const,
  );

/** Walk up beside another person (the same navigation as clicking their name in the people list). */
async function walkNextTo(p: Page, other: string) {
  const self = await myId(p);
  await p.evaluate(
    (id) => (window as any).__agora.store.set({ navRequest: { kind: 'person', id } }),
    other,
  );
  await expect.poll(() => gap(p, self, other), { timeout: 15_000 }).toBeLessThan(80);
}

/** Walk to the centre of a floor cell and wait until I am there. */
async function goCell(p: Page, cx: number, cy: number) {
  await p.evaluate(
    ([x, y]) => (window as any).__agora.store.set({ navRequest: { kind: 'point', x, y } }),
    [cx * T + 16, cy * T + 16] as const,
  );
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

/**
 * A floor cell near me in my region with seven free cells in a row (three each side), so a
 * left-right walk never meets a wall. Found from the map the client already holds.
 */
async function flatSpot(p: Page): Promise<{ cx: number; cy: number }> {
  const spot = await p.evaluate((T) => {
    const a = (window as any).__agora;
    const s = a.store.get();
    const m = s.map;
    const me = a.rendered.get(s.me);
    const region = s.myRegion ? m.regions.find((r: any) => r.id === s.myRegion) : null;
    const inZone = (px: number, py: number) =>
      m.zones.some(
        (z: any) =>
          ['desk', 'private', 'portal'].includes(z.kind) &&
          px >= z.x &&
          py >= z.y &&
          px < z.x + z.w &&
          py < z.y + z.h,
      );
    const free = (cx: number, cy: number) => {
      if (cx < 0 || cy < 0 || cx >= m.width || cy >= m.height) return false;
      const i = cy * m.width + cx;
      if (m.solid[i] || m.sit[i]) return false;
      const px = cx * T + 16;
      const py = cy * T + 16;
      if (
        region &&
        (px < region.x || py < region.y || px >= region.x + region.w || py >= region.y + region.h)
      )
        return false;
      return !inZone(px, py);
    };
    const mx = Math.floor(me.x / T);
    const my = Math.floor((me.y - 1) / T);
    for (let d = 4; d <= 12; d++)
      for (let dy = -d; dy <= d; dy++)
        for (let dx = -d; dx <= d; dx++) {
          if (Math.max(Math.abs(dx), Math.abs(dy)) !== d) continue;
          const cx = mx + dx;
          const cy = my + dy;
          let ok = true;
          for (let k = -3; k <= 3 && ok; k++) ok = free(cx + k, cy);
          if (ok) return { cx, cy };
        }
    return null;
  }, T);
  if (!spot) throw new Error('no open floor strip near me');
  return spot;
}

/** The chair nearest to me that is not a desk seat (desk seats belong to pods). */
async function nearestChair(p: Page): Promise<{ cx: number; cy: number }> {
  const seat = await p.evaluate((T) => {
    const a = (window as any).__agora;
    const s = a.store.get();
    const m = s.map;
    const me = a.rendered.get(s.me);
    const region = s.myRegion ? m.regions.find((r: any) => r.id === s.myRegion) : null;
    const desk = new Set(m.desks.map((d: any) => `${d.chair.cx},${d.chair.cy}`));
    let best: { cx: number; cy: number; d: number } | null = null;
    for (let i = 0; i < m.width * m.height; i++) {
      if (!m.sit[i]) continue;
      const cx = i % m.width;
      const cy = Math.floor(i / m.width);
      if (desk.has(`${cx},${cy}`)) continue;
      const x = cx * T + T / 2;
      const y = cy * T + T - 6;
      if (
        region &&
        (x < region.x || y < region.y || x >= region.x + region.w || y >= region.y + region.h)
      )
        continue;
      const d = Math.hypot(x - me.x, y - me.y);
      if (!best || d < best.d) best = { cx, cy, d };
    }
    return best ? { cx: best.cx, cy: best.cy } : null;
  }, T);
  if (!seat) throw new Error('no lounge chair in my region');
  return seat;
}

/**
 * Record the card of `id` on every animation frame: its flip factor and the directions it faces.
 * The log stays in the page until `readFlipLog` takes it.
 */
async function startFlipLog(p: Page, id: string) {
  await p.evaluate((id) => {
    const w = window as any;
    const f0 = w.__agora.view3d?.figure(id);
    w.__flipLog = {
      scales: [] as number[],
      dirs: [] as string[],
      on: true,
      id,
      flips0: f0?.flips ?? 0,
    };
    const tick = () => {
      const log = w.__flipLog;
      if (!log.on) return;
      const f = w.__agora.view3d?.figure(id);
      if (f) {
        log.scales.push(f.scaleX);
        if (log.dirs[log.dirs.length - 1] !== f.dir) log.dirs.push(f.dir);
      }
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  }, id);
}

async function readFlipLog(p: Page): Promise<{ scales: number[]; dirs: string[]; flips: number }> {
  return p.evaluate(() => {
    const w = window as any;
    const log = w.__flipLog;
    log.on = false;
    // flips the card started while logging: counted by the view, so it does not depend on timing
    const flips = (w.__agora.view3d?.figure(log.id)?.flips ?? 0) - log.flips0;
    return { scales: log.scales as number[], dirs: log.dirs as string[], flips };
  });
}

test('two people see each other as cards in 2.5D, with their names', async ({ browser }) => {
  test.setTimeout(90_000);
  const a = await enter(browser, { user: NAME_A });
  const b = await enter(browser, { user: NAME_B });
  const idA = await myId(a);
  const idB = await myId(b);
  await walkNextTo(a, idB);

  expect(await a.evaluate(() => (window as any).__agora.view.engine)).toBe('2.5d');
  expect(await b.evaluate(() => (window as any).__agora.view.engine)).toBe('2.5d');

  // each card is drawn for the other person (a figure with a pose), and both names are on the page
  await expect.poll(() => figure(a, idB)).not.toBeNull();
  await expect.poll(() => figure(b, idA)).not.toBeNull();
  await expect.poll(() => frameOf(a, idB)).not.toBeNull();
  await expect.poll(() => frameOf(b, idA)).not.toBeNull();
  await expect
    .poll(async () => {
      const texts = await textsOf(a);
      return texts.includes(NAME_A) && texts.includes(NAME_B);
    })
    .toBe(true);
});

test('nearby chat shows as a speech bubble above the speaker in 2.5D', async ({ browser }) => {
  test.setTimeout(90_000);
  const a = await enter(browser, { user: NAME_A });
  const b = await enter(browser, { user: NAME_B });
  const idB = await myId(b);
  await walkNextTo(a, idB);

  const msg = 'Bonjour depuis la 2.5D !';
  await a.bringToFront();
  await a.keyboard.press('Enter');
  await a.locator('#chat-input').fill(msg);
  await a.locator('#chat-input').press('Enter');
  await a.locator('#chat-input').blur();

  await expect
    .poll(async () => (await textsOf(b)).includes(msg), { timeout: 10_000, intervals: [200] })
    .toBe(true);
});

/**
 * Walk left, then right, on a clear floor strip with the arrow keys, while the card is logged.
 * Returns the log and the card's final flip factor (it should be back to 1).
 */
async function walkLeftThenRight(p: Page, id: string) {
  const spot = await flatSpot(p);
  await goCell(p, spot.cx, spot.cy);
  await p.bringToFront();

  await startFlipLog(p, id);
  await p.keyboard.down('ArrowLeft');
  await p.waitForTimeout(400);
  await p.keyboard.up('ArrowLeft');
  await p.waitForTimeout(150);
  await p.keyboard.down('ArrowRight');
  await p.waitForTimeout(500);
  await p.keyboard.up('ArrowRight');
  await p.waitForTimeout(600);
  const log = await readFlipLog(p);
  expect(log.scales.length).toBeGreaterThan(0);
  expect(log.dirs).toEqual(expect.arrayContaining(['left', 'right']));
  return log;
}

test('a left-right turn flips the card, and it settles back to full width', async ({ browser }) => {
  test.setTimeout(90_000);
  const a = await enter(browser, { user: NAME_A });
  const idA = await myId(a);
  const log = await walkLeftThenRight(a, idA);

  // the left→right turn started a flip. Sampling the 120 ms animation itself is timing-dependent
  // in headless Chromium (a frame or two), so the view counts flips; the 1 → 0 → 1 curve is unit-
  // tested in figureMath.test.ts
  expect(log.flips).toBeGreaterThanOrEqual(1);
  await expect
    .poll(async () => (await figure(a, idA))?.scaleX, { timeout: 5_000 })
    .toBeCloseTo(1, 3);
});

test('reduced motion: the card turns without any mid-flip frame', async ({ browser }) => {
  test.setTimeout(90_000);
  const a = await enter(browser, { user: NAME_A, reducedMotion: true });
  const idA = await myId(a);
  const log = await walkLeftThenRight(a, idA);

  expect(log.flips).toBe(0);
  expect(log.scales.filter((s) => s > 0.01 && s < 0.99)).toEqual([]);
});

test('sitting on a chair lifts the card to seat height, and standing puts it back', async ({
  browser,
}) => {
  test.setTimeout(90_000);
  const a = await enter(browser, { user: NAME_A });
  const idA = await myId(a);
  const seat = await nearestChair(a);
  // a point on the chair's cell sits me on arrival (the same click a player makes on a chair)
  await a.evaluate(
    ([x, y]) => (window as any).__agora.store.set({ navRequest: { kind: 'point', x, y } }),
    [seat.cx * T + T / 2, seat.cy * T + T - 6] as const,
  );

  await expect
    .poll(async () => (await figure(a, idA))?.lift ?? 0, { timeout: 20_000, intervals: [200] })
    .toBeGreaterThan(0);
  expect(await frameOf(a, idA)).toMatch(/^sit-/);

  // the stand prompt is offered once seated; X stands me up
  await expect
    .poll(async () => (await a.evaluate(() => (window as any).__agora.store.get().prompt))?.kind)
    .toBe('stand');
  await a.keyboard.press('x');

  await expect.poll(async () => (await figure(a, idA))?.lift, { timeout: 10_000 }).toBe(0);
  expect(await frameOf(a, idA)).not.toMatch(/^sit-/);
});

test('an emote shows its glyph above the sender for the other person', async ({ browser }) => {
  test.setTimeout(90_000);
  const a = await enter(browser, { user: NAME_A });
  const b = await enter(browser, { user: NAME_B });
  const idB = await myId(b);
  await walkNextTo(a, idB);

  await a.bringToFront();
  await a.keyboard.press('1');

  await expect
    .poll(async () => (await textsOf(b)).some((t) => t.includes(WAVE)), {
      timeout: 10_000,
      intervals: [200],
    })
    .toBe(true);
});
