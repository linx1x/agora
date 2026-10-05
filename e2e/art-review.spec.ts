import { test } from '@playwright/test';
/* eslint-disable @typescript-eslint/no-explicit-any */
test.skip(!process.env.SCREENS, 'set SCREENS=1');
const REGIONS = (process.env.REGIONS ?? 'jungle').split(',');
test('art review', async ({ page }) => {
  test.setTimeout(240_000);
  await page.addInitScript(() =>
    localStorage.setItem(
      'agora.settings',
      JSON.stringify({ lighting: false, sounds: false, autoSit: true, precheck: false }),
    ),
  );
  await page.goto(`/?hour=13`);
  await page.getByRole('button', { name: 'Benoît Gagnon' }).click();
  const enterBtn = page.getByRole('dialog').getByRole('button', { name: /Entrer/ });
  await Promise.race([enterBtn.click().catch(() => {}), page.locator('.control-bar').waitFor()]);
  await page.locator('.control-bar').waitFor();
  await page.evaluate(() => (window as any).__agora.store.set({ panelOpen: false }));
  await page.waitForTimeout(1000);
  for (const region of REGIONS) {
    if (region !== 'hub') {
      const pad = await page.evaluate((r) => {
        const st = (window as any).__agora.store.get();
        const here = st.myRegion;
        return st.map.zones.find(
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
      await page.waitForFunction(
        (r) => (window as any).__agora.store.get().myRegion === r,
        region,
        { timeout: 15_000 },
      );
    }
    const info = await page.evaluate(() => {
      const a = (window as any).__agora;
      const s = a.store.get();
      const r = s.map.regions.find((q: any) => q.id === s.myRegion);
      a.store.set({
        zoom: 0.78,
        navRequest: { kind: 'point', x: r.x + (r.w ?? 40 * 32) / 2, y: r.y + (r.h ?? 30 * 32) / 2 },
      });
      return r;
    });
    console.log(region, JSON.stringify(info));
    await page.waitForTimeout(9000);
    await page.screenshot({ path: `docs/screenshots/review-${region}.png` });
    // a second frame a moment later: animated tiles (pond, waterfall, water) should differ
    await page.waitForTimeout(330);
    await page.screenshot({ path: `docs/screenshots/review-${region}-b.png` });
  }
});
