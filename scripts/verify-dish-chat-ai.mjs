// 美食图鉴 AI 聊天接入内置 AI 的验收（页面 + 接口）
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

async function req(pathname, { method = 'GET', body, cookie = '' } = {}) {
  const res = await fetch(BASE + pathname, {
    method,
    headers: { 'Content-Type': 'application/json', Origin: BASE, ...(cookie ? { Cookie: cookie } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const sc = res.headers.getSetCookie?.() || [];
  const sess = sc.find((x) => x.startsWith('fs_session='));
  const text = await res.text();
  let data = null;
  try { data = JSON.parse(text); } catch { data = {}; }
  return { status: res.status, data, cookie: sess ? sess.split(';')[0] : '' };
}

async function loginOrRegister(email, password, name) {
  const reg = await req('/api/auth/register', { method: 'POST', body: { email, password, name } });
  if (reg.status === 200) return reg.cookie;
  const login = await req('/api/auth/login', { method: 'POST', body: { email, password } });
  return login.cookie;
}

const stamp = Date.now();
const adminCookie = await loginOrRegister(ADMIN_EMAIL, ADMIN_PASS, '管理员');
const userEmail = `dishchat-${stamp}@example.com`;
const userCookie = await loginOrRegister(userEmail, 'DishChat1234!', '图鉴用户');

// 确保内置 AI 已配置并开启
const save = await req('/api/admin/site-ai/config', {
  method: 'POST', cookie: adminCookie,
  body: { provider: 'zhipu', baseUrl: 'https://open.bigmodel.cn/api/paas/v4', model: 'glm-4-flash', apiKey: KEY },
});
check('内置 AI 配置保存', save.status === 200 && save.data.verified === true, `HTTP ${save.status}`);
const on = await req('/api/admin/site-ai/toggle', { method: 'POST', cookie: adminCookie, body: { enabled: true } });
check('内置 AI 已开启', on.status === 200 && on.data.status.enabled === true);

/* ---------- 接口层：欢迎语 ---------- */
const g = await req('/api/greeting?dishId=mapo-tofu', { cookie: userCookie });
check('欢迎语识别内置 AI 可用', g.status === 200 && g.data.aiConfigured === true, `aiConfigured=${g.data.aiConfigured}`);
check('欢迎语标记来源为 site', g.data.aiSource === 'site', g.data.aiSource);
check('欢迎语返回内置模型名', g.data.model === 'glm-4-flash', g.data.model);
check('欢迎语不含密钥', !JSON.stringify(g.data).includes(KEY.slice(0, 12)));

const gAnon = await req('/api/greeting?dishId=mapo-tofu');
check('未登录仍提示需登录', gAnon.data.aiConfigured === false, `aiConfigured=${gAnon.data.aiConfigured}`);

/* ---------- 页面层 ---------- */
const b = await chromium.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true });
const errs = [];

async function pageWithCookie(cookie) {
  const ctx = await b.newContext({ viewport: { width: 1440, height: 900 } });
  await ctx.addCookies([{ name: 'fs_session', value: decodeURIComponent(cookie.split('=')[1]), domain: '127.0.0.1', path: '/' }]);
  const p = await ctx.newPage();
  p.on('pageerror', (e) => errs.push(e.message));
  return p;
}

const p = await pageWithCookie(userCookie);
await p.goto(BASE + '/chat/mapo-tofu', { waitUntil: 'networkidle' });
await p.waitForTimeout(1800);

const badge = await p.locator('.chat-bar__mode').first().innerText().catch(() => '');
check('聊天页显示内置 AI 徽标', /内置 AI/.test(badge), badge);
check('输入框可用（未被锁定）', await p.locator('.chat-page .composer textarea').isEnabled());
check('未显示未接入提示', !(await p.locator('.chat-ai-notice').isVisible()));

// 发消息，验证流式
await p.locator('.chat-page .composer textarea').fill('一句话说说你的味道');
await p.keyboard.press('Enter');
await p.waitForTimeout(9000);
const msgs = await p.locator('.msg').count();
check('对话有回复消息（用户+助手）', msgs >= 2, `${msgs} 条消息`);
const lastText = await p.locator('.msg').last().innerText();
check('回复有实际内容', lastText.trim().length > 8, lastText.slice(0, 40).replace(/\n/g, ' '));

// 多轮
await p.locator('.chat-page .composer textarea').fill('那配什么菜好');
await p.keyboard.press('Enter');
await p.waitForTimeout(9000);
const msgs2 = await p.locator('.msg').count();
check('多轮对话继续可用', msgs2 > msgs, `${msgs} -> ${msgs2}`);
await p.screenshot({ path: 'F:/AIweb/美食1.0/aimeishi2.0/shots/dish-chat-site-ai.png' });

// 菜品上下文仍在
const title = await p.locator('.chat-page h1').first().innerText().catch(() => '');
check('保留菜品上下文（标题为菜品名）', /麻婆豆腐/.test(title), title);

/* ---------- 关闭内置 ---------- */
const off = await req('/api/admin/site-ai/toggle', { method: 'POST', cookie: adminCookie, body: { enabled: false } });
check('关闭内置 AI', off.status === 200 && off.data.status.enabled === false);

await p.reload({ waitUntil: 'networkidle' });
await p.waitForTimeout(1800);
const badge2 = await p.locator('.chat-bar__mode').first().innerText().catch(() => '');
check('关闭后徽标变为未接入', /未接入/.test(badge2), badge2);
check('关闭后提示条可见', await p.locator('.chat-ai-notice').isVisible());
const noticeText = await p.locator('.chat-ai-notice').innerText();
check('提示文案引导去接入', /接入 AI/.test(noticeText), noticeText.slice(0, 50));
check('关闭后输入框禁用', await p.locator('.chat-page .composer textarea').isDisabled());
await p.screenshot({ path: 'F:/AIweb/美食1.0/aimeishi2.0/shots/dish-chat-no-ai.png' });

/* ---------- 个人模型可用 ---------- */
const t = await req('/api/ai/test', {
  method: 'POST', cookie: userCookie,
  body: { provider: 'zhipu', baseUrl: 'https://open.bigmodel.cn/api/paas/v4', model: 'glm-4-flash', apiKey: KEY },
});
const cfg = await req('/api/ai/config', {
  method: 'POST', cookie: userCookie,
  body: { provider: 'zhipu', baseUrl: 'https://open.bigmodel.cn/api/paas/v4', model: 'glm-4-flash', apiKey: KEY, verifyToken: t.data?.verifyToken },
});
check('用户配置个人模型', cfg.status === 200, `HTTP ${cfg.status}`);

await p.reload({ waitUntil: 'networkidle' });
await p.waitForTimeout(1800);
const badge3 = await p.locator('.chat-bar__mode').first().innerText().catch(() => '');
check('关闭内置后个人模型可用', !/未接入/.test(badge3), badge3);
check('个人模式输入框可用', await p.locator('.chat-page .composer textarea').isEnabled());

/* ---------- 图鉴页面无回归 ---------- */
const dishesPage = await pageWithCookie(userCookie);
await dishesPage.goto(BASE + '/dishes', { waitUntil: 'networkidle' });
await dishesPage.waitForTimeout(1500);
const cards = await dishesPage.locator('.dish-card, .dish-tile, article').count();
check('图鉴列表正常渲染', cards > 0, `${cards} 个条目`);
await dishesPage.goto(BASE + '/dishes/mapo-tofu', { waitUntil: 'networkidle' });
await dishesPage.waitForTimeout(1200);
check('菜品详情页正常', (await dishesPage.locator('h1').first().innerText()).includes('麻婆豆腐'));

check('无脚本异常', errs.length === 0, errs.slice(0, 2).join(' | '));

console.log(`\nTOTAL ${results.filter(Boolean).length}/${results.length}`);
console.log('EMAIL=' + userEmail);
await b.close();
