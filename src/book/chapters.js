/**
 * 画册章节定义
 * 每个章节 = 一个书签 + 一段书页内容。
 * 视图用动态 import 加载，避免与 router.js 形成循环依赖。
 */

const VIEWS = {
  dishes: () => import('../views/dishes.js'),
  cuisine: () => import('../views/cuisine.js'),
  taste: () => import('../views/taste.js'),
  recipe: () => import('../views/recipe.js'),
  kitchen: () => import('../views/kitchen.js'),
  community: () => import('../views/community.js'),
  videos: () => import('../views/videos.js'),
  'dish-detail': () => import('../views/dish-detail.js'),
  admin: () => import('../views/admin.js'),
  notfound: () => import('../views/notfound.js'),
};

const load = (name) => () => VIEWS[name]().then((m) => m.default);

export const CHAPTERS = [
  { id: 'dishes', label: '图鉴', num: '01', side: 'left', href: '/dishes', load: load('dishes'), layout: 'atlas' },
  { id: 'cuisines', label: '菜系', num: '02', side: 'left', href: '/cuisines/chuan', load: load('cuisine'), params: ['chuan'], layout: 'flow' },
  { id: 'tastes', label: '口味', num: '03', side: 'left', href: '/tastes/mala', load: load('taste'), params: ['mala'], layout: 'flow' },
  { id: 'recipe', label: '菜谱', num: '04', side: 'right', href: '/recipe', load: load('recipe'), layout: 'flow' },
  { id: 'kitchen', label: '厨房', num: '05', side: 'right', href: '/kitchen', load: load('kitchen'), layout: 'flow' },
  { id: 'community', label: '社区', num: '06', side: 'right', href: '/community', load: load('community'), layout: 'flow' },
  { id: 'videos', label: '视频', num: '07', side: 'right', href: '/videos', load: load('videos'), layout: 'flow' },
];

export const EXTRA = {
  dishDetail: { id: 'dishDetail', load: load('dish-detail'), layout: 'flow' },
  admin: { id: 'admin', load: load('admin'), layout: 'flow' },
  notFound: { id: 'notFound', load: load('notfound'), layout: 'flow' },
};

const BY_ID = Object.fromEntries(CHAPTERS.map((c) => [c.id, c]));

export function chapterById(id) {
  return BY_ID[id] || null;
}

/** 路径 → 章节 id */
export function chapterOf(pathname) {
  const p = String(pathname || '/').split('?')[0];
  if (p.startsWith('/cuisines/')) return 'cuisines';
  if (p.startsWith('/tastes/')) return 'tastes';
  if (p === '/dishes' || p.startsWith('/dishes/')) return 'dishes';
  if (p === '/recipe') return 'recipe';
  if (p === '/kitchen' || p === '/recommend') return 'kitchen';
  if (p === '/community') return 'community';
  if (p === '/videos') return 'videos';
  if (p === '/admin') return 'admin';
  return 'dishes';
}

export function chapterIndex(id) {
  return CHAPTERS.findIndex((c) => c.id === id);
}

/** 详情页 / 后台这类不在书签里的路径 */
export function isInnerPath(pathname) {
  const p = String(pathname || '/').split('?')[0];
  return /^\/dishes\/[^/]+$/.test(p) || p === '/admin';
}

export function moduleOf(pathname) {
  const p = String(pathname || '/').split('?')[0];
  if (/^\/dishes\/([^/]+)$/.test(p)) return { key: 'dishDetail', params: [p.split('/')[2]] };
  if (p === '/admin') return { key: 'admin', params: [] };
  const id = chapterOf(p);
  const ch = chapterById(id);
  if (!ch) return { key: 'notFound', params: [] };
  if (id === 'cuisines') return { key: 'cuisines', params: [p.split('/')[2] || 'chuan'] };
  if (id === 'tastes') return { key: 'tastes', params: [p.split('/')[2] || 'mala'] };
  return { key: id, params: [] };
}
