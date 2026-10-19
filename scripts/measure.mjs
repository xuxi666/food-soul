import { chromium } from 'playwright-core';
const files = process.argv.slice(2);
const b = await chromium.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true });
const p = await b.newPage();
for (const f of files) {
  const url = 'file:///' + process.cwd().replace(/\\/g,'/') + '/shots/' + f;
  await p.goto(url);
  const r = await p.evaluate(async () => {
    const img = document.querySelector('img');
    await img.decode();
    const c = document.createElement('canvas');
    c.width = img.naturalWidth; c.height = img.naturalHeight;
    const ctx = c.getContext('2d');
    ctx.drawImage(img, 0, 0);
    const { data } = ctx.getImageData(0, 0, c.width, c.height);
    const lum = (x, y) => data[(y*c.width+x)*4] + data[(y*c.width+x)*4+1] + data[(y*c.width+x)*4+2];
    const W = c.width, H = c.height;
    let top = H, bot = 0, left = W, right = 0;
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      if (lum(x,y) > 170) { if (y<top) top=y; if (y>bot) bot=y; if (x<left) left=x; if (x>right) right=x; }
    }
    // bbox of the central bright object only
    let ctop=H, cbot=0;
    const cx = Math.floor(W/2);
    for (let x = cx-4; x <= cx+4; x++) for (let y=0;y<H;y++) if (lum(x,y)>170) { if(y<ctop)ctop=y; if(y>cbot)cbot=y; }
    return { W, H, bbox:[left,top,right,bot], centerCol:[ctop,cbot,cbot-ctop] };
  });
  console.log(f, JSON.stringify(r));
}
await b.close();
