// Dev helper: open a spike page in headless Chromium and save a screenshot or a data URL it exposes.
// node shot.mjs <url> <out.png> [--dump] [--w=1280 --h=800] [--wait=ms]
import { chromium } from '@playwright/test';
import { writeFileSync } from 'node:fs';
const [url, out] = process.argv.slice(2);
const flag = (k, d) => { const a = process.argv.find((x) => x.startsWith(`--${k}=`)); return a ? a.slice(k.length + 3) : d; };
const b = await chromium.launch({
  executablePath: process.env.PW_CHROMIUM ?? '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
});
const p = await b.newPage({ viewport: { width: +flag('w', 1280), height: +flag('h', 800) } });
const logs = [];
p.on('console', (m) => logs.push(`[${m.type()}] ${m.text()}`));
p.on('pageerror', (e) => logs.push(`[pageerror] ${e.message}`));
await p.goto(url);
await p.waitForTimeout(+flag('wait', 1500));
if (process.argv.includes('--dump')) {
  await p.waitForFunction(() => window.__dump, null, { timeout: 30000 });
  const d = await p.evaluate(() => window.__dump);
  writeFileSync(out, Buffer.from(d.split(',')[1], 'base64'));
} else if (process.argv.includes('--json')) {
  await p.waitForFunction(() => window.__result, null, { timeout: +flag('timeout', 120000) });
  writeFileSync(out, JSON.stringify(await p.evaluate(() => window.__result), null, 2));
} else if (flag('eval')) {
  console.log(JSON.stringify(await p.evaluate(flag('eval')), null, 1));
} else await p.screenshot({ path: out });
console.log(logs.slice(-15).join('\n'));
await b.close();
