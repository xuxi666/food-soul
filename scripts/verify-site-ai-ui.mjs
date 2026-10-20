// 内置 AI 页面级验收：后台配置 → 开启 → 前台状态 → 关闭
import fs from 'node:fs';
import { chromium } from 'playwright-core';

const BASE = process.env.BASE || 'http://127.0.0.1:5180';
const ADMIN_EMAIL = process.env.ADMIN_EMAIL || 'admin@foodsoul.local';
const ADMIN_PASS = 'AdminPass1234!';

const KEY = (() => {
  try {
    return (fs.readFileSync('.env', 'utf8').match(/^SEARCH_API_KEY=(.+)$/m) || [])[1]?.trim() || '';
  } catch {
    return '';
  }
})();
if (!KEY) {
  console.error('缺少 SEARCH_API_KEY');
  process.exit(2);
}

const results = [];
const check = (n, pass, extra = '') => {
  results.push(pass);
  console.log(`${pass ? 'PASS' : 'FAIL'} | ${n}${extra ? ' | ' + extra : ''}`);
};

const b = await chromium.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true });
const errs = [];
const p = await b.newPage({ viewport: { width: 1440, height: 900 } });
p.on('pageerror', (e) => errs.push(e.message));
p.on('console', (m) => { if (m.type() === 'error' && !/40[13]/.test(m.text())) errs.push(m.text()); });
p.on('dialog', (d) => d.accept());

// 登录管理员
await p.goto(BASE + '/', { waitUntil: 'networkidle' });
await p.waitForTimeout(700);
await p.locator('.account-btn--ghost', { hasText: '登录' }).first().click();
await p.waitForTimeout(400);
await p.locator('.account-modal input[type="email"]').fill(ADMIN_EMAIL);
await p.locator('.account-modal input[type="password"]').fill(ADMIN_PASS);
await p.locator('.account-modal button[type="submit"]').click();
await p.waitForTimeout(1600);
check('管理员登录', (await p.locator('.account-btn--admin').count()) === 1);

// 进入后台 → 内置 AI
await p.goto(BASE + '/admin', { waitUntil: 'networkidle' });
await p.waitForTimeout(1200);
await p.locator('.admin-nav__item', { hasText: '内置 AI' }).click();
await p.waitForTimeout(1200);
check('内置 AI 页面渲染', await p.locator('.admin-ai').isVisible());
check('四个配置字段齐全', (await p.locator('.admin-ai .admin-field').count()) === 4);
check('API Key 为密码框', (await p.locator('.admin-ai input[type="password"]').count()) === 1);

// 填写并测试
const fields = p.locator('.admin-ai .admin-field');
await p.locator('.admin-ai select').selectOption('zhipu');
await fields.nth(1).locator('input').fill('https://open.bigmodel.cn/api/paas/v4');
await fields.nth(2).locator('input').fill('glm-4-flash');
await fields.nth(3).locator('input').fill(KEY);

await p.locator('.admin-ai button', { hasText: '测试连接' }).click();
await p.waitForTimeout(6000);
const testText = await p.locator('.admin-ai__result').innerText();
check('页面内连接测试通过', /连接成功/.test(testText), testText.slice(0, 60));

// 保存
await p.locator('.admin-ai button', { hasText: '保存配置' }).click();
await p.waitForTimeout(7000);
const badges = await p.locator('.admin-ai__badges .admin-badge').allInnerTexts();
check('保存后显示已验证', badges.some((t) => t.includes('已验证')), badges.join('/'));

// Key 不回显
const keyVal = await p.locator('.admin-ai input[type="password"]').inputValue();
check('API Key 不回显', keyVal === '', `value="${keyVal}"`);
const pageHtml = await p.content();
check('页面源码不含 Key', !pageHtml.includes(KEY.slice(0, 12)));

// 开启
await p.locator('.admin-ai button', { hasText: '启用内置 AI' }).click();
await p.waitForTimeout(8000);
const badges2 = await p.locator('.admin-ai__badges .admin-badge').allInnerTexts();
check('开启后显示已启用', badges2.some((t) => t.includes('已启用')), badges2.join('/'));
await p.screenshot({ path: 'F:/AIweb/美食1.0/aimeishi2.0/shots/admin-site-ai-on.png' });

// 前台状态
await p.goto(BASE + '/', { waitUntil: 'networkidle' });
await p.waitForTimeout(1500);
const statusText = await p.locator('.account-status').first().innerText();
check('前台显示内置 AI 状态', /内置 AI/.test(statusText), statusText.replace(/\n/g, ' '));
await p.screenshot({ path: 'F:/AIweb/美食1.0/aimeishi2.0/shots/site-ai-enabled.png' });

// 普通用户视角
const anon = await b.newPage({ viewport: { width: 1440, height: 900 } });
await anon.goto(BASE + '/', { waitUntil: 'networkidle' });
await anon.waitForTimeout(1500);
const anonStatus = await anon.locator('.account-status').first().innerText();
check('未登录也显示内置 AI 可用', /内置 AI/.test(anonStatus), anonStatus.replace(/\n/g, ' '));

// 关闭
await p.goto(BASE + '/admin', { waitUntil: 'networkidle' });
await p.waitForTimeout(1000);
await p.locator('.admin-nav__item', { hasText: '内置 AI' }).click();
await p.waitForTimeout(1200);
await p.locator('.admin-ai button', { hasText: '关闭内置 AI' }).click();
await p.waitForTimeout(3000);
const badges3 = await p.locator('.admin-ai__badges .admin-badge').allInnerTexts();
check('关闭后显示已关闭', badges3.some((t) => t.includes('已关闭')), badges3.join('/'));
check('关闭后配置仍在（已验证保留）', badges3.some((t) => t.includes('已验证')), badges3.join('/'));
await p.screenshot({ path: 'F:/AIweb/美食1.0/aimeishi2.0/shots/admin-site-ai-off.png' });

await p.goto(BASE + '/', { waitUntil: 'networkidle' });
await p.waitForTimeout(1500);
const afterOff = await p.locator('.account-status').first().innerText();
check('关闭后前台不再显示内置 AI', !/内置 AI/.test(afterOff), afterOff.replace(/\n/g, ' '));

// 移动端
const m = await b.newPage({ viewport: { width: 390, height: 844 } });
await m.goto(BASE + '/', { waitUntil: 'networkidle' });
await m.waitForTimeout(800);
await m.locator('.account-btn--ghost', { hasText: '登录' }).first().click().catch(() => {});
await m.waitForTimeout(400);
if (await m.locator('.account-modal').count()) {
  await m.locator('.account-modal input[type="email"]').fill(ADMIN_EMAIL);
  await m.locator('.account-modal input[type="password"]').fill(ADMIN_PASS);
  await m.locator('.account-modal button[type="submit"]').click();
  await m.waitForTimeout(1600);
}
await m.goto(BASE + '/admin', { waitUntil: 'networkidle' });
await m.waitForTimeout(1000);
await m.locator('.admin-nav__item', { hasText: '内置 AI' }).click();
await m.waitForTimeout(1200);
const mLayout = await m.evaluate(() => ({
  visible: Boolean(document.querySelector('.admin-ai')),
  overflowX: document.documentElement.scrollWidth - window.innerWidth,
}));
check('移动端内置 AI 页面可用', mLayout.visible);
check('移动端无横向溢出', mLayout.overflowX === 0, `${mLayout.overflowX}px`);
await m.screenshot({ path: 'F:/AIweb/美食1.0/aimeishi2.0/shots/admin-site-ai-mobile.png' });

check('无脚本异常', errs.length === 0, errs.slice(0, 2).join(' | '));

console.log(`\nTOTAL ${results.filter(Boolean).length}/${results.length}`);
await b.close();
