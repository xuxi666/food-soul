import { SEARCH_CONFIG } from '../server/config.mjs';

const BASE = 'http://127.0.0.1:5180';
const BASE_URL = 'https://open.bigmodel.cn/api/paas/v4';
const MODEL = 'glm-4-flash';

/** 为回归测试创建一个已接入 AI 的临时账号，返回会话 Cookie（不打印密钥） */
export async function getTestCookie() {
  if (!SEARCH_CONFIG.apiKey) throw new Error('SEARCH_API_KEY 未配置，无法运行需要 AI 的回归测试');
  const email = `test-${Date.now()}-${Math.random().toString(36).slice(2, 6)}@example.com`;
  const reg = await fetch(`${BASE}/api/auth/register`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email, password: 'TestPass123!', name: '回归测试' }),
  });
  if (!reg.ok) throw new Error(`注册测试账号失败 (${reg.status})`);
  const cookie =
    (reg.headers.getSetCookie?.() || []).find((x) => x.startsWith('fs_session='))?.split(';')[0] || '';
  if (!cookie) throw new Error('未拿到测试会话 Cookie');

  const test = await fetch(`${BASE}/api/ai/test`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', cookie },
    body: JSON.stringify({ provider: 'zhipu', baseUrl: BASE_URL, model: MODEL, apiKey: SEARCH_CONFIG.apiKey }),
  });
  const t = await test.json().catch(() => null);
  if (!t?.ok) throw new Error(`测试连接失败：${t?.error || test.status}`);

  const save = await fetch(`${BASE}/api/ai/config`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', cookie },
    body: JSON.stringify({
      provider: 'zhipu',
      baseUrl: BASE_URL,
      model: MODEL,
      apiKey: SEARCH_CONFIG.apiKey,
      verifyToken: t.verifyToken,
    }),
  });
  if (!save.ok) throw new Error(`保存测试配置失败 (${save.status})`);
  return cookie;
}

export async function setTestCookie(page, cookie) {
  const value = cookie.split('=').slice(1).join('=');
  await page.context().addCookies([{ name: 'fs_session', value, domain: '127.0.0.1', path: '/' }]);
}

/** 清理临时账号的 AI 配置，避免测试密钥留在数据库 */
export async function clearTestConfig(cookie) {
  try {
    await fetch(`${BASE}/api/ai/config`, { method: 'DELETE', headers: { cookie } });
  } catch {
    /* noop */
  }
}
