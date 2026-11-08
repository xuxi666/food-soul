/**
 * 画册章节定义
 * ------------------------------------------------------------
 * 这里是全站模块的唯一配置源：章节顺序 = 书页顺序 = 书签顺序 = 目录顺序。
 * 目录页、侧边书签、翻页定位、地址映射全部从这里读，
 * 不允许在别处再写一份「模块 → 路由」的映射表。
 *
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

/**
 * 目录分栏：只影响目录页的排版分组，不参与章节顺序
 * （顺序由 CHAPTERS 决定，分组内按 CHAPTERS 顺序排）
 */
export const CATALOG_GROUPS = [
  { id: 'explore', title: '美食探索', en: 'EXPLORE' },
  { id: 'cook', title: 'AI 与烹饪', en: 'AI & KITCHEN' },
  { id: 'culture', title: '美食文化', en: 'CULTURE' },
];

/**
 * 章节表
 *   id     模块标识（书签 / 目录 / 地址映射共用这一个）
 *   label  书签上的短名（竖排，最多 4 字）
 *   title  目录里的正式名称
 *   desc   目录里的一句话介绍
 *   group  目录分组 id
 *   tint   书签侧边色标
 *   href   入口地址（分类页带默认分类）
 */
export const CHAPTERS = [
  {
    id: 'catalog',
    label: '目录',
    title: '全站目录',
    desc: '画册的序言与功能索引。',
    group: 'explore',
    num: '00',
    tint: '#8d6a3f',
    side: 'left',
    href: '/catalog',
    layout: 'catalog',
  },
  {
    id: 'dishes',
    label: '图鉴',
    title: '美食图鉴',
    desc: '近百道中国菜的图谱，可按菜系、味型与难度筛选。',
    group: 'explore',
    num: '01',
    tint: '#b5452f',
    side: 'left',
    href: '/dishes',
    load: load('dishes'),
    layout: 'atlas',
  },
  {
    id: 'cuisines',
    label: '菜系',
    title: '八大菜系',
    desc: '川、粤、苏、浙、闽、湘、徽、鲁，一系一专题。',
    group: 'explore',
    num: '02',
    tint: '#9a7248',
    side: 'left',
    href: '/cuisines/chuan',
    load: load('cuisine'),
    params: ['chuan'],
    layout: 'flow',
  },
  {
    id: 'tastes',
    label: '口味',
    title: '口味探索',
    desc: '麻辣、清鲜、醇厚……按味觉特征横向发现美食。',
    group: 'explore',
    num: '03',
    tint: '#c0854a',
    side: 'left',
    href: '/tastes/mala',
    load: load('taste'),
    params: ['mala'],
    layout: 'flow',
  },
  {
    id: 'recipe',
    label: '菜谱',
    title: '智能食谱',
    desc: '给出条件，生成结构化的菜谱与烹饪建议。',
    group: 'cook',
    num: '04',
    tint: '#b08e4e',
    side: 'right',
    href: '/recipe',
    load: load('recipe'),
    layout: 'flow',
  },
  {
    id: 'kitchen',
    label: '厨房',
    title: '食材厨房',
    desc: '食材库与风味图谱，从食材之间的关系推导配方。',
    group: 'cook',
    num: '05',
    tint: '#6f7f5f',
    side: 'right',
    href: '/kitchen',
    load: load('kitchen'),
    layout: 'flow',
  },
  {
    id: 'community',
    label: '社区',
    title: '美食社区',
    desc: '发布做菜记录，浏览他人的作品与心得。',
    group: 'culture',
    num: '06',
    tint: '#7a5a40',
    side: 'right',
    href: '/community',
    load: load('community'),
    layout: 'flow',
  },
  {
    id: 'videos',
    label: '视频',
    title: '影像视频',
    desc: '与美食有关的短片与影像档案。',
    group: 'culture',
    num: '07',
    tint: '#6e8489',
    side: 'right',
    href: '/videos',
    load: load('videos'),
    layout: 'flow',
  },
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
  if (p === '/' || p === '/catalog') return 'catalog';
  if (p.startsWith('/cuisines/')) return 'cuisines';
  if (p.startsWith('/tastes/')) return 'tastes';
  if (p === '/dishes' || p.startsWith('/dishes/')) return 'dishes';
  if (p === '/recipe') return 'recipe';
  if (p === '/kitchen' || p === '/recommend') return 'kitchen';
  if (p === '/community') return 'community';
  if (p === '/videos') return 'videos';
  if (p === '/admin') return 'admin';
  return 'catalog';
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

/** 目录页要列的条目：除目录自身以外的所有章节（与书签一一对应） */
export function catalogEntries() {
  return CHAPTERS.filter((ch) => ch.id !== 'catalog');
}