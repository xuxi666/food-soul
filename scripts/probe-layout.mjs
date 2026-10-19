import { chromium } from 'playwright-core';
const b = await chromium.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true });
const ctx = await b.newContext({ viewport: { width: 1440, height: 900 } });
const p = await ctx.newPage();
const errs = [];
p.on('pageerror', (e) => errs.push(e.message));
p.on('console', (m) => m.type() === 'error' && errs.push(m.text().slice(0, 160)));

// 桌面：图鉴
await p.goto('http://127.0.0.1:5180/dishes', { waitUntil: 'load' });
await p.waitForTimeout(1200);
const cols = await p.evaluate(() => {
  const cards = [...document.querySelectorAll('.dish-card')];
  const tops = new Map();
  for (const c of cards) { const t = Math.round(c.getBoundingClientRect().top / 10) * 10; tops.set(t, (tops.get(t) || 0) + 1); }
  return { total: cards.length, perRow: [...tops.values()] };
});
console.log('dishes desktop:', JSON.stringify(cols));
await p.screenshot({ path: 'shots/final/30-dishes-fixed.png' });

// 移动端：首页 + 图鉴 + 社区
await p.setViewportSize({ width: 390, height: 844 });
for (const [name, path, wait] of [
  ['31-home-mobile', '/', 3200],
  ['32-dishes-mobile', '/dishes', 1600],
  ['33-community-mobile', '/community', 1600],
  ['34-chat-mobile', '/chat/mapo-tofu', 2600],
]) {
  await p.goto(`http://127.0.0.1:5180${path}`, { waitUntil: 'load' });
  await p.waitForTimeout(wait);
  await p.screenshot({ path: `shots/final/${name}.png` });
  const overflow = await p.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  console.log(`${name}: horizontal overflow=${overflow}px, errors=${errs.length}`);
  errs.length = 0;
}
await b.close();
