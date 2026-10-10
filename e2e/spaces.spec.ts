import { expect, test, type Browser, type Page } from '@playwright/test';

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
const st = (p: Page) => p.evaluate(() => (window as any).__agora.store.get());
const online = (p: Page) =>
  p.waitForFunction(() => {
    const w = window as any;
    const s = w.__agora.store.get();
    return s.conn === 'online' && !!s.me && w.__agora.rendered.has(s.me);
  });

async function signIn(browser: Browser, devUser: number): Promise<Page> {
  const ctx = await browser.newContext();
  await ctx.addInitScript(() => {
    try {
      localStorage.setItem(
        'agora.settings',
        JSON.stringify({ lighting: false, sounds: false, autoSit: true, precheck: false }),
      );
    } catch {
      /* about:blank */
    }
  });
  const page = await ctx.newPage();
  opened.push(page);
  page.on('pageerror', (e) => console.log(`[pageerror ${devUser}]`, e.message));
  await page.goto('/');
  await page
    .getByRole('button', { name: ['Alice Tremblay', 'Benoît Gagnon', 'Chloé Roy'][devUser]! })
    .click();
  const enterBtn = page
    .getByRole('dialog')
    .getByRole('button', { name: /Entrer dans Agora|Enter Agora/ });
  await Promise.race([enterBtn.click().catch(() => {}), page.locator('.control-bar').waitFor()]);
  await online(page);
  return page;
}

test('create an invite-only space, share a link, and the invitee gets in', async ({ browser }) => {
  test.setTimeout(120_000);
  const alice = await signIn(browser, 0);
  const bob = await signIn(browser, 1);
  expect(new URL(alice.url()).pathname).toBe('/s/hq');

  // Alice creates a space from the Spaces dialog
  await alice.getByRole('button', { name: 'Espaces' }).click();
  const dlg = alice.getByRole('dialog', { name: 'Espaces' });
  await expect(dlg.getByText('Vous êtes ici')).toBeVisible();
  await dlg.getByLabel('Nom', { exact: true }).fill('Équipe pilote');
  await expect(dlg.getByLabel('Adresse')).toHaveValue('equipe-pilote');
  await dlg.getByRole('button', { name: 'Créer l’espace' }).click();
  await alice.waitForURL('**/s/equipe-pilote');
  await online(alice);
  expect((await st(alice)).spaceName).toBe('Équipe pilote');
  await expect(alice.locator('.room-space')).toHaveText('Équipe pilote');

  // Bob is refused before he has an invite
  await bob.goto('/s/equipe-pilote');
  await expect(bob.getByRole('alertdialog', { name: 'Espace sur invitation' })).toBeVisible();
  expect((await st(bob)).conn).toBe('denied');

  // Alice makes a one-use link
  await alice.getByRole('button', { name: 'Espaces' }).click();
  await alice.getByRole('button', { name: 'Réglages et invitations' }).click();
  const settings = alice.getByRole('dialog', { name: 'Réglages de l’espace' });
  await settings.getByLabel('Utilisations').selectOption('1');
  await settings.getByLabel('Étiquette').fill('Bob');
  await settings.getByRole('button', { name: 'Créer un lien' }).click();
  const link = await settings.locator('#invite-link').inputValue();
  expect(link).toMatch(/\/join\/[A-Za-z0-9_-]{20,}$/);
  await expect(settings.getByRole('cell', { name: 'Bob', exact: true })).toBeVisible();

  // Bob follows it, joins, and both see each other in the new space
  await bob.goto(link);
  await expect(bob.getByRole('heading', { name: 'Invitation : Équipe pilote' })).toBeVisible();
  await bob.getByRole('button', { name: 'Rejoindre l’espace' }).click();
  await bob.waitForURL('**/s/equipe-pilote');
  await online(bob);
  await alice.waitForFunction(
    () => Object.values((window as any).__agora.store.get().profiles).length === 2,
  );

  // The link is used up for anyone else
  const chloe = await signIn(browser, 2);
  await chloe.goto(link);
  await expect(chloe.getByText('Ce lien a atteint son nombre d’utilisations.')).toBeVisible();

  // Alice's last space is remembered for "/"
  await alice.goto('/');
  await alice.waitForURL('**/s/equipe-pilote');
  // leaving the page frees the seat at once (no "reconnecting" ghost for the next test)
  for (const p of [alice, bob, chloe]) {
    await p.goto('about:blank');
    await p.context().close();
  }
});
