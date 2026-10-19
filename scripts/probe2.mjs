import { chromium } from 'playwright-core';
const b = await chromium.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true, args: ['--use-angle=swiftshader','--enable-unsafe-swiftshader'] });
const ctx = await b.newContext({ viewport: { width: 1440, height: 900 } });
const p = await ctx.newPage();
await p.goto('http://127.0.0.1:5180/', { waitUntil: 'load' });
await p.waitForFunction(()=>window.__exhibition?.gallery?.ready===true,null,{timeout:20000});
await p.waitForTimeout(2000);
console.log(JSON.stringify(await p.evaluate(() => {
  const h = document.querySelector('.hero');
  const t = document.querySelector('.hero__title');
  const cs = getComputedStyle(h), ct = getComputedStyle(t);
  return {
    body: document.body.className,
    heroOpacity: cs.opacity, heroTransform: cs.transform, heroRect: h.getBoundingClientRect().toJSON(),
    titleOpacity: ct.opacity, titleColor: ct.color, titleRect: t.getBoundingClientRect().toJSON(),
    hintOpacity: getComputedStyle(document.querySelector('.hint')).opacity,
  };
}), null, 1));
await b.close();
