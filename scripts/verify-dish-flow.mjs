/**
 * 图鉴「加载更多」数据流验证。
 *
 * 覆盖：
 *   1. 八个菜系的本地图鉴 + 本地缓存分页、去重、排除；
 *   2. 外部检索未配置时，本地分页仍然可用，searchDishes 明确返回 search_not_configured；
 *   3. 外部检索配置正常时，用本地 mock 模型 + mock 360 结果跑通：
 *      候选 → 两条不同来源验证 → 落盘 → 下一轮去重；
 *   4. 外部检索失败时返回失败，不伪造菜品；
 *   5. 菜系不匹配的候选不会进入结果。
 *
 * 这个脚本不会访问真实外部服务，也不会保留生成的测试菜品：
 * 运行前备份 data/generated-dishes.json，结束后原样恢复。
 *
 * 用法：
 *   node scripts/verify-dish-flow.mjs
 */
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..');
const GEN_FILE = path.join(ROOT, 'data', 'generated-dishes.json');
const backup = fs.existsSync(GEN_FILE) ? fs.readFileSync(GEN_FILE) : null;
const originalFetch = globalThis.fetch;
const results = [];

function check(name, ok, detail = '') {
  results.push({ name, ok: Boolean(ok), detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` | ${detail}` : ''}`);
  if (!ok) process.exitCode = 1;
}

function setSearchEnv({ searxng = ' ', so360 = ' ', bing = ' ' } = {}) {
  process.env.SEARXNG_URL = searxng;
  process.env.SO360_URL = so360;
  process.env.BING_RSS_URL = bing;
}

function mockFetch(mode) {
  return async (input, init) => {
    const url = String(input);
    if (url.includes('mock-ai.local')) {
      const names =
        mode === 'wrong-cuisine'
          ? ['测试粤菜']
          : mode === 'second'
            ? ['验证失败菜']
            : ['测试新菜'];
      const dishes = names.map((name) => ({
        name,
        cuisine: mode === 'wrong-cuisine' ? 'yue' : 'chuan',
        ingredients: ['豆腐', '牛肉'],
        intro: '测试用候选菜品。',
      }));
      return new Response(
        JSON.stringify({
          choices: [{ message: { content: JSON.stringify({ dishes }) } }],
        }),
        { status: 200, headers: { 'content-type': 'application/json' } }
      );
    }
    if (url.includes('mock.local/fail')) {
      return new Response('mock search unavailable', { status: 503, headers: { 'content-type': 'text/plain' } });
    }
    if (url.includes('mock.local/s')) {
      const name = decodeURIComponent(url.split('q=')[1] || '').split('&')[0] || '测试新菜';
      const html = `<html><body>
        <li class="res-list"><h3><a href="https://a.example.com/dish" data-mdurl="https://a.example.com/dish">${name} 做法</a></h3><div class="res-desc">${name} 的家常做法与食材。</div></li>
        <li class="res-list"><h3><a href="https://b.example.com/dish" data-mdurl="https://b.example.com/dish">${name} 菜谱</a></h3><div class="res-desc">${name} 的另一种做法。</div></li>
      </body></html>`;
      return new Response(html, { status: 200, headers: { 'content-type': 'text/html' } });
    }
    if (/image\.so\.com|image\.baidu\.com|cn\.bing\.com\/images/.test(url)) {
      // 图片检索返回空集：测试不依赖图片下载，也不伪造图片。
      return new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } });
    }
    return originalFetch(input, init);
  };
}

function restoreGenerated() {
  if (backup === null) {
    try {
      fs.unlinkSync(GEN_FILE);
    } catch {
      /* noop */
    }
  } else {
    fs.writeFileSync(GEN_FILE, backup);
  }
}

try {
  // 先验证三来源全部关闭：本地分页仍应可用，外部检索明确报 not_configured。
  setSearchEnv();
  const { getSearchConfig, isSearchConfigured, searchConfigNeeded } = await import('../server/config.mjs');
  const { localDishesPage, searchDishes } = await import('../server/dish-search.mjs');

  check('三来源关闭时 isSearchConfigured=false', isSearchConfigured() === false);
  check(
    '未配置时给出真实环境变量名',
    JSON.stringify(searchConfigNeeded()) === JSON.stringify(['SEARXNG_URL', 'SO360_URL', 'BING_RSS_URL']),
    JSON.stringify(getSearchConfig())
  );

  const cuisineIds = ['chuan', 'yue', 'lu', 'su', 'zhe', 'min', 'xiang', 'hui'];
  for (const id of cuisineIds) {
    const page1 = localDishesPage({ kind: 'cuisine', id, limit: 4 });
    const page2 = localDishesPage({ kind: 'cuisine', id, limit: 4, offset: 4 });
    const names = page1.items.map((d) => d.name);
    const ids = page1.items.map((d) => d.id);
    const overlap = page1.items.filter((d) => page2.items.some((x) => x.id === d.id));
    const categoryOk = page1.items.every((d) => d.cuisine === id);
    const dedupeOk = new Set(names).size === names.length && new Set(ids).size === ids.length;
    check(
      `本地分页 ${id}`,
      page1.total > 0 && page1.items.length > 0 && categoryOk && dedupeOk && overlap.length === 0,
      `total=${page1.total}, p1=${page1.items.length}, p2=${page2.items.length}, hasMore=${page1.hasMore}`
    );
  }

  const tastePage = localDishesPage({ kind: 'taste', id: 'mala', limit: 5 });
  check(
    '味型本地分页只返回该味型',
    tastePage.items.length > 0 && tastePage.items.every((d) => Array.isArray(d.tastes) && d.tastes.includes('mala')),
    `total=${tastePage.total}`
  );

  const imagePage = localDishesPage({ kind: 'cuisine', id: 'chuan', limit: 4 });
  const shownImage = imagePage.items.find((d) => d.image)?.image || '';
  const imageExcluded = localDishesPage({ kind: 'cuisine', id: 'chuan', limit: 4, excludeIds: [shownImage] });
  check(
    '本地分页也按图片 URL 排除已展示项',
    Boolean(shownImage) && !imageExcluded.items.some((d) => d.image === shownImage),
    `image=${shownImage}`
  );

  const gate = await searchDishes({
    kind: 'cuisine',
    id: 'chuan',
    modelConfig: { baseUrl: 'http://mock-ai.local/v1', apiKey: 'test', model: 'mock' },
  });
  check(
    '未配置外部检索时 searchDishes 明确失败且不伪造',
    gate.status === 'failed' && gate.reason === 'search_not_configured' && gate.items.length === 0,
    gate.note
  );

  const stillLocal = localDishesPage({ kind: 'cuisine', id: 'chuan', limit: 4 });
  check('外部未配置不影响本地分页', stillLocal.total > 0 && stillLocal.items.length === 4);

  // 配置 mock 360，外部链路可以跑通；模型和图片也全部本地 mock。
  setSearchEnv({ so360: 'http://mock.local/s' });
  globalThis.fetch = mockFetch('first');
  const cfg2 = getSearchConfig();
  check('外部来源配置后 isSearchConfigured=true', isSearchConfigured() === true, JSON.stringify(cfg2));

  const modelConfig = { baseUrl: 'http://mock-ai.local/v1', apiKey: 'test', model: 'mock' };
  const found = await searchDishes({ kind: 'cuisine', id: 'chuan', limit: 1, modelConfig });
  const item = found.items?.[0];
  check(
    '外部检索配置正常时可落盘新菜品',
    found.status === 'ok' && Boolean(item) && item.cuisine === 'chuan',
    `status=${found.status}, reason=${found.reason}, items=${found.items?.length || 0}`
  );
  check(
    '新菜品带可追溯来源而非伪造',
    Boolean(item?.source?.verificationSources?.length >= 2) && item?.source?.type === 'ai-search',
    item ? `sources=${item.source?.verificationSources?.length || 0}` : ''
  );
  check(
    '没有可靠配图时保留菜品且不塞随机图',
    item && !item.image && item.imageNote,
    item ? `image=${item.image || '(empty)'}, note=${item.imageNote || ''}` : ''
  );

  const localAfter = localDishesPage({ kind: 'cuisine', id: 'chuan', limit: 4, excludeIds: [item?.id, item?.name] });
  check(
    '本地缓存排除已展示项',
    Boolean(item) && !localAfter.items.some((d) => d.id === item.id || d.name === item.name),
    `total=${localAfter.total}`
  );

  // 同一候选再次检索应被去重，不产生重复菜品。
  globalThis.fetch = mockFetch('first');
  const duplicate = await searchDishes({
    kind: 'cuisine',
    id: 'chuan',
    limit: 1,
    excludeIds: [item?.id, item?.name].filter(Boolean),
    modelConfig,
  });
  check('重复候选不会重复落盘', duplicate.items.length === 0, `status=${duplicate.status}, reason=${duplicate.reason}`);

  // 外部来源失败：返回 failed，不拿模型知识冒充检索结果。
  setSearchEnv({ so360: 'http://mock.local/fail' });
  globalThis.fetch = mockFetch('second');
  const failed = await searchDishes({ kind: 'cuisine', id: 'chuan', limit: 1, modelConfig });
  check(
    '外部来源失败时明确失败且无伪造数据',
    failed.status === 'failed' && failed.items.length === 0,
    `status=${failed.status}, reason=${failed.reason}, note=${(failed.note || '').slice(0, 40)}`
  );

  // 菜系不匹配的候选即使通过来源验证，也不能进入菜系页。
  setSearchEnv({ so360: 'http://mock.local/s' });
  globalThis.fetch = mockFetch('wrong-cuisine');
  const mismatch = await searchDishes({ kind: 'cuisine', id: 'chuan', limit: 1, modelConfig });
  check(
    '菜系不匹配的候选被过滤',
    mismatch.items.length === 0,
    `status=${mismatch.status}, reason=${mismatch.reason}, skipped=${mismatch.skipped?.length || 0}`
  );
} finally {
  globalThis.fetch = originalFetch;
  restoreGenerated();
  const failedCount = results.filter((r) => !r.ok).length;
  console.log(`\n结果：${results.length - failedCount}/${results.length} 通过`);
  if (!results.length) process.exitCode = 1;
}