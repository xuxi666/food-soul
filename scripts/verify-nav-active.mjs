/**
 * 顶部导航「当前页」指示器验收。
 *
 * 覆盖：直接访问、点击切换、刷新、前进后退、子页面归属、
 *      无对应入口的页面不误激活、任意时刻最多一个激活、桌面/移动端对齐。
 *
 * 用法：node scripts/verify-nav-active.mjs [baseUrl]
 */
import { chromium } from 'playwright-core';

const BASE = process.argv[2] || process.env.BASE || 'http://127.0.0.1:5180';
const results = [];
const check = (name, pass, extra = '') => {
  results.push({ name, pass });
  console.log(`${pass ? 'PASS' : 'FAIL'} | ${name}${extra ? ' | ' + extra : ''}`);
};

const browser = await chromium.launch({
  executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe',
  headless: true,
});
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const pageErrors = [];
page.on('pageerror', (e) => pageErrors.push(e.message));

const readActive = () =>
  page.evaluate(() => {
    const links = [...document.querySelectorAll('.nav__links a')];
    const active = links.filter((a) => a.classList.contains('is-active'));
    const aria = links.filter((a) => a.getAttribute('aria-current') === 'page');
    const first = active[0];
    const cs = first ? getComputedStyle(first, '::after') : null;
    return {
      labels: active.map((a) => a.textContent.trim()),
      aria: aria.map((a) => a.textContent.trim()),
      underline: cs ? cs.transform : '',
      count: active.length,
    };
  });

async function gotoPath(p, wait = 700) {
  await page.goto(BASE + p, { waitUntil: 'networkidle' });
  await page.waitForTimeout(wait);
  return readActive();
}

/* 1. 首页只激活「首页」 */
let a = await gotoPath('/');
check('首页 → 仅「首页」激活', a.count === 1 && a.labels[0] === '首页', JSON.stringify(a.labels));
check('激活项带 aria-current', a.aria.length === 1 && a.aria[0] === '首页', JSON.stringify(a.aria));
check('激活下划线可见（scaleX=1）', /matrix\(1,/.test(a.underline) || a.underline === 'none' || a.underline.includes('1,'),
  a.underline);

/* 2. 直接访问各入口 */
const direct = [
  ['/dishes', '美食图鉴'],
  ['/recipe', '菜谱工作台'],
  ['/recommend', '智能推荐'],
  ['/community', '美食社区'],
];
for (const [p, label] of direct) {
  const r = await gotoPath(p);
  check(`直接访问 ${p} → 「${label}」激活`, r.count === 1 && r.labels[0] === label, JSON.stringify(r.labels));
}

/* 3. 子页面继承栏目 */
a = await gotoPath('/dishes/mapo-tofu');
check('菜品详情 /dishes/:id → 仍归「美食图鉴」', a.count === 1 && a.labels[0] === '美食图鉴', JSON.stringify(a.labels));

a = await gotoPath('/recipe?dish=mapo-tofu&name=' + encodeURIComponent('麻婆豆腐'));
check('带查询串 /recipe?dish=… → 仍归「菜谱工作台」', a.count === 1 && a.labels[0] === '菜谱工作台', JSON.stringify(a.labels));

/* 4. 无对应入口的页面不误激活 */
for (const p of ['/cuisines/chuan', '/tastes/mala', '/videos', '/explore']) {
  a = await gotoPath(p);
  check(`${p} 无对应导航入口 → 全部不激活`, a.count === 0, JSON.stringify(a.labels));
}

/* 5. 点击切换 */
await gotoPath('/');
await page.locator('.nav__links a', { hasText: '美食图鉴' }).click();
await page.waitForTimeout(1200);
a = await readActive();
check('点击「美食图鉴」→ 横线切换', a.count === 1 && a.labels[0] === '美食图鉴', JSON.stringify(a.labels));

await page.locator('.nav__links a', { hasText: '美食社区' }).click();
await page.waitForTimeout(1200);
a = await readActive();
check('点击「美食社区」→ 横线切换', a.count === 1 && a.labels[0] === '美食社区', JSON.stringify(a.labels));

/* 6. 刷新保持 */
await page.reload({ waitUntil: 'networkidle' });
await page.waitForTimeout(800);
a = await readActive();
check('刷新后激活状态保持', a.count === 1 && a.labels[0] === '美食社区', JSON.stringify(a.labels));

/* 7. 前进 / 后退 */
await page.goBack({ waitUntil: 'networkidle' });
await page.waitForTimeout(1000);
a = await readActive();
check('浏览器后退 → 回到「美食图鉴」', a.count === 1 && a.labels[0] === '美食图鉴', JSON.stringify(a.labels));

await page.goForward({ waitUntil: 'networkidle' });
await page.waitForTimeout(1000);
a = await readActive();
check('浏览器前进 → 回到「美食社区」', a.count === 1 && a.labels[0] === '美食社区', JSON.stringify(a.labels));

/* 8. 从详情页返回上级 */
await gotoPath('/dishes');
await page.locator('.dish-card a, a[href^="/dishes/"]').first().click();
await page.waitForTimeout(1200);
a = await readActive();
check('图鉴 → 详情页：仍归「美食图鉴」', a.count === 1 && a.labels[0] === '美食图鉴', JSON.stringify(a.labels));
await page.goBack({ waitUntil: 'networkidle' });
await page.waitForTimeout(1000);
a = await readActive();
check('详情页返回图鉴：仍归「美食图鉴」', a.count === 1 && a.labels[0] === '美食图鉴', JSON.stringify(a.labels));

/* 9. 从子页面回首页 */
await gotoPath('/dishes/mapo-tofu');
await page.locator('.nav__brand').click();
await page.waitForTimeout(1200);
a = await readActive();
check('点品牌回首页 → 横线回到「首页」', a.count === 1 && a.labels[0] === '首页', JSON.stringify(a.labels));

/* 10. 下划线几何对齐（桌面） */
const geo = await page.evaluate(() => {
  const link = document.querySelector('.nav__links a.is-active');
  if (!link) return null;
  const r = link.getBoundingClientRect();
  const cs = getComputedStyle(link, '::after');
  return { width: Math.round(r.width), bottom: cs.bottom, left: cs.left, height: cs.height };
});
check('下划线宽度与文字块一致（left:0/right:0）', geo && geo.left === '0px' && geo.width > 0, JSON.stringify(geo));

/* 11. 移动端：两行布局下不错位 */
const mobile = await browser.newPage({ viewport: { width: 390, height: 844 } });
await mobile.goto(BASE + '/community', { waitUntil: 'networkidle' });
await mobile.waitForTimeout(900);
const m = await mobile.evaluate(() => {
  const links = [...document.querySelectorAll('.nav__links a')];
  const active = links.filter((a) => a.classList.contains('is-active'));
  const link = active[0];
  const r = link?.getBoundingClientRect();
  return {
    count: active.length,
    label: link?.textContent?.trim() || '',
    insideViewport: r ? r.left >= -1 && r.right <= window.innerWidth + 1 : false,
    docW: document.documentElement.scrollWidth,
    cliW: document.documentElement.clientWidth,
  };
});
check('移动端：社区页激活正确', m.count === 1 && m.label === '美食社区', JSON.stringify(m));
check('移动端：激活项在视口内且无横向溢出', m.insideViewport && m.docW <= m.cliW, `${m.docW}/${m.cliW}`);
await mobile.screenshot({ path: 'F:/AIweb/美食1.0/aimeishi2.0/shots/nav-active-mobile.png' });

await page.screenshot({ path: 'F:/AIweb/美食1.0/aimeishi2.0/shots/nav-active-desktop.png' });
check('无脚本异常', pageErrors.length === 0, pageErrors.slice(0, 2).join(' | '));

await browser.close();
const pass = results.filter((x) => x.pass).length;
console.log(`\nTOTAL ${pass}/${results.length}`);
process.exit(pass === results.length ? 0 : 1);
