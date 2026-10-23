/**
 * 菜谱工作台：联网检索（自建 SearXNG）+ 降级链路验收。
 *
 * 三段：
 *  A. 单元：web-search 的解析 / 空结果重试 / 错误分类 / 缓存（stub fetch，零外部请求）
 *  B. 集成：本地 mock（SearXNG + OpenAI 兼容模型），另起应用实例指向它，
 *     跑通「图鉴命中 / 检索成功 / 无结果降级 / 实例 5xx 降级 / 模型不可用 / 未登录」
 *  C. 页面：徽标与横幅是否正确
 *
 * 前置：npm run build（应用实例托管 dist）
 * 用法：node scripts/verify-recipe-fallback.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import { spawn } from 'node:child_process';
import { chromium } from 'playwright-core';

const results = [];
const check = (name, pass, extra = '') => {
  results.push({ name, pass });
  console.log(`${pass ? 'PASS' : 'FAIL'} | ${name}${extra ? ' | ' + extra : ''}`);
};

/* ============================================================
 * A. 单元测试
 * ============================================================ */

process.env.SEARXNG_URL = 'http://searxng.test';
process.env.BING_RSS_URL = ''; // 单测只测 SearXNG 一路，Bing 兜底在集成段验证
const { webSearch } = await import('../server/web-search.mjs');

const realFetch = globalThis.fetch;
let calls = 0;
let lastUrl = '';

function stubFetch(handler) {
  calls = 0;
  lastUrl = '';
  globalThis.fetch = async (url, init) => {
    calls += 1;
    lastUrl = String(url);
    return handler(url, init, calls);
  };
}
function jsonRes(status, obj) {
  return new Response(JSON.stringify(obj), { status, headers: { 'content-type': 'application/json' } });
}

const okBody = {
  results: [
    { title: '花卷做法大全', url: 'https://example.com/a', content: '面粉 酵母 发酵 蒸制', engine: '360search' },
    { title: '花卷（重复链接）', url: 'https://example.com/a', content: 'x', engine: '360search' },
    { title: '花卷家常做法', url: 'https://example.com/b', content: '葱花 卷制', engine: 'sogou' },
    { title: '非法链接', url: 'javascript:void(0)', content: 'y', engine: 'sogou' },
  ],
  unresponsive_engines: [['quark', 'Suspended: CAPTCHA']],
};

stubFetch(() => jsonRes(200, okBody));
let r = await webSearch('花卷 做法');
check('200 → 解析结果、去重并过滤非法 URL', r.status === 'ok' && r.sources.length === 2, `${r.status}/${r.sources.length}`);
check('来源带引擎名与摘要', r.sources[0].site === '360search' && r.sources[0].snippet.includes('面粉'), r.sources[0].site);
check('请求打到 /search?format=json', lastUrl.includes('/search?') && lastUrl.includes('format=json'), lastUrl.slice(0, 50));

stubFetch(() => jsonRes(200, { results: [] }));
r = await webSearch('空结果菜');
check('空结果会重试一次（共 2 次请求）', r.status === 'empty' && calls === 2, `${r.status}/${calls}`);

stubFetch(() => jsonRes(429, { error: 'slow down' }));
r = await webSearch('限流菜');
check('429 → rate_limit 且重试一次', r.errorKind === 'rate_limit' && calls === 2, `${r.errorKind}/${calls}`);

stubFetch(() => jsonRes(500, { error: 'boom' }));
r = await webSearch('服务端错误菜');
check('5xx → server', r.errorKind === 'server', r.errorKind);

stubFetch(() => jsonRes(403, { error: 'forbidden' }));
r = await webSearch('被拒菜');
check('403 → auth 且不重试', r.errorKind === 'auth' && calls === 1, `${r.errorKind}/${calls}`);

stubFetch(
  (url, init) =>
    new Promise((_, reject) => {
      init.signal.addEventListener('abort', () => {
        const e = new Error('aborted');
        e.name = 'AbortError';
        reject(e);
      });
    })
);
r = await webSearch('超时菜', { timeout: 3000 });
check('超时 → timeout', r.status === 'timeout' && r.errorKind === 'timeout', `${r.status}/${r.errorKind}`);

stubFetch(() => {
  throw Object.assign(new Error('connect ECONNREFUSED'), { cause: { code: 'ECONNREFUSED' } });
});
r = await webSearch('连不上菜');
check('连不上 → network', r.errorKind === 'network' && r.status === 'failed', `${r.errorKind}/${r.status}`);

stubFetch(() => jsonRes(200, okBody));
await webSearch('缓存菜');
const before = calls;
const cached = await webSearch('缓存菜');
check('同 query 命中缓存，不重复请求', calls === before && cached.cached === true, `calls=${calls}`);

stubFetch(() => jsonRes(500, { error: 'x' }));
await webSearch('失败缓存菜');
const before2 = calls;
await webSearch('失败缓存菜');
check('失败短缓存生效（不重复请求）', calls === before2, `calls=${calls}`);

process.env.SEARXNG_URL = '';
r = await webSearch('未配置菜');
check('未配置 SEARXNG_URL → not_configured', r.errorKind === 'not_configured', r.errorKind);
process.env.SEARXNG_URL = 'http://searxng.test';

globalThis.fetch = realFetch;

/* ============================================================
 * B. 集成：本地 mock + 独立应用实例
 * ============================================================ */

const RECIPE = {
  dish_name: '花卷',
  servings: 2,
  prep_time_minutes: 90,
  cook_time_minutes: 20,
  difficulty: 'easy',
  ingredients: [
    { name: '中筋面粉', amount: 300, unit: 'g', optional: false },
    { name: '温水', amount: 160, unit: 'ml', optional: false },
    { name: '干酵母', amount: 3, unit: 'g', optional: false },
  ],
  seasonings: [{ name: '白糖', amount: 10, unit: 'g', optional: true }],
  steps: [
    { step: 1, title: '化酵母', description: '酵母和糖用温水化开静置 5 分钟。', duration_minutes: 5, heat_level: 'low', tips: '水温不超过 35℃' },
    { step: 2, title: '和面', description: '分次加水揉成光滑面团。', duration_minutes: 15, heat_level: 'low', tips: '' },
    { step: 3, title: '发酵', description: '盖布发酵至两倍大。', duration_minutes: 60, heat_level: 'low', tips: '' },
    { step: 4, title: '整形', description: '擀开抹油撒葱花卷起切段。', duration_minutes: 10, heat_level: 'low', tips: '' },
    { step: 5, title: '蒸制', description: '大火蒸 15 分钟焖 3 分钟。', duration_minutes: 18, heat_level: 'high', tips: '不要立刻开盖' },
  ],
  taste_profile: ['麦香', '咸香'],
  substitutions: ['没有中筋粉可用高筋粉替代'],
  common_mistakes: ['各地做法不同，南方偏松软，北方偏紧实'],
  safety_notes: ['蒸制注意蒸汽烫伤'],
};

const mock = { search: 'ok', chat: 'ok' };

const mockServer = http.createServer((req, res) => {
  let body = '';
  req.on('data', (c) => (body += c));
  req.on('end', () => {
    const url = req.url || '';

    if (url.startsWith('/search')) {
      if (mock.search === 'empty') {
        res.writeHead(200, { 'content-type': 'application/json' });
        return res.end(JSON.stringify({ results: [] }));
      }
      if (mock.search === 'fail') {
        res.writeHead(500, { 'content-type': 'application/json' });
        return res.end(JSON.stringify({ error: 'boom' }));
      }
      const q = new URL(url, 'http://x').searchParams.get('q') || '花卷';
      const dish = q.split(/\s+/)[0] || '花卷';
      res.writeHead(200, { 'content-type': 'application/json' });
      return res.end(
        JSON.stringify({
          results: [
            { title: `${dish}的家常做法`, url: 'https://example.com/1', content: `${dish} 做法 面粉 酵母 发酵 蒸制`, engine: '360search' },
            { title: `${dish}做法详解`, url: 'https://example.com/2', content: `${dish} 做法 葱花 卷制`, engine: 'sogou' },
          ],
          unresponsive_engines: [],
        })
      );
    }

    if (url.startsWith('/bing')) {
      if (mock.search === 'fail') {
        res.writeHead(500, { 'content-type': 'application/json' });
        return res.end(JSON.stringify({ error: 'boom' }));
      }
      if (mock.search === 'empty') {
        res.writeHead(200, { 'content-type': 'application/rss+xml' });
        return res.end('<?xml version="1.0"?><rss><channel></channel></rss>');
      }
      const q = new URL(url, 'http://x').searchParams.get('q') || '花卷';
      const dish = q.split(/\s+/)[0] || '花卷';
      res.writeHead(200, { 'content-type': 'application/rss+xml' });
      return res.end(
        `<?xml version="1.0"?><rss><channel><item><title>${dish}的详细做法</title><link>https://example.com/bing1</link><description>${dish} 做法 步骤 面粉</description></item></channel></rss>`
      );
    }

    if (url.startsWith('/bing')) {
      if (mock.search === 'fail') {
        res.writeHead(500, { 'content-type': 'application/json' });
        return res.end(JSON.stringify({ error: 'boom' }));
      }
      if (mock.search === 'empty') {
        res.writeHead(200, { 'content-type': 'application/rss+xml' });
        return res.end('<?xml version="1.0"?><rss><channel></channel></rss>');
      }
      const q = new URL(url, 'http://x').searchParams.get('q') || '花卷';
      const dish = q.split(/\s+/)[0] || '花卷';
      res.writeHead(200, { 'content-type': 'application/rss+xml' });
      return res.end(
        `<?xml version="1.0"?><rss><channel><item><title>${dish}的详细做法</title><link>https://example.com/bing1</link><description>${dish} 做法 步骤 面粉</description></item></channel></rss>`
      );
    }

    if (url.includes('/chat/completions')) {
      const auth = String(req.headers.authorization || '');
      if (mock.chat === 'auth' || auth.includes('bad-key')) {
        res.writeHead(401, { 'content-type': 'application/json' });
        return res.end(JSON.stringify({ error: { message: 'invalid api key' } }));
      }
      const content = JSON.stringify(RECIPE);
      let wantStream = false;
      try {
        wantStream = Boolean(JSON.parse(body || '{}').stream);
      } catch {
        wantStream = false;
      }
      if (wantStream) {
        res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache' });
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

const MOCK_PORT = 5198;
const APP_PORT = 5199;
await new Promise((ok) => mockServer.listen(MOCK_PORT, '127.0.0.1', ok));

if (!fs.existsSync('dist/index.html')) {
  console.error('缺少 dist/，请先 npm run build');
  process.exit(1);
}

const child = spawn(process.execPath, ['--env-file=.env', 'server/index.mjs'], {
  env: {
    ...process.env,
    PORT: String(APP_PORT),
    SEARXNG_URL: `http://127.0.0.1:${MOCK_PORT}`,
    BING_RSS_URL: `http://127.0.0.1:${MOCK_PORT}/bing`,
    BING_RSS_URL: `http://127.0.0.1:${MOCK_PORT}/bing`,
  },
  stdio: ['ignore', 'pipe', 'pipe'],
});
const childLog = [];
child.stdout.on('data', (d) => childLog.push(String(d)));
child.stderr.on('data', (d) => childLog.push(String(d)));

const APP = `http://127.0.0.1:${APP_PORT}`;
for (let i = 0; i < 60; i += 1) {
  try {
    const h = await fetch(APP + '/api/health');
    if (h.ok) break;
  } catch {
    /* retry */
  }
  await new Promise((ok) => setTimeout(ok, 250));
}

let cookie = '';
async function req(p, { method = 'GET', body } = {}) {
  const res = await fetch(APP + p, {
    method,
    headers: { 'content-type': 'application/json', Origin: APP, ...(cookie ? { Cookie: cookie } : {}) },
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

async function makeUser(name) {
  const email = `${name}-${Date.now()}-${Math.floor(Math.random() * 1000)}@example.com`;
  cookie = '';
  const reg = await req('/api/auth/register', { method: 'POST', body: { email, password: 'Recipe1234!', name } });
  return { email, ok: reg.status === 200 };
}

async function saveModel(apiKey = 'mock-ok-key') {
  const baseUrl = `http://127.0.0.1:${MOCK_PORT}/v1`;
  const t = await req('/api/ai/test', { method: 'POST', body: { provider: 'custom', baseUrl, model: 'mock-model', apiKey } });
  const s = await req('/api/ai/config', {
    method: 'POST',
    body: { provider: 'custom', baseUrl, model: 'mock-model', apiKey, verifyToken: t.data?.verifyToken },
  });
  return { test: t.status, save: s.status };
}

/* --- 图鉴命中 --- */
const u1 = await makeUser('rf-lib');
check('注册账号（图鉴路径）', u1.ok);
await saveModel();
const libLookup = await req('/api/recipe/lookup', { method: 'POST', body: { dishName: '麻婆豆腐' } });
check('图鉴命中 → dataSource=library', libLookup.data?.dataSource === 'library', libLookup.data?.dataSource);
const libGen = await req('/api/recipe', { method: 'POST', body: { dishName: '麻婆豆腐', servings: 2, difficulty: 'easy' } });
check('图鉴菜品生成成功（不触发检索）', libGen.data?.dataSource === 'library' && Boolean(libGen.data?.recipe), `${libGen.data?.dataSource}`);

/* --- 检索成功 → ai-search --- */
const u2 = await makeUser('rf-search');
check('注册账号（检索路径）', u2.ok);
await saveModel();
const okLookup = await req('/api/recipe/lookup', { method: 'POST', body: { dishName: '花卷' } });
check('图鉴未命中 + 检索成功 → status=ok', okLookup.data?.status === 'ok', `status=${okLookup.data?.status}`);
check('检索结果带可追溯来源', (okLookup.data?.sources?.length || 0) > 0, `sources=${okLookup.data?.sources?.length}`);
const okGen = await req('/api/recipe', { method: 'POST', body: { dishName: '花卷', servings: 2, difficulty: 'easy', lookupId: okLookup.data?.lookupId } });
check('生成 → dataSource=ai-search', okGen.data?.dataSource === 'ai-search', okGen.data?.dataSource);
check('生成 → verification=ai-synthesized', okGen.data?.verification?.level === 'ai-synthesized', okGen.data?.verification?.level);
check('生成 → 携带来源', (okGen.data?.sources?.length || 0) > 0, `sources=${okGen.data?.sources?.length}`);

/* --- 检索无结果 → 降级 --- */
mock.search = 'empty';
const emptyLookup = await req('/api/recipe/lookup', { method: 'POST', body: { dishName: '糖三角' } });
check('检索无结果 → status=insufficient', emptyLookup.data?.status === 'insufficient', emptyLookup.data?.status);
const emptyGen = await req('/api/recipe', { method: 'POST', body: { dishName: '糖三角', servings: 2, difficulty: 'easy' } });
check('无结果仍能生成（降级为模型知识）', emptyGen.data?.dataSource === 'ai-knowledge' && Boolean(emptyGen.data?.recipe), emptyGen.data?.dataSource);
check('降级横幅含「未联网核实」', /未联网核实/.test(emptyGen.data?.verification?.label || ''), emptyGen.data?.verification?.label);
check('降级不伪造来源', (emptyGen.data?.sources?.length || 0) === 0, `sources=${emptyGen.data?.sources?.length}`);

/* --- 检索实例 5xx → 降级 --- */
mock.search = 'fail';
const failLookup = await req('/api/recipe/lookup', { method: 'POST', body: { dishName: '锅贴' } });
check('实例 5xx → status=failed + errorKind=server', failLookup.data?.status === 'failed' && failLookup.data?.errorKind === 'server',
  `${failLookup.data?.status}/${failLookup.data?.errorKind}`);
const failGen = await req('/api/recipe', { method: 'POST', body: { dishName: '锅贴', servings: 2, difficulty: 'easy' } });
check('实例 5xx 仍能降级生成', failGen.data?.dataSource === 'ai-knowledge' && Boolean(failGen.data?.recipe), failGen.data?.dataSource);

/* --- 模型不可用 → 明确失败 --- */
mock.search = 'ok';
const u3 = await makeUser('rf-noai');
await saveModel();
mock.chat = 'auth';
const noAi = await req('/api/recipe', { method: 'POST', body: { dishName: '花卷', servings: 2, difficulty: 'easy' } });
check('模型不可用 → 不返回菜谱（不伪造成功）', noAi.status === 200 && !noAi.data?.recipe, `recipe=${Boolean(noAi.data?.recipe)}`);
check('模型不可用 → 文案说明未返回可用菜谱', /模型没有返回可用菜谱|未完成/.test(noAi.data?.message || ''), String(noAi.data?.message || '').slice(0, 40));
mock.chat = 'ok';

/* --- 鉴权 --- */
const anon = await fetch(APP + '/api/recipe', {
  method: 'POST',
  headers: { 'content-type': 'application/json', Origin: APP },
  body: JSON.stringify({ dishName: '花卷' }),
});
// 游客现在也能调用生成接口，但是否成功取决于内置 AI：未开启时应返回 409 ai_disabled
const anonData = await anon.json().catch(() => ({}));
check('游客调用生成接口：内置 AI 未开启时被拒（409 ai_disabled）',
  anon.status === 409 && anonData.code === 'ai_disabled',
  `HTTP ${anon.status} code=${anonData.code}`);

/* ============================================================
 * C. 页面
 * ============================================================ */

const browser = await chromium.launch({
  executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe',
  headless: true,
});
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const pageErrors = [];
page.on('pageerror', (e) => pageErrors.push(e.message));

await page.goto(APP + '/recipe', { waitUntil: 'networkidle' });
await page.waitForTimeout(700);
await page.locator('.account-btn--ghost', { hasText: '登录' }).first().click();
await page.waitForTimeout(400);
await page.locator('.account-modal input[type="email"]').fill(u2.email);
await page.locator('.account-modal input[type="password"]').fill('Recipe1234!');
await page.locator('.account-modal button[type="submit"]').click();
await page.waitForTimeout(1200);

// 检索成功：应显示「AI 检索」
await page.locator('#dishName').fill('花卷');
await page.locator('.recipe-form button[type="submit"], form button[type="submit"]').first().click();
await page.waitForSelector('.recipe-card, .recipe-failure', { timeout: 60000 }).catch(() => {});
await page.waitForTimeout(500);
let ui = await page.evaluate(() => ({
  badge: document.querySelector('.recipe-source-badge')?.textContent?.trim() || '',
  sources: document.querySelectorAll('.source-item').length,
  banner: document.querySelector('.verify-banner b')?.textContent?.trim() || '',
  scrollW: document.documentElement.scrollWidth,
  clientW: document.documentElement.clientWidth,
}));
check('页面徽标为「AI 检索」', ui.badge === 'AI 检索', ui.badge);
check('页面渲染来源列表', ui.sources > 0, `sources=${ui.sources}`);
check('页面横幅为「AI 综合公开资料整理」', /综合公开资料/.test(ui.banner), ui.banner);
check('页面无横向溢出', ui.scrollW <= ui.clientW, `${ui.scrollW}/${ui.clientW}`);
await page.screenshot({ path: 'F:/AIweb/美食1.0/aimeishi2.0/shots/recipe-ai-search.png' });

// 无结果：应显示「模型知识」
mock.search = 'empty';
await page.locator('#dishName').fill('糖三角');
await page.locator('.recipe-form button[type="submit"], form button[type="submit"]').first().click();
await page.waitForSelector('.recipe-card, .recipe-failure', { timeout: 60000 }).catch(() => {});
await page.waitForTimeout(600);
ui = await page.evaluate(() => ({
  badge: document.querySelector('.recipe-source-badge')?.textContent?.trim() || '',
  banner: document.querySelector('.verify-banner b')?.textContent?.trim() || '',
}));
check('无结果时徽标为「模型知识」', ui.badge === '模型知识', ui.badge);
check('无结果时横幅标注未联网核实', /未联网核实/.test(ui.banner), ui.banner);
check('页面无脚本异常', pageErrors.length === 0, pageErrors.slice(0, 2).join(' | '));

await browser.close();
child.kill();
mockServer.close();
await new Promise((ok) => setTimeout(ok, 300));

if (results.some((x) => !x.pass)) {
  const tail = childLog.join('').split('\n').filter(Boolean).slice(-8).join('\n');
  if (tail) console.log('\n--- 应用日志（尾部）---\n' + tail);
}

const pass = results.filter((x) => x.pass).length;
console.log(`\nTOTAL ${pass}/${results.length}`);
process.exit(pass === results.length ? 0 : 1);
