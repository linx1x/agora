import { existsSync, readFileSync } from 'node:fs';
import { expect, test, type Browser, type Page } from '@playwright/test';
import { PASSKEY_PORT, SETUP_LINK_FILE } from '../playwright.config';

/**
 * Invite-only accounts end to end (PLAN P2.13–P2.17, P2.20): the owner is created from
 * the console setup link, invites someone with a PIN, the invitee claims it with a passkey
 * and enters the world; signing them out reaches their open page; they sign back in with
 * their passkey; a used link is dead. Passkeys come from Chromium's virtual authenticator.
 */
test.use({ baseURL: `http://localhost:${PASSKEY_PORT}` });

/* eslint-disable @typescript-eslint/no-explicit-any */
const online = (p: Page) =>
  p.waitForFunction(() => {
    const w = window as any;
    const s = w.__agora?.store.get();
    return s?.conn === 'online' && !!s.me && w.__agora.rendered.has(s.me);
  });

/** A person with their own device: browser context + a platform authenticator. */
async function person(browser: Browser, label: string) {
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
  page.on('pageerror', (e) => console.log(`[pageerror ${label}]`, e.message));
  const cdp = await ctx.newCDPSession(page);
  await cdp.send('WebAuthn.enable');
  const { authenticatorId } = await cdp.send('WebAuthn.addVirtualAuthenticator', {
    options: {
      protocol: 'ctap2',
      transport: 'internal',
      hasResidentKey: true,
      hasUserVerification: true,
      isUserVerified: true,
      automaticPresenceSimulation: true,
    },
  });
  const credentials = async () =>
    (await cdp.send('WebAuthn.getCredentials', { authenticatorId })).credentials;
  return { page, credentials };
}

/** First visit after a link: skip through the avatar editor into the world. */
async function enterWorld(page: Page) {
  await page.getByRole('button', { name: 'Entrer dans Agora' }).click(); // claim "done" page
  const avatarBtn = page.getByRole('dialog').getByRole('button', { name: /Entrer dans Agora/ });
  await Promise.race([avatarBtn.click().catch(() => {}), page.locator('.control-bar').waitFor()]);
  await online(page);
}

test('owner setup, PIN invite, passkey claim, sign-out reaches the world, passkey sign-in', async ({
  browser,
}) => {
  test.setTimeout(150_000);
  // ── the owner opens the console link
  await expect.poll(() => existsSync(SETUP_LINK_FILE), { timeout: 15_000 }).toBe(true);
  const setup = new URL(readFileSync(SETUP_LINK_FILE, 'utf8').trim());
  const owner = await person(browser, 'owner');
  await owner.page.goto(`${setup.pathname}${setup.hash}`);
  await expect(
    owner.page.getByRole('heading', { name: 'Créer le compte propriétaire' }),
  ).toBeVisible();
  // the secret left the address bar
  expect(new URL(owner.page.url()).hash).toBe('');
  await owner.page.getByLabel('Votre nom dans Agora').fill('Camille');
  await owner.page.getByRole('button', { name: 'Créer ma clé d’accès' }).click();
  await expect(owner.page.getByRole('heading', { name: /C’est fait/ })).toBeVisible();
  expect(await owner.credentials()).toHaveLength(1);
  await enterWorld(owner.page);

  // ── the owner invites Zoé with a PIN
  await owner.page.getByRole('button', { name: 'Personnes et invitations' }).click();
  const people = owner.page.getByRole('dialog', { name: 'Personnes' });
  await people.getByLabel('Nom de la personne').fill('Zoé Tremblay');
  await people.getByRole('button', { name: 'Créer l’invitation' }).click();
  const link = await people.locator('#made-link').inputValue();
  const pin = await people.locator('#made-pin').inputValue();
  expect(link).toContain('/join#');
  expect(pin).toMatch(/^\d{6}$/);
  await expect(people.getByRole('cell', { name: 'En attente' })).toBeVisible();

  // ── Zoé opens it on her own device
  const zoe = await person(browser, 'zoe');
  const u = new URL(link);
  await zoe.page.goto(`${u.pathname}${u.hash}`);
  await expect(
    zoe.page.getByRole('heading', { name: 'Vous êtes invité dans Agora' }),
  ).toBeVisible();
  const pinBox = zoe.page.getByLabel('NIP à 6 chiffres');
  await pinBox.fill(pin === '000000' ? '111111' : '000000');
  await zoe.page.getByRole('button', { name: 'Continuer' }).click();
  await expect(zoe.page.getByRole('alert')).toContainText('Encore 4 essais');
  await pinBox.fill(pin);
  await zoe.page.getByRole('button', { name: 'Continuer' }).click();
  // the name the owner chose is pre-filled; she shortens it
  const name = zoe.page.getByLabel('Votre nom dans Agora');
  await expect(name).toHaveValue('Zoé Tremblay');
  await name.fill('Zoé T.');
  await zoe.page.getByRole('button', { name: 'Créer ma clé d’accès' }).click();
  await expect(zoe.page.getByRole('heading', { name: /C’est fait/ })).toBeVisible();
  await enterWorld(zoe.page);
  expect(await zoe.page.evaluate(() => (window as any).__agora.store.get().role)).toBe('member');

  // ── the link is dead now
  const thief = await person(browser, 'thief');
  await thief.page.goto(`${u.pathname}${u.hash}`);
  await expect(thief.page.getByRole('heading', { name: 'Lien invalide' })).toBeVisible();

  // ── the owner signs Zoé out everywhere: her open page drops to the sign-in page
  await people.getByRole('tab', { name: 'Personnes' }).click();
  await people.getByRole('button', { name: 'Gérer Zoé T.' }).click();
  await expect(people.getByText('invité comme « Zoé Tremblay »')).toBeVisible();
  await people.getByRole('button', { name: 'Déconnecter partout' }).click();
  await expect(people.getByText('1 session fermée.')).toBeVisible();
  const signIn = zoe.page.getByRole('button', { name: 'Se connecter avec une clé d’accès' });
  await expect(signIn).toBeVisible({ timeout: 15_000 });

  // ── she signs back in with her passkey alone
  await signIn.click();
  await online(zoe.page);
  expect(await zoe.page.evaluate(() => (window as any).__agora.store.get().me)).toBeTruthy();

  // ── the owner's account page: one passkey, cannot remove it, two sessions? (one here)
  await owner.page.keyboard.press('Escape');
  await owner.page.getByRole('button', { name: 'Réglages' }).click();
  await owner.page.getByRole('button', { name: 'Mon compte' }).click();
  const account = owner.page.getByRole('dialog', { name: 'Mon compte' });
  await expect(account.getByText('Rôle : Propriétaire')).toBeVisible();
  await expect(account.getByRole('button', { name: /Supprimer la clé/ })).toBeDisabled();
  await expect(account.getByText('Cet appareil')).toBeVisible();
});
