import { expect, test, type Browser, type Page } from '@playwright/test';

/**
 * Personal worlds (P17.14, ADR-053): a claimed desk is a door to its owner's world. The owner
 * walks, crosses a level step, comes back to the desk; a visitor is held at the knock and let in.
 * Runs in the 2.5D view (WorldRoom3DView, ADR-054), the only view. The specs read the hooks of
 * `window.__agora.view`.
 */

/* eslint-disable @typescript-eslint/no-explicit-any */
type AgoraWindow = {
  __agora: {
    store: { get: () => any; set: (p: any) => void; subscribe: (f: () => void) => () => void };
    setHeld: (codes: string[]) => void;
    rendered: Map<string, { x: number; y: number }>;
    view: any;
  };
};

const opened: Page[] = [];
test.afterEach(async () => {
  for (const p of opened.splice(0))
    await p
      .context()
      .close()
      .catch(() => {});
});

const T = 32;
const A = (p: Page) => p.evaluate.bind(p);
const st = (p: Page) => A(p)(() => (window as unknown as AgoraWindow).__agora.store.get());
const view = (p: Page) => A(p)(() => (window as unknown as AgoraWindow).__agora.view);
const world = (p: Page) => A(p)(() => (window as any).__agora.view.world());

/** Enter the office as a dev user (the same path as world.spec.ts). */
async function enter(browser: Browser, devUser: number, hour = 13): Promise<Page> {
  const ctx = await browser.newContext();
  await ctx.addInitScript(() => {
    localStorage.setItem(
      'agora.settings',
      JSON.stringify({ lighting: false, sounds: false, autoSit: true, precheck: false }),
    );
  });
  const page = await ctx.newPage();
  opened.push(page);
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
  expect(await view(page).then((v) => v.engine)).toBe('2.5d');
  return page;
}

/** Teleport from the hub to the Jungle wing through its pad (as world.spec.ts). */
async function toJungle(p: Page) {
  // the server keeps the wing across specs on one server: already there is fine
  if ((await st(p)).myRegion !== 'hub') return;
  const pad = (await st(p)).map.zones.find((z: any) => z.id === 'portal-hub-jungle');
  await goTo(p, Math.floor(pad.x / T), Math.floor(pad.y / T));
  await p.waitForFunction(
    () => (window as any).__agora.store.get().prompt?.kind === 'teleport',
    undefined,
    {
      timeout: 30_000,
      polling: 200,
    },
  );
  await p
    .getByRole('group', { name: /Téléporteur/ })
    .getByRole('button', { name: /Jungle/ })
    .click();
  await p.waitForFunction(() => (window as any).__agora.store.get().myRegion !== 'hub', undefined, {
    timeout: 10_000,
    polling: 200,
  });
  await p.waitForTimeout(600);
}

/** Walk to a cell (the same as a click on it). */
const goTo = (p: Page, cx: number, cy: number) =>
  A(p)(
    ([x, y]) =>
      (window as unknown as AgoraWindow).__agora.store.set({ navRequest: { kind: 'point', x, y } }),
    [cx * T + 16, cy * T + 20] as const,
  );

/**
 * Walk to a cell of the world: a click on the middle of its top face. A raised cell is drawn
 * higher (12 px a level), so the feet point of a raised cell lies on the top of the row to its south.
 */
const goWorld = (p: Page, cx: number, cy: number) =>
  p.evaluate(
    ([x, y, t]) => {
      const a = (window as any).__agora;
      const lv: number = a.view.levelAt(x, y);
      a.store.set({ navRequest: { kind: 'point', x: x * t + t / 2, y: y * t + t / 2 - 12 * lv } });
    },
    [cx, cy, T] as const,
  );

async function waitPrompt(p: Page, kind: string, timeout = 40_000) {
  await p.waitForFunction((k) => (window as any).__agora.store.get().prompt?.kind === k, kind, {
    timeout,
    polling: 200,
  });
}

/**
 * Walk to a world cell and wait until the walker stands on it. The walker drops a route its feet
 * cannot follow (a corner the box does not fit): then the click is sent again, as a player would.
 */
async function walkWorld(p: Page, cx: number, cy: number, timeout = 90_000) {
  const deadline = Date.now() + timeout;
  for (;;) {
    await goWorld(p, cx, cy);
    const there = await p
      .waitForFunction(
        ([x, y]) => {
          const me = (window as any).__agora.view.world();
          return me.cell.cx === x && me.cell.cy === y && me.path === 0;
        },
        [cx, cy],
        { timeout: 20_000, polling: 200 },
      )
      .then(
        () => true,
        () => false,
      );
    if (there) return;
    if (Date.now() > deadline) throw new Error(`the walker did not reach ${cx},${cy}`);
  }
}

async function waitWorld(p: Page, timeout = 30_000) {
  await p.waitForFunction(() => (window as any).__agora.store.get().worldId !== null, undefined, {
    timeout,
    polling: 200,
  });
  await p.waitForFunction(() => (window as any).__agora.view?.world?.().id != null, undefined, {
    timeout,
    polling: 200,
  });
  expect(await p.evaluate(() => (window as any).__agora.view.engine)).toBe('2.5d');
}

/** Claim the Jungle desk J-6 as Alice (sit, claim, stand, step into the pod off the chair). */
async function claimJungle6(p: Page) {
  const spot = (await st(p)).map.desks.find((d: any) => d.id === 'jungle-6');
  await toJungle(p);
  // a desk kept from an earlier spec on the same server is already mine: no claim again
  if ((await st(p)).myDesk !== 'jungle-6') {
    await goTo(p, spot.chair.cx, spot.chair.cy);
    await waitPrompt(p, 'claim');
    await p.getByRole('button', { name: 'Réclamer ce poste' }).click();
    await p.waitForFunction(
      () => (window as any).__agora.store.get().myDesk === 'jungle-6',
      undefined,
      {
        timeout: 30_000,
        polling: 200,
      },
    );
    await p.keyboard.press('x'); // stand up
  }
  await goTo(p, spot.guest.cx, spot.guest.cy);
  return spot;
}

/** From my pod: X into my world, then the return pad back to the desk (creates the world once). */
async function visitMyWorldOnce(p: Page) {
  await waitPrompt(p, 'world');
  await p.keyboard.press('x');
  await waitWorld(p);
  await walkWorld(p, -1, 3);
  await waitPrompt(p, 'worldExit', 60_000);
  await p.keyboard.press('x');
  await p.waitForFunction(() => (window as any).__agora.store.get().worldId === null, undefined, {
    timeout: 30_000,
    polling: 200,
  });
}

test('my world: enter from my desk, walk, cross a level step, come back to the desk', async ({
  browser,
}) => {
  test.setTimeout(300_000);
  const a = await enter(browser, 0, 20);
  await claimJungle6(a);

  // standing in my own pod, off the chair: X enters my world (the server creates it on first entry)
  await waitPrompt(a, 'world');
  await a.keyboard.press('x');
  await waitWorld(a);
  let w = await world(a);
  expect(w.id).toBeTruthy();
  expect(w.people).toBe(1);
  expect((await st(a)).prompt).toBeNull();

  // FIX-1: the card names the world and its owner; never the desk pod, and no office minimap
  const card = (await a.locator('.room-name').textContent()) ?? '';
  expect(card).toContain('Monde de Alice Tremblay');
  expect(card).toContain('Seules les personnes dans ce monde vous entendent');
  expect(card).not.toMatch(/Poste|poste/);
  await expect(a.locator('.minimap-wrap')).toHaveCount(0);

  // P17.15b: the People panel lists the people of this world only (me), not the office roster
  await a.evaluate(() => (window as any).__agora.store.set({ panelOpen: true, panel: 'people' }));
  const panel = a.getByRole('complementary');
  await expect(panel.getByText('1 personne dans ce monde')).toBeVisible();
  await expect(panel.getByText('Dans ce monde', { exact: true })).toBeVisible();
  await expect(panel.getByText('Personnages')).toHaveCount(0);
  await expect(panel.getByText(/Poste de|Reconnexion/)).toHaveCount(0);

  // the starter house is flat: holding right moves me east (polled: headless frames are slow)
  const before = w;
  await a.evaluate(() => (window as any).__agora.setHeld(['ArrowRight']));
  await a.waitForFunction((x0) => (window as any).__agora.view.world().x > x0 + 40, before.x, {
    timeout: 30_000,
    polling: 100,
  });
  await a.evaluate(() => (window as any).__agora.setHeld([]));
  await a.waitForTimeout(300);
  w = await world(a);
  expect(w.cellsDrawn).toBeGreaterThan(100);

  // cross a level step: a walkable cell one level away, out of the flat starter square, that
  // the route reaches (the server validates every move of it)
  const target = await a.evaluate(() => {
    const v = (window as any).__agora.view;
    const me = v.world();
    const lv0 = v.levelAt(me.cell.cx, me.cell.cy);
    const seen = new Set<string>([`${me.cell.cx},${me.cell.cy}`]);
    const q: [number, number][] = [[me.cell.cx, me.cell.cy]];
    for (let i = 0; i < q.length; i++) {
      const [x, y] = q[i]!;
      const lv = v.levelAt(x, y);
      if (lv !== lv0 && Math.abs(lv - lv0) === 1) return { cx: x, cy: y, level: lv };
      for (const [dx, dy] of [
        [1, 0],
        [-1, 0],
        [0, 1],
        [0, -1],
      ] as const) {
        const nx = x + dx;
        const ny = y + dy;
        const k = `${nx},${ny}`;
        if (seen.has(k) || Math.max(Math.abs(nx - me.cell.cx), Math.abs(ny - me.cell.cy)) > 24)
          continue;
        seen.add(k);
        if (!v.walkableAt(nx, ny) || Math.abs(v.levelAt(nx, ny) - lv) > 1) continue;
        q.push([nx, ny]);
      }
    }
    return null;
  });
  expect(target, 'a level step reachable from the starter square').not.toBeNull();
  await walkWorld(a, target!.cx, target!.cy);
  w = await world(a);
  expect(w.level).toBe(target!.level);

  // back to the return pad (the starter's one portal) and out to the desk
  const pad = { cx: -1, cy: 3 };
  await walkWorld(a, pad.cx, pad.cy);
  await waitPrompt(a, 'worldExit', 60_000);
  await a.keyboard.press('x');
  await a.waitForFunction(() => (window as any).__agora.store.get().worldId === null, undefined, {
    timeout: 30_000,
    polling: 200,
  });
  const s = await st(a);
  expect(s.myDesk).toBe('jungle-6');
  // back at the guest spot inside my own pod: the office offers my world again (its ticks are ~3 Hz)
  await waitPrompt(a, 'world');
  expect((await st(a)).prompt).toMatchObject({ kind: 'world', deskId: 'jungle-6' });
  // the office is back and I am in it again (drawn where the office puts me)
  await a.waitForFunction((me) => (window as any).__agora.rendered.has(me), s.me, {
    timeout: 20_000,
  });
  // back in the office the card is the desk again, and the minimap is back
  await expect(a.locator('.room-name')).toContainText('Poste de Alice Tremblay');
  await expect(a.locator('.minimap-wrap')).toHaveCount(1);
});

test('a visitor is held at the knock, then let into the owner world', async ({ browser }) => {
  test.setTimeout(300_000);
  const a = await enter(browser, 0, 20);
  await claimJungle6(a);
  await visitMyWorldOnce(a);
  // knock access: nobody enters my pod (or my world) without my say-so
  await a.getByRole('button', { name: 'Mon poste', exact: true }).click();
  await a.getByText('Frapper', { exact: true }).click();
  await a.getByRole('dialog').getByRole('button', { name: 'Enregistrer' }).click();
  await a.waitForFunction(
    () =>
      (window as any).__agora.store.get().desks.find((d: any) => d.id === 'jungle-6')?.access ===
      'knock',
    undefined,
    { timeout: 30_000, polling: 200 },
  );

  const b = await enter(browser, 1);
  await toJungle(b);
  await A(b)(
    (id) =>
      (window as unknown as AgoraWindow).__agora.store.set({ navRequest: { kind: 'person', id } }),
    (await st(a)).me,
  );
  // held at the pod's door: the knock prompt, never the world prompt, and no world for me
  await waitPrompt(b, 'knock');
  expect((await st(b)).worldId).toBeNull();
  expect((await st(b)).prompt?.kind).not.toBe('world');

  // Alice lets Benoît in; now the door opens into Alice's world
  await b.getByRole('button', { name: 'Frapper', exact: true }).click();
  await a.getByRole('button', { name: 'Faire entrer' }).click();
  await b.waitForFunction(
    () => (window as any).__agora.store.get().admitted.includes('jungle-6'),
    undefined,
    {
      timeout: 30_000,
      polling: 200,
    },
  );
  // admitted, Benoît steps through the door into the pod: the world prompt is inside it
  const podB = (await st(b)).map.desks.find((d: any) => d.id === 'jungle-6');
  await goTo(b, podB.guest.cx, podB.guest.cy);
  await waitPrompt(b, 'world');
  expect((await st(b)).prompt).toMatchObject({ kind: 'world', deskId: 'jungle-6' });
  await b.keyboard.press('x');
  await waitWorld(b);
  expect((await world(b)).people).toBe(1);
  expect((await st(b)).worldId).toBe((await world(b)).id);
});

test('the away rule (P17.27): a person on my list comes in while I am away, and learns what they may do', async ({
  browser,
}) => {
  test.setTimeout(300_000);
  const a = await enter(browser, 0, 20);
  await claimJungle6(a);
  await visitMyWorldOnce(a);
  await a.getByRole('button', { name: 'Mon poste', exact: true }).click();
  await a.getByText('Frapper', { exact: true }).click();
  await a.getByRole('dialog').getByRole('button', { name: 'Enregistrer' }).click();
  const b = await enter(browser, 1);
  await toJungle(b);

  // Alice puts Benoît on her list from the People panel, and lets her list in while she is away
  await a.getByRole('button', { name: 'Ajouter Benoît Gagnon à ma liste de visiteurs' }).click();
  const panel = a.getByRole('dialog', { name: 'Visiteurs de mon monde' });
  await expect(panel.getByText('Benoît Gagnon', { exact: true })).toBeVisible();
  await expect(panel.getByRole('checkbox', { name: /Sur ma liste/ })).toBeChecked();
  await panel.getByRole('radio', { name: 'Les personnes de ma liste' }).check();
  await expect(panel.getByRole('radio', { name: 'Les personnes de ma liste' })).toBeChecked();
  await a.screenshot({ path: 'test-results/visitors-panel.png' });
  // the list is Alice's alone
  expect((await st(b)).worldVisitors).toBeNull();
  await a.context().close();

  // Alice is away: Benoît knocks and the rule lets him in, then he steps into her world
  const spot = (await st(b)).map.desks.find((d: any) => d.id === 'jungle-6');
  await goTo(b, spot.entrance.cx, spot.entrance.cy);
  await waitPrompt(b, 'knock');
  await b.getByRole('button', { name: 'Frapper', exact: true }).click();
  await b.waitForFunction(
    () => (window as any).__agora.store.get().admitted.includes('jungle-6'),
    undefined,
    { timeout: 30_000, polling: 200 },
  );
  await goTo(b, spot.guest.cx, spot.guest.cy);
  await waitPrompt(b, 'world');
  await b.keyboard.press('x');
  await waitWorld(b);
  await expect(b.getByText(/En visite : vous pouvez arroser/)).toBeVisible();
  expect((await st(b)).worldMine).toBe(false);
  await b.screenshot({ path: 'test-results/visitors-visit.png' });
  await b.context().close();

  // clean up for the specs after this one: nobody while away, Benoît off the list, the desk open
  const a2 = await enter(browser, 0, 20);
  await a2.getByRole('button', { name: 'Visiteurs de mon monde' }).click();
  const p2 = a2.getByRole('dialog', { name: 'Visiteurs de mon monde' });
  await p2.getByRole('radio', { name: 'Personne', exact: true }).check();
  await p2.getByRole('button', { name: 'Retirer Benoît Gagnon' }).click();
  await expect(p2.getByText('Benoît Gagnon', { exact: true })).toHaveCount(0);
});
