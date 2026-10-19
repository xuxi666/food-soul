import { chromium } from 'playwright-core';
const b = await chromium.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true, args: ['--use-angle=swiftshader','--enable-unsafe-swiftshader'] });
const ctx = await b.newContext({ viewport: { width: 1280, height: 800 } });
const p = await ctx.newPage();
p.on('console', m => console.log('[console]', m.type(), m.text()));
p.on('pageerror', e => console.log('[pageerror]', e.message));
await p.addInitScript(() => {
  const orig = HTMLCanvasElement.prototype.getContext;
  HTMLCanvasElement.prototype.getContext = function (type, ...args) {
    if (String(type).indexOf('webgl') === 0) return null;
    return orig.call(this, type, ...args);
  };
});
await p.goto('http://127.0.0.1:5180/', { waitUntil: 'load' });
await p.waitForTimeout(1500);
console.log('probe ctx:', await p.evaluate(() => String(document.createElement('canvas').getContext('webgl'))));
console.log('body:', await p.evaluate(() => document.body.className));
console.log('gallery:', await p.evaluate(() => !!window.__exhibition.gallery));
console.log('items:', await p.evaluate(() => document.querySelectorAll('.fallback__item').length));
await b.close();
