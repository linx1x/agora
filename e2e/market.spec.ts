import { expect, test, type Browser, type Page } from '@playwright/test';

/*
 * P17.30: the members' market at the office board. Chloé puts a seed lot up, Benoît buys it; the
 * listing names nobody, and the sale reaches Chloé.
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


async function toBoard(p: Page) {
  await expect
    .poll(
      () =>
        p.evaluate(() => {
          const st = (window as any).__agora.store.get();
          if (st.prompt?.kind === 'shop') return 'here';
          const z = st.map.zones.find((q: any) => q.kind === 'shop');
          if (!st.navRequest) (window as any).__agora.store.set({ navRequest: { kind: 'point', x: z.x + z.w / 2, y: z.y + z.h / 2 } });
          return 'walking';
        }),
      { timeout: 90_000, intervals: [1000] },
    )
    .toBe('here');
  await p.keyboard.press('x');
  await p.getByRole('dialog', { name: 'Tableau de la boutique' }).getByRole('button', { name: 'Marché des membres' }).click();
  return p.getByRole('dialog', { name: 'Marché des membres' });
}

test('the members market: a lot put up by one person is bought by another (P17.30)', async ({ browser }) => {
  const c = await enter(browser, 'Chloé Roy');
  const mc = await toBoard(c);
  await expect(mc.getByText(/Aujourd'hui : 0 sur 2 mises en vente/)).toBeVisible({ timeout: 30_000 });
  await mc.getByRole('combobox', { name: 'Objet' }).selectOption('clover_bulb_seed');
  await mc.getByRole('spinbutton', { name: 'Quantité' }).fill('2');
  await mc.getByRole('spinbutton', { name: 'Prix (pour le lot)' }).fill('40');
  await mc.getByRole('button', { name: 'Mettre en vente', exact: true }).click();
  await expect(mc.getByRole('button', { name: 'Retirer de la vente' })).toBeVisible({ timeout: 30_000 });
  await c.screenshot({ path: 'test-results/market-panel.png' });

  const b = await enter(browser, 'Benoît Gagnon');
  const mb = await toBoard(b);
  const buy = mb.getByRole('button', { name: /Acheter Sachet de graines : bulbe de trèfle ×2 pour 40/ });
  await expect(buy).toBeVisible({ timeout: 30_000 });
  await buy.click();
  await expect(mb.getByText("Rien en vente pour l'instant.")).toBeVisible({ timeout: 30_000 });
  await expect(c.getByText(/Vous avez vendu un lot au marché : \+40/)).toBeVisible({ timeout: 30_000 });
});
