/**
 * 分类页发现会话（前端）验证：
 *   1. 本地图鉴耗尽后，先读 /api/dishes 本地分页，不调用外部检索；
 *   2. 本地分页耗尽后才调用 /api/dishes/search；
 *   3. 外部检索失败时，已经加载的卡片不丢失，错误可被界面捕获；
 *   4. 本地接口失败时记录原因，不阻止后续外部检索。
 *
 * 用 stub fetch 代替浏览器网络；不访问真实服务，不需要登录。
 * 用法：node scripts/verify-dish-feed.mjs
 */
const originalFetch = globalThis.fetch;
const originalLocalStorage = globalThis.localStorage;
const results = [];

function check(name, ok, detail = '') {
  results.push({ name, ok: Boolean(ok) });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` | ${detail}` : ''}`);
  if (!ok) process.exitCode = 1;
}

function json(status, body) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

const LOCAL_ITEMS = [
  { id: 'local-test-1', name: '本地测试菜一', cuisine: 'chuan', image: '/test-1.jpg', tastes: ['mala'] },
  { id: 'local-test-2', name: '本地测试菜二', cuisine: 'chuan', image: '/test-2.jpg', tastes: ['mala'] },
];

function installFetch({ localMode = 'two-pages', searchMode = 'unavailable' } = {}) {
  let localCalls = 0;
  let searchCalls = 0;
  globalThis.fetch = async (input) => {
    const url = String(input);
    if (url.startsWith('/api/dishes?')) {
      localCalls += 1;
      if (localMode === 'error') return json(500, { error: '本地接口暂不可用' });
      if (localMode === 'two-pages') {
        if (localCalls === 1) return json(200, { items: LOCAL_ITEMS, total: 2, hasMore: true, nextOffset: 2 });
        return json(200, { items: [], total: 2, hasMore: false, nextOffset: 2 });
      }
      return json(200, { items: [], total: 0, hasMore: false });
    }
    if (url === '/api/dishes/search') {
      searchCalls += 1;
      if (searchMode === 'unavailable') return json(503, { error: '外部联网检索未配置，无法验证新菜品真实性。' });
      return json(200, { items: [], status: 'empty', note: '本次没有发现新的可靠菜品。' });
    }
    throw new Error(`unexpected fetch: ${url}`);
  };
  return {
    localCalls: () => localCalls,
    searchCalls: () => searchCalls,
  };
}

try {
  globalThis.localStorage = {
    getItem: () => null,
    setItem: () => {},
    removeItem: () => {},
  };
  const { getFeed, primeAtlas, discoverBatch, retryDiscovery, atlasRemaining } = await import('../src/data/dishFeed.js');

  // 1) 本地优先：图鉴耗尽后先读本地分页，外部检索一次都不应被调用
  const feed = getFeed('cuisine', 'chuan');
  primeAtlas(feed, 200);
  check('图鉴已全部展示', atlasRemaining(feed) === 0, `shown=${feed.items.length}`);
  const stats1 = installFetch();
  const batch1 = await discoverBatch(feed, 3);
  check('先返回本地分页结果', batch1.source === 'local' && batch1.items.length === 2, `source=${batch1.source}`);
  check('本地有数据时不调用外部检索', stats1.searchCalls() === 0, `searchCalls=${stats1.searchCalls()}`);
  check('本地结果已追加进当前会话', feed.items.some((d) => d.id === 'local-test-1'));

  // 2) 本地分页耗尽后才触发外部检索；外部失败不丢已加载卡片
  const before = feed.items.length;
  let thrown = '';
  try {
    await discoverBatch(feed, 3);
  } catch (err) {
    thrown = String(err?.message || err);
  }
  check('外部未配置时抛出明确原因', /未配置|无法验证|暂时无法/.test(thrown), thrown.slice(0, 60));
  check('外部失败不丢已加载的本地卡片', feed.items.length === before, `before=${before}, after=${feed.items.length}`);
  check('本地分页已标记耗尽', feed.localDone === true);

  // 3) 本地接口失败时，记录原因并继续尝试外部检索（不被本地失败短路）
  const feed2 = getFeed('cuisine', 'lu');
  primeAtlas(feed2, 200);
  const stats2 = installFetch({ localMode: 'error' });
  let thrown2 = '';
  try {
    await discoverBatch(feed2, 3);
  } catch (err) {
    thrown2 = String(err?.message || err);
  }
  check('本地接口失败会记录原因', /本地|暂不可用|请求失败/.test(feed2.localError), feed2.localError);
  check('本地失败后仍调到外部检索', stats2.searchCalls() === 1);
  check('本地失败不误报为「没有更多」', Boolean(thrown2), thrown2.slice(0, 60));

  // 4) 只有本地与外部都确认没有新菜，才进入「已到底」；失败不进入
  const feed3 = getFeed('cuisine', 'su');
  primeAtlas(feed3, 200);
  installFetch({ localMode: 'empty', searchMode: 'empty' });
  const empty1 = await discoverBatch(feed3, 3);
  check('外部空一轮不提前结束', feed3.localDone === true && feed3.done === false && empty1.items.length === 0);
  const empty2 = await discoverBatch(feed3, 3);
  check('本地和外部都耗尽才标记结束', feed3.done === true && empty2.items.length === 0);

  // 5) 重试会清空本地错误与结束标记，允许重新读取本地
  retryDiscovery(feed2);
  check('重试清空本地错误', feed2.localError === '' && feed2.done === false);
} finally {
  globalThis.fetch = originalFetch;
  globalThis.localStorage = originalLocalStorage;
  const failed = results.filter((r) => !r.ok).length;
  console.log(`\n结果：${results.length - failed}/${results.length} 通过`);
  if (!results.length) process.exitCode = 1;
}