import { expect, test, type Browser, type Page } from '@playwright/test';

/**
 * Farming in my world, played from the client (P17.21b, ADR-053): the item in hand acts on a cell
 * (a click within reach, or Space on the faced cell) and the server decides. Alice enters her world
 * from her desk, tills bare ground, plants a seed, waters it, chops the oak of the starter drawing,
 * and a pick on bare ground is refused with its message. The bag and the farm change after each.
 * P17.24 adds the build test: a wall placed and picked up, the shovel raising the ground, and a chest
 * that holds a stack until it is taken back out of the dialog.
 * P17.25 adds the craft test: a bench placed from the bag, its recipes opened by an empty hand, and a craft
 * the bag cannot pay for, refused by the server with its message.
 * Runs in the 2D project only: the 2.5D world view reuses the same hooks (P17.15).
 */

/* eslint-disable @typescript-eslint/no-explicit-any */
type AgoraWindow = {
  __agora: {
    store: { get: () => any; set: (p: any) => void; subscribe: (f: () => void) => () => void };
    rendered: Map<string, { x: number; y: number }>;
    view: any;
  };
};

const opened: Page[] = [];
test.afterEach(async () => {
  for (const p of opened.splice(0)) await p.context().close().catch(() => {});
});

const T = 32;
const A = (p: Page) => p.evaluate.bind(p);
const st = (p: Page) => A(p)(() => (window as unknown as AgoraWindow).__agora.store.get());
const world = (p: Page) => A(p)(() => (window as any).__agora.view.world());
const inventory = (p: Page) => A(p)(() => (window as any).__agora.view.inventory());
const cellInfo = (p: Page, cx: number, cy: number) =>
  p.evaluate(([x, y]) => (window as any).__agora.view.cellInfo(x, y), [cx, cy] as const);

/** Enter the office as a dev user (the same path as worlds.spec.ts). */
async function enter(browser: Browser, devUser: number, hour = 13): Promise<Page> {
  const ctx = await browser.newContext();
  await ctx.addInitScript(() => {
    localStorage.setItem(
      'agora.settings',
      JSON.stringify({ lighting: true, sounds: false, autoSit: true, precheck: false }),
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
  return page;
}

/** Walk to the Jungle wing through its pad (a desk of mine lies there). */
async function toJungle(p: Page) {
  if ((await st(p)).myRegion !== 'hub') return;
  const pad = (await st(p)).map.zones.find((z: any) => z.id === 'portal-hub-jungle');
  await goTo(p, Math.floor(pad.x / T), Math.floor(pad.y / T));
  await p.waitForFunction(() => (window as any).__agora.store.get().prompt?.kind === 'teleport', undefined, {
    timeout: 30_000,
    polling: 200,
  });
  await p.getByRole('group', { name: /Téléporteur/ }).getByRole('button', { name: /Jungle/ }).click();
  await p.waitForFunction(() => (window as any).__agora.store.get().myRegion !== 'hub', undefined, {
    timeout: 10_000,
    polling: 200,
  });
  await p.waitForTimeout(600);
}

/** Walk to a cell of the office (the same as a click on it). */
const goTo = (p: Page, cx: number, cy: number) =>
  A(p)(
    ([x, y]) => (window as unknown as AgoraWindow).__agora.store.set({ navRequest: { kind: 'point', x, y } }),
    [cx * T + 16, cy * T + 20] as const,
  );

async function waitPrompt(p: Page, kind: string, timeout = 40_000) {
  await p.waitForFunction((k) => (window as any).__agora.store.get().prompt?.kind === k, kind, {
    timeout,
    polling: 200,
  });
}

/** Walk to a world cell (a click on its top face) and wait until the walker stands on it. */
async function walkWorld(p: Page, cx: number, cy: number, timeout = 90_000) {
  const deadline = Date.now() + timeout;
  for (;;) {
    const lv: number = await p.evaluate(([x, y]) => (window as any).__agora.view.levelAt(x, y), [cx, cy] as const);
    await p.evaluate(
      ([x, y, lvl, t]) =>
        (window as any).__agora.store.set({ navRequest: { kind: 'point', x: x * t + t / 2, y: y * t + t / 2 - 12 * lvl } }),
      [cx, cy, lv, T] as const,
    );
    const there = await p
      .waitForFunction(
        ([x, y]) => {
          const me = (window as any).__agora.view.world();
          return me.cell.cx === x && me.cell.cy === y && me.path === 0;
        },
        [cx, cy],
        { timeout: 20_000, polling: 200 },
      )
      .then(() => true, () => false);
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
}

/** Claim the Jungle desk J-6 as Alice (or keep it if an earlier spec on this server did), and stand in my pod. */
async function claimJungle6(p: Page) {
  const spot = (await st(p)).map.desks.find((d: any) => d.id === 'jungle-6');
  await toJungle(p);
  if ((await st(p)).myDesk !== 'jungle-6') {
    await goTo(p, spot.chair.cx, spot.chair.cy);
    await waitPrompt(p, 'claim');
    await p.getByRole('button', { name: 'Réclamer ce poste' }).click();
    await p.waitForFunction(() => (window as any).__agora.store.get().myDesk === 'jungle-6', undefined, {
      timeout: 30_000,
      polling: 200,
    });
    await p.keyboard.press('x'); // stand up
  }
  await goTo(p, spot.guest.cx, spot.guest.cy);
}

/** Holds an item in hand by its hotbar slot (the slot names its item in `data-item`). */
async function hold(p: Page, item: string) {
  const slot = p.locator(`button.wh-slot[data-item="${item}"]`);
  await slot.click();
  await expect(slot).toHaveAttribute('aria-pressed', 'true');
}

/** A click on the top face of a world cell, as a player does. */
async function clickCell(p: Page, cx: number, cy: number) {
  const info = await cellInfo(p, cx, cy);
  const at = await p.evaluate(
    ([x, y]) => (window as any).__agora.view.toClient(x, y),
    [cx * T + T / 2, cy * T + T / 2 - 12 * info!.level] as const,
  );
  await p.mouse.click(at.x, at.y);
}

/** The first cell of these that is bare meadow ground (no plot, no decor), within reach of the spawn. */
async function freeCell(p: Page, cells: readonly (readonly [number, number])[]) {
  for (const [x, y] of cells) {
    const info = await cellInfo(p, x, y);
    if (info && (info.block === 'meadow_dirt' || info.block === 'meadow_grass') && info.decor === '' && info.plot === null) return [x, y] as const;
  }
  throw new Error('no free meadow cell in reach');
}

/** The first cell of these that is bare meadow, and whose four neighbours are as high as it or one higher (a raise is never a trap). */
async function flatCell(p: Page, cells: readonly (readonly [number, number])[]) {
  for (const [x, y] of cells) {
    const c = await cellInfo(p, x, y);
    if (!c || (c.block !== 'meadow_dirt' && c.block !== 'meadow_grass') || c.decor !== '' || c.plot !== null) continue;
    let flat = true;
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
      const n = await cellInfo(p, x + dx, y + dy);
      if (!n || n.level < c.level || n.level > c.level + 1) flat = false;
    }
    if (flat) return [x, y] as const;
  }
  throw new Error('no flat meadow cell in reach');
}

test('farming in my world: till, plant, water, chop, and a refusal with its message', async ({ browser }) => {
  test.setTimeout(400_000);
  const a = await enter(browser, 0, 20);
  await claimJungle6(a);

  // standing in my own pod, off the chair: X enters my world (the server creates it on first entry)
  await waitPrompt(a, 'world');
  await a.keyboard.press('x');
  await waitWorld(a);
  await expect(a.locator('nav.wh-hud')).toBeVisible();
  await expect(a.locator('button.wh-slot[data-item="hoe_1"]')).toBeVisible({ timeout: 30_000 });

  // the bag at the start: the starter kit
  const kit = await inventory(a);
  expect(kit.hoe_1).toBe(1);
  expect(kit.dawn_radish_seed).toBeGreaterThan(0);

  // in reach of the spawn: the cell I click has no plot and no decor yet
  const [sx, sy] = await freeCell(a, [
    [0, -1],
    [-1, 0],
    [1, 0],
    [-1, 1],
    [1, 1],
  ]);

  // till: the hoe turns bare ground into a plot, and the swing is played
  await hold(a, 'hoe_1');
  await clickCell(a, sx, sy);
  await a.waitForFunction(
    ([x, y]) => (window as any).__agora.view.cellInfo(x, y)?.plot != null,
    [sx, sy],
    { timeout: 30_000, polling: 200 },
  );
  expect((await world(a)).swings).toBeGreaterThan(0);

  // plant: a seed in hand on the plot, and the bag loses one seed
  const seeds = (await inventory(a)).dawn_radish_seed ?? 0;
  await hold(a, 'dawn_radish_seed');
  await clickCell(a, sx, sy);
  await a.waitForFunction(
    ([x, y]) => (window as any).__agora.view.cellInfo(x, y)?.plot?.crop?.crop === 'dawn_radish',
    [sx, sy],
    { timeout: 30_000, polling: 200 },
  );
  await expect.poll(async () => (await inventory(a)).dawn_radish_seed ?? 0, { timeout: 30_000 }).toBe(seeds - 1);

  // water: the can wets the plot for tomorrow's growth step (a watering on day D sets D + 1)
  await hold(a, 'can_1');
  await clickCell(a, sx, sy);
  await a.waitForFunction(
    ([x, y]) => {
      const info = (window as any).__agora.view.cellInfo(x, y);
      return info?.plot != null && info.plot.wateredOn === info.farmDay + 1;
    },
    [sx, sy],
    { timeout: 30_000, polling: 200 },
  );

  // chop: the oak of the starter drawing stands at (-3, 5); I walk beside it and fell it with an axe
  await walkWorld(a, -3, 6);
  const softwoodBefore = (await inventory(a)).softwood ?? 0;
  await hold(a, 'axe_1');
  await clickCell(a, -3, 5);
  await a.waitForFunction(
    () => (window as any).__agora.view.cellInfo(-3, 5)?.decor === '',
    undefined,
    { timeout: 30_000, polling: 200 },
  );
  await expect
    .poll(async () => (await inventory(a)).softwood ?? 0, { timeout: 30_000 })
    .toBeGreaterThanOrEqual(softwoodBefore + 2);

  // a refusal: a pick on bare ground has nothing to mine, and says so in the HUD's polite status line
  await hold(a, 'pick_1');
  await clickCell(a, -2, 6);
  await expect(a.locator('.wh-notice')).toHaveText(/déjà fait ou disparu/, { timeout: 30_000 });

  // the walker's world is still mine: the same world id, and the farm holds my plot
  expect((await world(a)).id).toBeTruthy();
  expect((await cellInfo(a, sx, sy))?.plot).not.toBeNull();
});

test('building in my world: a wall placed and picked up, the ground raised, and a chest that holds a stack', async ({ browser }) => {
  test.setTimeout(400_000);
  const a = await enter(browser, 0, 20);
  await claimJungle6(a);
  await waitPrompt(a, 'world');
  await a.keyboard.press('x');
  await waitWorld(a);
  await expect(a.locator('button.wh-slot[data-item="hoe_1"]')).toBeVisible({ timeout: 30_000 });

  // the cells in reach of the spawn (a feet point in cell 0,0 reaches these, not the diagonals above it)
  const around: (readonly [number, number])[] = [
    [0, 1],
    [1, 1],
    [-1, 1],
    [0, -1],
    [-1, 0],
    [1, 0],
  ];

  // a wall from the bag onto bare ground, and the pick takes it back into the bag
  const [wx, wy] = await freeCell(a, around);
  const walls = (await inventory(a)).wood_wall ?? 0;
  await hold(a, 'wood_wall');
  await clickCell(a, wx, wy);
  await a.waitForFunction(([x, y]) => (window as any).__agora.view.cellInfo(x, y)?.decor === 'wood_wall', [wx, wy], {
    timeout: 30_000,
    polling: 200,
  });
  await expect.poll(async () => (await inventory(a)).wood_wall ?? 0, { timeout: 30_000 }).toBe(walls - 1);
  await hold(a, 'pick_1');
  await clickCell(a, wx, wy);
  await a.waitForFunction(([x, y]) => (window as any).__agora.view.cellInfo(x, y)?.decor === '', [wx, wy], {
    timeout: 30_000,
    polling: 200,
  });
  await expect.poll(async () => (await inventory(a)).wood_wall ?? 0, { timeout: 30_000 }).toBe(walls);

  // the shovel raises a flat cell by one level (Shift would lower it)
  const [rx, ry] = await flatCell(a, around.filter(([x, y]) => x !== wx || y !== wy));
  const before = (await cellInfo(a, rx, ry))!.level;
  await hold(a, 'shovel_1');
  await clickCell(a, rx, ry);
  await a.waitForFunction(
    ([x, y, lv]) => (window as any).__agora.view.cellInfo(x, y)?.level === lv + 1,
    [rx, ry, before],
    { timeout: 30_000, polling: 200 },
  );

  // a chest on bare ground: the bag loses it, and the cell holds it
  const [cx, cy] = await freeCell(
    a,
    around.filter(([x, y]) => (x !== wx || y !== wy) && (x !== rx || y !== ry)),
  );
  await hold(a, 'chest');
  await clickCell(a, cx, cy);
  await a.waitForFunction(([x, y]) => (window as any).__agora.view.cellInfo(x, y)?.decor === 'chest', [cx, cy], {
    timeout: 30_000,
    polling: 200,
  });

  // the walls go into the chest: the whole stack leaves the bag, and the hand is empty again
  await hold(a, 'wood_wall');
  await clickCell(a, cx, cy);
  await expect.poll(async () => (await inventory(a)).wood_wall ?? 0, { timeout: 30_000 }).toBe(0);
  await expect(a.locator('.wh-hand')).toHaveText(/Rien en main/, { timeout: 30_000 });

  // an empty hand on the chest opens it: the dialog lists the stack, and Take brings it back
  await clickCell(a, cx, cy);
  const panel = a.getByRole('dialog', { name: 'Coffre' });
  await expect(panel).toBeVisible({ timeout: 30_000 });
  await panel.getByRole('button', { name: /Prendre Mur de bois/ }).click();
  await expect.poll(async () => (await inventory(a)).wood_wall ?? 0, { timeout: 30_000 }).toBe(walls);
  await panel.getByRole('button', { name: 'Fermer le coffre' }).click();
  await expect(panel).toBeHidden();
});

test('crafting in my world: a bench placed from the bag opens its recipes, and a craft the bag cannot pay for is refused', async ({ browser }) => {
  test.setTimeout(300_000);
  const a = await enter(browser, 0, 20);
  await claimJungle6(a);
  await waitPrompt(a, 'world');
  await a.keyboard.press('x');
  await waitWorld(a);
  await expect(a.locator('button.wh-slot[data-item="hoe_1"]')).toBeVisible({ timeout: 30_000 });

  // the cells in reach of the spawn (the same as the building test)
  const around: (readonly [number, number])[] = [
    [0, 1],
    [1, 1],
    [-1, 1],
    [0, -1],
    [-1, 0],
    [1, 0],
  ];

  // a bench from the bag onto bare ground: the bag loses it, and the cell holds it
  const [bx, by] = await freeCell(a, around);
  await hold(a, 'workbench');
  await clickCell(a, bx, by);
  await a.waitForFunction(([x, y]) => (window as any).__agora.view.cellInfo(x, y)?.decor === 'workbench', [bx, by], {
    timeout: 30_000,
    polling: 200,
  });
  await expect.poll(async () => (await inventory(a)).workbench ?? 0, { timeout: 30_000 }).toBe(0);
  await expect(a.locator('.wh-hand')).toHaveText(/Rien en main/, { timeout: 30_000 });

  // an empty hand on the bench opens its recipes: the panel is the client's, the craft is the server's
  await clickCell(a, bx, by);
  const panel = a.getByRole('dialog', { name: 'Établi' });
  await expect(panel).toBeVisible({ timeout: 30_000 });

  // a fence needs softwood and fiber, which the starter bag does not hold: the server refuses it
  await panel.getByRole('button', { name: /Clôture/ }).click();
  await expect(a.locator('.wh-notice')).toHaveText(/Il te manque quelque chose/, { timeout: 30_000 });
  expect((await inventory(a)).fence ?? 0).toBe(0);
  expect((await cellInfo(a, bx, by))!.decor).toBe('workbench');
});
