/**
 * P16.7 (ADR-052): the 2.5D paper avatar. With the flag `world25d` on (playwright.config.ts), the
 * avatar editor shows the paper cut-out (140×204) beside the 2D look, a Turn button cycles the
 * paper preview through four directions, and the catalog choices redraw it. The paper art is
 * also listed in the Credits page with its licence row (ASSETS.md).
 */
import { expect, test, type Browser, type Page } from '@playwright/test';

/* eslint-disable @typescript-eslint/no-explicit-any */

/** Dev login, then into the world (the first-time editor is skipped when it is not shown). */
async function enter(browser: Browser, user: string): Promise<Page> {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 }, locale: 'fr-CA' });
  await ctx.addInitScript(() => {
    localStorage.setItem(
      'agora.settings',
      JSON.stringify({ lighting: false, sounds: false, autoSit: false, precheck: false }),
    );
  });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => console.log(`[pageerror ${user}]`, e.message));
  await page.goto('/?hour=13');
  await page.getByRole('button', { name: user }).click();
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

/** Into the world, then the avatar editor from the control bar ("Modifier mon avatar"). */
async function openEditor(browser: Browser, user: string) {
  const page = await enter(browser, user);
  await page.getByRole('button', { name: 'Modifier mon avatar' }).click();
  const dialog = page.getByRole('dialog', { name: /Modifier mon avatar/ });
  await expect(dialog).toBeVisible();
  return { page, dialog, paper: dialog.getByTestId('avatar-paper-preview') };
}

test('the paper preview is drawn at 140×204 and is not blank', async ({ browser }) => {
  const { paper } = await openEditor(browser, 'Alice Tremblay');
  await expect(paper).toHaveJSProperty('complete', true);
  await expect(paper).toHaveJSProperty('naturalWidth', 140);
  await expect(paper).toHaveJSProperty('naturalHeight', 204);
  const opaque = await paper.evaluate((img: HTMLImageElement) => {
    const c = document.createElement('canvas');
    c.width = img.naturalWidth;
    c.height = img.naturalHeight;
    const ctx = c.getContext('2d')!;
    ctx.drawImage(img, 0, 0);
    const d = ctx.getImageData(0, 0, c.width, c.height).data;
    let n = 0;
    for (let i = 3; i < d.length; i += 4) if (d[i] > 0) n++;
    return n;
  });
  expect(opaque).toBeGreaterThan(2000);
});

test('Turn cycles the paper preview through four directions and back', async ({ browser }) => {
  const { dialog, paper } = await openEditor(browser, 'Alice Tremblay');
  const turn = dialog.getByTestId('avatar-turn');
  const srcs = [await paper.getAttribute('src')];
  for (let i = 0; i < 4; i++) {
    await turn.click();
    await expect.poll(() => paper.getAttribute('src')).not.toBe(srcs[srcs.length - 1]);
    srcs.push((await paper.getAttribute('src'))!);
  }
  expect(srcs[4]).toBe(srcs[0]);
});

test('Turn is reachable with the keyboard', async ({ browser }) => {
  const { page, dialog, paper } = await openEditor(browser, 'Alice Tremblay');
  const turn = dialog.getByTestId('avatar-turn');
  for (let i = 0; i < 80 && !(await turn.evaluate((el) => el === document.activeElement)); i++)
    await page.keyboard.press('Tab');
  await expect(turn).toBeFocused();
  const before = await paper.getAttribute('src');
  await page.keyboard.press('Enter');
  await expect.poll(() => paper.getAttribute('src')).not.toBe(before);
  const afterEnter = await paper.getAttribute('src');
  await page.keyboard.press('Space');
  await expect.poll(() => paper.getAttribute('src')).not.toBe(afterEnter);
});

test('changing a catalog choice redraws the paper preview', async ({ browser }) => {
  const { dialog, paper } = await openEditor(browser, 'Alice Tremblay');
  const before = await paper.getAttribute('src');
  await dialog
    .getByRole('group', { name: 'Coiffure', exact: true })
    .getByRole('button', { name: 'Coiffure suivant' })
    .click();
  await expect.poll(() => paper.getAttribute('src')).not.toBe(before);
});

test('Credits lists the paper avatar row with its licence', async ({ browser }) => {
  const page = await enter(browser, 'Alice Tremblay');
  await page.locator('.footer-links').getByRole('button', { name: 'Crédits' }).click();
  const dialog = page.getByRole('dialog', { name: 'Crédits' });
  await expect(dialog).toBeVisible();
  const row = dialog
    .getByRole('row')
    .filter({ hasText: 'Agora paper avatars (2.5D, drawn in code)' });
  await expect(row).toHaveCount(1);
  await expect(row.getByRole('cell').nth(1)).toContainText('Vincent (Agora project), Claude');
  await expect(row.getByRole('cell').nth(2)).toHaveText('CC0');
  // every registry entry is shown: the page does not filter the list
  const { assets } = (await (await page.request.get('/assets/registry.json')).json()) as {
    assets: unknown[];
  };
  await expect(dialog.locator('tbody tr')).toHaveCount(assets.length);
});
