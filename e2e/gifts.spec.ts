import { expect, test, type Page } from '@playwright/test';

/*
 * P17.26b: the office shop board and gifts to the characters (2.5D). Chloé plays it, so the other
 * specs' people (Alice, Benoît) keep their bags; the e2e server forgets everything when it stops.
 */
test.describe.configure({ timeout: 240_000 });

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
  await page.getByRole('button', { name: 'Chloé Roy' }).click();
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

/** Walk to the office shop board until its prompt shows. */
async function walkToBoard(page: Page) {
  await expect
    .poll(
      () =>
        page.evaluate(() => {
          const st = (window as any).__agora.store.get();
          if (st.prompt?.kind === 'shop') return 'here';
          const z = st.map.zones.find((q: any) => q.kind === 'shop');
          if (!st.navRequest)
            (window as any).__agora.store.set({
              navRequest: { kind: 'point', x: z.x + z.w / 2, y: z.y + z.h / 2 },
            });
          return 'walking';
        }),
      { timeout: 90_000, intervals: [1000] },
    )
    .toBe('here');
}

/** Walk beside a character until the Talk prompt shows, press X, and return its name. */
async function openTalk(page: Page): Promise<string> {
  for (let attempt = 0; attempt < 5; attempt++) {
    await expect
      .poll(
        () =>
          page.evaluate(() => {
            const st = (window as any).__agora.store.get();
            if (st.prompt?.kind === 'talk') return 'near';
            const me = (window as any).__agora.rendered.get(st.me);
            const best = [...st.npcs].sort(
              (a: any, b: any) =>
                Math.hypot(a.x - me.x, a.y - me.y) - Math.hypot(b.x - me.x, b.y - me.y),
            )[0];
            if (best)
              (window as any).__agora.store.set({
                navRequest: { kind: 'point', x: best.x, y: best.y },
              });
            return 'walking';
          }),
        { timeout: 90_000, intervals: [1000] },
      )
      .toBe('near');
    const name: string | null = await page.evaluate(() => {
      const p = (window as any).__agora.store.get().prompt;
      return p?.kind === 'talk' ? p.name : null;
    });
    if (!name) continue;
    await page.keyboard.press('x');
    const box = page.getByRole('dialog', { name: `Parler à ${name}` });
    if (
      await box.waitFor({ timeout: 3_000 }).then(
        () => true,
        () => false,
      )
    )
      return name;
  }
  throw new Error('could not open the Talk box with a character');
}

test('buy at the office board, give it to a character, and see the hearts (P17.26b)', async ({
  page,
}) => {
  await enter(page);
  await page.waitForFunction(() => (window as any).__agora.store.get().hearts !== null);

  // the board: X opens it; a buy takes the money the server says
  await walkToBoard(page);
  await page.keyboard.press('x');
  const shop = page.getByRole('dialog', { name: 'Tableau de la boutique' });
  await expect(shop).toBeVisible();
  const money = shop.locator('.wh-money');
  await expect(money).not.toHaveText(/^\s*$/);
  const before = await money.textContent();
  const buy = shop.getByRole('button', { name: /^Acheter / }).first();
  await expect(buy).toBeFocused();
  await buy.click();
  await expect(money).not.toHaveText(before ?? '');
  await page.screenshot({ path: 'test-results/gifts-shop.png' });
  await page.keyboard.press('Escape');
  await expect(shop).toHaveCount(0);

  // a gift: the box lists what can be given; the character's reaction and the hearts come back
  const name = await openTalk(page);
  const box = page.getByRole('dialog', { name: `Parler à ${name}` });
  const gift = box.locator('summary', { hasText: `Offrir un cadeau à ${name}` });
  await gift.focus();
  await page.keyboard.press('Enter');
  const list = box.getByRole('list', { name: `Ce que vous pouvez offrir à ${name}` });
  await expect(list.getByRole('button').first()).toBeVisible();
  await list.getByRole('button').first().click();
  const status = box.getByRole('status').filter({ hasText: name });
  await expect(status).toHaveText(/adore|aime bien|remercie|n'aime pas|déteste/);
  const result = await page.evaluate(() => (window as any).__agora.store.get().giftResult);
  expect(result).toMatchObject({ ok: true });
  await page.screenshot({ path: 'test-results/gifts-given.png' });

  // the same day again: refused, and the bag keeps it
  await list.getByRole('button').first().click();
  await expect(status).toHaveText(/déjà offert un cadeau/);

  // the hearts show in the Characters list
  await page.keyboard.press('Escape');
  const hearts = await page.evaluate(() => (window as any).__agora.store.get().hearts);
  expect(Object.keys(hearts).sort()).toEqual(['felix', 'theo', 'zoe']);
  const group = page.getByRole('list', { name: 'Personnages' });
  await expect(group.getByText(/cœurs? sur 10/).first()).toBeVisible();
});
