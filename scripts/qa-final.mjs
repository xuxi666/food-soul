// 全站 QA：逐页截图 + 控制台错误 + 首页交互冒烟
import { chromium } from 'playwright-core';
import { mkdirSync } from 'node:fs';

const OUT = 'shots/final';
mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch({
  executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe',
  headless: true,
});
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const page = await ctx.newPage();

const errors = [];
page.on('pageerror', (e) => errors.push(`[pageerror] ${e.message}`));
page.on('console', (m) => {
  if (m.type() === 'error') errors.push(`[console] ${m.text().slice(0, 200)}`);
});

const shot = async (name) => {
  await page.screenshot({ path: `${OUT}/${name}.png` });
  console.log('shot', name);
};

// ---------- 首页 ----------
await page.goto('http://127.0.0.1:5180/', { waitUntil: 'load' });
await page.waitForTimeout(2600);
console.log('home nav links:', await page.evaluate(() => document.querySelectorAll('#nav a').length));
console.log('gallery ready:', await page.evaluate(() => !!window.__exhibition?.gallery?.ready));
console.log('cards:', await page.evaluate(() => document.querySelectorAll('.cp').length));
await shot('01-home');

// 键盘：→ 切换
await page.keyboard.press('ArrowRight');
await page.waitForTimeout(900);
console.log('after ArrowRight center name:', await page.evaluate(() => document.querySelector('.cp.is-full .cp__name')?.textContent));
await shot('02-home-keyboard');

// 模式切换
await page.click('.wheel-modes__btn:nth-child(2)');
await page.waitForTimeout(1800);
console.log('after taste switch name:', await page.evaluate(() => document.querySelector('.cp.is-full .cp__name')?.textContent));
await shot('03-home-taste-mode');

// 中心 CTA 进入
await page.click('.cp.is-full .cp__cta:not(.cp__cta--alt)');
await page.waitForTimeout(1400);
console.log('url after CTA:', page.url());
await shot('04-after-reveal');

// ---------- 各页面 ----------
const pages = [
  ['05-cuisine', '/cuisines/chuan', 1600],
  ['06-taste', '/tastes/mala', 1600],
  ['07-dishes', '/dishes', 1500],
  ['08-dish-detail', '/dishes/mapo-tofu', 1600],
  ['09-chat', '/chat/mapo-tofu', 2600],
  ['10-explore', '/explore', 2200],
  ['11-community', '/community', 1800],
  ['12-videos', '/videos?q=' + encodeURIComponent('麻婆豆腐'), 5000],
  ['13-recommend', '/recommend', 6000],
  ['14-recipe', '/recipe?dish=mapo-tofu', 8000],
];

for (const [name, path, wait] of pages) {
  errors.length = 0;
  await page.goto(`http://127.0.0.1:5180${path}`, { waitUntil: 'load' });
  await page.waitForTimeout(wait);
  console.log(`${name}: title=${await page.title()} | errors=${errors.length}`);
  for (const e of errors.slice(0, 4)) console.log('   ', e);
  await shot(name);
}

// ---------- 社区交互 ----------
errors.length = 0;
await page.goto('http://127.0.0.1:5180/community', { waitUntil: 'load' });
await page.waitForTimeout(1500);
const postCount = await page.evaluate(() => document.querySelectorAll('.post').length);
console.log('community posts:', postCount);
if (postCount) {
  await page.click('.post .post__body, .post');
  await page.waitForTimeout(600);
  await shot('15-community-interact');
}
console.log('detail page 做菜视频 link:', await page.evaluate(() => {
  const a = [...document.querySelectorAll('a[href^="/videos"]')];
  return a.length;
}));

await browser.close();
console.log('QA done');
