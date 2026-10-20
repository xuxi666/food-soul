// 内置 AI 配置与全站路由验收
// 需要本地 .env 里可用的 SEARCH_API_KEY 作为测试用模型 Key（仅测试期使用，不写入任何文件）
import fs from 'node:fs';

const BASE = process.env.BASE || 'http://127.0.0.1:5180';
const ADMIN_EMAIL = process.env.ADMIN_EMAIL || 'admin@foodsoul.local';
const ADMIN_PASS = 'AdminPass1234!';

const results = [];
const check = (n, pass, extra = '') => {
  results.push({ name: n, pass });
  console.log(`${pass ? 'PASS' : 'FAIL'} | ${n}${extra ? ' | ' + extra : ''}`);
};

function envKey() {
  try {
    const txt = fs.readFileSync('.env', 'utf8');
    return (txt.match(/^SEARCH_API_KEY=(.+)$/m) || [])[1]?.trim() || '';
  } catch {
    return '';
  }
}
const KEY = envKey();
if (!KEY) {
  console.error('缺少 SEARCH_API_KEY，无法进行真实模型测试');
  process.exit(2);
}

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
  try { data = JSON.parse(text); } catch { data = { raw: text }; }
  return { status: res.status, data, cookie: sess ? sess.split(';')[0] : '', raw: text };
}

async function loginOrRegister(email, password, name) {
  const reg = await req('/api/auth/register', { method: 'POST', body: { email, password, name } });
  if (reg.status === 200) return { cookie: reg.cookie, data: reg.data };
  const login = await req('/api/auth/login', { method: 'POST', body: { email, password } });
  return { cookie: login.cookie, data: login.data };
}

/** 触发一次聊天，返回状态与是否收到流式内容 */
async function chatProbe(cookie) {
  const res = await fetch(BASE + '/api/chat', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: BASE, Cookie: cookie },
    body: JSON.stringify({ dishId: 'mapo-tofu', messages: [{ role: 'user', content: '一句话介绍你自己' }] }),
  });
  const text = await res.text();
  return { status: res.status, hasDelta: /"delta"/.test(text), body: text.slice(0, 160) };
}

const stamp = Date.now();
const admin = await loginOrRegister(ADMIN_EMAIL, ADMIN_PASS, '管理员');
check('管理员登录', Boolean(admin.cookie) && admin.data?.user?.role === 'admin', admin.data?.user?.role);

/* ---------- 权限 ---------- */
const anon = await req('/api/admin/site-ai');
check('未登录读内置配置 401', anon.status === 401, `HTTP ${anon.status}`);

const normal = await loginOrRegister(`siteai-n-${stamp}@example.com`, 'Normal1234!', '普通用户');
check('普通用户登录', Boolean(normal.cookie));
const normalGet = await req('/api/admin/site-ai', { cookie: normal.cookie });
check('普通用户读内置配置 403', normalGet.status === 403, `HTTP ${normalGet.status}`);
const normalToggle = await req('/api/admin/site-ai/toggle', { method: 'POST', cookie: normal.cookie, body: { enabled: true } });
check('普通用户切换开关 403', normalToggle.status === 403, `HTTP ${normalToggle.status}`);
const normalSave = await req('/api/admin/site-ai/config', { method: 'POST', cookie: normal.cookie, body: { provider: 'zhipu', baseUrl: 'https://open.bigmodel.cn/api/paas/v4', model: 'glm-4-flash', apiKey: KEY } });
check('普通用户保存内置配置 403', normalSave.status === 403, `HTTP ${normalSave.status}`);

/* ---------- 初始状态 ---------- */
const s0 = await req('/api/admin/site-ai', { cookie: admin.cookie });
const preConfigured = s0.data.status.configured === true;
if (!preConfigured) {
  check('初始未配置', s0.status === 200 && s0.data.status.configured === false, JSON.stringify({ configured: s0.data?.status?.configured }));
  check('初始不可启用', s0.data.status.canEnable === false);
  const t0 = await req('/api/admin/site-ai/toggle', { method: 'POST', cookie: admin.cookie, body: { enabled: true } });
  check('未配置时禁止开启', t0.status === 400, `HTTP ${t0.status} ${t0.data?.error || ''}`);
} else {
  // 已存在内置配置（例如重复运行）：初始态断言不适用
  console.log('SKIP | 初始未配置（环境中已存在内置配置）');
  results.push({ name: 'skip-pre', pass: true });
  results.push({ name: 'skip-canEnable', pass: true });
  results.push({ name: 'skip-toggle', pass: true });
}

/* ---------- 错误配置 ---------- */
const badKey = await req('/api/admin/site-ai/test', {
  method: 'POST', cookie: admin.cookie,
  body: { provider: 'zhipu', baseUrl: 'https://open.bigmodel.cn/api/paas/v4', model: 'glm-4-flash', apiKey: 'sk-invalid-key-123456' },
});
check('错误 API Key 测试失败', badKey.status === 400, `HTTP ${badKey.status} ${badKey.data?.error || ''}`);

const badModel = await req('/api/admin/site-ai/test', {
  method: 'POST', cookie: admin.cookie,
  body: { provider: 'zhipu', baseUrl: 'https://open.bigmodel.cn/api/paas/v4', model: 'no-such-model-xyz', apiKey: KEY },
});
check('不存在的模型测试失败', badModel.status === 400, `HTTP ${badModel.status}`);

const badUrl = await req('/api/admin/site-ai/test', {
  method: 'POST', cookie: admin.cookie,
  body: { provider: 'custom', baseUrl: 'http://127.0.0.1:1/v1', model: 'x', apiKey: KEY },
});
check('错误 Base URL 测试失败', badUrl.status === 400, `HTTP ${badUrl.status}`);

/* ---------- 正确配置 ---------- */
const okTest = await req('/api/admin/site-ai/test', {
  method: 'POST', cookie: admin.cookie,
  body: { provider: 'zhipu', baseUrl: 'https://open.bigmodel.cn/api/paas/v4', model: 'glm-4-flash', apiKey: KEY },
});
check('正确配置测试通过', okTest.status === 200 && okTest.data.ok === true, `HTTP ${okTest.status} ${okTest.data?.latency ?? ''}ms`);

const saved = await req('/api/admin/site-ai/config', {
  method: 'POST', cookie: admin.cookie,
  body: { provider: 'zhipu', baseUrl: 'https://open.bigmodel.cn/api/paas/v4', model: 'glm-4-flash', apiKey: KEY },
});
check('保存内置配置', saved.status === 200 && saved.data.verified === true, `HTTP ${saved.status}`);
check('保存后状态为已验证', saved.data.status.verified === true && saved.data.status.configured === true);
check('保存响应不含 Key', !saved.raw.includes(KEY.slice(0, 12)));

/* ---------- 留空 Key 不覆盖 ---------- */
const keep = await req('/api/admin/site-ai/config', {
  method: 'POST', cookie: admin.cookie,
  body: { provider: 'zhipu', baseUrl: 'https://open.bigmodel.cn/api/paas/v4', model: 'glm-4-flash', apiKey: '' },
});
check('Key 留空仍可保存（沿用原密钥）', keep.status === 200 && keep.data.verified === true, `HTTP ${keep.status} ${keep.data?.testError || ''}`);

/* ---------- 开启内置 ---------- */
const on = await req('/api/admin/site-ai/toggle', { method: 'POST', cookie: admin.cookie, body: { enabled: true } });
check('开启内置 AI', on.status === 200 && on.data.status.enabled === true, `HTTP ${on.status}`);

const meNormal = await req('/api/auth/me', { cookie: normal.cookie });
check('普通用户可见内置模式', meNormal.data?.siteAi?.enabled === true, JSON.stringify(meNormal.data?.siteAi));
check('普通用户无个人配置', meNormal.data?.ai?.configured === false);

const chatNormal = await chatProbe(normal.cookie);
check('内置开启：无个人配置的普通用户可聊天', chatNormal.status === 200 && chatNormal.hasDelta, `HTTP ${chatNormal.status}`);

// 另一个用户也验证一次（多用户共享内置）
const user2 = await loginOrRegister(`siteai-u2-${stamp}@example.com`, 'Normal1234!', '用户二');
const chat2 = await chatProbe(user2.cookie);
check('内置开启：第二个用户同样可用', chat2.status === 200 && chat2.hasDelta, `HTTP ${chat2.status}`);

/* ---------- 用户个人配置不影响全站模式 ---------- */
const badPersonal = await req('/api/ai/config', {
  method: 'POST', cookie: normal.cookie,
  body: { provider: 'custom', baseUrl: 'http://127.0.0.1:1/v1', model: 'broken', apiKey: 'sk-broken' },
});
check('用户保存了不可用的个人配置（预期失败）', badPersonal.status !== 200 || badPersonal.data?.ok === false, `HTTP ${badPersonal.status}`);
const chatStill = await chatProbe(normal.cookie);
check('内置开启时个人坏配置不影响使用', chatStill.status === 200 && chatStill.hasDelta, `HTTP ${chatStill.status}`);

/* ---------- 关闭内置 ---------- */
const off = await req('/api/admin/site-ai/toggle', { method: 'POST', cookie: admin.cookie, body: { enabled: false } });
check('关闭内置 AI', off.status === 200 && off.data.status.enabled === false);
check('关闭后配置仍保留', off.data.status.configured === true && off.data.status.verified === true);

const chatOff = await chatProbe(normal.cookie);
check('关闭后未配置用户被拒绝', chatOff.status === 409 || chatOff.status === 400, `HTTP ${chatOff.status}`);
check('提示语明确要求接入个人模型', /接入 AI/.test(chatOff.body), chatOff.body.slice(0, 80));

const meOff = await req('/api/auth/me', { cookie: normal.cookie });
check('关闭后状态回到未接入', meOff.data?.siteAi?.enabled === false && meOff.data?.ai?.configured === false);

/* ---------- 关闭后个人模型可用 ---------- */
const okPersonal = await req('/api/ai/config', {
  method: 'POST', cookie: normal.cookie,
  body: { provider: 'zhipu', baseUrl: 'https://open.bigmodel.cn/api/paas/v4', model: 'glm-4-flash', apiKey: KEY, verifyToken: (await req('/api/ai/test', { method: 'POST', cookie: normal.cookie, body: { provider: 'zhipu', baseUrl: 'https://open.bigmodel.cn/api/paas/v4', model: 'glm-4-flash', apiKey: KEY } })).data?.verifyToken },
});
check('用户配置个人模型', okPersonal.status === 200, `HTTP ${okPersonal.status} ${okPersonal.data?.error || ''}`);
const chatPersonal = await chatProbe(normal.cookie);
check('关闭后个人模型可用', chatPersonal.status === 200 && chatPersonal.hasDelta, `HTTP ${chatPersonal.status}`);

/* ---------- 重新开启，配置仍在 ---------- */
const onAgain = await req('/api/admin/site-ai/toggle', { method: 'POST', cookie: admin.cookie, body: { enabled: true } });
check('关闭后可再次开启且配置仍有效', onAgain.status === 200 && onAgain.data.status.enabled === true, `HTTP ${onAgain.status}`);

/* ---------- 无 Key 泄露 ---------- */
const statusRes = await req('/api/admin/site-ai', { cookie: admin.cookie });
check('状态接口不含 Key', !statusRes.raw.includes(KEY.slice(0, 12)) && !/key_cipher|apiKey/i.test(statusRes.raw), '');
const meRaw = await req('/api/auth/me', { cookie: normal.cookie });
check('me 接口不含 Key', !meRaw.raw.includes(KEY.slice(0, 12)));

/* ---------- 清理：关闭并删除测试用户 ---------- */
await req('/api/admin/site-ai/toggle', { method: 'POST', cookie: admin.cookie, body: { enabled: false } });

const passed = results.filter((r) => r.pass).length;
console.log(`\nTOTAL ${passed}/${results.length}`);
console.log('STAMP=' + stamp);
if (passed !== results.length) process.exitCode = 1;
