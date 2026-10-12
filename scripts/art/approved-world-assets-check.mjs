import { chromium } from '@playwright/test';
import assert from 'node:assert/strict';
const browser = await chromium.launch({ channel: 'msedge' });
try {
  const page = await browser.newPage();
  await page.goto('http://localhost:5173/');
  const report = await page.evaluate(async () => {
    const { loadApprovedWorldArt } = await import('/src/worlds/art/approvedArt.ts');
    const { buildWorldAtlas } = await import('/src/worlds/view3d/atlas3d.ts');
    const art = await loadApprovedWorldArt(),
      atlas = buildWorldAtlas();
    await atlas.ready;
    const alpha = (c) => {
      const a = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
      return Array.from(a).filter((v, i) => i % 4 === 3 && v > 128).length;
    };
    const crops = [...art.crops].filter(([, c]) => alpha(c) < 12).map(([id]) => id);
    const names = ['plume_hen', 'milk_cow', 'cloud_sheep', 'rune_goat'];
    return {
      ready: atlas.artworkReady,
      width: atlas.canvas.width,
      height: atlas.canvas.height,
      crops: art.crops.size,
      icons: art.icons.size,
      badCrops: crops,
      livestock: names.map((id) => ({
        id,
        frames: art.animals.get(id)?.length,
        uv: atlas.uv('animal:' + id),
      })),
      mature: atlas.uv('crop:dawn_radish:4'),
      soil: atlas.uv('top:tilled_soil:4'),
      first: atlas.update(0),
      again: atlas.update(0.1),
      next: atlas.update(0.26),
    };
  });
  assert.equal(report.ready, true);
  assert.equal(report.crops, 90);
  assert.deepEqual(report.badCrops, []);
  assert.ok(report.width <= 4096 && report.height <= 4096);
  assert.equal(report.first, true);
  assert.equal(report.again, false);
  assert.equal(report.next, true);
  for (const a of report.livestock) {
    assert.equal(a.frames, 4);
    assert.ok(a.uv.width > 0);
  }
  assert.ok(report.mature.burial > 0);
  assert.ok(report.soil);
  console.log(JSON.stringify(report, null, 2));
} finally {
  await browser.close();
}
