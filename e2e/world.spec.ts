import { mkdirSync, writeFileSync } from 'node:fs';
import { expect, test, type Browser, type Page } from '@playwright/test';
import { runView } from './views';

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
type AgoraWindow = {
  __agora: {
    store: { get: () => any; set: (p: any) => void };
    setHeld: (codes: string[]) => void;
    rendered: Map<string, { x: number; y: number }>;
  };
  __agoraGame: any;
};
const A = (p: Page) => p.evaluate.bind(p);
const T = 32;

/**
 * The `2.5d` project (playwright.config.ts) runs these specs in the 2.5D view (P16.12): this
 * device is told through its storage, lighting is off there (the software GPU cannot draw the lit
 * 2.5D look in time; the lit look has its own tests in world25d.spec.ts), and the engine is checked.
 */
async function enter(browser: Browser, devUser: number, hour = 13): Promise<Page> {
  const view = runView();
  const ctx = await browser.newContext();
  // keep lighting on in tests regardless of the software GPU's frame rate (2D)
  await ctx.addInitScript(
    ([v]) => {
      localStorage.setItem(
        'agora.settings',
        JSON.stringify({ lighting: v === '2d', sounds: false, autoSit: true, precheck: false }),
      );
      if (v === '2.5d') localStorage.setItem('agora.worldView', v);
    },
    [view] as const,
  );
  const page = await ctx.newPage();
  opened.push(page);
  page.on('pageerror', (e) => console.log(`[pageerror ${devUser}]`, e.message));
  await page.goto(`/?hour=${hour}`);
  await page
    .getByRole('button', { name: ['Alice Tremblay', 'Benoît Gagnon', 'Chloé Roy'][devUser]! })
    .click();
  const enterBtn = page
    .getByRole('dialog')
    .getByRole('button', { name: /Entrer dans Agora|Enter Agora/ });
  await Promise.race([enterBtn.click().catch(() => {}), page.locator('.control-bar').waitFor()]);
  await page.waitForFunction(() => {
    const w = window as unknown as AgoraWindow;
    const s = w.__agora.store.get();
    return s.conn === 'online' && !!s.me && w.__agora.rendered.has(s.me);
  });
  expect(await page.evaluate(() => (window as any).__agora.view.engine)).toBe(
    view === '2.5d' ? '2.5d' : '2d',
  );
  return page;
}

const st = (p: Page) => A(p)(() => (window as unknown as AgoraWindow).__agora.store.get());
const myPos = (p: Page) =>
  A(p)(() => {
    const a = (window as unknown as AgoraWindow).__agora;
    return a.rendered.get(a.store.get().me)!;
  });
const goTo = (p: Page, cx: number, cy: number) =>
  A(p)(
    ([x, y]) =>
      (window as unknown as AgoraWindow).__agora.store.set({ navRequest: { kind: 'point', x, y } }),
    [cx * T + 16, cy * T + 20] as const,
  );
async function teleport(p: Page, padCx: number, padCy: number, to: string) {
  await goTo(p, padCx, padCy);
  await p.waitForFunction(
    () => {
      const s = (window as any).__agora.store.get();
      return s.prompt?.kind === 'teleport';
    },
    undefined,
    { timeout: 30_000, polling: 200 },
  );
  await p
    .getByRole('group', { name: /Téléporteur/ })
    .getByRole('button', { name: new RegExp(to) })
    .click();
  await p.waitForFunction(
    () => {
      const s = (window as any).__agora.store.get();
      return s.myRegion !== 'hub';
    },
    undefined,
    { timeout: 10_000, polling: 200 },
  );
  await p.waitForTimeout(600);
}

test('two people see each other move and stop, chat, and connect media nearby', async ({
  browser,
}) => {
  const a = await enter(browser, 0);
  const b = await enter(browser, 1);
  await expect(a.getByText('2 personnes en ligne')).toBeVisible();

  const before = await myPos(a);
  await a.bringToFront();
  await A(a)(() => (window as unknown as AgoraWindow).__agora.setHeld(['ArrowLeft']));
  await a.waitForTimeout(600);
  await A(a)(() => (window as unknown as AgoraWindow).__agora.setHeld([]));
  await a.waitForTimeout(250);
  const after = await myPos(a);
  expect(after.x).toBeLessThan(before.x - 40);
  const aId = (await st(a)).me;
  await b.waitForFunction(
    ([id, x]) =>
      Math.abs(
        ((window as unknown as AgoraWindow).__agora.rendered.get(id as string)?.x ?? 0) -
          (x as number),
      ) < 2,
    [aId, after.x] as const,
    { timeout: 1000 },
  );
  // Regression: the remote avatar must stop its walk animation once A stops.
  await b.waitForTimeout(500);
  const frame = await A(b)((id) => (window as any).__agora.view.avatarFrame(id), aId);
  expect(frame).toMatch(/-0$/);

  await a.waitForFunction(() => (window as any).__agora.store.get().peers.length === 1);
  await a
    .getByRole('button', { name: /Caméra/ })
    .first()
    .click();
  await b.waitForFunction(
    () =>
      Object.values((window as unknown as AgoraWindow).__agora.store.get().remote).some(
        (r: any) => r.hasVideo,
      ),
    null,
    { timeout: 15000 },
  );

  await a.keyboard.press('Enter');
  await a.locator('#chat-input').fill('Bonjour Benoît!');
  await a.locator('#chat-input').press('Enter');
  await b.getByRole('tab', { name: /Clavardage/ }).click();
  await expect(b.locator('.messages')).toContainText('Bonjour Benoît!');
  await a.locator('#chat-input').blur();
  // the doc screenshot and the tileset export are the 2D view's (the 2.5D run leaves them alone)
  if (runView() === '2d') {
    mkdirSync('docs/screenshots', { recursive: true });
    await a.screenshot({ path: 'docs/screenshots/agora-two-people.png' });

    const png = await A(a)(() =>
      (window as unknown as AgoraWindow).__agoraGame.textures
        .get('agora-office')
        .getSourceImage()
        .toDataURL('image/png'),
    );
    mkdirSync('apps/web/public/assets/tiles', { recursive: true });
    writeFileSync(
      'apps/web/public/assets/tiles/agora-office.png',
      Buffer.from(png.split(',')[1]!, 'base64'),
    );
  }
  await a.context().close();
  await b.context().close();
});

test('desk pod: claim, knock access, visitor knocks and is let in, pod voice links only them', async ({
  browser,
}) => {
  test.setTimeout(240_000);
  const a = await enter(browser, 0, 20);
  const c = await enter(browser, 2);
  const map = (await st(a)).map;
  const spot = map.desks.find((d: any) => d.id === 'jungle-6');
  const pad = map.zones.find((z: any) => z.id === 'portal-hub-jungle');
  const padCell = [Math.floor(pad.x / T), Math.floor(pad.y / T)] as const;

  // Alice: teleport to the Jungle, sit at desk J-6 and claim it
  await teleport(a, padCell[0], padCell[1], 'Jungle');
  await goTo(a, spot.chair.cx, spot.chair.cy);
  await a.waitForFunction(
    () => {
      const s = (window as any).__agora.store.get();
      return s.prompt?.kind === 'claim';
    },
    undefined,
    { timeout: 30_000, polling: 200 },
  );
  await a.getByRole('button', { name: 'Réclamer ce poste' }).click();
  await a.waitForFunction(
    () => {
      const s = (window as any).__agora.store.get();
      return s.myDesk === 'jungle-6';
    },
    undefined,
    { timeout: 30_000, polling: 200 },
  );
  // Set access to Knock through the desk dialog
  await a.getByRole('button', { name: 'Mon poste', exact: true }).click();
  await a.getByText('Frapper', { exact: true }).click();
  await a.getByRole('dialog').getByRole('button', { name: 'Enregistrer' }).click();
  await a.waitForFunction(
    () => {
      const s = (window as any).__agora.store.get();
      return s.desks.find((d) => d.id === 'jungle-6').access === 'knock';
    },
    undefined,
    { timeout: 30_000, polling: 200 },
  );

  // Chloé: teleport and walk to Alice (stops at the pod entrance because of Knock)
  await teleport(c, padCell[0], padCell[1], 'Jungle');
  await c.waitForFunction(
    () => {
      const s = (window as any).__agora.store.get();
      return s.desks.find((d) => d.id === 'jungle-6').ownerName === 'Alice Tremblay';
    },
    undefined,
    { timeout: 30_000, polling: 200 },
  );
  await A(c)(
    (id) =>
      (window as unknown as AgoraWindow).__agora.store.set({ navRequest: { kind: 'person', id } }),
    (await st(a)).me,
  );
  await c.waitForFunction(
    () => {
      const s = (window as any).__agora.store.get();
      return s.prompt?.kind === 'knock';
    },
    undefined,
    { timeout: 40_000, polling: 200 },
  );
  expect((await st(c)).myZone?.kind).not.toBe('desk');
  expect((await st(c)).peers).toEqual([]);
  await c.getByRole('button', { name: 'Frapper', exact: true }).click();
  await a.getByRole('button', { name: 'Faire entrer' }).click();
  await c.waitForFunction(
    () => {
      const s = (window as any).__agora.store.get();
      return s.admitted.includes('jungle-6');
    },
    undefined,
    { timeout: 30_000, polling: 200 },
  );
  await goTo(c, spot.guest.cx, spot.guest.cy);
  await c.waitForFunction(
    () => {
      const s = (window as any).__agora.store.get();
      return s.myZone?.id === 'jungle-6';
    },
    undefined,
    { timeout: 30_000, polling: 200 },
  );
  await c.waitForFunction(
    () => {
      const s = (window as any).__agora.store.get();
      return s.peers.length === 1;
    },
    undefined,
    { timeout: 30_000, polling: 200 },
  );
  await a.waitForFunction(
    () => {
      const s = (window as any).__agora.store.get();
      return s.peers.length === 1;
    },
    undefined,
    { timeout: 30_000, polling: 200 },
  );
  await expect(c.locator('.room-name')).toContainText(
    'Seules les personnes dans ce poste vous entendent',
  );
  await a.screenshot({ path: 'docs/screenshots/agora-desk-pod-evening.png' });
  await a.context().close();
  await c.context().close();
});

test('private room isolates a person standing outside the wall', async ({ browser }) => {
  test.setTimeout(180_000);
  const a = await enter(browser, 1); // Benoît: no desk, spawns in the Atrium
  const c = await enter(browser, 2);
  // Hub meeting room "salle-a": interior x 40..45, y 10..18; door at (42..43, 19). Lane outside its wall: x 37..38.
  await goTo(a, 41, 15);
  await a.waitForFunction(
    () => {
      const s = (window as any).__agora.store.get();
      return s.myZone?.id === 'salle-a';
    },
    undefined,
    { timeout: 30_000, polling: 200 },
  );
  await goTo(c, 38, 15);
  await c.waitForFunction(
    () => {
      const a = (window as any).__agora;
      const p = a.rendered.get(a.store.get().me);
      return Math.floor(p.x / 32) === 38 && Math.floor((p.y - 1) / 32) === 15;
    },
    undefined,
    { timeout: 60_000, polling: 200 },
  );
  await c.waitForTimeout(800);
  const cp = await myPos(c);
  expect(Math.floor(cp.x / T)).toBeLessThanOrEqual(38);
  expect((await st(c)).peers).toEqual([]);
  expect((await st(a)).peers).toEqual([]);
  await expect(a.locator('.room-name')).toContainText(
    'Seules les personnes dans cette salle vous entendent',
  );
  await a.screenshot({ path: 'docs/screenshots/agora-private-room.png' });
  await a.context().close();
  await c.context().close();
});
