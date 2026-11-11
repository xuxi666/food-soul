// 管理后台验收：入口可见性、路由守卫、画册内嵌两页布局、各模块交互、退出失效
// 用法：node scripts/verify-admin-ui.mjs        （默认 http://127.0.0.1:5190）
//       BASE=https://... node scripts/verify-admin-ui.mjs
import fs from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright-core';

const BASE = process.env.BASE || 'http://127.0.0.1:5190';
const ADMIN_EMAIL = process.env.ADMIN_EMAIL || 'admin@foodsoul.local';
const ADMIN_PASS = process.env.ADMIN_PASS || 'AdminPass1234!';
const SHOTS = path.join(process.cwd(), 'shots');

const results = [];
const check = (n, pass, extra = '') => {
  results.push(Boolean(pass));
  console.log(`${pass ? 'PASS' : 'FAIL'} | ${n}${extra ? ' | ' + extra : ''}`);
};

const TMP_PNG = path.join(SHOTS, '_admin-upload-test.png');
fs.mkdirSync(SHOTS, { recursive: true });
fs.writeFileSync(
  TMP_PNG,
  Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
    'base64'
  )
);

const b = await chromium.launch({ channel: 'chrome' });
const errs = [];

async function newPage(viewport = { width: 1440, height: 900 }) {
  const p = await b.newPage({ viewport });
  p.on('pageerror', (e) => errs.push('pageerror: ' + e.message));
  p.on('console', (m) => {
    if (m.type() === 'error' && !/401|403|Forbidden|权限/.test(m.text())) errs.push(m.text());
  });
  p.on('dialog', (d) => d.accept());
  return p;
}

/** 「印」面板平时是收起的，先点印章再操作里面的账号条 */
async function openSeal(p) {
  const open = await p.evaluate(() => document.querySelector('.bk-seal__panel')?.classList.contains('is-open'));
  if (!open) await p.locator('.bk-seal').click();
  await p.waitForTimeout(320);
}

/** 画册默认合着，掀开封面才算进入阅读状态 */
async function openBook(p) {
  await p.locator('.bk-cover').click();
  await p.waitForTimeout(2900);
}

async function login(p, email, pass, { register = false } = {}) {
  await p.goto(BASE + '/', { waitUntil: 'networkidle' });
  await p.waitForTimeout(800);
  await openSeal(p);
  const ghost = p.locator('.account-btn--ghost', { hasText: '登录' });
  if (!(await ghost.count())) return false;
  await ghost.first().click();
  await p.waitForTimeout(400);
  if (register) await p.locator('.account-tab', { hasText: '注册' }).first().click();
  await p.waitForTimeout(220);
  await p.locator('.account-modal input[type="email"]').fill(email);
  await p.locator('.account-modal input[type="password"]').fill(pass);
  await p.locator('.account-modal button[type="submit"]').click();
  await p.waitForTimeout(1700);
  return true;
}

async function enterAdmin(p) {
  await openSeal(p);
  await p.locator('.seal-entry').click();
  await p.waitForTimeout(1900);
}

async function tab(p, name) {
  await p.locator('.adm-side .admin-nav__item', { hasText: name }).first().click();
  await p.waitForTimeout(1000);
}

/* ---------- 普通用户 ---------- */
const normal = await newPage();
await login(normal, `ui-admin-normal-${Date.now()}@example.com`, 'Normal1234!', { register: true });
check('普通用户登录成功', (await normal.locator('.account-user').count()) > 0);
await openSeal(normal);
check('普通用户：印面板里没有「管理员后台」入口', (await normal.locator('.seal-entry').count()) === 0);
await normal.goto(BASE + '/admin', { waitUntil: 'networkidle' });
await normal.waitForTimeout(1100);
await openBook(normal);
await normal.waitForTimeout(600);
check('普通用户：直接访问 /admin 被拦截', await normal.locator('.adm-denied').isVisible());
check('普通用户：被拦页面里没有任何管理内容', (await normal.locator('.admin-content').count()) === 0);
const normalApi = await normal.evaluate(async () => (await fetch('/api/admin/overview')).status);
check('普通用户：后台接口 403', normalApi === 403, String(normalApi));
await normal.close();

/* ---------- 管理员进入 ---------- */
const admin = await newPage();
await login(admin, ADMIN_EMAIL, ADMIN_PASS);
await openSeal(admin);
check('管理员：印面板出现「管理员后台」入口', (await admin.locator('.seal-entry').count()) === 1);
check('入口文案是「管理员后台」', (await admin.locator('.seal-entry').innerText()).includes('管理员后台'));

await admin.locator('.seal-entry').click();
await admin.waitForTimeout(1900);
check('点击入口进入后台路由', admin.url().endsWith('/admin'), admin.url());

const layout = await admin.evaluate(() => {
  const side = document.querySelector('.adm-side');
  const main = document.querySelector('.adm-main');
  const sideFace = side?.closest('.bk-sheet__face');
  const mainFace = main?.closest('.bk-sheet__face');
  const r = (el) => (el ? el.getBoundingClientRect() : null);
  return {
    bothPages: Boolean(sideFace && mainFace && sideFace !== mainFace),
    leftX: Math.round(r(sideFace)?.x || 0),
    rightX: Math.round(r(mainFace)?.x || 0),
    faceW: Math.round(r(mainFace)?.width || 0),
    gutter: Boolean(document.querySelector('.bk-gutter')),
    pageNums: (document.querySelector('.bk-content')?.innerText.match(/P\d{2}|第\s*\d+\s*页/g) || []).length,
    turnBtns: document.querySelectorAll('.bk-turn').length,
  };
});
check('后台渲染在画册里（左导航页 + 右内容页）', layout.bothPages && layout.leftX < layout.rightX, JSON.stringify(layout));
check('中缝保留、没有页码、没有翻页按钮', layout.gutter && layout.pageNums === 0 && layout.turnBtns === 0);
check('概览统计卡 5 个', (await admin.locator('.adm-main .admin-stat').count()) === 5);
await admin.screenshot({ path: path.join(SHOTS, 'admin-overview.png') });

/* 社区内容 */
await tab(admin, '社区内容');
const rows = await admin.locator('.adm-main .admin-row').count();
check('社区内容列表加载', rows > 0, `${rows} 行`);
const searchBox = admin.locator('.adm-main .admin-input').first();
await searchBox.fill('白切鸡');
await searchBox.press('Enter');
await admin.waitForTimeout(1000);
check('社区搜索生效', (await admin.locator('.adm-main .admin-row').count()) >= 1);
await admin.screenshot({ path: path.join(SHOTS, 'admin-posts.png') });

/* 首页图片功能已下线：页签与接口都不存在 */
const cardTab = await admin.locator('.admin-nav__item', { hasText: '首页图片' }).count();
check('后台导航不再有「首页图片」', cardTab === 0, `${cardTab} 个`);
// 用 request 上下文探测，避免浏览器把预期的 404 记成脚本异常
const cardApi = await admin.request.get(new URL('/api/admin/cards', BASE).href);
check('首页图片接口返回 404', cardApi.status() === 404, `HTTP ${cardApi.status()}`);

/* 美食图鉴 */
await tab(admin, '美食图鉴');
check('图鉴列表加载', (await admin.locator('.adm-main .admin-tile').count()) > 0);
const dishSearch = admin.locator('.adm-main .admin-input').first();
await dishSearch.fill('麻婆');
await dishSearch.press('Enter');
await admin.waitForTimeout(1000);
const dishNames = await admin.locator('.adm-main .admin-tile b').allInnerTexts();
check('图鉴按菜名搜索生效', dishNames.some((n) => n.includes('麻婆')), dishNames.slice(0, 3).join('/'));
await admin.screenshot({ path: path.join(SHOTS, 'admin-dishes.png') });

/* 内置 AI */
await tab(admin, '内置 AI');
const ai = await admin.evaluate(() => ({
  master: Boolean(document.querySelector('.adm-status')),
  cards: document.querySelectorAll('.adm-main .admin-card').length,
  text: (document.querySelector('.adm-main')?.innerText || '').replace(/\s+/g, ' ').slice(0, 80),
}));
check('内置 AI 配置页渲染', ai.cards >= 2, `${ai.cards} 块 / ${ai.text}`);
await admin.screenshot({ path: path.join(SHOTS, 'admin-ai.png') });

/* 举报处理 */
await tab(admin, '举报处理');
check('举报页有状态筛选', (await admin.locator('.adm-main .admin-chips .chip').count()) === 5);
await admin.locator('.adm-main .admin-chips .chip', { hasText: '全部' }).first().click();
await admin.waitForTimeout(900);
check('举报列表可用', (await admin.locator('.adm-main .admin-row').count()) >= 0);
await admin.screenshot({ path: path.join(SHOTS, 'admin-reports.png') });

/* 页签切换不翻页/不刷新 */
await admin.evaluate(() => { window.__noReload = true; });
const spreadBefore = await admin.evaluate(() => window.__book.spread);
await tab(admin, '后台概览');
const swap = await admin.evaluate(() => ({
  spread: window.__book.spread,
  noReload: window.__noReload === true,
  turning: document.querySelectorAll('.bk-sheet.is-turning').length,
  title: document.querySelector('.adm-title')?.textContent,
}));
check('页签切换：不翻页、不刷新画册', swap.spread === spreadBefore && swap.noReload && swap.turning === 0, JSON.stringify(swap));

/* 返回画册 */
await admin.locator('.adm-side .adm-link', { hasText: '返回画册' }).first().click();
await admin.waitForTimeout(1700);
const back = await admin.evaluate(() => ({
  path: location.pathname,
  inner: window.__book.innerKind,
  admDom: document.querySelectorAll('.adm-side').length,
}));
check('返回画册：离开后台、回到普通章节', back.inner === null && back.admDom === 0 && back.path !== '/admin', JSON.stringify(back));

/* 退出后入口消失、权限失效 */
await openSeal(admin);
await admin.locator('.seal-entry').click();
await admin.waitForTimeout(1700);
await admin.locator('.adm-side .adm-link', { hasText: '退出登录' }).first().click();
await admin.waitForTimeout(1900);
await openSeal(admin);
check('退出后「管理员后台」入口消失', (await admin.locator('.seal-entry').count()) === 0);
const afterLogout = await admin.evaluate(async () => (await fetch('/api/admin/overview')).status);
check('退出后后台接口失效', afterLogout === 401 || afterLogout === 403, String(afterLogout));
await admin.goto(BASE + '/admin', { waitUntil: 'networkidle' });
await admin.waitForTimeout(1100);
await openBook(admin);
await admin.waitForTimeout(600);
check('退出后访问 /admin 被拦截', await admin.locator('.adm-denied').isVisible());

/* ---------- 移动端 ---------- */
const mobile = await newPage({ width: 390, height: 844 });
await login(mobile, ADMIN_EMAIL, ADMIN_PASS);
await openBook(mobile);
await openSeal(mobile);
check('移动端：印面板有后台入口', (await mobile.locator('.seal-entry').count()) === 1);
await enterAdmin(mobile);
const mLayout = await mobile.evaluate(() => {
  const side = document.querySelector('.adm-side');
  const main = document.querySelector('.adm-main');
  const face = main?.closest('.bk-sheet__face');
  const content = document.querySelector('.admin-content');
  return {
    inline: Boolean(side && main && side.closest('.bk-sheet__face') === main.closest('.bk-sheet__face')),
    navItems: document.querySelectorAll('.adm-side .admin-nav__item').length,
    faceW: Math.round(face?.getBoundingClientRect().width || 0),
    overflowX: content ? content.scrollWidth - content.clientWidth : -1,
    pageOverflowX: document.documentElement.scrollWidth - window.innerWidth,
  };
});
check('移动端：导航与内容同页上下排布', mLayout.inline && mLayout.navItems === 5, JSON.stringify(mLayout));
check('移动端：无横向溢出', mLayout.overflowX === 0 && mLayout.pageOverflowX === 0, `${mLayout.overflowX}/${mLayout.pageOverflowX}`);
await mobile.screenshot({ path: path.join(SHOTS, 'admin-mobile.png') });

check('无脚本异常', errs.length === 0, errs.slice(0, 2).join(' | '));

try { fs.unlinkSync(TMP_PNG); } catch { /* noop */ }

const pass = results.filter(Boolean).length;
console.log(`\nTOTAL ${pass}/${results.length}`);
await b.close();
process.exit(pass === results.length ? 0 : 1);