/**
 * 顶部导航的当前页指示。
 * ------------------------------------------------------------
 * 唯一依据是 location.pathname（真实路由），不看点击事件：
 * 刷新、直接输 URL、前进/后退、转场跳转都会走到这里。
 *
 * 映射规则（与 index.html 的导航顺序一一对应）：
 *   /                     → 首页
 *   /dishes, /dishes/:id  → 美食图鉴
 *   /recipe               → 菜谱工作台
 *   /recommend            → 智能推荐
 *   /community            → 美食社区
 *   其他（/cuisines/:id、/tastes/:id、/chat/:id、/videos、/explore、/admin）
 *   → 不属于任何顶部导航入口，全部不激活，避免归错栏目
 */

/** 导航项定义：path 是入口路径，prefix 表示「该栏目下的子页面也归它」 */
const NAV_MAP = [
  { path: '/', label: '首页', exact: true },
  { path: '/dishes', label: '美食图鉴', prefix: true },
  { path: '/recipe', label: '菜谱工作台', exact: true },
  { path: '/recommend', label: '智能推荐', exact: true },
  { path: '/community', label: '美食社区', exact: true },
];

/** 归一化路径：去掉查询串/哈希、末尾斜杠、重复斜杠 */
export function normalizePath(raw) {
  let p = String(raw || '/');
  const cut = p.search(/[?#]/);
  if (cut >= 0) p = p.slice(0, cut);
  p = p.replace(/\/{2,}/g, '/');
  if (p.length > 1) p = p.replace(/\/+$/, '');
  return p || '/';
}

/** 根据路径算出应该激活的导航入口（没有匹配则返回 null） */
export function activeNavPath(raw) {
  const path = normalizePath(raw);
  for (const item of NAV_MAP) {
    if (item.exact && path === item.path) return item.path;
    if (item.prefix && (path === item.path || path.startsWith(item.path + '/'))) return item.path;
  }
  return null;
}

/**
 * 把激活态写到 DOM 上。
 * 同时维护 aria-current，读屏与样式共用同一份状态。
 * @param {string} [raw] 默认取 location.pathname
 */
export function syncNavActive(raw = location.pathname) {
  const target = activeNavPath(raw);
  const links = document.querySelectorAll('.nav__links a[href]');
  let marked = 0;
  links.forEach((a) => {
    const href = normalizePath(a.getAttribute('href') || '/');
    const on = target !== null && href === target;
    a.classList.toggle('is-active', on);
    if (on) {
      a.setAttribute('aria-current', 'page');
      marked += 1;
    } else {
      a.removeAttribute('aria-current');
    }
  });
  return { active: target, count: marked };
}
