/**
 * 画册导航历史（模块级）
 * ------------------------------------------------------------
 * 只做一件事：记住「用户按顺序看过哪些模块」，供「返回」使用。
 *
 * 一条记录（与验收口径一致）：
 *   moduleId       模块 id（catalog / dishes / cuisines / tastes / recipe /
 *                  kitchen / community / dishDetail / admin / chat / site）
 *   moduleName     模块中文名
 *   route          当时的地址（pathname + search，带分类 id、菜品 id 等）
 *   params         必要的页面参数（章节、跨页、单页模式、分类 id）
 *   pageState      页面内部状态（是否内页 / 是否浮层等，按模块自身写）
 *   scrollPosition 页面滚动位置（站内页与外部页面用得到）
 *   timestamp      导航时间
 *   site           是否站内页（聊天、视频等替换掉书页的整页模块）
 *
 * 规则：
 *   1. 连续两次「同一模块 + 同一地址」只更新状态，不新增一条（连点同一枚书签不会堆栈）。
 *   2. 正常前进时截断「前进分支」（和浏览器历史同义）。
 *   3. 返回时先把游标退一格再导航，导航写回的记录正好命中这一格，于是不会重复入栈。
 *   4. 栈长上限 60，超出丢最早的一条，避免无限增长。
 *
 * 这个模块不碰 DOM、不碰路由，也不认识画册：画册把「导航到某条记录」的能力注入进来，
 * 历史只负责顺序与游标。禁止在别处另写一套历史。
 */

export const NAV_HISTORY_LIMIT = 60;
export const NAV_EVENT = 'foodsoul:book-nav';

const MODULE_NAMES = {
  catalog: '目录',
  dishes: '图鉴',
  cuisines: '菜系',
  tastes: '口味',
  recipe: '菜谱',
  kitchen: '厨房',
  community: '社区',
  dishDetail: '菜品详情',
  admin: '后台',
  notFound: '未找到',
  chat: '美食角色聊天',
  site: '站内页面',
};

let entries = [];
let cursor = -1;
/* 返回导航：下一次记录应当落到这一格，而不是新压一条 */
let revisitIndex = -1;

const clone = (entry) =>
  entry
    ? {
        ...entry,
        params: { ...(entry.params || {}) },
        pageState: { ...(entry.pageState || {}) },
      }
    : null;

const keyOf = (entry) => `${entry.moduleId}|${entry.route}`;

function emit() {
  try {
    window.dispatchEvent(new CustomEvent(NAV_EVENT, { detail: { index: cursor, entries: entries.map(clone) } }));
  } catch {
    /* 非浏览器环境（单测 / SSR）：忽略 */
  }
}

export function moduleNameOf(id) {
  return MODULE_NAMES[id] || String(id || '模块');
}

/** 记一次模块访问；同一模块同一地址只更新状态 */
export function recordNavigation(input = {}) {
  const entry = {
    moduleId: String(input.moduleId || 'unknown'),
    moduleName: input.moduleName || moduleNameOf(input.moduleId),
    route: input.route || '/',
    params: { ...(input.params || {}) },
    pageState: { ...(input.pageState || {}) },
    scrollPosition: Number.isFinite(input.scrollPosition) ? Math.round(input.scrollPosition) : 0,
    timestamp: Date.now(),
    site: !!input.site,
  };

  if (revisitIndex >= 0) {
    const slot = Math.max(0, Math.min(revisitIndex, entries.length - 1));
    revisitIndex = -1;
    cursor = slot;
    entries[slot] = entry;
    emit();
    return clone(entry);
  }

  const top = entries[cursor];
  if (top && keyOf(top) === keyOf(entry)) {
    const samePayload =
      JSON.stringify(top.params) === JSON.stringify(entry.params) &&
      JSON.stringify(top.pageState) === JSON.stringify(entry.pageState);
    entries[cursor] = { ...entry, timestamp: top.timestamp };
    if (!samePayload) emit();
    return clone(entries[cursor]);
  }

  entries = entries.slice(0, cursor + 1);
  entries.push(entry);
  if (entries.length > NAV_HISTORY_LIMIT) {
    entries = entries.slice(entries.length - NAV_HISTORY_LIMIT);
  }
  cursor = entries.length - 1;
  emit();
  return clone(entry);
}

/** 只读快照（诊断 / 验收用） */
export function historyState() {
  return { index: cursor, entries: entries.map(clone) };
}

export function currentEntry() {
  return clone(entries[cursor]);
}

export function previousEntry() {
  return cursor > 0 ? clone(entries[cursor - 1]) : null;
}

export function canGoBack() {
  return cursor > 0;
}

/**
 * 返回：游标退一格并返回该条记录。
 * 真正的跳转由调用方（画册）执行；失败时应调用 restoreCursor 复位。
 */
export function commitBack() {
  if (cursor <= 0) return null;
  cursor -= 1;
  emit();
  return clone(entries[cursor]);
}

/** 返回失败（例如翻页被打断）时复位游标，保证历史与画面一致 */
export function restoreCursor(index) {
  if (!Number.isInteger(index)) return;
  cursor = Math.max(-1, Math.min(index, entries.length - 1));
  emit();
}

/** 返回前声明目标格：接下来那一次记录落到这里，保留前进分支 */
export function expectRevisit(index) {
  revisitIndex = Number.isInteger(index) ? index : -1;
}

export function cancelRevisit() {
  revisitIndex = -1;
}

export function revisitPending() {
  return revisitIndex >= 0;
}

export function clearHistory() {
  entries = [];
  cursor = -1;
  emit();
}