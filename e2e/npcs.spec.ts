import { expect, test, type Page } from '@playwright/test';

// walking to a character may cross a teleporter and the characters keep moving (see walkToCharacter)
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

test.describe('characters (ADR-042, P15.2)', () => {
  test('three characters are drawn with a Bot tag, listed apart, and are not people', async ({
    page,
  }) => {
    await enter(page);
    // NPC_CLOCK=10:30 in the e2e server: everyone is at work
    await page.waitForFunction(() => (window as any).__agora.store.get().npcs.length === 3);
    const npcs = await page.evaluate(() => (window as any).__agora.store.get().npcs);
    expect(npcs.map((n: any) => n.name).sort()).toEqual(['Félix', 'Théo', 'Zoé']);
    expect(npcs.every((n: any) => n.id.startsWith('npc:'))).toBe(true);

    // not people: not in profiles, peers or the people count
    const s = await page.evaluate(() => {
      const st = (window as any).__agora.store.get();
      return { profiles: Object.keys(st.profiles), peers: st.peers ?? [] };
    });
    expect(s.profiles.some((id: string) => id.startsWith('npc:'))).toBe(false);
    expect(s.peers.some((id: string) => id.startsWith('npc:'))).toBe(false);
    await expect(page.getByText('1 personne en ligne')).toBeVisible();

    // drawn on the canvas with their name and the Bot tag
    const labels: string[] = await page.evaluate(() => (window as any).__agora.view.texts(true));
    for (const name of ['Zoé', 'Félix', 'Théo']) expect(labels).toContain(`${name} · Bot`);

    // the "Personnages" group in the side panel, with a locate button each
    const group = page.getByRole('list', { name: 'Personnages' });
    await expect(group.getByRole('listitem')).toHaveCount(3);
    await expect(group.getByText('Bot').first()).toBeVisible();
    await group.getByRole('button', { name: 'Localiser Théo' }).focus();
    await expect(group.getByRole('button', { name: 'Localiser Théo' })).toBeFocused();
    await page.screenshot({ path: 'test-results/npcs-people.png' });
  });

  test('the brain view (P15.3): needs and why, keyboard-reachable, scoring without Clef', async ({
    page,
  }) => {
    await enter(page);
    await page.waitForFunction(
      () => Object.keys((window as any).__agora.store.get().npcMinds).length === 3,
    );
    const group = page.getByRole('list', { name: 'Personnages' });
    // no NPC_DECIDE_URL in the e2e server: the characters' own scoring decides
    await expect(page.getByText('Décisions : score (Clef non configuré)')).toBeVisible();
    const summary = group.locator('summary', { hasText: 'Cerveau' }).first();
    await summary.focus();
    await expect(summary).toBeFocused();
    await page.keyboard.press('Enter');
    const needs = group.getByRole('list', { name: 'Besoins' }).first();
    await expect(needs.getByRole('meter')).toHaveCount(4);
    await expect(needs.getByRole('meter', { name: /Caféine : \d+ sur 100/ })).toBeVisible();
    // names of people never reach the brain view
    const minds = await page.evaluate(() =>
      JSON.stringify((window as any).__agora.store.get().npcMinds),
    );
    expect(minds).not.toContain('Alice');
    await page.screenshot({ path: 'test-results/npcs-brain.png' });
  });
});

/** Walk beside a character on the open floor until the Talk prompt appears. */
async function walkToCharacter(page: Page, want?: string) {
  await expect
    .poll(
      async () => {
        const r = await page.evaluate((want) => {
          const st = (window as any).__agora.store.get();
          if (st.prompt?.kind === 'talk' && (!want || st.prompt.name === want)) return 'near';
          const me = (window as any).__agora.rendered.get(st.me);
          const best = [...st.npcs]
            .filter((n: any) => !want || n.name === want)
            .sort(
              (a: any, b: any) =>
                Math.hypot(a.x - me.x, a.y - me.y) - Math.hypot(b.x - me.x, b.y - me.y),
            )[0];
          if (best)
            (window as any).__agora.store.set({
              navRequest: { kind: 'point', x: best.x, y: best.y },
            });
          return 'walking';
        }, want);
        return r;
      },
      // a route may go through a teleporter (nav.ts), and the characters keep walking
      { timeout: 90_000, intervals: [1000] },
    )
    .toBe('near');
}

/**
 * Walk up to a character (or the one named `want`) and open the Talk box, as one step: the
 * characters keep walking (P15.3), so the prompt can be gone a moment after it showed. Reads the
 * name and presses X while the prompt is there, and tries again when the box did not open.
 */
async function openTalk(page: Page, want?: string): Promise<string> {
  for (let attempt = 0; attempt < 5; attempt++) {
    await walkToCharacter(page, want);
    const name: string | null = await page.evaluate((want) => {
      const p = (window as any).__agora.store.get().prompt;
      return p?.kind === 'talk' && (!want || p.name === want) ? p.name : null;
    }, want);
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

/**
 * Open the Talk box and wait until it is usable (the notice or the message field). A character that
 * heads home cannot be held (it leaves), and its box closes: then walk to one again.
 */
async function openTalkReady(page: Page, want?: string): Promise<string> {
  for (let attempt = 0; attempt < 5; attempt++) {
    const name = await openTalk(page, want);
    const box = page.getByRole('dialog', { name: `Parler à ${name}` });
    const ready = await Promise.race([
      box.getByRole('button', { name: 'J’accepte' }).waitFor({ timeout: 5_000 }),
      box.getByRole('textbox', { name: `Message pour ${name}` }).waitFor({ timeout: 5_000 }),
    ]).then(
      () => true,
      () => false,
    );
    if (ready) return name;
  }
  throw new Error('the Talk box did not stay open');
}

test.describe('talking to a character (P15.4, ADR-045)', () => {
  test('the AI notice first, then a prepared reply and a model-written one, as bubbles and in the box', async ({
    page,
  }) => {
    await enter(page);
    await page.waitForFunction(() => (window as any).__agora.store.get().npcs.length === 3);
    const name = await openTalkReady(page);
    const box = page.getByRole('dialog', { name: `Parler à ${name}` });
    await expect(box).toBeVisible();

    // the notice names the provider and the country, and nothing can be sent before it is accepted
    await expect(box.getByRole('heading', { name: /Avis/ })).toBeVisible();
    await expect(box.getByText(/fournisseur : Test, pays : Canada/)).toBeVisible();
    await expect(box.getByRole('textbox')).toHaveCount(0);
    await box.getByRole('button', { name: 'J’accepte' }).click();

    const input = box.getByRole('textbox', { name: `Message pour ${name}` });
    await expect(input).toBeFocused();

    // a prepared line: no model involved, so no "(fake)"
    await input.fill('Bonjour!');
    await input.press('Enter');
    const log = box.getByRole('log', { name: 'Conversation' });
    await expect(log.locator('.theirs').first()).toBeVisible({ timeout: 15_000 });
    expect(await log.locator('.theirs').first().innerText()).not.toContain('(fake)');
    // my own line is in my box
    await expect(log.locator('.mine').first()).toContainText('Bonjour!');
    // and drawn over the character's head
    const said: string[] = await page.evaluate(() => (window as any).__agora.view.texts());
    expect(said.some((t) => t.length > 8 && !t.includes('· Bot'))).toBe(true);

    // something no prepared line covers: the model-written reply
    await expect(input).toBeEnabled();
    await expect(box.getByRole('button', { name: 'Envoyer' })).toBeDisabled();
    await input.fill('Quelle est la capitale du Pérou?');
    // the first reply must have arrived before the next message is allowed
    await expect(log.locator('.theirs')).toHaveCount(1);
    await input.press('Enter');
    await expect(log.locator('.theirs').nth(1)).toContainText('(fake)', { timeout: 15_000 });
    await page.screenshot({ path: 'test-results/npcs-talk.png' });

    // what the character remembers about me: nothing yet (no Clef in the e2e server), with a way to erase it
    const memory = box.locator('details.talk-memory');
    await memory.locator('summary').click();
    await expect(memory.getByText(/ne retient rien sur vous/)).toBeVisible();
    await memory.getByRole('button', { name: /Tout oublier/ }).click();
    await expect(page.getByText(/ont tout oublié à votre sujet/)).toBeVisible();

    // the notice can be withdrawn: the box asks again
    await box.getByRole('button', { name: /Retirer mon accord/ }).click();
    await expect(box.getByRole('heading', { name: /Avis/ })).toBeVisible();
    // Escape closes the box
    await page.keyboard.press('Escape');
    await expect(box).toHaveCount(0);
  });

  test('a message sent from a private room is refused by the server', async ({ page }) => {
    await enter(page);
    await page.waitForFunction(() => (window as any).__agora.store.get().npcs.length === 3);
    // walk into the meeting room "salle-a" (global cells x 40..45, y 10..18)
    await page.evaluate(() =>
      (window as any).__agora.store.set({
        navRequest: { kind: 'point', x: 42 * 32 + 16, y: 14 * 32 + 16 },
      }),
    );
    await page.waitForFunction(
      () => (window as any).__agora.store.get().myZone?.kind === 'private',
      null,
      {
        timeout: 30_000,
      },
    );
    await page.evaluate(() =>
      (window as any).__agoraWorld?.send({ t: 'npc:consent', accept: true }),
    );
    await page.evaluate(() =>
      (window as any).__agoraWorld?.send({ t: 'npc:talk', npcId: 'npc:zoe', body: 'Bonjour!' }),
    );
    await page.waitForFunction(
      () => (window as any).__agora.store.get().npcRefused?.reason === 'zone',
      null,
      { timeout: 10_000 },
    );
    // and no line from a character reached this private room
    expect(await page.evaluate(() => (window as any).__agora.store.get().npcLog.length)).toBe(0);
  });
});

test.describe('character voices (P15.6)', () => {
  test.skip(!process.env.AGORA_E2E_VOICE, 'needs python3 and ffmpeg for the fake voice service');

  test('with voices on, a reply is spoken at the volume of its distance; with them off, nothing is', async ({
    page,
  }) => {
    // count the audio elements the page creates
    await page.addInitScript(() => {
      const w = window as any;
      w.__voices = [];
      const Real = window.Audio;
      w.Audio = function (src?: string) {
        const a = new Real(src);
        if (typeof src === 'string' && src.startsWith('blob:'))
          w.__voices.push({ volume: a.volume });
        return a;
      } as any;
    });
    await enter(page);
    await page.waitForFunction(() => (window as any).__agora.store.get().npcs.length === 3);
    const name = await openTalkReady(page);
    const box = page.getByRole('dialog', { name: `Parler à ${name}` });
    const input = box.getByRole('textbox', { name: `Message pour ${name}` });
    // the notice may already be accepted by an earlier test (the account is shared in this run)
    const accept = box.getByRole('button', { name: 'J’accepte' });
    await Promise.race([accept.waitFor(), input.waitFor()]);
    if (await accept.isVisible()) await accept.click();
    await input.fill('Bonjour!');
    await input.press('Enter');
    await expect(box.getByRole('log').locator('.theirs').first()).toBeVisible({ timeout: 15_000 });
    await page.waitForTimeout(1500);
    // voices are off by default: the server never even asked the voice service
    expect(await page.evaluate(() => (window as any).__voices.length)).toBe(0);

    // turn them on in the settings, then talk again
    await page.keyboard.press('Escape');
    await page.getByRole('button', { name: 'Réglages', exact: true }).click();
    await page.getByRole('checkbox', { name: /Voix des personnages/ }).check();
    await page.keyboard.press('Escape');
    await openTalkReady(page, name);
    await expect(box).toBeVisible();
    await input.fill('Merci beaucoup');
    await input.press('Enter');
    await expect(box.getByRole('log').locator('.theirs').nth(1)).toBeVisible({ timeout: 15_000 });
    await expect
      .poll(() => page.evaluate(() => (window as any).__voices.length), { timeout: 15_000 })
      .toBeGreaterThan(0);
    const v = await page.evaluate(() => (window as any).__voices[0]);
    expect(v.volume).toBeGreaterThan(0);
    expect(v.volume).toBeLessThanOrEqual(1);
  });
});
