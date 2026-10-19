import { chromium } from 'playwright-core';
const [file, x, y, w, h, out] = process.argv.slice(2);
const b = await chromium.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true });
const p = await b.newPage({ viewport: { width: 800, height: 800 } });
await p.goto('file:///' + process.cwd().replace(/\\/g,'/') + '/shots/' + file);
await p.evaluate(async ([x,y,w,h]) => {
  const img = document.querySelector('img'); await img.decode();
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  c.getContext('2d').drawImage(img, x, y, w, h, 0, 0, w, h);
  document.body.innerHTML = ''; document.body.style.margin='0'; document.body.style.background='#111';
  c.style.width = w+'px'; c.style.height = h+'px'; document.body.appendChild(c);
}, [Number(x),Number(y),Number(w),Number(h)]);
await p.screenshot({ path: 'shots/' + out });
await b.close();
