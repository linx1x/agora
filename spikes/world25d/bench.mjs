// P16.1 benchmark runner: opens each engine/config in headless Chromium and saves the JSON results.
// Headless Chromium here renders with SwiftShader (software GL): a worst case, not a laptop or phone.
// node bench.mjs [baseUrl] [outFile]
import { chromium } from '@playwright/test';
import { writeFileSync, mkdirSync } from 'node:fs';
const base = process.argv[2] ?? 'http://localhost:5190';
const out = process.argv[3] ?? 'results/headless-swiftshader.json';
const sec = Number(process.env.SEC ?? 12);
const runs = [
  ['three', 'lights=1'],
  ['three', 'lights=0'],
  ['three', 'lights=1&shadows=1'],
  ['phaser', ''],
  ['three', 'lights=1&bots=50'],
  ['phaser', 'bots=50'],
  ['three', 'lights=1&scale=0.5'],
  ['phaser', 'scale=0.5'],
];
const b = await chromium.launch({
  executablePath: process.env.PW_CHROMIUM ?? '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
});
const results = [];
for (const [engine, q] of runs) {
  const p = await b.newPage({ viewport: { width: 1280, height: 720 } });
  const url = `${base}/${engine}.html?bench=1&sec=${sec}&${q}`;
  await p.goto(url);
  await p.waitForFunction(() => window.__result, null, { timeout: (sec + 60) * 1000 });
  const r = await p.evaluate(() => window.__result);
  results.push({ run: `${engine} ${q || 'default'}`, ...r });
  console.log(`${engine.padEnd(6)} ${(q || 'default').padEnd(22)} fps ${r.fpsMean} p95 ${r.frameMsP95} ms work ${r.workMsMean} ms calls ${r.drawCallsMean} first ${r.firstFrameMs} ms`);
  await p.close();
}
await b.close();
mkdirSync('results', { recursive: true });
writeFileSync(out, JSON.stringify(results, null, 1));
