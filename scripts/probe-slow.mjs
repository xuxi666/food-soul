import { chromium } from 'playwright-core';
const b = await chromium.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true });
const ctx = await b.newContext({ viewport: { width: 1440, height: 900 } });
const p = await ctx.newPage();
const errs = [];
p.on('pageerror', (e) => errs.push(e.message));
p.on('console', (m) => m.type() === 'error' && errs.push(m.text().slice(0, 160)));

async function waitFor(sel, timeout = 90000) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeout) {
    if (await p.locator(sel).count()) return Date.now() - t0;
    await p.waitForTimeout(500);
  }
  return -1;
}

// 首页新布局
await p.goto('http://127.0.0.1:5180/', { waitUntil: 'load' });
await p.waitForTimeout(3000);
await p.screenshot({ path: 'shots/final/20-home-centered.png' });
console.log('home labels visible:', await p.evaluate(() =>
  [...document.querySelectorAll('.cp')].filter((el) => getComputedStyle(el).opacity > 0.4).map((el) => el.querySelector('.cp__name')?.textContent)));

// 推荐
await p.goto('http://127.0.0.1:5180/recommend', { waitUntil: 'load' });
let dt = await waitFor('.pick-card');
console.log('recommend cards in', dt, 'ms');
await p.waitForTimeout(600);
await p.screenshot({ path: 'shots/final/21-recommend-done.png' });

// 菜谱
await p.goto('http://127.0.0.1:5180/recipe?dish=mapo-tofu', { waitUntil: 'load' });
dt = await waitFor('.recipe-card');
console.log('recipe card in', dt, 'ms');
await p.waitForTimeout(800);
await p.screenshot({ path: 'shots/final/22-recipe-done.png' });
console.log('errors:', errs.slice(0, 6));
await b.close();
