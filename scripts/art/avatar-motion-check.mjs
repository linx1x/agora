/** Source-art check: run with the Vite dev server, then inspect the contact sheet. */
import { chromium } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';
import assert from 'node:assert/strict';
const out = 'test-results/avatar-motion';
await mkdir(out, { recursive: true });
const browser = await chromium.launch({ channel: process.env.ART_REVIEW_BROWSER ?? 'msedge' });
try {
  const page = await browser.newPage();
  await page.goto(process.env.AVATAR_DEV_URL ?? 'http://localhost:5173');
  const result = await page.evaluate(async () => {
    const { wardrobeFrame } = await import('/src/game/wardrobeArt.ts');
    const { ACTION_MOTIONS, motionFrameAt, motionDuration } =
      await import('/src/game/avatarMotion.ts');
    const { PaperFigures } = await import('/src/game3d/paperFigures.ts');
    const THREE = await import('/node_modules/.vite/deps/three.js');
    const clips = [
      ...Object.keys(ACTION_MOTIONS),
      'wave',
      'thumbs',
      'heart',
      'laugh',
      'hand',
      'clap',
      'idle',
      'talk',
      'sitDown',
      'standUp',
    ];
    const base = {
      skin: 2,
      hair: 0,
      hairColor: 1,
      top: 1,
      bottom: 0,
      accessory: 0,
      belt: 1,
      buckle: 1,
    };
    const variants = [
      base,
      { ...base, gender: 1, hair: 8, vest: 1, top: 5, bottomStyle: 2, accessory: 5 },
      { ...base, hair: 3, skin: 5, costume: 1, accessory: 4 },
      { ...base, gender: 2, hair: 6, vest: 2, costume: 2 },
      { ...base, hair: 1, hairColor: 6, costume: 3 },
      { ...base, hair: 7, top: 7, costume: 4, accessory: 7 },
    ];
    let checked = 0;
    const clipped = [];
    for (const [variant, a] of variants.entries())
      for (const dir of ['down', 'right', 'up', 'left'])
        for (const clip of clips) {
          const frames = new Set();
          for (let frame = 0; frame < 6; frame++) {
            const cv = wardrobeFrame(a, dir, 'walk', 0, { clip, frame, tier: 1 + (variant % 3) });
            frames.add(cv.toDataURL());
            const d = cv.getContext('2d').getImageData(0, 0, cv.width, cv.height).data;
            let opaque = 0,
              edge = 0;
            for (let y = 0; y < cv.height; y++)
              for (let x = 0; x < cv.width; x++) {
                const alpha = d[(y * cv.width + x) * 4 + 3];
                if (!alpha) continue;
                opaque++;
                if (alpha !== 255) throw Error('Soft alpha');
                if (x === 0 || x === cv.width - 1 || y === 0 || y === cv.height - 1) edge++;
              }
            if (opaque < 500) throw Error(`Blank ${clip} ${dir}`);
            if (edge) clipped.push(`${variant}:${clip}:${dir}:${frame}`);
            checked++;
          }
          if (frames.size < 2) throw Error(`Static ${clip} ${dir}`);
        }
    // Exercise the actual GPU-facing resource owner: stable anchor, interruption and teardown.
    const scene = new THREE.Scene(),
      figures = new PaperFigures(scene, 1);
    const pose = { x: 32, y: 32, dir: 'right', pose: 'stand', moving: false, poseAt: 0, elev: 2 };
    figures.place('test', base, pose, 5000);
    const before = figures.box('test');
    for (const clip of clips) {
      figures.cancelAction('test');
      figures.playAction('test', clip, 5000, { duration: 1000 });
      figures.place('test', base, pose, 5500);
      if (!figures.info('test').frame.startsWith(clip + '-')) throw Error('Figure missed ' + clip);
      if (figures.box('test').y0 !== before.y0) throw Error('Foot anchor moved');
    }
    figures.place('test', base, { ...pose, moving: true }, 5600);
    if (!/^right-\d$/.test(figures.info('test').frame)) throw Error('Movement failed to interrupt');
    figures.dispose();
    if (scene.children.length) throw Error('Leaked figures');
    // A crowd shares CPU artwork without overwriting another figure's current texture.
    const crowdScene = new THREE.Scene(),
      crowd = new PaperFigures(crowdScene, 1);
    const createElement = document.createElement.bind(document);
    let canvasAllocations = 0;
    document.createElement = (name, options) => {
      if (name === 'canvas') canvasAllocations++;
      return createElement(name, options);
    };
    const crowdStart = performance.now();
    let contactCanvases;
    try {
      for (let i = 0; i < 50; i++) {
        crowd.playAction(`crowd-${i}`, 'chop', 0, { dir: 'right' });
        crowd.place(`crowd-${i}`, base, pose, 0);
      }
      const firstImage = crowdScene.children[0].children[0].material.map.image;
      const beforeContact = firstImage.toDataURL();
      canvasAllocations = 0;
      for (let i = 1; i < 50; i++) crowd.place(`crowd-${i}`, base, pose, 170);
      if (firstImage.toDataURL() !== beforeContact)
        throw Error('Shared art mutated an idle figure');
      crowd.place('crowd-0', base, pose, 170);
      contactCanvases = canvasAllocations;
      if (contactCanvases > 2) throw Error('Crowd rebuilt identical motion artwork');
    } finally {
      document.createElement = createElement;
      crowd.dispose();
    }
    const crowdMs = Math.round(performance.now() - crowdStart);
    if (crowdScene.children.length) throw Error('Leaked crowd');
    const selected = [
      'chop',
      'till',
      'water',
      'plant',
      'harvest',
      'craft',
      'eat',
      'sleep',
      'wave',
      'clap',
      'heart',
      'talk',
    ];
    const sheet = document.createElement('canvas');
    sheet.width = 840;
    sheet.height = selected.length * 134;
    const g = sheet.getContext('2d');
    g.fillStyle = '#eee7d6';
    g.fillRect(0, 0, sheet.width, sheet.height);
    g.font = 'bold 13px sans-serif';
    g.imageSmoothingEnabled = false;
    selected.forEach((clip, row) => {
      g.fillStyle = '#354c3a';
      g.fillText(clip.toUpperCase(), 12, row * 134 + 16);
      for (let frame = 0; frame < 6; frame++)
        g.drawImage(
          wardrobeFrame(variants[row % variants.length], row % 2 ? 'down' : 'right', 'walk', 0, {
            clip,
            frame,
          }),
          6 + frame * 138,
          row * 134 + 18,
        );
    });
    const film = [];
    for (let tick = 0; tick < 24; tick++) {
      const cv = document.createElement('canvas');
      cv.width = 960;
      cv.height = 792;
      const c = cv.getContext('2d');
      c.fillStyle = '#eee7d6';
      c.fillRect(0, 0, cv.width, cv.height);
      c.imageSmoothingEnabled = false;
      c.font = 'bold 15px sans-serif';
      selected.forEach((clip, i) => {
        const x = (i % 4) * 240,
          y = Math.floor(i / 4) * 264;
        const dir = i % 2 ? 'down' : 'right';
        const duration = motionDuration(clip, dir);
        const elapsed = (tick * 100) % (duration + 250);
        const frame = motionFrameAt(clip, elapsed, duration, false, dir);
        c.drawImage(
          wardrobeFrame(variants[i % variants.length], dir, 'walk', 0, {
            clip,
            frame,
          }),
          x - 8,
          y + 8,
          256,
          224,
        );
        c.fillStyle = '#354c3a';
        c.fillText(clip.toUpperCase(), x + 20, y + 246);
      });
      film.push(cv.toDataURL());
    }
    const directions = document.createElement('canvas');
    directions.width = 1072;
    directions.height = 700;
    const dc = directions.getContext('2d');
    dc.fillStyle = '#eee7d6';
    dc.fillRect(0, 0, directions.width, directions.height);
    dc.font = '13px sans-serif';
    ['chop', 'water', 'harvest', 'eat', 'clap'].forEach((clip, row) =>
      ['up', 'left', 'down', 'right'].forEach((dir, col) =>
        [2, 3].forEach((frame, f) => {
          dc.fillStyle = '#354c3a';
          dc.fillText(`${clip} ${dir} ${frame}`, col * 268 + f * 134 + 10, row * 140 + 15);
          dc.drawImage(
            wardrobeFrame({ ...base, hair: 8, accessory: 4, vest: 2, costume: 2 }, dir, 'walk', 0, {
              clip,
              frame,
            }),
            col * 268 + f * 134,
            row * 140 + 20,
          );
        }),
      ),
    );
    return {
      checked,
      clipped,
      sheet: sheet.toDataURL(),
      directions: directions.toDataURL(),
      film,
      crowdMs,
      contactCanvases,
    };
  });
  await writeFile(`${out}/contact-sheet.png`, Buffer.from(result.sheet.split(',')[1], 'base64'));
  await writeFile(`${out}/directions.png`, Buffer.from(result.directions.split(',')[1], 'base64'));
  for (const [i, data] of result.film.entries())
    await writeFile(`${out}/frame-${i}.png`, Buffer.from(data.split(',')[1], 'base64'));
  assert.deepEqual(result.clipped, [], 'gesture/tool pixels must fit inside their frame');
  console.log(
    `Passed ${result.checked} frames: all actions, directions, wardrobe variants; pixel edges, stable feet, movement interruption and cleanup.`,
  );
  console.log(
    `50 matching figures: ${result.contactCanvases} new canvases for contact; ${result.crowdMs}ms setup, two poses and cleanup (CPU check, not game FPS).`,
  );
} finally {
  await browser.close();
}
