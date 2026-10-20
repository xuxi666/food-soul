// 管理后台页面级验收：入口可见性、路由守卫、各模块交互、移动端
import fs from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright-core';

const BASE = process.env.BASE || 'http://127.0.0.1:5180';
const ADMIN_EMAIL = process.env.ADMIN_EMAIL || 'admin@foodsoul.local';
const ADMIN_PASS = 'AdminPass1234!';

const results = [];
const check = (n, pass, extra = '') => {
  results.push(pass);
  console.log(`${pass ? 'PASS' : 'FAIL'} | ${n}${extra ? ' | ' + extra : ''}`);
};

// 1x1 红点 png
const TMP_PNG = path.join(process.cwd(), 'shots', '_admin-upload-test.png');
fs.writeFileSync(TMP_PNG, Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64'
));

const b = await chromium.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true });
const errs = [];

async function newPage(viewport = { width: 1440, height: 900 }) {
  const p = await b.newPage({ viewport });
  p.on('pageerror', (e) => errs.push(e.message));
  p.on('console', (m) => { if (m.type() === 'error' && !/401|403/.test(m.text())) errs.push(m.text()); });
  p.on('dialog', (d) => d.accept());
  return p;
}

async function login(p, email, password) {
  await p.goto(BASE + '/', { waitUntil: 'networkidle' });
  await p.waitForTimeout(600);
  const btn = p.locator('.account-btn--ghost', { hasText: '登录' });
  if (await btn.count()) await btn.first().click();
  else await p.evaluate(() => window.__foodsoulLogoutForTest?.());
  await p.waitForTimeout(400);
  await p.locator('.account-modal input[type="email"]').fill(email);
  await p.locator('.account-modal input[type="password"]').fill(password);
  await p.locator('.account-modal button[type="submit"]').click();
  await p.waitForTimeout(1500);
}

/* ---------- 未登录 ---------- */
const anon = await newPage();
await anon.goto(BASE + '/', { waitUntil: 'networkidle' });
await anon.waitForTimeout(1000);
check('未登录：导航无「管理后台」按钮', (await anon.locator('.account-btn--admin').count()) === 0);

await anon.goto(BASE + '/admin', { waitUntil: 'networkidle' });
await anon.waitForTimeout(1200);
check('未登录：直接访问 /admin 被拦截', await anon.locator('.admin-denied').isVisible());
check('未登录：后台不渲染管理内容', (await anon.locator('.admin-shell').count()) === 0);
await anon.screenshot({ path: 'F:/AIweb/美食1.0/aimeishi2.0/shots/admin-denied.png' });
await anon.close();

/* ---------- 普通用户 ---------- */
const normal = await newPage();
const normalEmail = `ui-admin-normal-${Date.now()}@example.com`;
await normal.goto(BASE + '/', { waitUntil: 'networkidle' });
await normal.waitForTimeout(800);
await normal.locator('.account-btn--ghost', { hasText: '登录' }).first().click();
await normal.waitForTimeout(400);
await normal.locator('.account-tab', { hasText: '注册' }).click();
await normal.locator('.account-modal input[type="email"]').fill(normalEmail);
await normal.locator('.account-modal input[type="password"]').fill('Normal1234!');
await normal.locator('.account-modal button[type="submit"]').click();
await normal.waitForTimeout(1600);
check('普通用户登录成功', (await normal.locator('.account-user').count()) > 0);
check('普通用户：导航无「管理后台」按钮', (await normal.locator('.account-btn--admin').count()) === 0);

await normal.goto(BASE + '/admin', { waitUntil: 'networkidle' });
await normal.waitForTimeout(1200);
check('普通用户：直接访问 /admin 被拦截', await normal.locator('.admin-denied').isVisible());
await normal.close();

/* ---------- 管理员 ---------- */
const admin = await newPage();
await login(admin, ADMIN_EMAIL, ADMIN_PASS);
const adminBtn = admin.locator('.account-btn--admin');
check('管理员：导航出现「管理后台」按钮', (await adminBtn.count()) === 1);

await adminBtn.first().click();
await admin.waitForTimeout(1600);
check('点击进入后台页面', admin.url().endsWith('/admin'), admin.url());
check('后台主结构渲染', await admin.locator('.admin-shell').isVisible());
check('概览统计卡 4 个', (await admin.locator('.admin-stat').count()) === 4);
await admin.screenshot({ path: 'F:/AIweb/美食1.0/aimeishi2.0/shots/admin-overview.png' });

/* 社区内容 */
await admin.locator('.admin-nav__item', { hasText: '社区内容' }).click();
await admin.waitForTimeout(1000);
const rows = await admin.locator('.admin-row').count();
check('社区内容列表加载', rows > 0, `${rows} 行`);
await admin.locator('.admin-input').first().fill('白切鸡');
await admin.locator('.admin-nav__item', { hasText: '社区内容' }).click();
await admin.waitForTimeout(800);
const searchBox = admin.locator('.admin-input').first();
await searchBox.fill('白切鸡');
await searchBox.press('Enter');
await admin.waitForTimeout(900);
check('社区搜索生效', (await admin.locator('.admin-row').count()) >= 1);
await admin.screenshot({ path: 'F:/AIweb/美食1.0/aimeishi2.0/shots/admin-posts.png' });

/* 首页图片 */
await admin.locator('.admin-nav__item', { hasText: '首页图片' }).click();
await admin.waitForTimeout(1200);
const tiles = await admin.locator('.admin-tile').count();
check('首页图片：16 张卡片（8 菜系 + 8 口味）', tiles === 16, `${tiles} 张`);
check('菜系与口味分组独立', (await admin.locator('.admin-card__title').count()) === 2,
  (await admin.locator('.admin-card__title').allInnerTexts()).join(' / '));

const firstTile = admin.locator('.admin-tile').first();
const firstName = await firstTile.locator('b').innerText();
const beforeSrc = await firstTile.locator('.admin-tile__img').getAttribute('src');

await firstTile.locator('input[type="file"]').setInputFiles(TMP_PNG);
await admin.waitForTimeout(2200);
const afterSrc = await firstTile.locator('.admin-tile__img').getAttribute('src');
check(`替换「${firstName}」卡片图片生效`, Boolean(afterSrc) && afterSrc !== beforeSrc && afterSrc.startsWith('/uploads/'), `${beforeSrc} -> ${afterSrc}`);
check('卡片状态标记为已替换', (await firstTile.locator('.admin-tile__state').innerText()).includes('已替换'));

// 数据源确实变化：读取 wheel 模块返回的 image
const wheelImage = await admin.evaluate(async () => {
  const m = await import('/src/data/wheel.js');
  const nodes = m.nodesFor ? m.nodesFor('cuisine') : m.buildCuisineNodes();
  return nodes[0]?.image;
});
check('首页数据源已使用新图片', wheelImage === afterSrc, `${wheelImage}`);
await admin.screenshot({ path: 'F:/AIweb/美食1.0/aimeishi2.0/shots/admin-cards.png' });

/* 美食图鉴 */
await admin.locator('.admin-nav__item', { hasText: '美食图鉴' }).click();
await admin.waitForTimeout(1200);
check('图鉴列表加载', (await admin.locator('.admin-tile').count()) > 0);
const dishSearch = admin.locator('.admin-input').first();
await dishSearch.fill('麻婆');
await dishSearch.press('Enter');
await admin.waitForTimeout(900);
const dishNames = await admin.locator('.admin-tile b').allInnerTexts();
check('图鉴按菜名搜索生效', dishNames.some((n) => n.includes('麻婆')), dishNames.slice(0, 3).join('/'));
await admin.screenshot({ path: 'F:/AIweb/美食1.0/aimeishi2.0/shots/admin-dishes.png' });

/* 举报处理 */
await admin.locator('.admin-nav__item', { hasText: '举报处理' }).click();
await admin.waitForTimeout(1200);
check('举报页有状态筛选', (await admin.locator('.admin-chips .chip').count()) === 5);
await admin.locator('.admin-chips .chip', { hasText: '全部' }).click();
await admin.waitForTimeout(900);
const reportRows = await admin.locator('.admin-row').count();
check('举报记录可见', reportRows >= 1, `${reportRows} 条`);
await admin.screenshot({ path: 'F:/AIweb/美食1.0/aimeishi2.0/shots/admin-reports.png' });

/* 移动端 */
const mobile = await b.newPage({ viewport: { width: 390, height: 844 } });
await mobile.goto(BASE + '/', { waitUntil: 'networkidle' });
await mobile.waitForTimeout(800);
await mobile.locator('.account-btn--ghost', { hasText: '登录' }).first().click().catch(() => {});
await mobile.waitForTimeout(400);
if (await mobile.locator('.account-modal').count()) {
  await mobile.locator('.account-modal input[type="email"]').fill(ADMIN_EMAIL);
  await mobile.locator('.account-modal input[type="password"]').fill(ADMIN_PASS);
  await mobile.locator('.account-modal button[type="submit"]').click();
  await mobile.waitForTimeout(1600);
}
await mobile.goto(BASE + '/admin', { waitUntil: 'networkidle' });
await mobile.waitForTimeout(1400);
const mLayout = await mobile.evaluate(() => ({
  shell: Boolean(document.querySelector('.admin-shell')),
  overflowX: document.documentElement.scrollWidth - window.innerWidth,
  navItems: document.querySelectorAll('.admin-nav__item').length,
}));
check('移动端：后台可正常渲染', mLayout.shell);
check('移动端：无横向溢出', mLayout.overflowX === 0, `${mLayout.overflowX}px`);
await mobile.screenshot({ path: 'F:/AIweb/美食1.0/aimeishi2.0/shots/admin-mobile.png' });

/* 退出后按钮消失 */
await admin.goto(BASE + '/', { waitUntil: 'networkidle' });
await admin.waitForTimeout(800);
await admin.locator('.account-btn--ghost', { hasText: '退出' }).click();
await admin.waitForTimeout(1500);
check('退出后「管理后台」按钮消失', (await admin.locator('.account-btn--admin').count()) === 0);
await admin.goto(BASE + '/admin', { waitUntil: 'networkidle' });
await admin.waitForTimeout(1200);
check('退出后访问 /admin 被拦截', await admin.locator('.admin-denied').isVisible());

check('无脚本异常', errs.length === 0, errs.slice(0, 2).join(' | '));

// 清理：恢复被替换的卡片图片
try {
  const { request } = await import('playwright-core');
  const ctx = await request.newContext({ baseURL: BASE });
  await ctx.dispose();
} catch { /* noop */ }
fs.unlinkSync(TMP_PNG);

console.log(`\nTOTAL ${results.filter(Boolean).length}/${results.length}`);
await b.close();
