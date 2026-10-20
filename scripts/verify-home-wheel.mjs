// 首页轮播稳定性回归：重复点击 / 模式切换 / 往返 / 刷新后卡片都必须可见
import { chromium } from 'playwright-core';

const BASE = process.env.BASE || 'http://127.0.0.1:5180';
const results = [];
const check = (n, pass, extra = '') => {
  results.push(pass);
  console.log(`${pass ? 'PASS' : 'FAIL'} | ${n}${extra ? ' | ' + extra : ''}`);
};

const b = await chromium.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true });
const errs = [];

async function newPage(viewport = { width: 1440, height: 900 }) {
  const p = await b.newPage({ viewport });
  p.on('pageerror', (e) => errs.push(e.message));
  p.on('console', (m) => { if (m.type() === 'error' && !/40[13]/.test(m.text())) errs.push(m.text()); });
  return p;
}

/** 卡片可见性：canvas 不透明 + 画廊实例存在且有卡片 */
async function wheel(p) {
  return p.evaluate(() => {
    const c = document.querySelector('.stage canvas');
    const cs = c ? getComputedStyle(c) : null;
    const g = window.__exhibition?.gallery;
    return {
      route: document.body.dataset.route,
      opacity: cs?.opacity ?? 'none',
      transform: cs?.transform ?? 'none',
      items: g?.items?.length ?? -1,
      nodes: window.__exhibition?.nodes?.length ?? -1,
    };
  });
}
// scale(1) 的计算值是 matrix(1, 0, 0, 1, 0, 0)，不是 none
const identity = (t) => t === 'none' || /^matrix\(1,\s*0,\s*0,\s*1,\s*0,\s*0\)$/.test(String(t));
const visible = (s) => s.opacity === '1' && identity(s.transform) && s.items === 8;

/* ---------- 1. 首次打开 ---------- */
let p = await newPage();
await p.goto(BASE + '/', { waitUntil: 'networkidle' });
await p.waitForTimeout(2600);
let s = await wheel(p);
check('首次打开卡片可见', visible(s), JSON.stringify(s));
await p.screenshot({ path: 'F:/AIweb/美食1.0/aimeishi2.0/shots/home-wheel-ok.png' });

/* ---------- 2. 连点「首页」导航两次 ---------- */
const home = p.locator('.nav__links a', { hasText: '首页' });
await home.click({ force: true });
await p.waitForTimeout(140);
await home.click({ force: true });
await p.waitForTimeout(2800);
s = await wheel(p);
check('连点「首页」两次后卡片仍可见', visible(s), JSON.stringify(s));

/* ---------- 3. 连点 4 次 ---------- */
for (let i = 0; i < 4; i += 1) {
  await home.click({ force: true });
  await p.waitForTimeout(180);
}
await p.waitForTimeout(3000);
s = await wheel(p);
check('连点 4 次后卡片仍可见', visible(s), JSON.stringify(s));
await p.screenshot({ path: 'F:/AIweb/美食1.0/aimeishi2.0/shots/home-wheel-after-double.png' });

/* ---------- 4. 连续切换菜系/口味 ---------- */
const modeBtns = p.locator('.wheel-modes__btn');
for (let i = 0; i < 4; i += 1) {
  await modeBtns.nth(1).click({ force: true });
  await p.waitForTimeout(90);
  await modeBtns.nth(0).click({ force: true });
  await p.waitForTimeout(90);
}
await p.waitForTimeout(2200);
s = await wheel(p);
check('连续切换模式后卡片仍可见', visible(s), JSON.stringify(s));
const modeOn = await p.locator('.wheel-modes__btn.is-on').innerText();
check('模式与数据一致（当前为八大菜系）', /八大菜系/.test(modeOn), modeOn.replace(/\n/g, ' '));

/* ---------- 5. 动画期间重复点击 ---------- */
await modeBtns.nth(1).click({ force: true });
await p.waitForTimeout(30);
await modeBtns.nth(0).click({ force: true });
await p.waitForTimeout(30);
await modeBtns.nth(1).click({ force: true });
await p.waitForTimeout(2500);
s = await wheel(p);
check('动画期间重复点击后卡片仍可见', visible(s), JSON.stringify(s));

/* ---------- 6. 进入菜系页再返回 ---------- */
await p.goto(BASE + '/cuisines/chuan', { waitUntil: 'networkidle' });
await p.waitForTimeout(900);
await p.goto(BASE + '/', { waitUntil: 'networkidle' });
await p.waitForTimeout(2600);
s = await wheel(p);
check('进入菜系页返回后卡片可见', visible(s), JSON.stringify(s));

/* ---------- 7. 往返 3 次 ---------- */
for (let i = 0; i < 3; i += 1) {
  await p.goto(BASE + '/chat/mapo-tofu', { waitUntil: 'networkidle' });
  await p.waitForTimeout(700);
  await p.goto(BASE + '/', { waitUntil: 'networkidle' });
  await p.waitForTimeout(2200);
}
s = await wheel(p);
check('多次往返后卡片仍可见', visible(s), JSON.stringify(s));

/* ---------- 8. 刷新 ---------- */
await p.reload({ waitUntil: 'networkidle' });
await p.waitForTimeout(2600);
s = await wheel(p);
check('刷新后卡片可见', visible(s), JSON.stringify(s));

/* ---------- 9. 卡片交互仍可用（拖拽 + 选择） ---------- */
const before = await p.evaluate(() => window.__exhibition?.gallery?.items?.length ?? -1);
await p.mouse.move(720, 560);
await p.mouse.down();
await p.mouse.move(920, 560, { steps: 12 });
await p.mouse.up();
await p.waitForTimeout(900);
const after = await p.evaluate(() => window.__exhibition?.gallery?.items?.length ?? -1);
check('拖拽后画廊仍完整', before === 8 && after === 8, `${before} -> ${after}`);

/* ---------- 10. 移动端 ---------- */
const m = await newPage({ width: 390, height: 844 });
await m.goto(BASE + '/', { waitUntil: 'networkidle' });
await m.waitForTimeout(2600);
let ms = await m.evaluate(() => {
  const c = document.querySelector('.stage canvas');
  const cs = c ? getComputedStyle(c) : null;
  return {
    opacity: cs?.opacity ?? 'none',
    transform: cs?.transform ?? 'none',
    items: window.__exhibition?.gallery?.items?.length ?? -1,
    overflowX: document.documentElement.scrollWidth - window.innerWidth,
  };
});
check('移动端卡片可见', ms.opacity === '1' && identity(ms.transform) && ms.items === 8, JSON.stringify(ms));
check('移动端无横向溢出', ms.overflowX === 0, `${ms.overflowX}px`);

// 移动端连点首页
const mHome = m.locator('.nav__links a', { hasText: '首页' });
await mHome.click({ force: true });
await m.waitForTimeout(140);
await mHome.click({ force: true });
await m.waitForTimeout(2800);
ms = await m.evaluate(() => {
  const c = document.querySelector('.stage canvas');
  const cs = c ? getComputedStyle(c) : null;
  return { opacity: cs?.opacity ?? 'none', transform: cs?.transform ?? 'none', items: window.__exhibition?.gallery?.items?.length ?? -1 };
});
check('移动端连点首页后卡片仍可见', ms.opacity === '1' && identity(ms.transform) && ms.items === 8, JSON.stringify(ms));
await m.screenshot({ path: 'F:/AIweb/美食1.0/aimeishi2.0/shots/home-wheel-mobile.png' });

check('无脚本异常', errs.length === 0, errs.slice(0, 2).join(' | '));

console.log(`\nTOTAL ${results.filter(Boolean).length}/${results.length}`);
await b.close();
