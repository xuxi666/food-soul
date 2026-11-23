/**
 * 菜系页右页的数据层：图鉴分页 + 图鉴外发现
 * ------------------------------------------------------------
 * 三段式，和页面上的「加载更多」一一对应：
 *   1. 图鉴批次：随包发布的菜品清单（src/data/dishes.js），按分类过滤后切片；
 *   2. 服务端本地缓存：GET /api/dishes?kind=&id=&offset=&limit=&excludeIds=
 *      读取已持久化的「AI 补全」菜品，分页/按已展示项去重，不访问外部检索；
 *   3. 外部发现：POST /api/dishes/search，服务端 searchDishes() 用真实检索验证候选，
 *      再检索真实图片并哈希去重，落盘 public/dishes/generated。
 *      只有前两层都耗尽才调用；密钥只在服务端（server/config.mjs），前端拿不到。
 *
 * 每个分类（`cuisine:chuan` / `taste:mala`）一份独立状态并缓存：
 * 切走再切回来恢复已加载的卡片（与 src/lib/catalog.js 的缓存策略一致），
 * 但页面切换菜系时滚动位置一律回到顶部。
 *
 * 去重三重：真实 id（图鉴 id / 服务端生成的 ai-xxxx）、规范化菜名、图片 URL。
 */

import { DISHES, inTaste } from './dishes.js';
import { api } from '../lib/api.js';

export const ATLAS_BATCH = 4; // 图鉴每批 4 道（两列两行）
export const DISCOVER_BATCH = 3; // 图鉴外每批 3 道，和服务端单轮预算匹配
const LOCAL_PAGE = 20; // 服务端本地缓存每页条数（不触发外部检索）
const DRY_ROUNDS_DONE = 2; // 连续两轮没有新菜就停止自动检索，避免空耗额度

const feeds = new Map();

const feedKey = (kind, id) => `${kind}:${id || 'all'}`;

/** 规范化菜名：去空格与常见标点/括注，用于「同名不同 id」的去重 */
export function normalizeName(name) {
  return String(name || '')
    .replace(/[（(][^）)]*[）)]/g, '')
    .replace(/[\s·・、,，.。「」【】《》""'']/g, '')
    .slice(0, 12);
}

/** 该分类下的图鉴菜品：必须有图，按名字与图片去重（同一道菜的重复条目只留一条）；口味按主味型唯一归属 */
export function listCategoryDishes(kind, id) {
  if (!id) return [];
  const list = DISHES.filter((d) => (kind === 'taste' ? inTaste(d, id) : d.cuisine === id));
  const seenName = new Set();
  const seenImage = new Set();
  return list.filter((d) => {
    if (!d.image || seenName.has(d.name) || seenImage.has(d.image)) return false;
    seenName.add(d.name);
    seenImage.add(d.image);
    return true;
  });
}

function track(feed, d, source = 'atlas') {
  if (!d) return;
  if (d.id) {
    feed.usedIds.add(d.id);
    feed.sourceById.set(d.id, source);
  }
  const n = normalizeName(d.name);
  if (n) feed.usedNames.add(n);
  if (d.image) feed.usedImages.add(d.image);
}

function isFresh(feed, d) {
  // 图鉴外发现的菜可能暂时拿不到可靠图片（服务端会给占位标记），
  // 不能因为缺图就把整道菜丢掉
  if (!d || !d.id || !d.name) return false;
  if (feed.usedIds.has(d.id)) return false;
  if (feed.usedNames.has(normalizeName(d.name))) return false;
  if (d.image && feed.usedImages.has(d.image)) return false;
  return true;
}

/** 取（或建）分类的发现会话 */
export function getFeed(kind, id) {
  const key = feedKey(kind, id);
  let feed = feeds.get(key);
  if (feed) return feed;
  const pool = listCategoryDishes(kind, id);
  feed = {
    key,
    kind,
    id,
    pool,
    items: [], // 已展示（图鉴 + 新发现，按展示顺序）
    backlog: [], // 服务端已持久化、还没展示的发现结果
    usedIds: new Set(),
    sourceById: new Map(), // id → 'atlas' | 'discovered'
    usedNames: new Set(),
    usedImages: new Set(),
    hydrated: false,
    hydrating: false,
    localDone: false,
    localError: '',
    atlasDone: false,
    dryRounds: 0,
    done: false,
    lastNotice: '',
    lastReason: '',
    lastStats: null,
  };
  feeds.set(key, feed);
  return feed;
}

/** 首屏：取图鉴前 N 道（页面打开时同步用，不发请求） */
export function primeAtlas(feed, limit) {
  const items = [];
  for (const d of feed.pool) {
    if (items.length >= limit) break;
    if (!isFresh(feed, d)) continue;
    items.push(d);
  }
  items.forEach((d) => track(feed, d, 'atlas'));
  feed.items = [...feed.items, ...items];
  feed.atlasDone = !feed.pool.some((d) => isFresh(feed, d));
  return items;
}

/** 图鉴里还没展示的条数 */
export function atlasRemaining(feed) {
  return feed.pool.filter((d) => isFresh(feed, d)).length;
}

/** 取下一批图鉴菜品（不足则返回剩余的） */
export function takeAtlasBatch(feed, limit = ATLAS_BATCH) {
  const items = [];
  for (const d of feed.pool) {
    if (items.length >= limit) break;
    if (!isFresh(feed, d)) continue;
    items.push(d);
  }
  items.forEach((d) => track(feed, d, 'atlas'));
  feed.items = [...feed.items, ...items];
  feed.atlasDone = !feed.pool.some((d) => isFresh(feed, d));
  return items;
}

/**
 * 从服务端本地缓存取一页「尚未展示」的发现结果。
 * 这只是分页读取打包图鉴与 data/generated-dishes.json，不调用任何外部检索。
 */
async function fetchLocalPage(feed) {
  const excludeIds = [
    ...feed.usedIds,
    ...feed.usedNames,
    ...feed.usedImages,
    ...feed.backlog.flatMap((d) => [d.id, normalizeName(d.name), d.image]),
  ].filter(Boolean);
  const res = await api.dishes({
    kind: feed.kind,
    id: feed.id,
    offset: 0,
    limit: LOCAL_PAGE,
    excludeIds,
  });
  const list = Array.isArray(res?.items) ? res.items : [];
  let fresh = 0;
  for (const d of list) {
    if (!isFresh(feed, d)) continue;
    if (feed.backlog.some((x) => x.id && x.id === d.id)) continue;
    feed.backlog.push(d);
    fresh += 1;
  }
  // 服务端已经明确没有下一页，或本页全是重复项（避免同一页反复请求）时结束本地阶段。
  feed.localDone = res?.hasMore === false || list.length === 0 || fresh === 0;
  feed.localError = '';
  return fresh;
}

/** 读服务端已经落盘的发现结果（免费，不触发检索） */
export async function hydrateFeed(feed) {
  if (feed.hydrated || feed.hydrating) return feed;
  feed.hydrating = true;
  try {
    await fetchLocalPage(feed);
  } catch (err) {
    // 本地接口失败不应该阻止后续外部检索；记录原因，用户重试时可再次尝试本地。
    feed.localError = String(err?.message || err || '本地菜品读取失败').slice(0, 120);
  } finally {
    feed.hydrated = true;
    feed.hydrating = false;
  }
  return feed;
}

/**
 * 取下一批图鉴外菜品。
 * 严格按「本地图鉴 → 服务端本地缓存 → 外部联网检索」顺序，前一层有数据时
 * 绝不请求下一层；外部未配置/失败也不会把已加载的本地卡片一起打回。
 * @returns {Promise<{items:Array, source:'local'|'search'|'none', status:string, note:string}>}
 */
export async function discoverBatch(feed, limit = DISCOVER_BATCH) {
  if (!feed.hydrated) await hydrateFeed(feed);

  const takeBacklog = () => {
    const out = [];
    while (feed.backlog.length && out.length < limit) {
      const d = feed.backlog.shift();
      if (isFresh(feed, d)) out.push(d);
    }
    return out;
  };

  let cached = takeBacklog();
  if (!cached.length && !feed.localDone && !feed.localError) {
    try {
      await fetchLocalPage(feed);
      cached = takeBacklog();
    } catch (err) {
      feed.localError = String(err?.message || err || '本地菜品读取失败').slice(0, 120);
    }
  }
  if (cached.length) {
    cached.forEach((d) => track(feed, d, 'discovered'));
    feed.items = [...feed.items, ...cached];
    feed.dryRounds = 0;
    feed.lastNotice = '';
    return { items: cached, source: 'local', status: 'ok', note: '' };
  }

  const excludeIds = [...feed.usedIds, ...feed.usedNames];
  const res = await api.dishSearch({ kind: feed.kind, id: feed.id, excludeIds, limit });
  const items = [];
  for (const d of res?.items || []) {
    if (!isFresh(feed, d)) continue;
    items.push(d);
  }
  feed.lastReason = res?.reason || '';
  feed.lastStats = res?.stats || null;
  if (items.length) {
    items.forEach((d) => track(feed, d, 'discovered'));
    feed.items = [...feed.items, ...items];
    feed.dryRounds = 0;
    feed.lastNotice = '';
    return { items, source: 'search', status: 'ok', note: res?.note || '', reason: res?.reason || 'ok', stats: res?.stats || null };
  }

  // 一条都没拿到：如实记下服务端给的说明，不做「假装还有更多」。
  // 本地接口失败时把原因一并带上，避免只显示外部检索错误而掩盖本地问题。
  feed.dryRounds += 1;
  const localNote = feed.localError ? `本地历史结果读取失败：${feed.localError}` : '';
  feed.lastNotice = [res?.note || '本次没有发现新的可靠菜品，可以尝试再次探索。', localNote]
    .filter(Boolean)
    .join('；');
  if (feed.dryRounds >= DRY_ROUNDS_DONE) feed.done = true;
  return {
    items: [],
    source: 'none',
    status: res?.status || 'empty',
    note: feed.lastNotice,
    reason: res?.reason || '',
    stats: res?.stats || null,
  };
}

/** 用户点「再试一次」：清掉「已到底」的判断，允许重新尝试本地分页和外部检索 */
export function retryDiscovery(feed) {
  feed.dryRounds = 0;
  feed.done = false;
  feed.lastNotice = '';
  feed.localError = '';
}

/** 测试/调试用：清空所有分类缓存 */
export function resetFeeds() {
  feeds.clear();
}