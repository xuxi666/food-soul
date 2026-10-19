import { chromium } from 'playwright-core';
const files = process.argv.slice(2);
const b = await chromium.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true });
const p = await b.newPage();
for (const f of files) {
  await p.goto('file:///' + process.cwd().replace(/\\/g,'/') + '/shots/' + f);
  const r = await p.evaluate(async () => {
    const img = document.querySelector('img');
    await img.decode();
    const c = document.createElement('canvas');
    c.width = img.naturalWidth; c.height = img.naturalHeight;
    const ctx = c.getContext('2d'); ctx.drawImage(img, 0, 0);
    const { data } = ctx.getImageData(0, 0, c.width, c.height);
    const W = c.width, H = c.height;
    const lum = (x, y) => data[(y*W+x)*4] + data[(y*W+x)*4+1] + data[(y*W+x)*4+2];
    const runs = (x) => {
      const out = []; let s = -1;
      for (let y = 0; y <= H; y++) {
        const on = y < H && lum(x, y) > 170;
        if (on && s < 0) s = y;
        if (!on && s >= 0) { if (y - s > 12) out.push([s, y - 1, y - s]); s = -1; }
      }
      return out.sort((a,b)=>b[2]-a[2]).slice(0,2);
    };
    const rowRuns = (y) => {
      const out = []; let s = -1;
      for (let x = 0; x <= W; x++) {
        const on = x < W && lum(x, y) > 170;
        if (on && s < 0) s = x;
        if (!on && s >= 0) { if (x - s > 12) out.push([s, x - 1, x - s]); s = -1; }
      }
      return out;
    };
    return { W, H, colCenter: runs(Math.floor(W*0.5)), rowMid: rowRuns(Math.floor(H*0.5)) };
  });
  console.log(f, JSON.stringify(r));
}
await b.close();
