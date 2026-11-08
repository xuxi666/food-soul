/**
 * 菜系页右页的数据层：图鉴分页 + 图鉴外发现
 * ------------------------------------------------------------
 * 两段式，和页面上的「加载更多」一一对应：
 *   1. 图鉴批次：随包发布的菜品清单（src/data/dishes.js，97 道），按分类过滤后切片；
 *   2. 图鉴外发现：复用已有的服务端能力，不在前端另造一套 ——
 *      · GET  /api/dishes?kind=&id=     已持久化的「AI 联网补全」菜（读缓存，不重复检索）
 *      · POST /api/dishes/search        服务端 searchDishes()：GLM 联网检索 → 搜索验证菜名
 *                                       → 真实图片检索与哈希去重 → 落盘 public/dishes/generated
 *      两处都由服务端做真实性校验和去重，密钥只在服务端（server/config.mjs），前端拿不到。
 *
 * 每个分类（`cuisine:chuan` / `taste:mala`）一份独立状态并缓存：
 * 切走再切回来恢复已加载的卡片（与 src/lib/catalog.js 的缓存策略一致），
 * 但页面切换菜系时滚动位置一律回到顶部。
 *
 * 去重三重：真实 id（图鉴 id / 服务端生成的 ai-xxxx）、规范化菜名、图片 URL。
 */

import { DISHES } from './dishes.js';
import { api } from '../lib/api.js';

export const ATLAS_BATCH = 4; // 图鉴每批 4 道（两列两行）
export const DISCOVER_BATCH = 3; // 图鉴外每批 3 道，和服务端单轮预算匹配
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

/** 该分类下的图鉴菜品：必须有图，按名字与图片去重（同一道菜的重复条目只留一条） */
export function listCategoryDishes(kind, id) {
  if (!id) return [];
  const list = DISHES.filter((d) => (kind === 'taste' ? (d.tastes || []).includes(id) : d.cuisine === id));
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

/** 读服务端已经落盘的发现结果（免费，不触发检索） */
export async function hydrateFeed(feed) {
  if (feed.hydrated || feed.hydrating) return feed;
  feed.hydrating = true;
  try {
    const res = await api.dishes({ kind: feed.kind, id: feed.id });
    const list = (res?.items || []).filter((d) => isFresh(feed, d));
    feed.backlog = list;
  } catch {
    feed.backlog = [];
  } finally {
    feed.hydrated = true;
    feed.hydrating = false;
  }
  return feed;
}

/**
 * 取下一批图鉴外菜品。
 * 先花缓存（服务端已持久化的结果），没有再触发一次联网检索。
 * @returns {Promise<{items:Array, source:'cache'|'search'|'none', status:string, note:string}>}
 */
export async function discoverBatch(feed, limit = DISCOVER_BATCH) {
  if (!feed.hydrated) await hydrateFeed(feed);

  const cached = [];
  while (feed.backlog.length && cached.length < limit) {
    const d = feed.backlog.shift();
    if (isFresh(feed, d)) cached.push(d);
  }
  if (cached.length) {
    cached.forEach((d) => track(feed, d, 'discovered'));
    feed.items = [...feed.items, ...cached];
    feed.dryRounds = 0;
    return { items: cached, source: 'cache', status: 'ok', note: '' };
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

  // 一条都没拿到：如实记下服务端给的说明，不做「假装还有更多」
  feed.dryRounds += 1;
  feed.lastNotice = res?.note || '本次没有发现新的可靠菜品，可以尝试再次探索。';
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

/** 用户点「再试一次」：清掉「已到底」的判断，允许重新检索一轮 */
export function retryDiscovery(feed) {
  feed.dryRounds = 0;
  feed.done = false;
  feed.lastNotice = '';
}

/** 测试/调试用：清空所有分类缓存 */
export function resetFeeds() {
  feeds.clear();
}