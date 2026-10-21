/**
 * 内置 AI 多配置管理验收（不消耗任何真实服务商额度）。
 *
 * 做法：本地起一个 OpenAI 兼容 mock（可按 key/model 返回 200/401/404/429），
 * 另起一份应用实例指向临时数据库与 mock，全程走真实 HTTP。
 *
 * 覆盖：迁移、增删改查、3 套上限、Key 留空保留、Key 轮换、
 *       单启用约束（含并发）、总开关、删除启用项、权限、持久化、页面。
 *
 * 前置：npm run build（应用实例托管 dist）
 * 用法：node scripts/verify-site-ai-profiles.mjs
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
const MOCK_PORT = 5195;
const APP_PORT = 5197;
const MIG_PORT = 5196;
const DB_MAIN = path.join(ROOT, 'data', 'test-site-ai.db');
const DB_MIG = path.join(ROOT, 'data', 'test-site-ai-migrate.db');

for (const f of [DB_MAIN, DB_MIG, `${DB_MAIN}-wal`, `${DB_MAIN}-shm`, `${DB_MIG}-wal`, `${DB_MIG}-shm`]) {
  if (fs.existsSync(f)) fs.unlinkSync(f);
}
if (!fs.existsSync(path.join(ROOT, 'dist', 'index.html'))) {
  console.error('缺少 dist/，请先 npm run build');
  process.exit(1);
}

/* ============================================================
 * 0. mock 服务商
 * ============================================================ */

const mockSeen = [];
const mockServer = http.createServer((req, res) => {
  let body = '';
  req.on('data', (c) => (body += c));
  req.on('end', () => {
    if (!req.url.includes('/chat/completions')) {
      res.writeHead(404).end('{}');
      return;
    }
    let payload = {};
    try {
      payload = JSON.parse(body || '{}');
    } catch {
      payload = {};
    }
    const auth = String(req.headers.authorization || '');
    const key = auth.replace(/^Bearer\s+/i, '');
    const model = String(payload.model || '');
    mockSeen.push({ key, model });

    if (/bad/i.test(key)) {
      res.writeHead(401, { 'content-type': 'application/json' });
      return res.end(JSON.stringify({ error: { message: 'invalid api key' } }));
    }
    if (/quota/i.test(key)) {
      res.writeHead(429, { 'content-type': 'application/json' });
      return res.end(JSON.stringify({ error: { message: 'insufficient balance' } }));
    }
    if (/missing/i.test(model)) {
      res.writeHead(404, { 'content-type': 'application/json' });
      return res.end(JSON.stringify({ error: { message: 'model not found' } }));
    }
    res.writeHead(200, { 'content-type': 'application/json' });
    return res.end(JSON.stringify({ choices: [{ message: { role: 'assistant', content: 'OK' } }] }));
  });
});
await new Promise((ok) => mockServer.listen(MOCK_PORT, '127.0.0.1', ok));
const MOCK_BASE = `http://127.0.0.1:${MOCK_PORT}/v1`;

/* ============================================================
 * 1. 迁移：旧版单套配置 → 第一套 profile
 * ============================================================ */

(() => {
  const db = new DatabaseSync(DB_MIG);
  db.exec(`
    CREATE TABLE site_ai (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      provider TEXT NOT NULL, base_url TEXT NOT NULL, model TEXT NOT NULL,
      key_cipher TEXT NOT NULL, key_iv TEXT NOT NULL, key_tag TEXT NOT NULL,
      key_version INTEGER NOT NULL DEFAULT 1,
      verified_at INTEGER, last_status TEXT NOT NULL DEFAULT 'unverified', last_error TEXT,
      enabled INTEGER NOT NULL DEFAULT 0, enabled_at INTEGER, updated_by TEXT, updated_at INTEGER NOT NULL
    );
  `);
  db.prepare(
    `INSERT INTO site_ai (id, provider, base_url, model, key_cipher, key_iv, key_tag, key_version,
      verified_at, last_status, enabled, updated_at)
     VALUES (1, 'zhipu', 'https://open.bigmodel.cn/api/paas/v4', 'glm-4-flash',
      'legacy-cipher', 'legacy-iv', 'legacy-tag', 1, ?, 'ok', 1, ?)`
  ).run(Date.now(), Date.now());
  db.close();
})();

const migChild = spawn(process.execPath, ['--env-file=.env', 'server/index.mjs'], {
  env: { ...process.env, PORT: String(MIG_PORT), DB_PATH: DB_MIG },
  stdio: ['ignore', 'pipe', 'pipe'],
});
await waitHealth(`http://127.0.0.1:${MIG_PORT}`);
{
  const db = new DatabaseSync(DB_MIG);
  const profiles = db.prepare('SELECT * FROM site_ai_profiles').all();
  const legacy = db.prepare('SELECT key_cipher, enabled FROM site_ai WHERE id = 1').get();
  check('迁移：旧配置转成第一套 profile', profiles.length === 1 && profiles[0].model === 'glm-4-flash', `count=${profiles.length}`);
  check('迁移：保留原密文与验证状态', profiles[0].key_cipher === 'legacy-cipher' && profiles[0].last_status === 'ok');
  check('迁移：旧行密文被清空（避免删光后被重建）', legacy.key_cipher === '');
  check('迁移：启用状态随配置迁移', profiles[0].enabled === 1);
  db.close();
}
migChild.kill();

/* ============================================================
 * 2. 主实例（空库）
 * ============================================================ */

const ADMIN_EMAIL = `siteadmin-${Date.now()}@example.com`;
const child = spawn(process.execPath, ['--env-file=.env', 'server/index.mjs'], {
  env: {
    ...process.env,
    PORT: String(APP_PORT),
    DB_PATH: DB_MAIN,
    ADMIN_EMAILS: ADMIN_EMAIL,
    SEARCH_API_KEY: 'mock-search',
  },
  stdio: ['ignore', 'pipe', 'pipe'],
});
const childLog = [];
child.stdout.on('data', (d) => childLog.push(String(d)));
child.stderr.on('data', (d) => childLog.push(String(d)));

const APP = `http://127.0.0.1:${APP_PORT}`;
await waitHealth(APP);

async function waitHealth(base) {
  for (let i = 0; i < 60; i += 1) {
    try {
      const h = await fetch(base + '/api/health');
      if (h.ok) return;
    } catch {
      /* retry */
    }
    await new Promise((ok) => setTimeout(ok, 250));
  }
  throw new Error('服务未启动: ' + base);
}

let cookie = '';
async function req(p, { method = 'GET', body, base = APP } = {}) {
  const res = await fetch(base + p, {
    method,
    headers: { 'content-type': 'application/json', Origin: base, ...(cookie ? { Cookie: cookie } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const sc = (res.headers.getSetCookie?.() || []).find((x) => x.startsWith('fs_session='));
  if (sc) cookie = sc.split(';')[0];
  const text = await res.text();
  let data = null;
  try {
    data = JSON.parse(text);
  } catch {
    /* ignore */
  }
  return { status: res.status, data, text };
}

/* --- 账号 --- */
const reg = await req('/api/auth/register', {
  method: 'POST',
  body: { email: ADMIN_EMAIL, password: 'SiteAi1234!', name: '内置AI管理员' },
});
check('管理员注册并登录', reg.status === 200, `HTTP ${reg.status}`);

let panel = await req('/api/admin/site-ai');
check('空库面板：0 套配置、总开关关闭', panel.status === 200 && panel.data.count === 0 && panel.data.master.enabled === false,
  `count=${panel.data?.count} enabled=${panel.data?.master?.enabled}`);
check('面板不返回任何密钥字段', !/key_cipher|apiKey|sk-/.test(panel.text), 'checked');

/* --- 新增三套 --- */
const mk = (name, provider, model, apiKey = 'ok-key') => ({
  name,
  provider,
  baseUrl: MOCK_BASE,
  model,
  apiKey,
});

const p1 = await req('/api/admin/site-ai/profiles', { method: 'POST', body: mk('DeepSeek 主模型', 'deepseek', 'deepseek-v4-flash') });
check('新增第 1 套（DeepSeek）', p1.status === 200 && p1.data.count === 1, `HTTP ${p1.status} ${p1.data?.error || ''}`);
check('新增后默认未启用', p1.data?.profiles?.[0]?.enabled === false);
check('新增即完成连接测试', p1.data?.profiles?.[0]?.verified === true, p1.data?.tested?.error || '');

const p2 = await req('/api/admin/site-ai/profiles', { method: 'POST', body: mk('智谱备用模型', 'zhipu', 'glm-4-flash') });
check('新增第 2 套（智谱）', p2.status === 200 && p2.data.count === 2, `HTTP ${p2.status}`);
const p3 = await req('/api/admin/site-ai/profiles', { method: 'POST', body: mk('火山备用', 'volcengine', 'doubao-seed-1-6') });
check('新增第 3 套（火山引擎）', p3.status === 200 && p3.data.count === 3, `HTTP ${p3.status}`);

const p4 = await req('/api/admin/site-ai/profiles', { method: 'POST', body: mk('第四套', 'custom', 'x') });
check('第 4 套被后端拒绝', p4.status === 400 && /最多保存 3 套/.test(p4.data?.error || ''), `HTTP ${p4.status} ${p4.data?.error || ''}`);

const ids = p3.data.profiles.map((x) => x.id);
const [id1, id2, id3] = ids;

/* --- 校验 --- */
const badProvider = await req('/api/admin/site-ai/profiles', { method: 'POST', body: mk('x', 'unknown-provider', 'm') });
check('未知服务商被拒绝', badProvider.status === 400, `HTTP ${badProvider.status}`);
const badUrl = await req('/api/admin/site-ai/profiles', { method: 'POST', body: { ...mk('x', 'custom', 'm'), baseUrl: 'ftp://x' } });
check('非 http(s) Base URL 被拒绝', badUrl.status === 400, `HTTP ${badUrl.status}`);

/* --- 编辑：留空 Key 保留原密钥 --- */
mockSeen.length = 0;
const editKeep = await req(`/api/admin/site-ai/profiles/${id1}`, {
  method: 'POST',
  body: { name: 'DeepSeek 主模型（改名）', provider: 'deepseek', baseUrl: MOCK_BASE, model: 'deepseek-v4-flash', apiKey: '' },
});
check('编辑时留空 Key 仍可保存', editKeep.status === 200, `HTTP ${editKeep.status} ${editKeep.data?.error || ''}`);
check('留空 Key 后仍标记已验证（沿用原密钥）', editKeep.data?.profiles?.find((x) => x.id === id1)?.verified === true);
check('只改名称不触发重新测试（沿用原验证状态）', mockSeen.length === 0, `calls=${mockSeen.length}`);

/* --- 编辑：换 Key --- */
mockSeen.length = 0;
const newKey = 'ok-key-rotated';
const editRotate = await req(`/api/admin/site-ai/profiles/${id1}`, {
  method: 'POST',
  body: { name: 'DeepSeek 主模型（改名）', provider: 'deepseek', baseUrl: MOCK_BASE, model: 'deepseek-v4-flash', apiKey: newKey },
});
check('更换 API Key 保存成功', editRotate.status === 200 && editRotate.data?.revalidated === true, `HTTP ${editRotate.status}`);
check('新 Key 立即生效（测试用新密钥）', mockSeen.some((s) => s.key === newKey), JSON.stringify(mockSeen.slice(-1)));

/* --- 关键字段变更 → 必须重新验证 --- */
const editModelBad = await req(`/api/admin/site-ai/profiles/${id1}`, {
  method: 'POST',
  body: { name: 'DeepSeek 主模型（改名）', provider: 'deepseek', baseUrl: MOCK_BASE, model: 'missing-model', apiKey: '' },
});
const afterBad = editModelBad.data?.profiles?.find((x) => x.id === id1);
check('改模型后测试失败 → 验证状态作废', afterBad?.verified === false && afterBad?.status === 'error', `${afterBad?.status}`);

// 改回可用模型
await req(`/api/admin/site-ai/profiles/${id1}`, {
  method: 'POST',
  body: { name: 'DeepSeek 主模型（改名）', provider: 'deepseek', baseUrl: MOCK_BASE, model: 'deepseek-v4-flash', apiKey: '' },
});

/* --- 单独测试某套配置 --- */
const test2 = await req(`/api/admin/site-ai/profiles/${id2}/test`, { method: 'POST', body: {} });
check('可单独测试未启用配置', test2.status === 200 && test2.data.ok === true, `HTTP ${test2.status}`);
check('测试未启用配置不影响启用状态', !test2.data.profiles.some((x) => x.enabled), 'no enabled');

const testBad = await req(`/api/admin/site-ai/profiles/${id2}/test`, { method: 'POST', body: { apiKey: 'bad-key' } });
check('错误 Key 测试失败且给出可读原因', testBad.status === 400 && /认证失败/.test(testBad.data?.error || ''), testBad.data?.error?.slice(0, 40));
check('测试失败后该配置变为未验证', testBad.data?.profile?.verified === false, testBad.data?.profile?.status);

// 未验证的配置不允许启用
const enBad = await req(`/api/admin/site-ai/profiles/${id2}/enable`, { method: 'POST', body: {} });
check('未通过测试的配置不能启用', enBad.status === 400 && /测试/.test(enBad.data?.error || ''), `HTTP ${enBad.status}`);

// 重新测试通过后再启用
const retest = await req(`/api/admin/site-ai/profiles/${id2}/test`, { method: 'POST', body: {} });
check('重新测试通过', retest.status === 200 && retest.data.ok === true, `HTTP ${retest.status}`);

/* --- 启用 --- */
const en2 = await req(`/api/admin/site-ai/profiles/${id2}/enable`, { method: 'POST', body: {} });
check('启用第 2 套', en2.status === 200 && en2.data.activeId === id2, `HTTP ${en2.status} ${en2.data?.error || ''}`);
check('启用后只有一套处于启用', (en2.data?.profiles || []).filter((x) => x.enabled).length === 1);

const en3 = await req(`/api/admin/site-ai/profiles/${id3}/enable`, { method: 'POST', body: {} });
check('启用第 3 套时第 2 套自动停用',
  en3.status === 200 && en3.data?.activeId === id3 && (en3.data?.profiles || []).filter((x) => x.enabled).length === 1,
  `active=${en3.data?.activeId}`);

/* --- 并发启用 --- */
const burst = await Promise.all(
  [id1, id2, id3, id1, id2].map((id) => req(`/api/admin/site-ai/profiles/${id}/enable`, { method: 'POST', body: {} }))
);
const afterBurst = await req('/api/admin/site-ai');
const enabledCount = (afterBurst.data?.profiles || []).filter((x) => x.enabled).length;
check('并发启用后仍只有一套启用', enabledCount === 1,
  `enabled=${enabledCount} 请求码=${burst.map((b) => b.status).join(',')}`);

/* --- 总开关 --- */
const masterNoActive = await (async () => {
  // 先停掉当前启用：删除会带走启用状态，这里用一次「启用再删除」的路径验证
  const activeId = (await req('/api/admin/site-ai')).data.activeId;
  return activeId;
})();

const on1 = await req('/api/admin/site-ai/master', { method: 'POST', body: { enabled: true } });
check('有可用配置时可以开启总开关', on1.status === 200 && on1.data.master.enabled === true, `HTTP ${on1.status} ${on1.data?.error || ''}`);

const greetingOn = await req('/api/greeting?dishId=mapo-tofu');
check('开启后前台 AI 可用（无需个人 Key）', greetingOn.data?.aiConfigured === true && greetingOn.data?.aiSource === 'site',
  `configured=${greetingOn.data?.aiConfigured} source=${greetingOn.data?.aiSource}`);

const off1 = await req('/api/admin/site-ai/master', { method: 'POST', body: { enabled: false } });
check('可以关闭总开关', off1.status === 200 && off1.data.master.enabled === false);

const greetingOff = await req('/api/greeting?dishId=mapo-tofu');
check('关闭后前台提示未接入（不再使用内置模型）',
  greetingOff.data?.aiConfigured === false && /内置 AI 暂未开启|接入 AI/.test(greetingOff.data?.aiMessage || ''),
  greetingOff.data?.aiMessage?.slice(0, 40));

const chatOff = await req('/api/chat', { method: 'POST', body: { dishId: 'mapo-tofu', messages: [{ role: 'user', content: 'hi' }] } });
check('关闭后聊天接口被拦截并返回明确错误码', chatOff.status === 409 && chatOff.data?.code === 'ai_disabled',
  `HTTP ${chatOff.status} code=${chatOff.data?.code}`);

/* 关闭内置 AI 后，配了个人模型的用户仍可用自己的模型 */
{
  const savedCookie = cookie;
  cookie = '';
  const uEmail = `ownmodel-${Date.now()}@example.com`;
  await req('/api/auth/register', { method: 'POST', body: { email: uEmail, password: 'Own123456!', name: '自有模型用户' } });
  const t = await req('/api/ai/test', {
    method: 'POST',
    body: { provider: 'custom', baseUrl: MOCK_BASE, model: 'own-model', apiKey: 'ok-key-own' },
  });
  const sv = await req('/api/ai/config', {
    method: 'POST',
    body: { provider: 'custom', baseUrl: MOCK_BASE, model: 'own-model', apiKey: 'ok-key-own', verifyToken: t.data?.verifyToken },
  });
  const g = await req('/api/greeting?dishId=mapo-tofu');
  check('关闭内置 AI 后：有个人配置的用户走自己的模型',
    sv.status === 200 && g.data?.aiConfigured === true && g.data?.aiSource === 'user',
    `save=${sv.status} configured=${g.data?.aiConfigured} source=${g.data?.aiSource}`);
  cookie = savedCookie;
}

/* --- 删除 --- */
const delInactive = await req(`/api/admin/site-ai/profiles/${id3}`, { method: 'DELETE' });
check('删除未启用配置成功', delInactive.status === 200 && delInactive.data.count === 2, `HTTP ${delInactive.status}`);

await req('/api/admin/site-ai/master', { method: 'POST', body: { enabled: true } });
const activeNow = (await req('/api/admin/site-ai')).data.activeId;
const delActive = await req(`/api/admin/site-ai/profiles/${activeNow}`, { method: 'DELETE' });
check('删除当前启用配置：停用 + 同步关闭总开关',
  delActive.status === 200 && delActive.data.wasEnabled === true && delActive.data.masterDisabled === true && delActive.data.master.enabled === false,
  `wasEnabled=${delActive.data?.wasEnabled} masterDisabled=${delActive.data?.masterDisabled}`);

const masterNoCfg = await req('/api/admin/site-ai/master', { method: 'POST', body: { enabled: true } });
check('没有启用配置时无法开启总开关', masterNoCfg.status === 400 && /启用一套/.test(masterNoCfg.data?.error || ''),
  `HTTP ${masterNoCfg.status} ${masterNoCfg.data?.error || ''}`);

/* --- 权限 --- */
const anon = await fetch(APP + '/api/admin/site-ai');
check('未登录访问管理接口 → 401', anon.status === 401, `HTTP ${anon.status}`);

cookie = '';
const normalEmail = `normal-${Date.now()}@example.com`;
await req('/api/auth/register', { method: 'POST', body: { email: normalEmail, password: 'Normal1234!', name: '普通用户' } });
const normalPanel = await req('/api/admin/site-ai');
check('普通用户读取配置 → 403', normalPanel.status === 403, `HTTP ${normalPanel.status}`);
const normalCreate = await req('/api/admin/site-ai/profiles', { method: 'POST', body: mk('hack', 'custom', 'm') });
check('普通用户新增配置 → 403', normalCreate.status === 403, `HTTP ${normalCreate.status}`);
const normalMaster = await req('/api/admin/site-ai/master', { method: 'POST', body: { enabled: true } });
check('普通用户切换总开关 → 403', normalMaster.status === 403, `HTTP ${normalMaster.status}`);

/* --- 持久化：重启后状态一致 --- */
cookie = '';
await req('/api/auth/login', { method: 'POST', body: { email: ADMIN_EMAIL, password: 'SiteAi1234!' } });
const beforeRestart = await req('/api/admin/site-ai');
const snapshot = {
  count: beforeRestart.data.count,
  enabled: beforeRestart.data.master.enabled,
  activeId: beforeRestart.data.activeId,
  names: beforeRestart.data.profiles.map((p) => p.name).sort(),
};

child.kill();
await new Promise((ok) => setTimeout(ok, 600));
const child2 = spawn(process.execPath, ['--env-file=.env', 'server/index.mjs'], {
  env: { ...process.env, PORT: String(APP_PORT), DB_PATH: DB_MAIN, ADMIN_EMAILS: ADMIN_EMAIL },
  stdio: ['ignore', 'pipe', 'pipe'],
});
await waitHealth(APP);
cookie = '';
await req('/api/auth/login', { method: 'POST', body: { email: ADMIN_EMAIL, password: 'SiteAi1234!' } });
const afterRestart = await req('/api/admin/site-ai');
check('重启后配置数量一致', afterRestart.data.count === snapshot.count, `${snapshot.count} -> ${afterRestart.data.count}`);
check('重启后总开关状态一致', afterRestart.data.master.enabled === snapshot.enabled);
check('重启后启用配置一致', afterRestart.data.activeId === snapshot.activeId);
check('重启后配置名称一致', JSON.stringify(afterRestart.data.profiles.map((p) => p.name).sort()) === JSON.stringify(snapshot.names));

/* ============================================================
 * 3. 页面
 * ============================================================ */

// 补到 3 套，验证新增按钮禁用
const cur = await req('/api/admin/site-ai');
while (cur.data.count < 3) {
  await req('/api/admin/site-ai/profiles', { method: 'POST', body: mk(`补位 ${cur.data.count + 1}`, 'custom', 'mock-model') });
  const again = await req('/api/admin/site-ai');
  cur.data = again.data;
}

const browser = await chromium.launch({
  executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe',
  headless: true,
});
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
const pageErrors = [];
page.on('pageerror', (e) => pageErrors.push(e.message));

await page.goto(APP + '/admin', { waitUntil: 'networkidle' });
await page.waitForTimeout(600);
await page.locator('.account-btn--ghost', { hasText: '登录' }).first().click();
await page.waitForTimeout(400);
await page.locator('.account-modal input[type="email"]').fill(ADMIN_EMAIL);
await page.locator('.account-modal input[type="password"]').fill('SiteAi1234!');
await page.locator('.account-modal button[type="submit"]').click();
await page.waitForTimeout(1200);
await page.locator('.admin-nav__item', { hasText: '内置 AI' }).click();
await page.waitForTimeout(1200);

const ui = await page.evaluate(() => ({
  cards: document.querySelectorAll('.admin-ai-profile').length,
  masterText: document.querySelector('.admin-ai__master-state b')?.textContent?.trim() || '',
  addDisabled: document.querySelector('.admin-card__head button')?.disabled ?? null,
  addLabel: document.querySelector('.admin-card__head button')?.textContent?.trim() || '',
  hasKeyText: /已加密保存/.test(document.querySelector('.admin-ai-profile')?.textContent || ''),
  // 输入框 placeholder 是 sk-...，不算泄漏；只查真实密钥形态与字段名
  leak: /key_cipher|Bearer\s+\w{10,}|sk-[A-Za-z0-9]{12,}/.test(document.body.innerHTML),
  scrollW: document.documentElement.scrollWidth,
  clientW: document.documentElement.clientWidth,
}));
check('后台渲染 3 张配置卡片', ui.cards === 3, `cards=${ui.cards}`);
check('总开关状态可见', /已开启|已关闭/.test(ui.masterText), ui.masterText);
check('达到上限后新增按钮禁用', ui.addDisabled === true, `disabled=${ui.addDisabled}`);
check('卡片显示「已加密保存」而非密钥', ui.hasKeyText === true);
check('页面不含密钥原文', ui.leak === false);
check('页面无横向溢出', ui.scrollW <= ui.clientW, `${ui.scrollW}/${ui.clientW}`);
check('页面无脚本异常', pageErrors.length === 0, pageErrors.slice(0, 2).join(' | '));

await page.screenshot({ path: 'F:/AIweb/美食1.0/aimeishi2.0/shots/admin-site-ai-profiles.png', fullPage: true });

// 移动端
const m = await browser.newPage({ viewport: { width: 390, height: 844 } });
await m.goto(APP + '/admin', { waitUntil: 'networkidle' });
await m.waitForTimeout(800);
const mInfo = await m.evaluate(() => ({
  scrollW: document.documentElement.scrollWidth,
  clientW: document.documentElement.clientWidth,
  cards: document.querySelectorAll('.admin-ai-profile').length,
}));
check('移动端无横向溢出', mInfo.scrollW <= mInfo.clientW, `${mInfo.scrollW}/${mInfo.clientW}`);
await m.screenshot({ path: 'F:/AIweb/美食1.0/aimeishi2.0/shots/admin-site-ai-profiles-mobile.png', fullPage: true });
await browser.close();

child2.kill();
mockServer.close();
await new Promise((ok) => setTimeout(ok, 300));

for (const f of [DB_MAIN, DB_MIG, `${DB_MAIN}-wal`, `${DB_MAIN}-shm`, `${DB_MIG}-wal`, `${DB_MIG}-shm`]) {
  if (fs.existsSync(f)) fs.unlinkSync(f);
}

if (results.some((x) => !x.pass)) {
  const tail = childLog.join('').split('\n').filter(Boolean).slice(-8).join('\n');
  if (tail) console.log('\n--- 应用日志（尾部）---\n' + tail);
}

const pass = results.filter((x) => x.pass).length;
console.log(`\nTOTAL ${pass}/${results.length}`);
process.exit(pass === results.length ? 0 : 1);
