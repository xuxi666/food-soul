// 社区发布登录门禁的页面级验收（前端 + 后端联动）
import { chromium } from 'playwright-core';

const BASE = process.env.BASE || 'http://127.0.0.1:5180';
const results = [];
const check = (n, pass, extra = '') => {
  results.push(pass);
  console.log(`${pass ? 'PASS' : 'FAIL'} | ${n}${extra ? ' | ' + extra : ''}`);
};

const b = await chromium.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true });
const p = await b.newPage({ viewport: { width: 1440, height: 900 } });
const errs = [];
p.on('pageerror', (e) => errs.push(e.message));
p.on('console', (m) => { if (m.type() === 'error') errs.push(m.text()); });

const email = `ui-comm-${Date.now()}@example.com`;
const PASS = 'UiComm1234!';

/* ---------- 未登录 ---------- */
await p.goto(BASE + '/community', { waitUntil: 'networkidle' });
await p.waitForTimeout(1200);

const postCount = await p.locator('.post').count();
check('未登录仍能看到帖子', postCount >= 3, `${postCount} 条`);
check('未登录：发布锁层可见', await p.locator('.composer-lock').isVisible());
check('未登录：锁层文案正确', (await p.locator('.composer-lock__text').innerText()).includes('请先登录后再发布内容'));
check('未登录：输入框被禁用', await p.locator('.composer-box__area').isDisabled());
check('未登录：发布按钮被禁用', await p.locator('.composer-box button[type="submit"]').isDisabled());
await p.screenshot({ path: 'F:/AIweb/美食1.0/aimeishi2.0/shots/community-locked.png' });

/* ---------- 点击登录入口 ---------- */
await p.locator('.composer-lock button').click();
await p.waitForTimeout(500);
check('点击锁层按钮弹出登录框', await p.locator('.account-modal').isVisible());

/* ---------- 注册并登录 ---------- */
await p.locator('.account-tab', { hasText: '注册' }).click();
await p.waitForTimeout(200);
await p.locator('.account-modal input[type="email"]').fill(email);
await p.locator('.account-modal input[type="password"]').fill(PASS);
const nameInput = p.locator('.account-modal input[type="text"]').first();
if (await nameInput.count()) await nameInput.fill('UI 测试');
await p.locator('.account-modal button[type="submit"]').click();
await p.waitForTimeout(1800);

check('登录后弹窗关闭', (await p.locator('.account-modal').count()) === 0 || !(await p.locator('.account-modal').isVisible()));
check('登录后：锁层消失', !(await p.locator('.composer-lock').isVisible()));
check('登录后：输入框可用', await p.locator('.composer-box__area').isEnabled());
check('登录后：发布按钮可用', await p.locator('.composer-box button[type="submit"]').isEnabled());
const who = await p.locator('.composer-box__who').innerText();
check('登录后：显示当前登录身份', who.includes('已登录'), who);

/* ---------- 发布 ---------- */
const text = `UI 门禁测试帖 ${Date.now()}`;
await p.locator('.composer-box__area').fill(text);
await p.locator('.composer-box button[type="submit"]').click();
await p.waitForTimeout(2000);
const feed = await p.locator('.feed, .post-list, body').first().innerText();
check('登录后发帖成功并出现在列表', feed.includes(text));
await p.screenshot({ path: 'F:/AIweb/美食1.0/aimeishi2.0/shots/community-logged-in.png' });

/* ---------- 退出登录 ---------- */
await p.locator('.account-btn--ghost', { hasText: '退出' }).click();
await p.waitForTimeout(1500);
check('退出后：锁层恢复', await p.locator('.composer-lock').isVisible());
check('退出后：输入框再次禁用', await p.locator('.composer-box__area').isDisabled());
check('退出后：帖子仍可浏览', (await p.locator('.post').count()) >= 3);

/* ---------- 直接调接口（页面内）---------- */
const apiAnon = await p.evaluate(async () => {
  const r = await fetch('/api/posts', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ content: '前端绕过尝试' }),
  });
  return r.status;
});
check('页面内未登录直调发帖接口返回 401', apiAnon === 401, `HTTP ${apiAnon}`);

/* ---------- 移动端 ---------- */
const m = await b.newPage({ viewport: { width: 390, height: 844 } });
await m.goto(BASE + '/community', { waitUntil: 'networkidle' });
await m.waitForTimeout(1200);
const mLock = await m.evaluate(() => {
  const lock = document.querySelector('.composer-lock');
  const r = lock.getBoundingClientRect();
  const box = document.querySelector('.composer-box').getBoundingClientRect();
  return {
    visible: !lock.hidden && getComputedStyle(lock).display !== 'none',
    inside: r.top >= box.top - 1 && r.bottom <= box.bottom + 1,
    overflowX: document.documentElement.scrollWidth - window.innerWidth,
  };
});
check('移动端：锁层可见且在发布框内', mLock.visible && mLock.inside, JSON.stringify(mLock));
check('移动端：无横向溢出', mLock.overflowX === 0, `${mLock.overflowX}px`);
await m.screenshot({ path: 'F:/AIweb/美食1.0/aimeishi2.0/shots/community-locked-mobile.png' });

// 本脚本会故意发起一次未登录请求，浏览器必然记录 401 资源错误，属预期
const realErrs = errs.filter((e) => !/401/.test(e));
check('无脚本异常（排除预期的 401）', realErrs.length === 0, realErrs.slice(0, 2).join(' | '));

console.log(`\nTOTAL ${results.filter(Boolean).length}/${results.length}`);
console.log('EMAIL=' + email);
await b.close();
