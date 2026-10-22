/**
 * 验收：用户级 AI 配置（注册/登录、连接测试、加密存储、账号隔离、真实模型调用）
 * 用法：先启动 dev server（5180），再 node scripts/verify-ai-config.mjs
 * 注意：不会打印任何真实 API Key。
 */
import { DatabaseSync } from 'node:sqlite';
import { SEARCH_CONFIG } from '../server/config.mjs';

const BASE = 'http://127.0.0.1:5180';
const KEY = SEARCH_CONFIG.apiKey;
let failures = 0;
const check = (label, ok, extra = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'} ${label}${extra ? ` — ${extra}` : ''}`);
  if (!ok) failures += 1;
};

function cookieFrom(res) {
  const lines = typeof res.headers.getSetCookie === 'function' ? res.headers.getSetCookie() : [];
  const line = lines.find((x) => x.startsWith('fs_session=')) || '';
  return line.split(';')[0];
}

async function request(path, { method = 'GET', body, cookie } = {}) {
  const headers = {};
  if (body) headers['content-type'] = 'application/json';
  if (cookie) headers.cookie = cookie;
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => null);
  return { status: res.status, data, cookie: cookieFrom(res) };
}

async function chat(cookie, dishId, text) {
  const res = await fetch(`${BASE}/api/chat`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', cookie },
    body: JSON.stringify({ dishId, messages: [{ role: 'user', content: text }] }),
  });
  const raw = await res.text();
  const lines = raw.split('\n').filter((l) => l.startsWith('data:'));
  const events = lines.map((l) => {
    try {
      return JSON.parse(l.slice(5).trim());
    } catch {
      return null;
    }
  }).filter(Boolean);
  return {
    status: res.status,
    meta: events.find((e) => e.type === 'meta') || null,
    deltas: events.filter((e) => e.type === 'delta').map((e) => e.text).join(''),
    error: events.find((e) => e.type === 'error') || null,
    done: events.some((e) => e.type === 'done'),
  };
}

const stamp = Date.now();
const base = { provider: 'zhipu', baseUrl: 'https://open.bigmodel.cn/api/paas/v4' };

/* 1. 基础状态 */
const health = await request('/api/health');
check('健康检查正常且声明用户级 AI', health.status === 200 && health.data?.ai === 'user-config');

const anon = await request('/api/auth/me');
check('未登录状态返回空用户与未配置', anon.data?.user === null && anon.data?.ai?.configured === false);

const noSession = await request('/api/ai/test', { method: 'POST', body: { ...base, model: 'glm-4-flash', apiKey: 'x' } });
check('未登录不能调用测试接口', noSession.status === 401, `http=${noSession.status}`);

/* 2. 注册 A */
const regA = await request('/api/auth/register', {
  method: 'POST',
  body: { email: `a-${stamp}@example.com`, password: 'TestPass123!', name: '测试A' },
});
check('用户 A 注册成功', regA.status === 200 && Boolean(regA.data?.user?.id), `http=${regA.status}`);
const aCookie = regA.cookie;
const aId = regA.data?.user?.id;
check('注册后返回会话 Cookie', Boolean(aCookie));

/* 3. 无效 Key 不能标记为已接入 */
const badKey = await request('/api/ai/test', {
  method: 'POST',
  cookie: aCookie,
  body: { ...base, model: 'glm-4-flash', apiKey: `sk-invalid-${stamp}` },
});
check('无效 API Key 测试失败', badKey.data?.ok === false, badKey.data?.code || badKey.data?.error);

/* 4. 真实连接测试 + 保存 A */
if (KEY) {
  const testA = await request('/api/ai/test', {
    method: 'POST',
    cookie: aCookie,
    body: { ...base, model: 'glm-4-flash', apiKey: KEY },
  });
  check('用户 A 真实连接测试通过', testA.data?.ok === true, testA.data?.error || `latency=${testA.data?.latency}ms`);
  check('测试通过返回验证令牌', Boolean(testA.data?.verifyToken));

  const saveA = await request('/api/ai/config', {
    method: 'POST',
    cookie: aCookie,
    body: { ...base, model: 'glm-4-flash', apiKey: KEY, verifyToken: testA.data?.verifyToken },
  });
  check('用户 A 配置保存成功', saveA.status === 200 && saveA.data?.ok === true, `http=${saveA.status}`);
  check('保存后状态为已连接', saveA.data?.ai?.verified === true && saveA.data?.ai?.model === 'glm-4-flash');

  const cfgA = await request('/api/ai/config', { cookie: aCookie });
  const cfgText = JSON.stringify(cfgA.data);
  check('配置回显不含 API Key', !cfgText.includes(KEY) && !('apiKey' in (cfgA.data || {})));
  check('配置回显含服务商/模型', cfgA.data?.provider === 'zhipu' && cfgA.data?.model === 'glm-4-flash');

  const chatA = await chat(aCookie, 'mapo-tofu', '用一句话介绍你自己。');
  check('用户 A 聊天使用自己的模型', chatA.meta?.model === 'glm-4-flash' && chatA.deltas.length > 0 && chatA.done, `model=${chatA.meta?.model}`);

  /* 5. 用户 B 配置不同模型 */
  const regB = await request('/api/auth/register', {
    method: 'POST',
    body: { email: `b-${stamp}@example.com`, password: 'TestPass123!', name: '测试B' },
  });
  const bCookie = regB.cookie;
  const bId = regB.data?.user?.id;
  const testB = await request('/api/ai/test', {
    method: 'POST',
    cookie: bCookie,
    body: { ...base, model: 'glm-4-air', apiKey: KEY },
  });
  check('用户 B 真实连接测试通过（不同模型）', testB.data?.ok === true, testB.data?.error || '');
  const saveB = await request('/api/ai/config', {
    method: 'POST',
    cookie: bCookie,
    body: { ...base, model: 'glm-4-air', apiKey: KEY, verifyToken: testB.data?.verifyToken },
  });
  check('用户 B 配置保存成功', saveB.status === 200 && saveB.data?.ok === true);

  const meA = await request('/api/auth/me', { cookie: aCookie });
  const meB = await request('/api/auth/me', { cookie: bCookie });
  check('A/B 各自读取自己的模型', meA.data?.ai?.model === 'glm-4-flash' && meB.data?.ai?.model === 'glm-4-air', `${meA.data?.ai?.model} / ${meB.data?.ai?.model}`);

  const chatB = await chat(bCookie, 'mapo-tofu', '用一句话介绍你自己。');
  check('用户 B 聊天使用自己的模型', chatB.meta?.model === 'glm-4-air' && chatB.deltas.length > 0 && chatB.done, `model=${chatB.meta?.model}`);

  /* 6. 伪造身份 / 越权 */
  const forged = await request('/api/auth/me', { cookie: 'fs_session=forged-token-value' });
  check('伪造会话无法读取用户', forged.data?.user === null);

  const cfgWithForgedUser = await request(`/api/ai/config?userId=${encodeURIComponent(bId)}`, { cookie: aCookie });
  check('客户端传 userId 不影响配置归属', cfgWithForgedUser.data?.model === 'glm-4-flash');

  /* 7. 数据库密文检查 */
  const db = new DatabaseSync('data/foodsoul.db');
  const rowA = db.prepare('SELECT * FROM ai_configs WHERE user_id = ?').get(aId);
  const rowB = db.prepare('SELECT * FROM ai_configs WHERE user_id = ?').get(bId);
  check('数据库存在 A/B 配置行', Boolean(rowA && rowB));
  check('数据库不保存明文 API Key', Boolean(rowA) && rowA.key_cipher !== KEY && !rowA.key_cipher.includes(KEY));
  check('数据库保存 nonce / tag / 版本', Boolean(rowA?.key_iv && rowA?.key_tag && rowA?.key_version));
  check('A/B 配置相互独立', rowA?.model === 'glm-4-flash' && rowB?.model === 'glm-4-air');
  db.close();

  /* 8. 删除 B 配置，不影响 A */
  const delB = await request('/api/ai/config', { method: 'DELETE', cookie: bCookie });
  check('用户 B 删除配置成功', delB.data?.ai?.configured === false);
  const meA2 = await request('/api/auth/me', { cookie: aCookie });
  check('B 删除后 A 配置仍存在', meA2.data?.ai?.configured === true && meA2.data?.ai?.model === 'glm-4-flash');

  /* 9. 退出登录 */
  const logout = await request('/api/auth/logout', { method: 'POST', cookie: aCookie });
  check('退出登录成功', logout.status === 200);
  const afterLogout = await request('/api/auth/me', { cookie: aCookie });
  check('退出后旧会话失效', afterLogout.data?.user === null);
} else {
  console.log('SKIP 真实模型测试：未配置 SEARCH_API_KEY');
}

console.log(`\nTOTAL FAIL=${failures}`);
process.exit(failures > 0 ? 1 : 0);
