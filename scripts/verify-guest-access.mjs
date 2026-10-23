/**
 * 游客开放访问 + 内置 AI 权限 验收。
 *
 * 独立实例（临时 DB + 本地 mock 模型/检索），覆盖：
 *   A. 内置 AI 开启：游客可用全部公开美食功能与 AI，社区写操作仍要登录
 *   B. 内置 AI 关闭：游客与无个人配置的用户被拒，有个人配置的用户不受影响
 *   C. 权限与安全：伪造身份无效、管理接口 403/401、不泄漏密钥、游客 AI 限流
 *
 * 前置：npm run build（实例托管 dist）
 * 用法：node scripts/verify-guest-access.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import { spawn } from 'node:child_process';
import { DatabaseSync } from 'node:sqlite';
import { chromium } from 'playwright-core';

const results = [];
const check = (name, pass, extra = '') => {
  results.push({ name, pass });
  console.log(`${pass ? 'PASS' : 'FAIL'} | ${name}${extra ? ' | ' + extra : ''}`);
};

const ROOT = process.cwd();
const MOCK_PORT = 5188;
const APP_PORT = 5189;
const DB = path.join(ROOT, 'data', 'test-guest.db');
for (const f of [DB, `${DB}-wal`, `${DB}-shm`]) if (fs.existsSync(f)) fs.unlinkSync(f);
if (!fs.existsSync(path.join(ROOT, 'dist', 'index.html'))) {
  console.error('缺少 dist/，请先 npm run build');
  process.exit(1);
}

/* ---------------- mock：模型 + 检索 ---------------- */
const RECIPE = {
  dish_name: '番茄炒蛋',
  servings: 2,
  prep_time_minutes: 10,
  cook_time_minutes: 8,
  difficulty: 'easy',
  ingredients: [
    { name: '番茄', amount: 2, unit: '个', optional: false },
    { name: '鸡蛋', amount: 3, unit: '个', optional: false },
    { name: '盐', amount: 2, unit: 'g', optional: false },
  ],
  seasonings: [{ name: '糖', amount: 3, unit: 'g', optional: true }],
  steps: [
    { step: 1, title: '备料', description: '番茄切块，鸡蛋打散。', duration_minutes: 3, heat_level: 'low', tips: '' },
    { step: 2, title: '炒蛋', description: '热油下蛋液炒至凝固盛出。', duration_minutes: 2, heat_level: 'high', tips: '' },
    { step: 3, title: '炒番茄', description: '下番茄炒出汁。', duration_minutes: 3, heat_level: 'medium', tips: '' },
    { step: 4, title: '合炒', description: '倒回鸡蛋调味炒匀。', duration_minutes: 2, heat_level: 'medium', tips: '' },
  ],
  taste_profile: ['咸鲜'],
  substitutions: ['没有番茄可用番茄罐头'],
  common_mistakes: ['鸡蛋炒太老'],
  safety_notes: ['热油注意溅烫'],
};

const mockServer = http.createServer((req, res) => {
  let body = '';
  req.on('data', (c) => (body += c));
  req.on('end', () => {
    const url = req.url || '';
    if (url.startsWith('/search')) {
      res.writeHead(200, { 'content-type': 'application/json' });
      return res.end(JSON.stringify({ results: [] }));
    }
    if (url.includes('/chat/completions')) {
      const content = JSON.stringify(RECIPE);
      let wantStream = false;
      try {
        wantStream = Boolean(JSON.parse(body || '{}').stream);
      } catch {
        wantStream = false;
      }
      if (wantStream) {
        res.writeHead(200, { 'content-type': 'text/event-stream' });
        for (let i = 0; i < content.length; i += 200) {
          res.write(`data: ${JSON.stringify({ choices: [{ delta: { content: content.slice(i, i + 200) } }] })}\n\n`);
        }
        res.write('data: [DONE]\n\n');
        return res.end();
      }
      res.writeHead(200, { 'content-type': 'application/json' });
      return res.end(JSON.stringify({ choices: [{ message: { role: 'assistant', content } }] }));
    }
    res.writeHead(404).end('{}');
  });
});
await new Promise((ok) => mockServer.listen(MOCK_PORT, '127.0.0.1', ok));

const ADMIN_EMAIL = `ga-admin-${Date.now()}@example.com`;
const child = spawn(process.execPath, ['--env-file=.env', 'server/index.mjs'], {
  env: {
    ...process.env,
    PORT: String(APP_PORT),
    DB_PATH: DB,
    ADMIN_EMAILS: ADMIN_EMAIL,
    SEARXNG_URL: `http://127.0.0.1:${MOCK_PORT}`,
    BING_RSS_URL: '',
  },
  stdio: ['ignore', 'pipe', 'pipe'],
});
const logs = [];
child.stdout.on('data', (d) => logs.push(String(d)));
child.stderr.on('data', (d) => logs.push(String(d)));

const APP = `http://127.0.0.1:${APP_PORT}`;
for (let i = 0; i < 60; i += 1) {
  try {
    if ((await fetch(APP + '/api/health')).ok) break;
  } catch {
    /* retry */
  }
  await new Promise((ok) => setTimeout(ok, 250));
}

let cookie = '';
async function req(p, { method = 'GET', body, as = 'current' } = {}) {
  const useCookie = as === 'current' ? cookie : as === 'guest' ? '' : as;
  const res = await fetch(APP + p, {
    method,
    headers: {
      'content-type': 'application/json',
      Origin: APP,
      ...(useCookie ? { Cookie: useCookie } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const sc = (res.headers.getSetCookie?.() || []).find((x) => x.startsWith('fs_session='));
  if (sc && as === 'current') cookie = sc.split(';')[0];
  const text = await res.text();
  let data = null;
  try {
    data = JSON.parse(text);
  } catch {
    /* ignore */
  }
  return { status: res.status, data, text };
}

/* ---------------- 账号与内置 AI ---------------- */
const adminReg = await req('/api/auth/register', {
  method: 'POST',
  body: { email: ADMIN_EMAIL, password: 'Guest1234!', name: '游客测试管理员' },
});
check('管理员注册', adminReg.status === 200, `HTTP ${adminReg.status}`);
const adminCookie = cookie;

// 创建内置 AI 配置（指向 mock 模型）
const modelBase = `http://127.0.0.1:${MOCK_PORT}/v1`;
const t = await req('/api/ai/test', {
  method: 'POST',
  body: { provider: 'custom', baseUrl: modelBase, model: 'mock-model', apiKey: 'mock-key' },
});
const prof = await req('/api/admin/site-ai/profiles', {
  method: 'POST',
  body: { name: '游客测试模型', provider: 'custom', baseUrl: modelBase, model: 'mock-model', apiKey: 'mock-key' },
});
const profId = prof.data?.profiles?.[0]?.id;
check('创建内置 AI 配置', prof.status === 200 && Boolean(profId), `HTTP ${prof.status} ${prof.data?.error || ''}`);
const enabled = await req(`/api/admin/site-ai/profiles/${profId}/enable`, { method: 'POST', body: {} });
check('启用内置 AI 配置', enabled.status === 200, `HTTP ${enabled.status} ${enabled.data?.error || ''}`);

/* ============================================================
 * A. 内置 AI 开启
 * ============================================================ */
const on = await req('/api/admin/site-ai/master', { method: 'POST', body: { enabled: true } });
check('开启内置 AI 总开关', on.status === 200 && on.data.master.enabled === true, `HTTP ${on.status}`);

const guest = { as: 'guest' };

// 公开页面
for (const p of ['/', '/dishes', '/dishes/mapo-tofu', '/recipe', '/recommend', '/community']) {
  const r = await fetch(APP + p);
  check(`游客可访问页面 ${p}`, r.status === 200, `HTTP ${r.status}`);
}

// 欢迎语 → 内置 AI 可用
const greet = await req('/api/greeting?dishId=mapo-tofu', guest);
check('游客：欢迎语识别内置 AI 可用', greet.data?.aiConfigured === true && greet.data?.aiSource === 'site',
  `configured=${greet.data?.aiConfigured} source=${greet.data?.aiSource}`);

// 聊天（SSE）
const chatRes = await fetch(APP + '/api/chat', {
  method: 'POST',
  headers: { 'content-type': 'application/json', Origin: APP },
  body: JSON.stringify({ dishId: 'mapo-tofu', messages: [{ role: 'user', content: '怎么做' }] }),
});
const chatText = await chatRes.text();
check('游客：聊天接口可用（内置 AI）', chatRes.status === 200 && /data:/.test(chatText), `HTTP ${chatRes.status}`);
check('游客：流式输出正常', /"delta"|delta/.test(chatText) || chatText.includes('event'), chatText.slice(0, 60));

// 菜谱
const recipe = await req('/api/recipe', { method: 'POST', body: { dishName: '番茄炒蛋', servings: 2, difficulty: 'easy' }, ...guest });
check('游客：可生成菜谱', recipe.status === 200 && Boolean(recipe.data?.recipe), `HTTP ${recipe.status} ${recipe.data?.message || ''}`);

// 推荐
const recommend = await req('/api/recommend', { method: 'POST', body: { taste: '麻辣鲜香', servings: 2, budget: 60, avoid: [] }, ...guest });
check('游客：可使用智能推荐', recommend.status === 200 && Array.isArray(recommend.data?.picks), `HTTP ${recommend.status}`);

// 社区只读
const posts = await req('/api/posts?page=1', guest);
check('游客：可浏览社区帖子', posts.status === 200 && Array.isArray(posts.data?.items), `HTTP ${posts.status}`);

// 社区写操作必须登录
const postCreate = await req('/api/posts', { method: 'POST', body: { content: '游客发帖测试' }, ...guest });
check('游客：发帖被拒（401）', postCreate.status === 401, `HTTP ${postCreate.status}`);
const firstPost = posts.data?.items?.[0];
if (firstPost) {
  const like = await req(`/api/posts/${firstPost.id}/like`, { method: 'POST', body: {}, ...guest });
  check('游客：点赞被拒（401）', like.status === 401, `HTTP ${like.status}`);
  const comment = await req(`/api/posts/${firstPost.id}/comments`, { method: 'POST', body: { content: '游客评论' }, ...guest });
  check('游客：评论被拒（401）', comment.status === 401, `HTTP ${comment.status}`);
  const report = await req(`/api/posts/${firstPost.id}/report`, { method: 'POST', body: { reason: 'spam' }, ...guest });
  check('游客：举报被拒（401）', report.status === 401, `HTTP ${report.status}`);
}
const upload = await req('/api/upload', {
  method: 'POST',
  body: { image: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==' },
  ...guest,
});
check('游客：上传图片被拒（401）', upload.status === 401, `HTTP ${upload.status}`);

// 个人 AI 配置必须登录
const guestAiConfig = await req('/api/ai/config', guest);
check('游客：读取个人 AI 配置被拒（401）', guestAiConfig.status === 401, `HTTP ${guestAiConfig.status}`);
const guestAiSave = await req('/api/ai/config', { method: 'POST', body: { provider: 'custom', baseUrl: modelBase, model: 'x', apiKey: 'y' }, ...guest });
check('游客：保存个人 AI 配置被拒（401）', guestAiSave.status === 401, `HTTP ${guestAiSave.status}`);

// 管理后台
const guestAdmin = await req('/api/admin/site-ai', guest);
check('游客：管理接口被拒（401）', guestAdmin.status === 401, `HTTP ${guestAdmin.status}`);

/* ============================================================
 * B. 关闭内置 AI
 * ============================================================ */
const off = await req('/api/admin/site-ai/master', { method: 'POST', body: { enabled: false } });
check('关闭内置 AI', off.status === 200 && off.data.master.enabled === false);

const chatOff = await fetch(APP + '/api/chat', {
  method: 'POST',
  headers: { 'content-type': 'application/json', Origin: APP },
  body: JSON.stringify({ dishId: 'mapo-tofu', messages: [{ role: 'user', content: 'hi' }] }),
});
const chatOffData = await chatOff.json().catch(() => ({}));
check('关闭后：游客聊天被拒（ai_disabled）', chatOff.status === 409 && chatOffData.code === 'ai_disabled',
  `HTTP ${chatOff.status} code=${chatOffData.code}`);

const recipeOff = await req('/api/recipe', { method: 'POST', body: { dishName: '番茄炒蛋' }, ...guest });
check('关闭后：游客生成菜谱被拒', recipeOff.status === 409 && recipeOff.data?.code === 'ai_disabled', `HTTP ${recipeOff.status}`);

const recOff = await req('/api/recommend', { method: 'POST', body: { taste: '麻辣鲜香' }, ...guest });
check('关闭后：游客推荐被拒', recOff.status === 409 && recOff.data?.code === 'ai_disabled', `HTTP ${recOff.status}`);

const greetOff = await req('/api/greeting?dishId=mapo-tofu', guest);
check('关闭后：欢迎语标记 AI 不可用', greetOff.data?.aiConfigured === false && /暂未开启/.test(greetOff.data?.aiMessage || ''),
  greetOff.data?.aiMessage?.slice(0, 30));

// 无个人配置的登录用户
cookie = '';
const userEmail = `ga-user-${Date.now()}@example.com`;
await req('/api/auth/register', { method: 'POST', body: { email: userEmail, password: 'Guest1234!', name: '普通用户' } });
const normalCookie = cookie;
const normalChat = await req('/api/chat', { method: 'POST', body: { dishId: 'mapo-tofu', messages: [{ role: 'user', content: 'hi' }] }, as: normalCookie });
check('关闭后：无个人配置的登录用户也被拒', normalChat.status === 409 && normalChat.data?.code === 'ai_disabled', `HTTP ${normalChat.status}`);

// 有个人配置的登录用户仍可用
const uTest = await req('/api/ai/test', { method: 'POST', body: { provider: 'custom', baseUrl: modelBase, model: 'mock-model', apiKey: 'mock-key' }, as: normalCookie });
const uSave = await req('/api/ai/config', {
  method: 'POST',
  body: { provider: 'custom', baseUrl: modelBase, model: 'mock-model', apiKey: 'mock-key', verifyToken: uTest.data?.verifyToken },
  as: normalCookie,
});
const normalChat2 = await fetch(APP + '/api/chat', {
  method: 'POST',
  headers: { 'content-type': 'application/json', Origin: APP, Cookie: normalCookie },
  body: JSON.stringify({ dishId: 'mapo-tofu', messages: [{ role: 'user', content: 'hi' }] }),
});
const normalText = await normalChat2.text();
check('关闭后：配了个人 AI 的用户仍可用', uSave.status === 200 && normalChat2.status === 200 && /data:/.test(normalText),
  `save=${uSave.status} chat=${normalChat2.status}`);

// 重新开启 → 游客恢复
await req('/api/admin/site-ai/master', { method: 'POST', body: { enabled: true }, as: adminCookie });
const greetBack = await req('/api/greeting?dishId=mapo-tofu', guest);
check('重新开启后：游客恢复可用', greetBack.data?.aiConfigured === true && greetBack.data?.aiSource === 'site',
  `configured=${greetBack.data?.aiConfigured}`);

/* ============================================================
 * C. 权限与安全
 * ============================================================ */
// 伪造身份字段无效
const spoof = await req('/api/posts', {
  method: 'POST',
  body: { content: '伪造管理员发帖', isAdmin: true, userId: 'admin', user: { id: 'admin', role: 'admin' } },
  ...guest,
});
check('伪造 isAdmin/userId 仍被拒（401）', spoof.status === 401, `HTTP ${spoof.status}`);

// 普通用户访问管理接口 403
const normalAdmin = await req('/api/admin/site-ai', { as: normalCookie });
check('普通用户访问管理接口 → 403', normalAdmin.status === 403, `HTTP ${normalAdmin.status}`);

// 响应不含密钥
const panel = await req('/api/admin/site-ai', { as: adminCookie });
check('管理面板不返回密钥', !/key_cipher|"apiKey"|mock-key/.test(panel.text), 'checked');
const me = await req('/api/me', { as: adminCookie });
check('个人状态接口不返回密钥', !/apiKey|key_cipher|mock-key/.test(me.text), 'checked');

// 游客 AI 限流
let limited = false;
for (let i = 0; i < 25; i += 1) {
  const r = await req('/api/recipe', { method: 'POST', body: { dishName: '番茄炒蛋' }, ...guest });
  if (r.status === 429) {
    limited = true;
    break;
  }
}
check('游客 AI 调用受限流保护', limited, limited ? 'hit 429' : '未触发（25 次内）');

/* ============================================================
 * D. 页面（游客身份）
 * ============================================================ */
const browser = await chromium.launch({
  executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe',
  headless: true,
});
const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
const pageErrors = [];
page.on('pageerror', (e) => pageErrors.push(e.message));

await page.goto(APP + '/', { waitUntil: 'networkidle' });
await page.waitForTimeout(800);
const home = await page.evaluate(() => ({
  modal: Boolean(document.querySelector('.account-modal')),
  nav: document.querySelector('.account-btn')?.textContent?.trim() || '',
  aiBadge: document.querySelector('.nav__mode')?.textContent?.trim() || '',
}));
check('游客进首页不弹登录窗', home.modal === false);
check('游客首页导航可见', Boolean(home.nav), home.nav);

await page.goto(APP + '/community', { waitUntil: 'networkidle' });
await page.waitForTimeout(900);
const community = await page.evaluate(() => ({
  posts: document.querySelectorAll('.post-card, .post').length,
  locked: /登录后即可|请先登录/.test(document.body.innerText),
}));
check('游客可浏览社区内容', community.posts > 0, `posts=${community.posts}`);
check('社区给出登录提示（不强制跳转）', community.locked === true && page.url().includes('/community'), page.url());

await page.goto(APP + '/dishes/mapo-tofu', { waitUntil: 'networkidle' });
await page.waitForTimeout(700);
const detail = await page.evaluate(() => document.querySelector('h1')?.textContent?.trim() || '');
check('游客可看菜品详情', Boolean(detail), detail);
check('页面无脚本异常', pageErrors.length === 0, pageErrors.slice(0, 2).join(' | '));

await page.screenshot({ path: 'F:/AIweb/美食1.0/aimeishi2.0/shots/guest-community.png' });

await browser.close();
child.kill();
mockServer.close();
await new Promise((ok) => setTimeout(ok, 300));
for (const f of [DB, `${DB}-wal`, `${DB}-shm`]) if (fs.existsSync(f)) fs.unlinkSync(f);

if (results.some((x) => !x.pass)) {
  const tail = logs.join('').split('\n').filter(Boolean).slice(-8).join('\n');
  if (tail) console.log('\n--- 应用日志（尾部）---\n' + tail);
}
const pass = results.filter((x) => x.pass).length;
console.log(`\nTOTAL ${pass}/${results.length}`);
process.exit(pass === results.length ? 0 : 1);
