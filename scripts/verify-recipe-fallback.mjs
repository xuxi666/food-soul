/**
 * 菜谱工作台：图鉴未收录 + 联网检索失败时的降级链路验收。
 *
 * 三段：
 *  A. 单元：web-search 的错误分类 / 重试 / 缓存（stub fetch，零真实配额消耗）
 *  B. 集成：起本地 mock（web_search + chat/completions），另起一份应用实例指向它，
 *     用真实 HTTP 跑通「图鉴命中 / 检索 429 降级 / 检索成功 / 无结果 / 模型不可用」
 *  C. 页面：前端确实渲染「模型知识」徽标与未核实提示
 *
 * 前置：先 `npm run build`（应用实例直接托管 dist）
 * 用法：node scripts/verify-recipe-fallback.mjs
 */
import fs from 'node:fs';
import http from 'node:http';
import { spawn } from 'node:child_process';
import { chromium } from 'playwright-core';

const results = [];
const check = (name, pass, extra = '') => {
  results.push({ name, pass });
  console.log(`${pass ? 'PASS' : 'FAIL'} | ${name}${extra ? ' | ' + extra : ''}`);
};

/* ============================================================
 * A. 单元测试：错误分类与重试（stub fetch）
 * ============================================================ */

process.env.SEARCH_API_KEY = process.env.SEARCH_API_KEY || 'unit-test-key';
process.env.SEARCH_BASE_URL = 'https://search.test/v4';
const { webSearch } = await import('../server/web-search.mjs');

const realFetch = globalThis.fetch;
let calls = 0;

function stubFetch(handler) {
  calls = 0;
  globalThis.fetch = async (url, init) => {
    calls += 1;
    return handler(url, init, calls);
  };
}
function jsonRes(status, obj) {
  return new Response(JSON.stringify(obj), { status, headers: { 'content-type': 'application/json' } });
}

stubFetch(() => jsonRes(429, { error: { code: '1113', message: '余额不足或无可用资源包,请充值。' } }));
let r = await webSearch('馒头 做法 食材');
check('429 余额不足 → errorKind=quota', r.errorKind === 'quota', r.errorKind);
check('quota 不重试（只请求 1 次）', calls === 1, `calls=${calls}`);
check('quota 提示可操作（提到充值/更换）', /充值|更换/.test(r.message), r.message.slice(0, 50));

stubFetch(() => jsonRes(429, { error: { code: '1000', message: '令牌不匹配或检索配额已用完，请稍后重试' } }));
r = await webSearch('花卷 做法');
check('429 令牌不匹配 → errorKind=auth', r.errorKind === 'auth', r.errorKind);
check('auth 不重试', calls === 1, `calls=${calls}`);

stubFetch(() => jsonRes(429, { error: { code: '1302', message: '请求过于频繁，请稍后再试' } }));
r = await webSearch('包子 做法');
check('429 频率限制 → errorKind=rate_limit', r.errorKind === 'rate_limit', r.errorKind);
check('rate_limit 有限重试（2 次）', calls === 2, `calls=${calls}`);

stubFetch(() => jsonRes(401, { error: { code: '1001', message: '身份验证失败' } }));
r = await webSearch('油条 做法');
check('401 → errorKind=auth', r.errorKind === 'auth', r.errorKind);

stubFetch(() => jsonRes(404, { error: { message: 'not found' } }));
r = await webSearch('豆浆 做法');
check('404 → errorKind=not_found', r.errorKind === 'not_found', r.errorKind);

stubFetch(() => jsonRes(500, { error: { message: 'internal' } }));
r = await webSearch('锅贴 做法');
check('500 → errorKind=server 且重试 1 次', r.errorKind === 'server' && calls === 2, `${r.errorKind}/${calls}`);

stubFetch(
  (url, init) =>
    new Promise((_, reject) => {
      init.signal.addEventListener('abort', () => {
        const err = new Error('aborted');
        err.name = 'AbortError';
        reject(err);
      });
    })
);
r = await webSearch('烧麦 做法', { timeout: 3000 });
check('超时 → status=timeout', r.status === 'timeout' && r.errorKind === 'timeout', `${r.status}/${r.errorKind}`);

stubFetch(() =>
  jsonRes(200, {
    search_result: [
      { title: '馒头家常做法', link: 'https://example.com/a', content: '面粉 酵母 发酵 蒸', media: '示例' },
      { title: '重复链接', link: 'https://example.com/a', content: 'x' },
      { title: '花卷做法', link: 'https://example.com/b', content: 'y' },
    ],
  })
);
r = await webSearch('馒头 家常做法');
check('200 → status=ok 且按 URL 去重', r.status === 'ok' && r.sources.length === 2, `${r.status}/${r.sources.length}`);

stubFetch(() => jsonRes(200, { search_result: [] }));
r = await webSearch('不存在的菜名xyz');
check('200 空结果 → empty（区别于失败）', r.status === 'empty' && !r.errorKind, `${r.status}/${r.errorKind}`);

const SECRETISH = 'sk-should-never-leak-1234567890';
stubFetch(() => new Response(`Bad Gateway ${SECRETISH}`, { status: 502, headers: { 'content-type': 'text/html' } }));
r = await webSearch('汤圆 做法');
check('非 JSON 错误体不回传原文（无密钥泄漏）', !r.message.includes(SECRETISH) && !r.message.includes('Bad Gateway'), r.message.slice(0, 50));

stubFetch(() => jsonRes(200, { search_result: [{ title: 't', link: 'https://example.com/c', content: 'z' }] }));
await webSearch('缓存测试菜');
const before = calls;
const cached = await webSearch('缓存测试菜');
check('同 query 命中缓存，不重复请求', calls === before && cached.cached === true, `calls=${calls}`);

stubFetch(() => jsonRes(429, { error: { code: '1113', message: '余额不足或无可用资源包,请充值。' } }));
await webSearch('配额缓存测试');
const before2 = calls;
await webSearch('配额缓存测试');
check('quota 失败短缓存生效（不重复请求）', calls === before2, `calls=${calls}`);

globalThis.fetch = realFetch;

/* ============================================================
 * B. 集成：本地 mock + 独立应用实例
 * ============================================================ */

const RECIPE = {
  dish_name: '馒头',
  servings: 2,
  prep_time_minutes: 90,
  cook_time_minutes: 25,
  difficulty: 'easy',
  ingredients: [
    { name: '中筋面粉', amount: 500, unit: 'g', optional: false },
    { name: '温水', amount: 260, unit: 'ml', optional: false },
    { name: '干酵母', amount: 5, unit: 'g', optional: false },
  ],
  seasonings: [{ name: '白糖', amount: 10, unit: 'g', optional: true }],
  steps: [
    { step: 1, title: '和面', description: '酵母用温水化开，倒入面粉揉成光滑面团。', duration_minutes: 10, heat_level: 'low', tips: '水温不超过 35℃' },
    { step: 2, title: '一发', description: '盖湿布发酵至两倍大。', duration_minutes: 60, heat_level: 'low', tips: '室温低时延长' },
    { step: 3, title: '排气整形', description: '揉匀排气，分割滚圆。', duration_minutes: 10, heat_level: 'low', tips: '' },
    { step: 4, title: '二发', description: '二次发酵 15 分钟。', duration_minutes: 15, heat_level: 'low', tips: '' },
    { step: 5, title: '蒸制', description: '水开后大火蒸 15 分钟，关火焖 3 分钟。', duration_minutes: 18, heat_level: 'high', tips: '不要立刻开盖' },
  ],
  taste_profile: ['原味', '麦香'],
  substitutions: ['没有中筋粉可用高筋粉加玉米淀粉替代'],
  common_mistakes: ['各地做法不同，北方多为戗面馒头，南方偏松软'],
  safety_notes: ['蒸制时注意蒸汽烫伤'],
};

const mock = { search: 'quota', chat: 'ok' };

const mockServer = http.createServer((req, res) => {
  let body = '';
  req.on('data', (c) => (body += c));
  req.on('end', () => {
    const url = req.url || '';
    if (url.includes('/web_search')) {
      if (mock.search === 'quota') {
        res.writeHead(429, { 'content-type': 'application/json' });
        return res.end(JSON.stringify({ error: { code: '1113', message: '余额不足或无可用资源包,请充值。' } }));
      }
      if (mock.search === 'empty') {
        res.writeHead(200, { 'content-type': 'application/json' });
        return res.end(JSON.stringify({ search_result: [] }));
      }
      // 回显检索词里的菜名，保证命中 lookupDish 的相关性判断
      let q = '';
      try {
        q = String(JSON.parse(body || '{}').search_query || '馒头');
      } catch {
        q = '馒头';
      }
      const dish = q.split(/\s+/)[0] || '馒头';
      res.writeHead(200, { 'content-type': 'application/json' });
      return res.end(
        JSON.stringify({
          search_intent: `${dish}做法`,
          search_result: [
            { title: `${dish}（中国传统面食）做法`, link: 'https://example.com/a1', content: `${dish} 做法 面粉 酵母 发酵 蒸制`, media: '示例站点' },
            { title: `${dish}家常做法详解`, link: 'https://example.com/a2', content: `${dish} 做法 戗面 二发 蒸`, media: '示例站点2' },
          ],
        })
      );
    }
    if (url.includes('/chat/completions')) {
      const auth = String(req.headers.authorization || '');
      if (mock.chat === 'auth' || auth.includes('bad-key')) {
        res.writeHead(401, { 'content-type': 'application/json' });
        return res.end(JSON.stringify({ error: { message: 'invalid api key' } }));
      }
      // 菜谱调用现在走 stream:true，mock 需要按 SSE 返回，否则解析不到内容
      let wantStream = false;
      try {
        wantStream = Boolean(JSON.parse(body || '{}').stream);
      } catch {
        wantStream = false;
      }
      const content = JSON.stringify(RECIPE);
      if (wantStream) {
        res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache' });
        // 分块推送，模拟真实流
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
    SEARCH_BASE_URL: `http://127.0.0.1:${MOCK_PORT}/v4`,
    SEARCH_API_KEY: 'mock-search-key',
  },
  stdio: ['ignore', 'pipe', 'pipe'],
});
const childLog = [];
child.stdout.on('data', (d) => childLog.push(String(d)));
child.stderr.on('data', (d) => childLog.push(String(d)));

const APP = `http://127.0.0.1:${APP_PORT}`;
for (let i = 0; i < 40; i += 1) {
  try {
    const h = await fetch(APP + '/api/health');
    if (h.ok) break;
  } catch {
    /* retry */
  }
  await new Promise((ok) => setTimeout(ok, 250));
}

let cookie = '';
async function req(path, { method = 'GET', body } = {}) {
  const res = await fetch(APP + path, {
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

async function saveModel(apiKey) {
  const baseUrl = `http://127.0.0.1:${MOCK_PORT}/v1`;
  const t = await req('/api/ai/test', { method: 'POST', body: { provider: 'custom', baseUrl, model: 'mock-model', apiKey } });
  const s = await req('/api/ai/config', {
    method: 'POST',
    body: { provider: 'custom', baseUrl, model: 'mock-model', apiKey, verifyToken: t.data?.verifyToken },
  });
  return { test: t.status, save: s.status, error: s.data?.error };
}

/* --- B1 图鉴命中 --- */
const u1 = await makeUser('recipe-lib');
check('注册账号（图鉴路径）', u1.ok);
await saveModel('mock-ok-key');
const libLookup = await req('/api/recipe/lookup', { method: 'POST', body: { dishName: '麻婆豆腐' } });
check('图鉴命中 → dataSource=library', libLookup.data?.dataSource === 'library', libLookup.data?.dataSource);
const libGen = await req('/api/recipe', { method: 'POST', body: { dishName: '麻婆豆腐', servings: 2, difficulty: 'easy' } });
check('图鉴菜品生成成功（不触发检索）', libGen.data?.dataSource === 'library' && Boolean(libGen.data?.recipe), `${libGen.data?.dataSource}/${Boolean(libGen.data?.recipe)}`);

/* --- B2 图鉴未命中 + 检索 429 配额不足 → 降级生成 --- */
const u2 = await makeUser('recipe-fallback');
check('注册账号（降级路径）', u2.ok);
await saveModel('mock-ok-key');

const unkLookup = await req('/api/recipe/lookup', { method: 'POST', body: { dishName: '馒头' } });
check('图鉴未命中：返回结构化失败而非 500', unkLookup.status === 200 && unkLookup.data?.status !== 'ok', `HTTP ${unkLookup.status} status=${unkLookup.data?.status}`);
check('失败携带 errorKind=quota', unkLookup.data?.errorKind === 'quota', `kind=${unkLookup.data?.errorKind}`);
check('错误信息不含原始 JSON 花括号', !/[{}]/.test(String(unkLookup.data?.message || '')), String(unkLookup.data?.message || '').slice(0, 50));

const gen = await req('/api/recipe', { method: 'POST', body: { dishName: '馒头', servings: 2, difficulty: 'easy' } });
check('检索 429 仍生成菜谱（不再整条中断）', gen.status === 200 && Boolean(gen.data?.recipe), `HTTP ${gen.status}`);
check('降级标记 dataSource=ai-knowledge', gen.data?.dataSource === 'ai-knowledge', gen.data?.dataSource);
check('降级标记 verification=model-knowledge', gen.data?.verification?.level === 'model-knowledge', gen.data?.verification?.level);
check('横幅文案含「未联网核实」', /未联网核实/.test(gen.data?.verification?.label || ''), gen.data?.verification?.label);
check('返回真实检索失败原因（quota）', gen.data?.search?.errorKind === 'quota', gen.data?.search?.errorKind);
check('降级结果不伪造来源', Array.isArray(gen.data?.sources) && gen.data.sources.length === 0, `sources=${gen.data?.sources?.length}`);
check('菜谱结构通过校验', (gen.data?.recipe?.steps?.length || 0) >= 4 && (gen.data?.recipe?.ingredients?.length || 0) >= 3,
  `steps=${gen.data?.recipe?.steps?.length} ing=${gen.data?.recipe?.ingredients?.length}`);
check('响应体不含模型 Key', !gen.text.includes('mock-ok-key'), 'checked');

/* --- B3 检索成功 → 走 ai-search --- */
mock.search = 'ok';
const okLookup = await req('/api/recipe/lookup', { method: 'POST', body: { dishName: '花卷' } });
check('检索成功 → lookup status=ok', okLookup.data?.status === 'ok', `status=${okLookup.data?.status}`);
const okGen = await req('/api/recipe', { method: 'POST', body: { dishName: '花卷', servings: 2, difficulty: 'easy', lookupId: okLookup.data?.lookupId } });
check('检索成功 → dataSource=ai-search', okGen.data?.dataSource === 'ai-search', okGen.data?.dataSource);
check('检索成功 → 带可追溯来源', (okGen.data?.sources?.length || 0) > 0, `sources=${okGen.data?.sources?.length}`);
check('检索成功 → 不标记为模型知识', okGen.data?.verification?.level !== 'model-knowledge', okGen.data?.verification?.level);

/* --- B4 检索无结果 → 仍降级（不是报错） --- */
mock.search = 'empty';
const emptyLookup = await req('/api/recipe/lookup', { method: 'POST', body: { dishName: '糖三角' } });
check('无搜索结果 → status=insufficient（区别于服务异常）', emptyLookup.data?.status === 'insufficient', emptyLookup.data?.status);
check('无搜索结果不带 errorKind', !emptyLookup.data?.errorKind, String(emptyLookup.data?.errorKind || ''));
const emptyGen = await req('/api/recipe', { method: 'POST', body: { dishName: '糖三角', servings: 2, difficulty: 'easy' } });
check('无搜索结果仍能生成（降级）', emptyGen.data?.dataSource === 'ai-knowledge' && Boolean(emptyGen.data?.recipe), emptyGen.data?.dataSource);

/* --- B5 模型不可用 → 明确失败，不伪造成功 --- */
mock.search = 'quota';
const u3 = await makeUser('recipe-noai');
mock.chat = 'auth';
const badSave = await saveModel('bad-key');
check('坏 Key 无法通过连接测试', badSave.test !== 200 || badSave.save !== 200, `test=${badSave.test} save=${badSave.save}`);

mock.chat = 'ok';
await saveModel('mock-ok-key');
mock.chat = 'auth'; // 保存后让模型鉴权失效，模拟服务商侧异常
const noAi = await req('/api/recipe', { method: 'POST', body: { dishName: '馒头', servings: 2, difficulty: 'easy' } });
check('模型不可用 → 不返回菜谱（不伪造成功）', noAi.status === 200 && !noAi.data?.recipe, `recipe=${Boolean(noAi.data?.recipe)}`);
check('模型不可用 → 文案说明检索未完成且模型不可用', /联网检索未完成/.test(noAi.data?.message || ''), String(noAi.data?.message || '').slice(0, 50));
check('模型不可用 → 仍保留真实检索原因', noAi.data?.search?.errorKind === 'quota', noAi.data?.search?.errorKind);
mock.chat = 'ok';

/* --- B6 未登录不可调用 --- */
const anon = await fetch(APP + '/api/recipe', {
  method: 'POST',
  headers: { 'content-type': 'application/json', Origin: APP },
  body: JSON.stringify({ dishName: '馒头' }),
});
check('未登录调用生成接口 → 401', anon.status === 401, `HTTP ${anon.status}`);

/* ============================================================
 * C. 页面测试（同一实例：检索 quota，模型正常）
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

await page.locator('#dishName').fill('馒头');
// 状态条是瞬时的（mock 很快），用 observer 记录出现过的文案
await page.evaluate(() => {
  window.__statusTexts = [];
  const obs = new MutationObserver(() => {
    document.querySelectorAll('.lookup-status').forEach((n) => {
      const t = n.textContent.trim();
      if (t && !window.__statusTexts.includes(t)) window.__statusTexts.push(t);
    });
  });
  obs.observe(document.body, { childList: true, subtree: true });
});
await page.locator('.recipe-form button[type="submit"], form button[type="submit"]').first().click();
await page.waitForTimeout(900);
const statusTexts = await page.evaluate(() => window.__statusTexts || []);
check('生成过程中显示降级状态条', statusTexts.some((t) => /模型已有知识/.test(t)), statusTexts.slice(0, 2).join(' / '));

await page.waitForSelector('.recipe-card, .recipe-failure', { timeout: 60000 }).catch(() => {});
await page.waitForTimeout(500);
const ui = await page.evaluate(() => ({
  badge: document.querySelector('.recipe-source-badge')?.textContent?.trim() || '',
  banner: document.querySelector('.verify-banner b')?.textContent?.trim() || '',
  bannerNote: document.querySelector('.verify-banner p')?.textContent?.trim() || '',
  hasCard: Boolean(document.querySelector('.recipe-card')),
  failure: document.querySelector('.recipe-failure__title')?.textContent?.trim() || '',
  scrollW: document.documentElement.scrollWidth,
  clientW: document.documentElement.clientWidth,
  input: document.querySelector('#dishName')?.value || '',
}));
check('页面渲染菜谱卡片', ui.hasCard, ui.failure || '');
check('徽标显示「模型知识」', ui.badge === '模型知识', ui.badge);
check('页面横幅标明未联网核实', /未联网核实/.test(ui.banner), ui.banner);
check('横幅说明含差异/核对提示', /差异|核对/.test(ui.bannerNote), ui.bannerNote.slice(0, 40));
check('横幅不暴露 HTTP 码与服务商原文', !/HTTP\s*\d|\d{4}：|余额不足或无可用资源包/.test(ui.bannerNote), ui.bannerNote.slice(0, 60));
check('横幅不暴露 HTTP 码与服务商原文', !/HTTP\s*\d|\d{4}：|余额不足或无可用资源包/.test(ui.bannerNote), ui.bannerNote.slice(0, 60));
check('降级后保留用户输入', ui.input === '馒头', ui.input);
check('页面无横向溢出', ui.scrollW <= ui.clientW, `${ui.scrollW}/${ui.clientW}`);
check('页面无脚本异常', pageErrors.length === 0, pageErrors.slice(0, 2).join(' | '));

await page.screenshot({ path: 'F:/AIweb/美食1.0/aimeishi2.0/shots/recipe-fallback.png' });
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
