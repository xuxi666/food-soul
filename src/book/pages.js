/**
 * 页面库：把整本书拆成「一张张纸」
 * ------------------------------------------------------------
 * 书页不再是一个横跨双页的内容层。每个跨页 = 两张真实的纸面：
 *   左页纸 = 上半张纸的背面，右页纸 = 同一张纸的正面。
 * 所以这里只回答两个问题：
 *   1. 全书一共有哪些跨页（spreads）
 *   2. 第 s 个跨页的左/右页分别是谁的哪个 DOM 节点
 *
 * 页面节点创建后不会再被销毁（图鉴分页除外，它是纯数据页，丢了也能重建），
 * 换页时只是把同一个节点搬到另一张纸上，模块状态（筛选、输入、滚动位置）不会丢。
 */
import { h } from '../lib/dom.js';
import { CHAPTERS, EXTRA, chapterById } from './chapters.js';
import { createAtlas } from './atlas.js';
import { mountCategory } from './category.js';
import { mountVideos } from './videos.js';

/** 把若干节点装进一张纸的纸面 */
function wrapFace(bare, nodes, extraClass = '') {
  const face = h('div', { class: `bk-pageface${bare ? ' bk-pageface--bare' : ''}${extraClass ? ` ${extraClass}` : ''}` });
  const inner = h('div', { class: 'bk-pageface__inner' });
  for (const node of nodes) if (node) inner.append(node);
  face.append(inner);
  return face;
}

/** 章节内容 → 左右两页的节点清单 */
const SPLITTERS = {
  recipe(root) {
    const left = [root.querySelector('.page-head'), root.querySelector('.tool-form')];
    const right = [root.querySelector('.recipe-result')];
    return { left, right };
  },
  // 厨房：左页 = 食材探索（风味图谱 + 食材库），右页 = 配方创作（模式 + 配方 + 生成结果）
  kitchen(root) {
    const left = [root.querySelector('.ek-explore')];
    const right = [root.querySelector('.ek-craft')];
    return { left, right };
  },
  community(root) {
    const left = [root.querySelector('.community-side')];
    const right = [root.querySelector('.community-main')];
    return { left, right };
  },
  dishDetail(root) {
    // 左页：页头 + 主视觉 + 介绍 · 来历；右页：风味 / 食材 / 步骤 / 要点 / 相关 / AI / 评论
    const hero = root.querySelector('.detail-hero');
    const blocks = [...root.querySelectorAll('.cat-block')];
    const left = [root.querySelector('.page-head'), hero, ...blocks.slice(0, 4)];
    const right = blocks.slice(4);
    return { left, right };
  },
  admin(root) {
    // 后台是独立的一叠内页：左页管理导航、右页管理内容。
    // 单页模式（手机）放不下两张纸，就在同一页里上下排：导航在上、内容在下。
    const single = document.querySelector('.bk-stage')?.classList.contains('is-single');
    if (single) return { left: [root], right: [] };
    const left = root.querySelector('.adm-side');
    const right = root.querySelector('.adm-main');
    return left && right ? { left: [left], right: [right] } : { left: [root], right: [] };
  },
  notFound(root) {
    return { left: [root.querySelector('.page > .wrap') || root], right: [] };
  },
};

export function createPageBook({ staging, onAtlasChange, onCategoryNav }) {
  /** 章节 id → { left, right } 两张纸面 */
  const pages = new Map();
  let atlas = null;

  /* ---------------- 图鉴 ---------------- */
  function ensureAtlas() {
    if (!atlas) {
      atlas = createAtlas({
        onChange: () => {
          // 筛选改变了页数：让外面的书页栈重算跨页
          onAtlasChange?.();
        },
        // 卡片三角书签：交给书页模块走全局章节翻页（目标分类一起带过去）
        onCategoryNav,
      });
    }
    return atlas;
  }
  const atlasSpreadCount = () => (atlas ? atlas.spreadCount() : 1);

  /* ---------------- 定制双页 / 整章模块 ---------------- */

  /** 菜系 / 口味当前停在哪个分类（地址里带 id：/cuisines/yue、/tastes/mala） */
  const chapterParams = new Map();
  const defaultParamOf = (id) => (id === 'tastes' ? 'mala' : 'chuan');

  async function ensureChapter(id) {
    const entry = pages.has(id) ? pages.get(id) : await buildChapter(id);
    if (!entry) return null;
    if (id === 'cuisines' || id === 'tastes') {
      // 章节只建一次；分类换了就换内容，不重建纸面（滚动、卡片节点都留着）
      const kind = id === 'tastes' ? 'taste' : 'cuisine';
      entry.instance?.update?.(kind, chapterParams.get(id) || defaultParamOf(id));
    }
    return entry;
  }

  async function buildChapter(id) {
    const def = chapterById(id) || EXTRA[id];
    if (!def) return null;

    if (id === 'cuisines' || id === 'tastes') {
      const kind = id === 'tastes' ? 'taste' : 'cuisine';
      const inst = mountCategory(staging, kind, chapterParams.get(id) || defaultParamOf(id));
      // 页内芯片换分类：把新 id 记在书页模块这边，书重绘时不会被旧参数拉回去
      inst.setSwitchHandler?.((href) => chapterParams.set(id, String(href || '').split('/').filter(Boolean).pop()));
      const left = inst.el.querySelector('.catb__page--left');
      const right = inst.el.querySelector('.catb__page--right');
      const entry = { left: wrapFace(true, [left], 'bk-pageface--cat'), right: wrapFace(true, [right], 'bk-pageface--cat'), instance: inst };
      pages.set(id, entry);
      return entry;
    }

    if (id === 'videos') {
      const inst = mountVideos(staging);
      const left = inst.el.querySelector('.vid__page--left');
      const right = inst.el.querySelector('.vid__page--right');
      const entry = { left: wrapFace(true, [left]), right: wrapFace(true, [right]), instance: inst };
      pages.set(id, entry);
      return entry;
    }

    // 普通章节：整章挂进暂存区，再按结构切成左右两页
    const mod = await def.load();
    if (!mod) return null;
    const holder = h('div', { class: 'bk-module', 'data-key': id });
    staging.append(holder);
    let instance = null;
    try {
      instance = (await mod.mount(holder, def.params || [])) || null;
    } catch (err) {
      console.warn('[book] 模块挂载失败', id, err);
      holder.append(h('p', { class: 'bk-error', text: '内容加载失败，请刷新重试' }));
    }
    const split = (SPLITTERS[id] || ((root) => ({ left: [root], right: [] })))(holder);
    const faceClass = id === 'kitchen' ? 'bk-pageface--kitchen' : '';
    const entry = {
      left: wrapFace(false, split.left, faceClass),
      right: wrapFace(false, split.right, faceClass),
      instance,
      holder,
    };
    pages.set(id, entry);
    holder.remove();
    // 图谱这类按容器尺寸绘制的组件，换爹之后要重新量一次
    requestAnimationFrame(() => window.dispatchEvent(new Event('resize')));
    return entry;
  }

  /* ---------------- 跨页序列 ---------------- */
  function spreads() {
    ensureAtlas();
    const out = [];
    for (const ch of CHAPTERS) {
      const n = ch.id === 'dishes' ? atlasSpreadCount() : 1;
      for (let i = 0; i < n; i++) out.push({ chapter: ch.id, index: i });
    }
    return out;
  }

  /** 全局页码：第 1 页是扉页，正文从第 2 页开始；左页偶数、右页奇数 */
  const firstPageOf = (spreadIndex) => spreadIndex * 2 + 2;

  function spreadOfChapter(id) {
    const list = spreads();
    const at = list.findIndex((s) => s.chapter === id);
    return at < 0 ? 0 : at;
  }

  /* ---------------- 取页面节点 ---------------- */
  async function pageAt(spreadIndex, side) {
    const list = spreads();
    const sp = list[Math.max(0, Math.min(spreadIndex, list.length - 1))];
    if (!sp) return null;
    // 给每张纸面打上「全书页码」，方便验收时核对正反面到底是哪一页
    const mark = (node) => {
      if (node) node.dataset.globalPage = String(spreadIndex * 2 + (side === 'left' ? 2 : 3));
      if (node) node.dataset.pageSide = side;
      return node;
    };
    if (sp.chapter === 'dishes') {
      ensureAtlas();
      const idx = sp.index * 2 + (side === 'left' ? 0 : 1);
      return mark(atlas.page(idx, side));
    }
    const entry = await ensureChapter(sp.chapter);
    return entry ? mark(entry[side]) : null;
  }

  /** 按全局页码取页（单页模式用；奇偶两侧都能取） */
  async function pageByNumber(n) {
    const list = spreads();
    const s = Math.floor((n - 2) / 2);
    const side = (n - 2) % 2 === 0 ? 'left' : 'right';
    if (s < 0 || s >= list.length) return null;
    return pageAt(s, side);
  }

  const totalSpreads = () => spreads().length;

  /** 某个路径落在第几个跨页 */
  function spreadOfPath(path) {
    ensureAtlas();
    const list = spreads();
    if (String(path).startsWith('/dishes/')) return -1; // 详情页另走「插入页」
    if (String(path).startsWith('/admin')) return -1;
    const id = (() => {
      const p = String(path).split('?')[0];
      if (p.startsWith('/cuisines/')) return 'cuisines';
      if (p.startsWith('/tastes/')) return 'tastes';
      if (p.startsWith('/dishes')) return 'dishes';
      if (p === '/recipe') return 'recipe';
      if (p === '/kitchen' || p === '/recommend') return 'kitchen';
      if (p === '/community') return 'community';
      if (p === '/videos') return 'videos';
      return 'dishes';
    })();
    const at = list.findIndex((s) => s.chapter === id);
    return at < 0 ? 0 : at;
  }

  /** 内页（详情/后台/404）：单独一叠纸，不参与章节顺序 */
  async function innerPages(path) {
    const id = String(path).startsWith('/admin') ? 'admin' : String(path).startsWith('/dishes/') ? 'dishDetail' : 'notFound';
    const params = id === 'dishDetail' ? [String(path).split('/')[2]] : [];
    const def = EXTRA[id];
    const mod = await def.load();
    const holder = h('div', { class: 'bk-module', 'data-key': id });
    staging.append(holder);
    let instance = null;
    try {
      instance = (await mod.mount(holder, params)) || null;
    } catch (err) {
      console.warn('[book] 内页挂载失败', id, err);
    }
    const split = (SPLITTERS[id] || ((root) => ({ left: [root], right: [] })))(holder);
    const entry = { left: wrapFace(false, split.left), right: wrapFace(false, split.right), instance, holder };
    if (id === 'admin') {
      // 后台两页各自整页铺满：滚动只发生在内容区，不牵动纸张
      entry.left.classList.add('bk-pageface--adm');
      entry.right.classList.add('bk-pageface--adm');
    }
    // 单页模式 / 无权限等情况下整块 holder 被搬进了纸面，这时候不能再 remove，
    // 否则会把刚贴上去的内容一起删掉（手机上前台后台都只剩一张白纸）
    if (!entry.left.contains(holder) && !entry.right.contains(holder)) holder.remove();
    requestAnimationFrame(() => window.dispatchEvent(new Event('resize')));
    return entry;
  }

  function disposeInner(entry) {
    if (!entry) return;
    try {
      entry.instance?.destroy?.();
    } catch {
      /* 忽略 */
    }
    entry.left?.remove();
    entry.right?.remove();
    entry.holder?.remove();
  }

  return {
    spreads,
    totalSpreads,
    spreadOfPath,
    spreadOfChapter,
    firstPageOf,
    pageAt,
    pageByNumber,
    innerPages,
    disposeInner,
    get atlas() {
      return atlas;
    },
    /** 当前停在哪个分类（写地址时用，保证地址与内容一致） */
    getChapterParam(chapterId) {
      return chapterParams.get(chapterId) || defaultParamOf(chapterId);
    },
    /** 地址里的分类 id（书签 / 深链接 / 前进后退）交代给章节实例 */
    setChapterParam(chapterId, param) {
      if (!chapterId) return;
      chapterParams.set(chapterId, param || defaultParamOf(chapterId));
    },
  };
}