/**
 * Visual tour for docs/screenshots (run with SCREENS=1 pnpm e2e e2e/screens.spec.ts).
 * Skipped in normal CI runs.
 */
import { test, type Page } from '@playwright/test';

/* eslint-disable @typescript-eslint/no-explicit-any */
const T = 32;
test.skip(!process.env.SCREENS, 'set SCREENS=1 to capture screenshots');

async function tour(page: Page, hour: number) {
  await page.addInitScript(() =>
    localStorage.setItem(
      'agora.settings',
      JSON.stringify({ lighting: true, sounds: false, autoSit: true, precheck: false }),
    ),
  );
  await page.goto(`/?hour=${hour}`);
  await page.getByRole('button', { name: 'Benoît Gagnon' }).click();
  const enterBtn = page.getByRole('dialog').getByRole('button', { name: /Entrer/ });
  await Promise.race([enterBtn.click().catch(() => {}), page.locator('.control-bar').waitFor()]);
  await page.locator('.control-bar').waitFor();
  await page.evaluate(() => (window as any).__agora.store.set({ panelOpen: false }));
  await page.waitForTimeout(1500);
  await page.screenshot({ path: `docs/screenshots/tour-${hour}h-atrium.png` });
  for (const region of ['jungle', 'boreal', 'oasis', 'zen']) {
    const pad = await page.evaluate((r) => {
      const s = (window as any).__agora.store.get();
      const here = s.myRegion;
      return s.map.zones.find(
        (z: any) =>
          z.kind === 'portal' && z.region === here && (here === 'hub' ? z.props.to === r : true),
      );
    }, region);
    await page.evaluate(
      ([x, y]) => (window as any).__agora.store.set({ navRequest: { kind: 'point', x, y } }),
      [pad.x + 16, pad.y + 20],
    );
    await page.waitForFunction(
      () => (window as any).__agora.store.get().prompt?.kind === 'teleport',
      undefined,
      { timeout: 60_000 },
    );
    await page.evaluate((to) => (window as any).__agoraWorld.send({ t: 'teleport', to }), region);
    await page.waitForFunction((r) => (window as any).__agora.store.get().myRegion === r, region, {
      timeout: 15_000,
    });
    // walk into the middle of the pod rows
    await page.evaluate(() => {
      const a = (window as any).__agora;
      const s = a.store.get();
      const r = s.map.regions.find((q: any) => q.id === s.myRegion);
      a.store.set({ navRequest: { kind: 'point', x: r.x + 12 * 32, y: r.y + 10 * 32 } });
    });
    await page.waitForTimeout(9000);
    await page.screenshot({ path: `docs/screenshots/tour-${hour}h-${region}.png` });
  }
  void T;
}

test('tour day', async ({ page }) => {
  test.setTimeout(300_000);
  await tour(page, 13);
});
test('tour evening', async ({ page }) => {
  test.setTimeout(300_000);
  await tour(page, 20);
});
