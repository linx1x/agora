import { expect, test, type Browser, type Page } from '@playwright/test';

/*
 * P17.29: a direct trade between two people side by side in the office. Benoît and Chloé (no desk,
 * so both arrive in the hub); each puts something up, both confirm, the swap is the server's.
 */
test.describe.configure({ timeout: 240_000 });

/* eslint-disable @typescript-eslint/no-explicit-any */
const opened: Page[] = [];
test.afterEach(async () => {
  for (const p of opened.splice(0)) await p.context().close().catch(() => {});
});

async function enter(browser: Browser, name: string): Promise<Page> {
  const ctx = await browser.newContext();
  await ctx.addInitScript(() =>
    localStorage.setItem(
      'agora.settings',
      JSON.stringify({ lighting: false, sounds: false, autoSit: true, precheck: false }),
    ),
  );
  const page = await ctx.newPage();
  opened.push(page);
  page.on('pageerror', (e) => console.log('[pageerror]', e.message));
  await page.goto('/?hour=13');
  await page.getByRole('button', { name }).click();
  const enterBtn = page.getByRole('dialog').getByRole('button', { name: /Entrer dans Agora|Enter Agora/ });
  await Promise.race([enterBtn.click().catch(() => {}), page.locator('.control-bar').waitFor()]);
  await page.waitForFunction(() => {
    const w = window as any;
    const s = w.__agora.store.get();
    return s.conn === 'online' && !!s.me && w.__agora.rendered.has(s.me);
  });
  return page;
}

test('two people side by side trade: offers, both confirm, the swap (P17.29)', async ({ browser }) => {
  const b = await enter(browser, 'Benoît Gagnon');
  const c = await enter(browser, 'Chloé Roy');
  const cId: string = await c.evaluate(() => (window as any).__agora.store.get().me);
  // Benoît walks up to Chloé
  await expect
    .poll(
      () =>
        b.evaluate((id) => {
          const a = (window as any).__agora;
          const s = a.store.get();
          const me = a.rendered.get(s.me);
          const her = a.rendered.get(id);
          if (!me || !her) return 999;
          const d = Math.hypot(me.x - her.x, me.y - her.y);
          if (d > 64 && !s.navRequest) a.store.set({ navRequest: { kind: 'person', id } });
          return d;
        }, cId),
      { timeout: 60_000, intervals: [500] },
    )
    .toBeLessThan(100);

  await b.getByRole('button', { name: 'Proposer un échange à Chloé Roy' }).click();
  await c.getByRole('button', { name: 'Échanger', exact: true }).click();
  const pb = b.getByRole('dialog', { name: 'Échange avec Chloé Roy' });
  const pc = c.getByRole('dialog', { name: 'Échange avec Benoît Gagnon' });
  await expect(pb.getByRole('heading', { name: 'Vous donnez' })).toBeVisible({ timeout: 30_000 });
  await expect(pc.getByRole('heading', { name: 'Vous donnez' })).toBeVisible();

  // Benoît gives two radish seed packets; Chloé gives 15 money
  const seeds = pb.getByRole('spinbutton', { name: /Quantité de Sachet de graines : radis de l.aube/ });
  await expect(seeds).toBeVisible({ timeout: 30_000 });
  const before = await c.evaluate(() => (window as any).__agora.store.get().trade);
  expect(before.pending).toBe(false);
  await seeds.fill('2');
  await pb.getByRole('button', { name: 'Proposer cette offre' }).click();
  await pc.getByRole('spinbutton', { name: /Argent à donner/ }).fill('15');
  await pc.getByRole('button', { name: 'Proposer cette offre' }).click();
  await expect(pb.getByText('15 d\'argent')).toBeVisible({ timeout: 30_000 });
  await expect(pc.getByText(/radis de l.aube ×2/)).toBeVisible();

  await pb.getByRole('button', { name: "Confirmer l'échange" }).click();
  await expect(pc.getByText('Benoît Gagnon a confirmé cet échange. À vous.')).toBeVisible({ timeout: 30_000 });
  await c.screenshot({ path: 'test-results/trade-panel.png' });
  await pc.getByRole('button', { name: "Confirmer l'échange" }).click();
  await expect(pb).toHaveCount(0, { timeout: 30_000 });
  await expect(pc).toHaveCount(0);
  await expect(b.getByText('Échange fait!')).toBeVisible();
});
