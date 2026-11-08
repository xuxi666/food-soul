/**
 * 美食图鉴：左右双页「分类画册」
 * ------------------------------------------------------------
 * 左页八大菜系 / 右页八种口味，每页 2 列 × 4 行 = 8 张五边形书签卡片，
 * 共 16 张。每张卡片由两部分组成：
 *   · 外凸的三角书签（写分类名）—— 点击进入该分类
 *   · 内嵌的长方形图片区（自动轮播代表菜）—— 点击进入当前那道菜
 *
 * 这里只有两种「局部」动画，都不碰书籍翻页系统：
 *   1. 分类：把这一跨页的两张纸换成分类封面 + 菜品列表（不翻页）
 *   2. 详情：从被点击那张图片的四条边向外扩散，只覆盖它所在的那一页
 *
 * 所有内容节点一次建好就常驻：进出分类 / 详情都不重建卡片，
 * 所以轮播位置、图片缓存、纸面滚动都不会被重置。
 */
import { h, clear } from '../lib/dom.js';
import { DISHES } from '../data/dishes.js';
import { CUISINES, CUISINE_BY_ID, TASTES, TASTE_BY_ID } from '../data/cuisines.js';
import { guardImage } from '../lib/placeholder.js';
import { openDishOverlay, closeAllOverlays, overlayCount } from './overlay.js';

const SLIDES_PER_CARD = 5;

const SIDES = {
  left: {
    kind: 'cuisine',
    list: () => CUISINES,
    kicker: 'EIGHT CUISINES',
    title: '八大菜系',
    note: '地域 · 谱系 · 技法',
  },
  right: {
    kind: 'taste',
    list: () => TASTES,
    kicker: 'EIGHT FLAVOURS',
    title: '八种口味',
    note: '味型 · 口感 · 回甘',
  },
};

const REDUCED = () =>
  typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

/* ---------------- 数据 ---------------- */

/** 某分类下的真实菜品：只取带图的，按图 / 菜名去重（库里同名同图有多条） */
function dishesOf(kind, id) {
  const list = DISHES.filter((d) => (kind === 'cuisine' ? d.cuisine === id : (d.tastes || []).includes(id)));
  const names = new Set();
  const images = new Set();
  const out = [];
  for (const d of list) {
    if (!d.image || names.has(d.name) || images.has(d.image)) continue;
    names.add(d.name);
    images.add(d.image);
    out.push(d);
  }
  return out;
}

const metaOf = (kind, id) => (kind === 'cuisine' ? CUISINE_BY_ID[id] : TASTE_BY_ID[id]);
const accentOf = (kind, id) => metaOf(kind, id)?.accent || metaOf(kind, id)?.color || '#c2452d';

/* ---------------- 主模块 ---------------- */

export function createAtlas({ onChange } = {}) {
  const state = { view: 'board', kind: '', id: '' };
  const pages = new Map(); // 'left' / 'right' → { el, board, cat, carousels }
  const live = new Set(); // 正在跑的轮播（只有可见的那一页）
  const listCache = new Map(); // `${kind}:${id}:${side}` → 分类页节点
  let ticker = 0;
    const closers = new Set();

  /* ---------- 轮播调度：一个定时器驱动所有卡片，节奏各自独立 ---------- */
  function ensureTicker() {
    if (ticker) return;
    ticker = window.setInterval(() => {
      const now = performance.now();
      for (const c of live) c.tick(now);
    }, 420);
  }

  function stopTicker() {
    if (!ticker) return;
    window.clearInterval(ticker);
    ticker = 0;
  }

  /**
   * 轮播只在「这一页显示分类卡片、没被详情盖住、页签可见、没开减弱动效」时跑。
   * 逐页判断：左页进详情时，右页的轮播照常继续。
   */
  function syncLive() {
    const globalOk = state.view === 'board' && !REDUCED() && !document.hidden;
    let any = false;
    for (const page of pages.values()) {
      const covered = page.el.dataset.expanded === '1';
      for (const c of page.carousels) {
        if (globalOk && !covered) {
          // 从暂停里回来时重新计时，避免一放开就立刻跳一张
          if (!live.has(c) && c.everTicked) c.resetClock();
          live.add(c);
          any = true;
        } else {
          live.delete(c);
        }
      }
    }
    if (any) ensureTicker();
    else stopTicker();
  }

  document.addEventListener('visibilitychange', syncLive);

  /* ---------- 五边形书签卡片 ---------- */
  function buildCard(kind, meta, index) {
    const name = meta.name;
    const dishes = dishesOf(kind, meta.id);
    const first = dishes[0];
    if (!first) return null;

    const slides = dishes.slice(0, SLIDES_PER_CARD).map((d, i) =>
      h(
        'span',
        { class: `atcat__slide${i === 0 ? ' is-on' : ''}`, 'data-dish': d.id },
        guardImage(
          h('img', {
            src: d.image,
            alt: d.alt || d.name,
            loading: i === 0 ? 'eager' : 'lazy',
            decoding: 'async',
          }),
          d.name,
          '图片暂不可用'
        )
      )
    );

    const dots = h(
      'span',
      { class: 'atcat__dots', 'aria-hidden': 'true' },
      ...dishes.slice(0, SLIDES_PER_CARD).map((_, i) => h('i', { class: i === 0 ? 'is-on' : '' }))
    );

    const tab = h(
      'button',
      {
        class: 'atcat__tab',
        type: 'button',
        'data-act': 'category',
        'data-kind': kind,
        'data-id': meta.id,
        'aria-label': `进入${name}`,
        title: `${name} · ${dishes.length} 道`,
      },
      h('span', { class: 'atcat__tab-t', text: name })
    );

    const media = h(
      'button',
      {
        class: 'atcat__media',
        type: 'button',
        'data-act': 'dish',
        'data-kind': kind,
        'data-id': meta.id,
        'data-dish': first.id,
        'aria-label': `查看${first.name}详情`,
      },
      ...slides,
      dots
    );

    const caption = h('span', { class: 'atcat__dish', text: first.name });

    const el = h(
      'article',
      {
        class: 'atcat',
        'data-kind': kind,
        'data-id': meta.id,
        'data-dish': first.id,
        style: `--accent:${accentOf(kind, meta.id)}`,
      },
      h(
        'span',
        { class: 'atcat__shape' },
        tab,
        h(
          'span',
          { class: 'atcat__box' },
          media,
          h('span', { class: 'atcat__meta' }, caption, h('span', { class: 'atcat__count', text: `${dishes.length} 道` }))
        )
      )
    );

    /* 卡片自己的轮播：节奏带固定偏移，16 张不会同时换图 */
    const carousel = {
      el,
      order: dishes.slice(0, SLIDES_PER_CARD),
      at: 0,
      /* 首轮错开：16 张不会在同一帧一起换图 */
      nextAt: performance.now() + 900 + index * 340 + (kind === 'taste' ? 180 : 0),
      dwell: 3600 + (index % 5) * 460 + (kind === 'taste' ? 220 : 0),
      hover: false,
      show(i) {
        const n = slides.length;
        const next = ((i % n) + n) % n;
        if (next === this.at || n < 2) return;
        slides[this.at]?.classList.remove('is-on');
        slides[next].classList.add('is-on');
        dots.children[this.at]?.classList.remove('is-on');
        dots.children[next]?.classList.add('is-on');
        this.at = next;
        const d = this.order[next];
        if (!d) return;
        media.dataset.dish = d.id;
        el.dataset.dish = d.id;
        media.setAttribute('aria-label', `查看${d.name}详情`);
        caption.textContent = d.name;
      },
      everTicked: false,
      tick(now) {
        if (this.hover) return;
        this.everTicked = true;
        if (now < this.nextAt) return;
        this.nextAt = now + this.dwell;
        this.show(this.at + 1);
      },
      resetClock(ms = 900) {
        this.nextAt = performance.now() + ms;
      },
    };
    el.addEventListener('pointerenter', () => {
      carousel.hover = true;
    });
    el.addEventListener('pointerleave', () => {
      carousel.hover = false;
      carousel.resetClock();
    });
    return { el, carousel };
  }

  /* ---------- 分类卡片页（一页 8 张） ---------- */
  function buildBoard(side) {
    const cfg = SIDES[side];
    const list = cfg.list();
    const carousels = [];
    const grid = h('div', { class: `atlas-grid atlas-grid--${side}` });
    list.forEach((meta, i) => {
      const built = buildCard(cfg.kind, meta, i);
      if (!built) return;
      carousels.push(built.carousel);
      grid.append(built.el);
    });

    const head = h(
      'header',
      { class: 'atlas-head' },
      h('p', { class: 'atlas-head__kicker', text: cfg.kicker }),
      h('h2', { class: 'atlas-head__title', text: cfg.title }),
      h('span', { class: 'atlas-head__note', text: cfg.note }),
      h('span', { class: 'atlas-head__count', text: `${list.length} 类 · ${DISHES.length} 道` })
    );

    return { board: h('section', { class: 'atlas-board', 'data-side': side }, head, grid), carousels };
  }

  /* ---------- 分类页：左 = 分类封面，右 = 菜品列表 ---------- */
  function categoryCover(kind, id) {
    const meta = metaOf(kind, id);
    const dishes = dishesOf(kind, id);
    const isCuisine = kind === 'cuisine';
    const strip = dishes.slice(0, 3).map((d) =>
      h(
        'button',
        {
          class: 'atlas-cover__thumb',
          type: 'button',
          'data-act': 'dish',
          'data-dish': d.id,
          'aria-label': `查看${d.name}`,
        },
        guardImage(h('img', { src: d.image, alt: d.alt || d.name, loading: 'lazy', decoding: 'async' }), d.name, '图片暂不可用')
      )
    );

    // 代表菜索引：把剩余纸面占满，避免大片空白
    const picks = h(
      'ol',
      { class: 'atlas-cover__picks' },
      ...dishes.slice(0, 6).map((d, i) =>
        h(
          'li',
          { class: 'atlas-cover__pick' },
          h('em', { text: String(i + 1).padStart(2, '0') }),
          h('b', { text: d.name }),
          h('span', { text: d.signature || (isCuisine ? TASTE_BY_ID[(d.tastes || [])[0]]?.name : CUISINE_BY_ID[d.cuisine]?.name) || '' })
        )
      )
    );

    const tastes = [...new Set(dishes.flatMap((d) => (d.tastes || []).map((t) => TASTE_BY_ID[t]?.name).filter(Boolean)))];
    const cuisines = [...new Set(dishes.map((d) => CUISINE_BY_ID[d.cuisine]?.name).filter(Boolean))];

    return h(
      'div',
      { class: 'atlas-cover', style: `--accent:${accentOf(kind, id)}` },
      h(
        'button',
        { class: 'atlas-back', type: 'button', 'data-act': 'board' },
        h('span', { class: 'atlas-back__mark', 'aria-hidden': 'true' }),
        '返回图鉴'
      ),
      h('p', { class: 'atlas-cover__kicker', text: isCuisine ? 'CUISINE · 菜系' : 'FLAVOUR · 口味' }),
      h('h2', { class: 'atlas-cover__title', text: meta.name }),
      h('p', { class: 'atlas-cover__en', text: meta.en || '' }),
      h('p', { class: 'atlas-cover__line', text: meta.tagline || '' }),
      h('p', { class: 'atlas-cover__desc', text: meta.desc || '' }),
      h(
        'dl',
        { class: 'atlas-cover__facts' },
        h(
          'div',
          {},
          h('dt', { text: isCuisine ? '地域' : '味觉' }),
          h('dd', { text: (isCuisine ? meta.region : meta.tagline) || '—' })
        ),
        h('div', {}, h('dt', { text: '菜品' }), h('dd', { text: `${dishes.length} 道` })),
        h(
          'div',
          {},
          h('dt', { text: isCuisine ? '常见味型' : '涉及菜系' }),
          h('dd', { text: (isCuisine ? tastes : cuisines).slice(0, 3).join(' · ') || '—' })
        )
      ),
      picks,
      strip.length ? h('div', { class: 'atlas-cover__strip' }, ...strip) : null,
      h('p', { class: 'atlas-cover__hint', text: '点右侧图片 · 在书页内展开详情' })
    );
  }

  function categoryList(kind, id) {
    const meta = metaOf(kind, id);
    const dishes = dishesOf(kind, id);
    const rows = dishes.map((d) =>
      h(
        'article',
        { class: 'atlas-row', 'data-dish': d.id },
        h(
          'button',
          {
            class: 'atlas-row__thumb',
            type: 'button',
            'data-act': 'dish',
            'data-dish': d.id,
            'aria-label': `查看${d.name}详情`,
          },
          guardImage(h('img', { src: d.image, alt: d.alt || d.name, loading: 'lazy', decoding: 'async' }), d.name, '图片暂不可用')
        ),
        h(
          'button',
          { class: 'atlas-row__body', type: 'button', 'data-act': 'dish', 'data-dish': d.id },
          h('span', { class: 'atlas-row__name', text: d.name }),
          h(
            'span',
            { class: 'atlas-row__tags' },
            h('em', { text: CUISINE_BY_ID[d.cuisine]?.name || '' }),
            (d.tastes || [])[0] ? h('em', { class: 'is-soft', text: TASTE_BY_ID[d.tastes[0]]?.name || '' }) : null
          ),
          h('span', { class: 'atlas-row__line', text: d.oneLiner || d.intro || '' })
        ),
        h('span', { class: 'atlas-row__go', 'aria-hidden': 'true', text: '›' })
      )
    );

    return h(
      'div',
      { class: 'atlas-catlist' },
      h(
        'header',
        { class: 'atlas-catlist__head' },
        h('h3', { class: 'atlas-catlist__title', text: `${meta.name} · ${dishes.length} 道` }),
        h('span', { class: 'atlas-catlist__hint', text: '点图片 · 详情在书页内展开' })
      ),
      h('div', { class: 'atlas-catlist__scroll' }, ...rows)
    );
  }

/* ---------- 页内详情：共享的四边扩散覆盖层（book/overlay.js） ---------- */
function openDetail(pageEl, { dishId, origin }) {
  return openDishOverlay(pageEl, {
    dishId,
    origin,
    backLabel: '返回图鉴',
    accent: '#b0794a',
    onChange: () => syncLive(),
  });
}

function closeAllDetails() {
  closeAllOverlays({ instant: true });
}

  /* ---------- 分类视图切换（不翻页、不重建卡片） ---------- */
  function paintCategory() {
    const on = state.view === 'category';
    for (const [side, page] of pages) {
      page.el.dataset.view = on ? 'category' : 'board';
      page.board.hidden = on;
      page.cat.hidden = !on;
      if (!on) continue;
      const key = `${state.kind}:${state.id}:${side}`;
      let node = listCache.get(key);
      if (!node) {
        node = side === 'left' ? categoryCover(state.kind, state.id) : categoryList(state.kind, state.id);
        listCache.set(key, node);
      }
      if (!page.cat.contains(node)) {
        clear(page.cat);
        page.cat.append(node);
      }
    }
    syncLive();
  }

  function showCategory(kind, id) {
    if (!metaOf(kind, id)) return;
    closeAllDetails();
    state.view = 'category';
    state.kind = kind;
    state.id = id;
    paintCategory();
  }

  function showBoard() {
    closeAllDetails();
    state.view = 'board';
    state.kind = '';
    state.id = '';
    paintCategory();
  }

  /* ---------- 页面创建 ---------- */
  function page(idx, side) {
    const key = side === 'right' || idx % 2 === 1 ? 'right' : 'left';
    const cached = pages.get(key);
    if (cached) return cached.el;

    const built = buildBoard(key);
    const cat = h('section', { class: 'atlas-cat', hidden: true });
    const el = h('div', { class: `atlas-page atlas-page--${key}`, 'data-side': key, 'data-view': 'board' }, built.board, cat);

    pages.set(key, { el, board: built.board, cat, carousels: built.carousels });
    syncLive();

    // 事件全部走委托：卡片很多，逐张绑会拖慢首次开书
    el.addEventListener('click', (e) => {
      const act = e.target.closest('[data-act]');
      if (!act) return;
      const action = act.dataset.act;
      if (action === 'category') {
        e.preventDefault();
        showCategory(act.dataset.kind, act.dataset.id);
        return;
      }
      if (action === 'board') {
        e.preventDefault();
        showBoard();
        return;
      }
      if (action === 'dish') {
        e.preventDefault();
        const dishId = act.closest('[data-dish]')?.dataset.dish || act.dataset.dish;
        const origin = act.matches('img') ? act : act.querySelector('img') || act;
        openDetail(el, { dishId, origin });
      }
    });

    if (state.view === 'category') paintCategory();
    return el;
  }

  /* ---------- 分类视图里 Esc 只退回图鉴（详情的键盘隔离在 overlay.js 里） ---------- */
  document.addEventListener(
    'keydown',
    (e) => {
      if (e.key !== 'Escape' || state.view !== 'category' || overlayCount()) return;
      e.preventDefault();
      e.stopPropagation();
      showBoard();
    },
    true
  );

  return {
    page,
    pageCount: () => 2,
    spreadCount: () => 1,
    reset() {
      listCache.clear();
    },
    /** 图鉴现在是固定的两页十六分类，不再有菜名搜索筛选 */
    get filterLabel() {
      return '十六分类';
    },
    /**
     * 收起所有页内详情（立即，不做反向动画）：
     * 离开图鉴章节、合书、翻页前由书页模块调用，避免局部状态悬挂在别处。
     */
    closeAll() {
      closeAllDetails();
    },
    get expanded() {
      return overlayCount() > 0;
    },
    /* 供验收 / 诊断 */
    get state() {
      return { ...state };
    },
    get carousels() {
      return [...pages.values()].flatMap((p) => p.carousels);
    },
  };
}