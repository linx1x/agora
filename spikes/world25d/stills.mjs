// P16.2: render the art stills headlessly and save them to stills/*.png.
// node stills.mjs [baseUrl]
import { chromium } from '@playwright/test';
import { mkdirSync, writeFileSync } from 'node:fs';
const base = process.argv[2] ?? 'http://localhost:5190';
const b = await chromium.launch({
  executablePath: process.env.PW_CHROMIUM ?? '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
});
const p = await b.newPage({ viewport: { width: 1600, height: 1000 } });
p.on('pageerror', (e) => console.log('pageerror', e.message));
p.on('console', (m) => m.type() === 'error' && !/404/.test(m.text()) && console.log(m.text()));
await p.goto(`${base}/stills.html`, { waitUntil: 'commit' });
await p.waitForFunction(() => window.__done, null, { timeout: 600000 });
const shots = await p.evaluate(() => window.__shots);
mkdirSync('stills', { recursive: true });
for (const [name, url] of Object.entries(shots)) {
  writeFileSync(`stills/${name}.png`, Buffer.from(url.split(',')[1], 'base64'));
  console.log('saved', name);
}
await b.close();
