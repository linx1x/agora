import { expect, test, type Browser, type Page } from '@playwright/test';
import { entryPath, runView } from './views';

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
const T = 32;
const NAMES = ['Alice Tremblay', 'Benoît Gagnon', 'Chloé Roy'];
const st = (p: Page) => p.evaluate(() => (window as any).__agora.store.get());
const online = (p: Page) =>
  p.waitForFunction(() => {
    const w = window as any;
    const s = w.__agora.store.get();
    return s.conn === 'online' && !!s.me && w.__agora.rendered.has(s.me);
  });

async function signIn(browser: Browser, devUser: number, precheck = false, tone = false) {
  const ctx = await browser.newContext();
  // Chromium's fake microphone is silent between short beeps: give it a steady tone instead.
  if (tone)
    await ctx.addInitScript(() => {
      const md = navigator.mediaDevices;
      if (!md) return; // about:blank
      const real = md.getUserMedia.bind(md);
      md.getUserMedia = async (c) => {
        const s = await real(c);
        if (!c?.audio) return s;
        const ac = new AudioContext();
        const o = ac.createOscillator();
        const d = ac.createMediaStreamDestination();
        o.connect(d);
        o.start();
        void ac.resume();
        s.getAudioTracks().forEach((t) => s.removeTrack(t));
        s.addTrack(d.stream.getAudioTracks()[0]!);
        return s;
      };
    });
  // the `2.5d` project (playwright.config.ts) runs the privacy tests in the 2.5D view too (P16.12)
  const view = runView();
  await ctx.addInitScript(
    ([pc, v]) => {
      try {
        localStorage.setItem(
          'agora.settings',
          JSON.stringify({ lighting: false, sounds: false, autoSit: true, precheck: pc }),
        );
        if (v === '2.5d') localStorage.setItem('agora.worldView', v);
      } catch {
        /* about:blank */
      }
    },
    [precheck, view] as const,
  );
  const page = await ctx.newPage();
  opened.push(page);
  page.on('pageerror', (e) => console.log(`[pageerror ${devUser}]`, e.message));
  await page.goto(entryPath(view));
  await page.getByRole('button', { name: NAMES[devUser]! }).click();
  const enterBtn = page
    .getByRole('dialog')
    .getByRole('button', { name: /Entrer dans Agora|Enter Agora/ });
  const ready = precheck
    ? page.getByRole('heading', { name: 'Prêt à entrer?' }).waitFor()
    : page.locator('.control-bar').waitFor();
  await Promise.race([enterBtn.click().catch(() => {}), ready]);
  await ready;
  if (!precheck) {
    await online(page);
    expect(await page.evaluate(() => (window as any).__agora.view.engine)).toBe(
      view === '2.5d' ? '2.5d' : '2d',
    );
  }
  return page;
}

/** Leave the page first so the seat is freed at once, then close. */
async function close(...pages: Page[]) {
  for (const p of pages) {
    await p.goto('about:blank');
    await p.context().close();
  }
}

const goTo = (p: Page, cx: number, cy: number) =>
  p.evaluate(
    ([x, y]) => (window as any).__agora.store.set({ navRequest: { kind: 'point', x, y } }),
    [cx * T + 16, cy * T + 20] as const,
  );
const waitZone = (p: Page, zone: string | null) =>
  p.waitForFunction((z) => ((window as any).__agora.store.get().myZone?.id ?? null) === z, zone, {
    timeout: 60_000,
    polling: 100,
  });
const waitCell = (p: Page, cx: number, cy: number) =>
  p.waitForFunction(
    ([x, y]) => {
      const a = (window as any).__agora;
      const me = a.rendered.get(a.store.get().me);
      return Math.floor(me.x / 32) === x && Math.floor((me.y - 1) / 32) === y;
    },
    [cx, cy] as const,
    { timeout: 60_000, polling: 200 },
  );
/** 'livekit' when the suite runs with LIVEKIT_BIN (ADR-031), else 'p2p'. */
const backend = (p: Page) =>
  p.evaluate(() => (window as any).__agora.store.get().config.mediaBackend as 'livekit' | 'p2p');
/** Screen capture without a picker: a canvas that keeps changing. */
const fakeScreen = (p: Page) =>
  p.evaluate(() => {
    (navigator.mediaDevices as any).getDisplayMedia = async () => {
      const c = document.createElement('canvas');
      c.width = 640;
      c.height = 360;
      const g = c.getContext('2d')!;
      let n = 0;
      setInterval(() => {
        g.fillStyle = `hsl(${(n += 7) % 360} 60% 50%)`;
        g.fillRect(0, 0, 640, 360);
      }, 100);
      return c.captureStream(10);
    };
  });
const mediaOn = (p: Page) =>
  p.evaluate(async () => {
    const m = (window as any).__agoraMedia;
    await m.setMic(true);
    await m.setCam(true);
  });

test('device check: preview, level meter, then enter with the chosen mic and camera', async ({
  browser,
}) => {
  test.setTimeout(90_000);
  const p = await signIn(browser, 2, true, true);
  await expect(p.getByText('Caméra désactivée').first()).toBeVisible();
  expect((await st(p)).conn).not.toBe('online'); // nothing connects before entering
  await p.getByRole('button', { name: 'Micro désactivé' }).click();
  await p.getByRole('button', { name: 'Caméra désactivée' }).click();
  await expect(p.locator('.precheck-preview video')).toBeVisible();
  await expect(p.getByRole('button', { name: 'Micro activé' })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  // the fake microphone beeps: the meter moves at some point
  await p.waitForFunction(
    () => Number(document.querySelector('.meter')?.getAttribute('aria-valuenow')) > 0,
    undefined,
    { timeout: 10_000 },
  );
  await expect(p.getByRole('combobox', { name: 'Micro' })).toBeEnabled(); // labels after access
  await p.getByRole('button', { name: 'Entrer', exact: true }).click();
  await online(p);
  await p.waitForFunction(() => {
    const s = (window as any).__agora.store.get();
    return s.mic && s.cam && s.profiles[s.me]?.mic && s.profiles[s.me]?.cam;
  });
  await close(p);
});

test('push to talk: the mic sends only while the key is held', async ({ browser }) => {
  test.setTimeout(60_000);
  const p = await signIn(browser, 2);
  await p.evaluate(() => {
    const a = (window as any).__agora;
    a.store.set({ settings: { ...a.store.get().settings, pushToTalk: true, pttKey: 'KeyT' } });
  });
  await p.evaluate(() => (window as any).__agoraMedia.setMic(true));
  await p.waitForFunction(() => {
    const s = (window as any).__agora.store.get();
    return s.profiles[s.me]?.ptt === true && s.profiles[s.me]?.mic === true;
  });
  const enabled = () =>
    p.evaluate(() => (window as any).__agoraMedia.audioTrack?.enabled as boolean);
  expect(await enabled()).toBe(false);
  expect((await st(p)).talking).toBe(false);
  await p
    .locator('canvas')
    .first()
    .click({ position: { x: 5, y: 5 } })
    .catch(() => {});
  await p.keyboard.down('t');
  await p.waitForFunction(() => (window as any).__agora.store.get().talking === true);
  expect(await enabled()).toBe(true);
  await expect(p.locator('.ctrl.talking')).toBeVisible();
  await p.keyboard.up('t');
  await p.waitForFunction(() => (window as any).__agora.store.get().talking === false);
  expect(await enabled()).toBe(false);
  // typing in the chat never opens the mic
  await p.keyboard.press('Enter');
  await p.locator('#chat-input').focus();
  await p.keyboard.down('t');
  expect((await st(p)).talking).toBe(false);
  await p.keyboard.up('t');
  await close(p);
});

test('private room isolation with live media: three people, forged signalling, leaving', async ({
  browser,
}) => {
  test.setTimeout(240_000);
  const a = await signIn(browser, 0);
  const b = await signIn(browser, 1);
  const c = await signIn(browser, 2);
  for (const p of [a, b, c]) await mediaOn(p);

  // Hub meeting room "salle-a": interior x 40..45, y 10..18; lane outside its west wall: x 37..38.
  await Promise.all([goTo(a, 41, 15), goTo(b, 44, 12), goTo(c, 38, 15)]);
  await Promise.all([waitZone(a, 'salle-a'), waitZone(b, 'salle-a'), waitCell(c, 38, 15)]);
  const ids = await Promise.all([a, b, c].map(async (p) => (await st(p)).me as string));
  const [ia, ib, ic] = ids;

  // A and B are linked and receive each other's audio and video
  for (const [p, other] of [
    [a, ib],
    [b, ia],
  ] as const)
    await p.waitForFunction(
      (o) => {
        const s = (window as any).__agora.store.get();
        return s.peers.includes(o) && s.remote[o]?.hasVideo === true;
      },
      other,
      { timeout: 20_000 },
    );
  await c.waitForTimeout(1500);
  // C, right behind the wall with mic and camera on, has nothing to or from them
  const sc = await st(c);
  expect(sc.peers).toEqual([]);
  expect(Object.keys(sc.remote)).toEqual([]);
  for (const p of [a, b]) {
    const s = await st(p);
    expect(s.peers).not.toContain(ic);
    expect(Object.keys(s.remote)).not.toContain(ic);
  }

  if ((await backend(a)) === 'livekit') {
    // SFU (ADR-031): A and B hold tokens for the room's own SFU room, C never got one
    const zoneOf = (p: Page) =>
      p.evaluate(() => (window as any).__agoraMedia.debugTransport.grant?.zone?.room ?? null);
    expect(await zoneOf(a)).toBe('agora:hq:zone:salle-a');
    expect(await zoneOf(b)).toBe('agora:hq:zone:salle-a');
    expect(await zoneOf(c)).toBeNull();
    // nothing is relayed peer to peer at all
    await c.evaluate(() => {
      (window as any).__errors = [];
      (window as any).__agoraWorld.on(
        (m: any) => m.t === 'error' && (window as any).__errors.push(m.code),
      );
    });
    await c.evaluate(
      (to) =>
        (window as any).__agoraWorld.send({ t: 'rtc', to, data: { kind: 'offer', sdp: 'v=0' } }),
      ia,
    );
    await c.waitForFunction(() => (window as any).__errors.includes('rtc_off'));
  } else {
    // C forges an offer to A: the server refuses to relay it, A never sees it
    await a.evaluate(() => {
      (window as any).__rtcFrom = [];
      (window as any).__agoraWorld.on(
        (m: any) => m.t === 'rtc' && (window as any).__rtcFrom.push(m.from),
      );
    });
    await c.evaluate(() => {
      (window as any).__errors = [];
      (window as any).__agoraWorld.on(
        (m: any) => m.t === 'error' && (window as any).__errors.push(m.code),
      );
    });
    await c.evaluate(
      (to) =>
        (window as any).__agoraWorld.send({
          t: 'rtc',
          to,
          data: { kind: 'offer', sdp: 'v=0\r\n' },
        }),
      ia,
    );
    await c.waitForFunction(() => (window as any).__errors.includes('rtc_not_linked'));
    await a.waitForTimeout(500);
    expect(await a.evaluate(() => (window as any).__rtcFrom)).not.toContain(ic);
  }

  // B walks out of the door: A loses B within a second of B leaving the room
  await goTo(b, 42, 22);
  await b.waitForFunction(
    () => (window as any).__agora.store.get().myZone?.id !== 'salle-a',
    undefined,
    {
      timeout: 30_000,
      polling: 50,
    },
  );
  await a.waitForFunction(
    (o) => {
      const s = (window as any).__agora.store.get();
      return !s.peers.includes(o) && !s.remote[o];
    },
    ib,
    { timeout: 1000, polling: 50 },
  );
  await close(a, b, c);
});

test('LiveKit: screen sharing reaches linked people only; far listeners cannot subscribe', async ({
  browser,
}) => {
  test.setTimeout(180_000);
  const a = await signIn(browser, 0);
  if ((await backend(a)) !== 'livekit') {
    await close(a); // free the seat: later tests count who is online
    test.skip(true, 'needs the SFU backend (LIVEKIT_BIN)');
  }
  const b = await signIn(browser, 1);
  const c = await signIn(browser, 2);
  for (const p of [a, b, c]) await mediaOn(p);
  await fakeScreen(a);
  // A and B close together on the open floor, C on the floor too but out of reach
  await Promise.all([goTo(a, 38, 13), goTo(b, 38, 16), goTo(c, 42, 22)]);
  await Promise.all([waitCell(a, 38, 13), waitCell(b, 38, 16), waitCell(c, 42, 22)]);
  const [ia, ib] = await Promise.all([a, b].map(async (p) => (await st(p)).me as string));
  await b.waitForFunction((o) => (window as any).__agora.store.get().remote[o]?.hasVideo, ia, {
    timeout: 20_000,
  });
  expect((await st(c)).peers).toEqual([]);

  await a.getByRole('button', { name: 'Écran', exact: true }).click();
  await b.waitForFunction((o) => !!(window as any).__agora.store.get().remote[o]?.screen, ia, {
    timeout: 20_000,
  });
  await expect(b.locator('.screen-tile video')).toHaveCount(1);
  await expect(a.locator('.screen-tile video')).toHaveCount(1); // own preview
  await c.waitForFunction((o) => (window as any).__agora.store.get().profiles[o]?.screen, ia);
  await expect(c.locator('.screen-tile')).toHaveCount(0);

  // C runs a modified client and asks the SFU for A's tracks anyway: A only allows linked people
  await c.evaluate((o) => {
    const t = (window as any).__agoraMedia.debugTransport;
    t.sync = () => {}; // the modified client no longer follows the server's links
    const room = t.floor.room;
    const them = [...room.remoteParticipants.values()].find((p: any) => p.identity === o);
    for (const pub of them.trackPublications.values()) pub.setSubscribed(true);
  }, ia);
  await c.waitForTimeout(3000);
  const got = await c.evaluate((o) => {
    const room = (window as any).__agoraMedia.debugTransport.floor.room;
    const them = [...room.remoteParticipants.values()].find((p: any) => p.identity === o);
    return [...them.trackPublications.values()].map((pub: any) => ({
      source: pub.source,
      track: !!pub.track,
      permission: pub.permissionStatus,
      status: pub.subscriptionStatus,
    }));
  }, ia);
  expect(got.length).toBeGreaterThanOrEqual(3); // mic, camera, screen
  for (const g of got) {
    expect(g.track).toBe(false);
    expect(g.permission).toBe('not_allowed');
  }

  // A stops sharing: B's screen tile goes away
  await a.getByRole('button', { name: 'Écran', exact: true }).click();
  await expect(b.locator('.screen-tile')).toHaveCount(0);
  expect((await st(b)).peers).toContain(ia);
  expect((await st(a)).peers).toContain(ib);
  await close(a, b, c);
});

test('poor connection switches to audio only and peers stop sending video', async ({ browser }) => {
  test.setTimeout(180_000);
  const a = await signIn(browser, 1);
  const b = await signIn(browser, 2);
  for (const p of [a, b]) await mediaOn(p);
  await Promise.all([goTo(a, 41, 15), goTo(b, 44, 12)]);
  await Promise.all([waitZone(a, 'salle-a'), waitZone(b, 'salle-a')]);
  const ia = (await st(a)).me;
  const ib = (await st(b)).me;
  await b.waitForFunction((o) => (window as any).__agora.store.get().remote[o]?.hasVideo, ia, {
    timeout: 20_000,
  });
  await expect(b.locator('.video-strip video')).toHaveCount(2);

  // two rounds of bad samples on A's side
  const bad = { rttMs: 900, lossPct: 15, outKbps: 80 };
  await a.evaluate((s) => {
    const m = (window as any).__agoraMedia;
    m.judge([s]);
    m.judge([s]);
  }, bad);
  await expect(
    a.getByText('Connexion faible : la vidéo est en pause (audio seulement).'),
  ).toBeVisible();
  await b.waitForFunction((o) => (window as any).__agora.store.get().profiles[o]?.lowBw, ia);
  // A shows no video at all; B no longer shows A's video (only its own)
  await expect(a.locator('.video-strip video')).toHaveCount(0);
  await expect(b.locator('.video-strip video')).toHaveCount(1);
  // still talking: the audio link is there
  expect((await st(b)).peers).toContain(ia);
  expect((await st(a)).peers).toContain(ib);

  await a.getByRole('button', { name: 'Réactiver la vidéo' }).click();
  await b.waitForFunction((o) => !(window as any).__agora.store.get().profiles[o]?.lowBw, ia);
  await expect(a.locator('.video-strip video')).toHaveCount(2);
  await close(a, b);
});
