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
function wrapFace(bare, nodes) {
  const face = h('div', { class: `bk-pageface${bare ? ' bk-pageface--bare' : ''}` });
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
  kitchen(root) {
    const left = [root.querySelector('.ek-graph-card'), root.querySelector('.ek-modes')];
    const right = [root.querySelector('.ek-catalog'), root.querySelector('.ek-recipe'), root.querySelector('.ek-result')];
    return { left, right };
  },
  community(root) {
    const left = [root.querySelector('.community-side')];
    const right = [root.querySelector('.community-main')];
    return { left, right };
  },
  dishDetail(root) {
    const hero = root.querySelector('.detail-hero');
    const blocks = [...root.querySelectorAll('.cat-block')];
    const left = [root.querySelector('.page-head'), hero, blocks[0]];
    const right = blocks.slice(1);
    return { left, right };
  },
  admin(root) {
    return { left: [root.querySelector('.page > .wrap') || root], right: [] };
  },
  notFound(root) {
    return { left: [root.querySelector('.page > .wrap') || root], right: [] };
  },
};

export function createPageBook({ staging, onAtlasChange }) {
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
      });
    }
    return atlas;
  }
  const atlasSpreadCount = () => (atlas ? atlas.spreadCount() : 1);

  /* ---------------- 定制双页 / 整章模块 ---------------- */
  async function ensureChapter(id) {
    if (pages.has(id)) return pages.get(id);
    const def = chapterById(id) || EXTRA[id];
    if (!def) return null;

    if (id === 'cuisines' || id === 'tastes') {
      const kind = id === 'tastes' ? 'taste' : 'cuisine';
      const inst = mountCategory(staging, kind, def.params?.[0] || (id === 'tastes' ? 'mala' : 'chuan'));
      const left = inst.el.querySelector('.catb__page--left');
      const right = inst.el.querySelector('.catb__page--right');
      const entry = { left: wrapFace(true, [left]), right: wrapFace(true, [right]), instance: inst };
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
    const entry = {
      left: wrapFace(false, split.left),
      right: wrapFace(false, split.right),
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
    holder.remove();
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
  };
}