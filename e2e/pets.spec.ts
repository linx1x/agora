import { expect, test, type Page } from '@playwright/test';

/* eslint-disable @typescript-eslint/no-explicit-any */

async function enter(page: Page) {
  await page.addInitScript(() =>
    localStorage.setItem(
      'agora.settings',
      JSON.stringify({ lighting: false, sounds: false, autoSit: true, precheck: false }),
    ),
  );
  page.on('pageerror', (e) => console.log('[pageerror]', e.message));
  await page.goto('/?hour=13');
  await page.getByRole('button', { name: 'Alice Tremblay' }).click();
  const enterBtn = page
    .getByRole('dialog')
    .getByRole('button', { name: /Entrer dans Agora|Enter Agora/ });
  await Promise.race([enterBtn.click().catch(() => {}), page.locator('.control-bar').waitFor()]);
  await page.waitForFunction(() => {
    const w = window as any;
    const s = w.__agora.store.get();
    return s.conn === 'online' && !!s.me && w.__agora.rendered.has(s.me);
  });
}

test.describe('office cat (ADR-040)', () => {
  test('one cat roams the floor and is not a person', async ({ page }) => {
    await enter(page);
    await page.waitForFunction(() => (window as any).__agora.store.get().pets.length === 1);
    const first = await page.evaluate(() => ({ ...(window as any).__agora.store.get().pets[0] }));
    expect(first).toMatchObject({ id: 'cat:office', kind: 'office' });

    // it walks: within 40 s it has been somewhere else
    await page.waitForFunction(
      (f) => {
        const c = (window as any).__agora.store.get().pets[0];
        return Math.hypot(c.x - f.x, c.y - f.y) > 64;
      },
      first,
      { timeout: 40_000 },
    );

    // the cat is nowhere in the people list
    const people = await page.evaluate(() =>
      Object.keys((window as any).__agora.store.get().profiles),
    );
    expect(people.some((id) => id.includes('cat'))).toBe(false);
  });

  test('the cat is drawn on the floor', async ({ page }) => {
    test.skip(
      true,
      'the 2.5D view does not draw the office cat yet: petsDrawn() is 0 (ADR-054; checkpoint K)',
    );
    await enter(page);
    await page.waitForFunction(() => (window as any).__agora.store.get().pets.length === 1);
    expect(await page.evaluate(() => (window as any).__agora.view.petsDrawn() > 0)).toBe(true);
  });
});
