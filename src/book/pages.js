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
import { enableWheelScroll, enableTouchScroll } from '../lib/wheel-scroll.js';
import { CHAPTERS, EXTRA, chapterById, chapterOf } from './chapters.js';
import { createAtlas } from './atlas.js';
import { mountCategory } from './category.js';
import { mountCatalog } from './catalog.js';

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
    // 手机只有一张纸：表单与菜谱结果上下排，向下滚动即可看结果。
    // 注意不能像 admin 那样直接返回 [root]——wrapFace 会把节点搬进纸面，
    // 而 buildChapter 结尾会 holder.remove()，那样整页内容会被一起摘掉。
    const single = document.querySelector('.bk-stage')?.classList.contains('is-single');
    if (single) return { left: [...root.children], right: [] };
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
    // 手机只有一张纸：发布区与帖子列表必须并进同一张纸上下排。
    // 否则「社区」这一章在单页模式下会拆成两张纸，而画册没有翻页按钮，
    // 右页（帖子列表）永远翻不到——列表再好看也没人看得见。
    const single = document.querySelector('.bk-stage')?.classList.contains('is-single');
    if (single) return { left: [...root.children], right: [] };
    const left = [root.querySelector('.community-side'), root.querySelector('.com-detail')];
    const right = [root.querySelector('.community-main')];
    return { left, right };
  },
  dishDetail(root) {
    // 详情只占「一页」：全部内容都排在右页，左页交给浏览内容（图鉴 / 菜系列表）。
    // 聊天打开时也落在左页，收起后左页原样露回来。
    // 这样详情永远不会横跨书脊，也不会和聊天抢同一张纸。
    return {
      left: [],
      right: [root.querySelector('.page-head'), root.querySelector('.dm-head'), root.querySelector('.dm-top'), root.querySelector('.dm-facts'), ...root.querySelectorAll('.cat-block')],
    };
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
  recommendations(root) {
    // 左页输入需求、右页看推荐；手机只有一张纸，两个面板上下排成一页。
    const single = document.querySelector('.bk-stage')?.classList.contains('is-single');
    if (single) return { left: [...root.children], right: [] };
    return {
      left: [root.querySelector('.rec-form-pane')],
      right: [root.querySelector('.rec-result-pane')],
    };
  },
  notFound(root) {
    return { left: [root.querySelector('.page > .wrap') || root], right: [] };
  },
};

export function createPageBook({ staging, onAtlasChange, onCategoryNav, onChapterNav }) {
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

  /**
   * 目录页的两张纸。
   * 双页模式：左页序言、右页目录，各自排满、都不滚动。
   * 单页模式（手机）：一本书一次只显示一张纸，而画册没有「下一页」按钮，
   *   所以把「序 + 目录」并进同一张纸，让读者在一页里往下读就能看到全部条目。
   */
  function catalogEntryFor(inst) {
    const single = document.querySelector('.bk-stage')?.classList.contains('is-single');
    if (single) {
      const flow = h(
        'div',
        { class: 'catalog catalog--flow' },
        inst.el.querySelector('.catalog__page--left'),
        inst.el.querySelector('.catalog__page--right')
      );
      return {
        left: wrapFace(true, [flow], 'bk-pageface--catalog bk-pageface--catalog-flow'),
        right: wrapFace(true, [], 'bk-pageface--catalog'),
        instance: inst,
        single: true,
      };
    }
    return {
      left: wrapFace(true, [inst.el.querySelector('.catalog__page--left')], 'bk-pageface--catalog'),
      right: wrapFace(true, [inst.el.querySelector('.catalog__page--right')], 'bk-pageface--catalog'),
      instance: inst,
      single: false,
    };
  }

  /** 丢掉某一章已建好的纸（横竖屏切换时目录要按新宽度重排） */
  function disposeChapter(id) {
    const entry = pages.get(id);
    if (!entry) return;
    pages.delete(id);
    try {
      entry.instance?.destroy?.();
    } catch {
      /* 忽略 */
    }
    entry.left?.remove();
    entry.right?.remove();
  }

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

    // 目录页：同样是「一章」，左右各贴一张纸；条目点击交给书册的 openChapter（与书签同一条路径）
    if (id === 'catalog') {
      const inst = mountCatalog(staging, { onPick: (chapterId) => onChapterNav?.(chapterId) });
      const entry = catalogEntryFor(inst);
      pages.set(id, entry);
      return entry;
    }

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
    const faceClass =
      id === 'kitchen'
        ? 'bk-pageface--kitchen'
        : id === 'recipe'
          ? 'bk-pageface--recipe'
          : id === 'recommendations'
            ? 'bk-pageface--rec'
            : '';
    const entry = {
      left: wrapFace(false, split.left, faceClass),
      right: wrapFace(false, split.right, faceClass),
      instance,
      holder,
    };
    pages.set(id, entry);
    holder.remove();
    // 菜品详情内页 / 社区：两张纸各自滚动，同样需要把滚轮换算成 scrollTop
    // （社区要靠滚动触发无限加载，原生滚轮在 3D 纸面上不生效）
    if (id === 'dishDetail' || id === 'community') {
      enableWheelScroll(entry.left);
      enableWheelScroll(entry.right);
      enableTouchScroll(entry.left);
      enableTouchScroll(entry.right);
    }
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
    const p = String(path).split('?')[0];
    if (p.startsWith('/dishes/')) return -1; // 详情页另走「插入页」
    if (p.startsWith('/admin')) return -1;
    // 路径 → 章节只有一份映射（chapters.js），这里不再重复写一张表
    const id = chapterOf(p);
    const at = list.findIndex((s) => s.chapter === id);
    return at < 0 ? 0 : at;
  }

  /** 内页（详情/后台/404）：单独一叠纸，不参与章节顺序 */
  async function innerPages(path, { single = false } = {}) {
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
    if (id === 'dishDetail') {
      if (single) {
        // 手机单页：一屏只有一张纸，没有「另一半」可放图鉴。
        // 详情必须占这一张纸，所以把详情换到左页（单页模式下位置 2 就是这张纸）。
        const blank = entry.left;
        entry.left = entry.right;
        entry.right = blank;
      } else {
        // 深链接进详情（双页）：左页放图鉴的那张纸，右页是详情本身 ——
        // 与「在图鉴里点开详情」同一种半页结构。纸面节点仍归图鉴所有，
        // 这里只是把它搬到本跨页；离开内页时图鉴会重新取回同一节点。
        ensureAtlas();
        entry.left = wrapFace(true, [atlas.page(0, 'left')], 'bk-pageface--atlas');
      }
    }
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
    disposeChapter,
    /** 目录页是高亮 / 重排都要现取的一章 */
    catalogEntry: () => pages.get('catalog') || null,
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
    /** 目录页高亮当前章节（与书签同一份章节 id） */
    setChapterActive(chapterId) {
      pages.get('catalog')?.instance?.setActive?.(chapterId);
    },
  };
}