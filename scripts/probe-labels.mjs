import { chromium } from 'playwright-core';
const b = await chromium.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true });
const ctx = await b.newContext({ viewport: { width: 1440, height: 900 } });
const p = await ctx.newPage();
p.on('pageerror', (e) => console.log('[pageerror]', e.message));
await p.goto('http://127.0.0.1:5180/', { waitUntil: 'load' });
await p.waitForTimeout(2800);
await p.click('.wheel-modes__btn:nth-child(2)');
await p.waitForTimeout(2200);

const data = await p.evaluate(() => {
  const g = window.__exhibition.gallery;
  const cps = [...document.querySelectorAll('.cp')];
  return {
    items: g.items.map((it) => it.label),
    rotation: g.rotation,
    selected: g.selected,
    cps: cps.map((el, i) => ({
      i,
      text: (el.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 40),
      rect: (() => { const r = el.getBoundingClientRect(); return [Math.round(r.left), Math.round(r.top), Math.round(r.width), Math.round(r.height)]; })(),
      opacity: getComputedStyle(el).opacity,
      info: g.screenInfo ? g.screenInfo(i) : null,
    })),
  };
});
console.log(JSON.stringify(data, null, 1));
await p.screenshot({ path: 'shots/final/probe-labels.png' });
await b.close();
