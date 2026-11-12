/**
 * 菜品详情的「另一半页」视频面板
 * ------------------------------------------------------------
 * 不再是独立视频章节，也没有全站视频页：
 *   · 菜品详情留在原书页不动；
 *   · 点「做菜视频」后，面板以 absolute inset:0 铺在「详情所在页的另一半」；
 *   · 桌面 / 平板从书脊向另一侧展开，手机单页整页浮起；
 *   · 收起只摘掉这一层 DOM，下面的书页、滚动位置、筛选状态原样还在。
 *
 * 数据只来自 /api/videos/dish（服务端先做美食过滤，再做「当前菜品」强相关过滤）。
 * 不伪造视频、不把同类菜系结果当成本菜；搜索更多用 page + 已展示 id 去重。
 *
 * 与聊天面板的互斥由 book/index.js 统一处理：
 * 开视频 → 收起聊天；开聊天 → 收起视频。
 */
import { h, clear } from '../lib/dom.js';
import { api } from '../lib/api.js';
import { CUISINE_BY_ID, TASTE_BY_ID } from '../data/cuisines.js';

const CLOSE_MS = 280;
const MAX_CACHED = 4;
const PAGE_SIZE = 9;
const MAX_PAGE = 5;
const STALE_MS = 30 * 60 * 1000;

const PLATFORM_LABEL = { bilibili: 'B 站', douyin: '抖音', xiaohongshu: '小红书', xigua: '西瓜' };
const PHASE = {
  IDLE: 'idle',
  LOADING: 'loading',
  SUCCESS: 'success',
  EMPTY: 'empty',
  ERROR: 'error',
  MORE_LOADING: 'more-loading',
  MORE_ERROR: 'more-error',
};

const CACHE = new Map();
let current = null;
let opener = null;
let openWidth = 0;
let resizeTimer = 0;

function fmtDuration(sec) {
  const n = Math.round(Number(sec) || 0);
  if (!n) return '';
  return `${Math.floor(n / 60)}:${String(n % 60).padStart(2, '0')}`;
}

function cleanDescription(value) {
  const text = String(value || '')
    .replace(/https?:\/\/\S+/gi, '')
    .replace(/\s+/g, ' ')
    .trim();
  if (text.length < 2 || !/[A-Za-z0-9\u4e00-\u9fa5]/.test(text)) return '';
  return text;
}

function dishSubtitle(dish) {
  const cuisine = CUISINE_BY_ID[dish?.cuisine]?.name || '';
  const flavors = (dish?.tastes || [])
    .map((id) => TASTE_BY_ID[id]?.name)
    .filter(Boolean)
    .slice(0, 2)
    .join(' / ');
  return [cuisine, flavors].filter(Boolean).join(' · ');
}

function cardView(item) {
  const cover = item.coverUrl
    ? h('img', {
      src: item.coverUrl,
      alt: '',
      loading: 'lazy',
      decoding: 'async',
      referrerpolicy: 'no-referrer',
      onerror: (e) => {
        const box = e.currentTarget?.parentElement;
        e.currentTarget?.remove();
        box?.classList.add('is-empty');
      },
    })
    : null;
  const tags = Array.isArray(item.tags) ? item.tags.slice(0, 2) : [];
  const description = cleanDescription(item.description);
  return h(
    'a',
    {
      class: 'dm-video__card',
      href: item.url,
      target: '_blank',
      rel: 'noopener noreferrer',
      'data-video-id': item.id,
      'data-video-url': item.url,
      title: item.title,
    },
    h(
      'div',
      { class: `dm-video__cover${cover ? '' : ' is-empty'}` },
      cover,
      item.relevance ? h('span', { class: 'dm-video__tag', text: item.relevance }) : null,
      item.duration ? h('span', { class: 'dm-video__dur', text: fmtDuration(item.duration) }) : null,
      h('span', { class: 'dm-video__play', 'aria-hidden': 'true', text: '▶' })
    ),
    h(
      'div',
      { class: 'dm-video__body' },
      h('h3', { class: 'dm-video__vtitle', text: item.title }),
      h(
        'p',
        { class: 'dm-video__source' },
        h('span', { text: PLATFORM_LABEL[item.platform] || '视频' }),
        item.author ? h('em', { text: ` · ${item.author}` }) : null
      ),
      description
        ? h('p', { class: 'dm-video__desc', text: description })
        : null,
      tags.length
        ? h('p', { class: 'dm-video__tags' }, ...tags.map((tag) => h('span', { text: tag })))
        : null
    )
  );
}

function buildEntry(dish) {
  const key = String(dish.id);
  const status = h('p', { class: 'dm-video__status', role: 'status', 'aria-live': 'polite' });
  const count = h('span', { class: 'dm-video__count' });
  const grid = h('div', { class: 'dm-video__grid' });
  const blank = h('div', { class: 'dm-video__blank', hidden: true });
  const note = h('p', { class: 'dm-video__note' });
  const more = h(
    'button',
    { class: 'dm-video__more', type: 'button' },
    h('span', { class: 'dm-video__more-txt', text: '搜索更多' })
  );
  const foot = h('div', { class: 'dm-video__foot' }, more, note);
  const scroll = h(
    'div',
    { class: 'dm-video__scroll' },
    h('div', { class: 'dm-video__bar' }, status, count),
    grid,
    blank,
    foot
  );
  const subtitle = dishSubtitle(dish);
  const head = h(
    'header',
    { class: 'dm-video__head' },
    h(
      'div',
      { class: 'dm-video__headrow' },
      h(
        'div',
        { class: 'dm-video__heading' },
        h('p', { class: 'dm-video__kicker', text: '影像 · 菜品关联视频' }),
        h(
          'h2',
          { class: 'dm-video__title' },
          h('span', { class: 'dm-video__dish', text: dish.name }),
          h('em', { text: '· 相关做菜视频' })
        ),
        dish.nameEn ? h('p', { class: 'dm-video__en', text: dish.nameEn }) : null,
        subtitle ? h('p', { class: 'dm-video__meta', text: subtitle }) : null
      ),
      h(
        'button',
        {
          class: 'dm-video__close',
          type: 'button',
          'aria-label': `收起视频，返回${dish.name}详情`,
        },
        h('span', { class: 'dm-video__close-ico', 'aria-hidden': 'true', text: '⟩' }),
        h('span', { text: '收起视频' })
      )
    ),
    h('p', {
      class: 'dm-video__lead',
      text: `为你整理与${dish.name}相关的制作教程、烹饪技巧和美食内容。`,
    })
  );

  const holder = h(
    'div',
    {
      class: 'dm-video is-loading',
      role: 'region',
      'aria-label': `${dish.name} 的相关做菜视频`,
    },
    h('div', { class: 'dm-video__inner' }, head, scroll)
  );
  holder.dataset.dish = key;
  holder.dataset.phase = PHASE.IDLE;

  const entry = {
    key,
    dish,
    holder,
    status,
    count,
    grid,
    blank,
    note,
    more,
    scroll,
    closeTimer: 0,
    state: {
      phase: PHASE.IDLE,
      results: [],
      seen: new Set(),
      page: 0,
      nextPage: 1,
      exhausted: false,
      loading: false,
      error: '',
      token: 0,
      loadedAt: 0,
    },
  };

  holder.querySelector('.dm-video__close').addEventListener('click', (e) => {
    e.preventDefault();
    e.stopPropagation();
    closeDishVideo('button');
  });
  more.addEventListener('click', () => {
    if (entry.state.loading) return;
    const page = entry.state.page === 0 ? 1 : entry.state.nextPage;
    if (page > MAX_PAGE) return;
    void load(entry, page);
  });
  blank.addEventListener('click', (e) => {
    const btn = e.target.closest?.('.dm-video__retry');
    if (!btn || entry.state.loading) return;
    e.preventDefault();
    void load(entry, 1, { reset: true });
  });

  CACHE.set(key, entry);
  return entry;
}

function setBlank(entry, title, sub, retryLabel = '') {
  const nodes = [
    h('p', { class: 'dm-video__blank-title', text: title }),
    sub ? h('p', { class: 'dm-video__blank-sub', text: sub }) : null,
  ];
  if (retryLabel) {
    nodes.push(h('button', { class: 'dm-video__retry', type: 'button' }, retryLabel));
  }
  entry.blank.replaceChildren(...nodes.filter(Boolean));
}

function paint(entry) {
  const s = entry.state;
  const dish = entry.dish;
  entry.holder.dataset.phase = s.phase;
  entry.count.textContent = s.results.length ? `${s.results.length} 条` : '';
  entry.holder.classList.toggle('is-loading', s.phase === PHASE.LOADING && !s.results.length);
  entry.holder.classList.toggle('is-more-loading', s.phase === PHASE.MORE_LOADING);

  switch (s.phase) {
    case PHASE.IDLE:
      entry.status.textContent = `正在整理「${dish.name}」的视频…`;
      break;
    case PHASE.LOADING:
      entry.status.textContent = `正在寻找「${dish.name}」的相关视频…`;
      break;
    case PHASE.MORE_LOADING:
      entry.status.textContent = '正在寻找更多视频…';
      break;
    case PHASE.SUCCESS:
      entry.status.textContent = `已筛选为「${dish.name}」直接相关的视频 · 来源：哔哩哔哩`;
      break;
    case PHASE.EMPTY:
      entry.status.textContent = `暂时没有找到与「${dish.name}」直接相关的视频`;
      break;
    case PHASE.ERROR:
      entry.status.textContent = s.error || '视频服务暂时不可用';
      break;
    case PHASE.MORE_ERROR:
      entry.status.textContent = s.error || '加载更多失败，请重试';
      break;
    default:
      entry.status.textContent = '';
  }

  const isEmpty = !s.results.length;
  entry.blank.hidden = !isEmpty || s.phase === PHASE.LOADING || s.phase === PHASE.MORE_LOADING;
  entry.grid.hidden = isEmpty && s.phase !== PHASE.IDLE;

  if (isEmpty) {
    if (s.phase === PHASE.EMPTY) {
      setBlank(
        entry,
        `暂时没有找到与「${dish.name}」相关的视频`,
        '没有用同类菜系或无关视频填充。可以稍后再试，或从其他菜品进入。'
      );
    } else if (s.phase === PHASE.ERROR) {
      setBlank(entry, '视频暂时打不开', s.error || '视频平台暂时不可用，请稍后重试。', '重新搜索');
    } else if (s.phase === PHASE.LOADING || s.phase === PHASE.IDLE) {
      setBlank(entry, `正在寻找「${dish.name}」的相关视频…`, '只保留与这道菜直接相关的真实视频。');
    }
  } else {
    setBlank(entry, '', '');
  }

  const canMore = !s.exhausted && s.results.length > 0 && s.nextPage <= MAX_PAGE;
  entry.more.hidden = !(canMore || s.phase === PHASE.MORE_ERROR);
  entry.more.disabled = s.loading;
  entry.more.querySelector('.dm-video__more-txt').textContent =
    s.phase === PHASE.MORE_LOADING ? '正在寻找更多视频…' : s.phase === PHASE.MORE_ERROR ? '重试加载' : '搜索更多';
  entry.note.textContent = s.exhausted && s.results.length
    ? '暂时没有更多与这道菜相关的视频了。'
    : s.phase === PHASE.MORE_ERROR
      ? '加载失败，点击「重试加载」再试一次。'
      : s.results.length
        ? '内容来自哔哩哔哩公开检索，已按菜品名称筛选。'
        : '';
}

function scrollToNew(entry, firstId) {
  if (!firstId) return;
  const card = entry.grid.querySelector(`[data-video-id="${CSS.escape(firstId)}"]`);
  if (!card) return;
  const top = card.getBoundingClientRect().top - entry.scroll.getBoundingClientRect().top + entry.scroll.scrollTop - 10;
  entry.scroll.scrollTo({ top: Math.max(0, top), behavior: 'smooth' });
}

async function load(entry, page, { reset = false } = {}) {
  if (!entry || entry.state.loading) return;
  const s = entry.state;
  const token = ++s.token;
  s.loading = true;
  s.error = '';

  if (reset) {
    s.results = [];
    s.seen.clear();
    s.page = 0;
    s.nextPage = 1;
    s.exhausted = false;
    clear(entry.grid);
  }

  s.phase = page > 1 ? PHASE.MORE_LOADING : PHASE.LOADING;
  paint(entry);

  try {
    const bundle = await api.dishVideos({
      dishId: entry.dish.id,
      dishName: entry.dish.name,
      englishName: entry.dish.nameEn,
      aliases: entry.dish.aliases,
      cuisineType: entry.dish.cuisine,
      flavorType: entry.dish.tastes,
      mainIngredients: entry.dish.ingredients,
      cookingMethods: entry.dish.techniques,
      limit: PAGE_SIZE,
      page,
      exclude: s.results.map((item) => item.id).slice(0, 60),
    });
    if (token !== s.token) return;

    const bili = Array.isArray(bundle?.providers)
      ? bundle.providers.find((p) => p.platform === 'bilibili')
      : null;
    if (bundle?.reason === 'provider_error' || bili?.status === 'error') {
      throw new Error(bundle?.note || '视频平台暂时不可用，请稍后重试。');
    }

    const raw = Array.isArray(bundle?.results) ? bundle.results : [];
    if (page === 1) {
      s.results = [];
      s.seen.clear();
      clear(entry.grid);
    }

    const fresh = [];
    for (const item of raw) {
      if (!item?.id || !item?.url) continue;
      const id = String(item.id);
      const url = String(item.url);
      if (s.seen.has(id) || s.seen.has(url)) continue;
      s.seen.add(id);
      s.seen.add(url);
      s.results.push(item);
      fresh.push(item);
    }
    for (const item of fresh) entry.grid.append(cardView(item));

    s.page = page;
    s.nextPage = page + 1;
    if (page >= MAX_PAGE || (page > 1 && !fresh.length)) s.exhausted = true;
    s.loadedAt = Date.now();
    s.phase = s.results.length ? PHASE.SUCCESS : PHASE.EMPTY;
    paint(entry);
    if (page > 1 && fresh.length) scrollToNew(entry, fresh[0].id);
  } catch (error) {
    if (token !== s.token) return;
    const raw = String(error?.message || '视频服务暂时不可用').trim();
    s.error = /failed to fetch|networkerror|load failed|network request failed/i.test(raw)
      ? '视频服务暂时不可用，请检查网络后重试。'
      : raw.slice(0, 80);
    s.phase = page > 1 ? PHASE.MORE_ERROR : PHASE.ERROR;
    paint(entry);
  } finally {
    if (token === s.token) {
      s.loading = false;
      paint(entry);
    }
  }
}

function restoreScroll(scroller, top) {
  if (!scroller?.isConnected || !top) return;
  requestAnimationFrame(() => {
    if (scroller.isConnected) scroller.scrollTop = top;
  });
}

function trimCache(keepKey) {
  while (CACHE.size > MAX_CACHED) {
    const oldest = [...CACHE.keys()].find((key) => key !== keepKey && key !== current?.key);
    if (!oldest) break;
    const entry = CACHE.get(oldest);
    CACHE.delete(oldest);
    entry?.holder.remove();
  }
}

export function setDishVideoOpener(fn) {
  opener = typeof fn === 'function' ? fn : null;
}

export const hasOpenDishVideo = () => Boolean(current);
export const openDishVideoDishId = () => current?.dish?.id ?? null;

/** 菜品详情按钮入口；画册没接管时返回 false，由调用方决定是否降级。 */
export function openDishVideos(dish, originEl) {
  if (!opener || !dish?.id) return false;
  return opener(dish, originEl) === true;
}

/**
 * 把视频面板挂到 page 这张纸上。
 * @param {{dish:object, page:HTMLElement, side:'left'|'right'|'full', single?:boolean}} opts
 */
export async function openDishVideoPanel({ dish, page, side = 'right', single = false }) {
  if (!dish?.id || !page) return null;
  const key = String(dish.id);

  if (current && current.key !== key) closeDishVideo('switch', { instant: true });
  let entry = CACHE.get(key);
  if (!entry) entry = buildEntry(dish);
  else entry.dish = { ...entry.dish, ...dish };

  if (entry.closeTimer) {
    window.clearTimeout(entry.closeTimer);
    entry.closeTimer = 0;
  }
  if (entry.holder.parentNode) entry.holder.remove();

  entry.holder.className = `dm-video dm-video--${single ? 'full' : side}`;
  entry.holder.dataset.dish = key;
  entry.holder.setAttribute('aria-label', `${dish.name} 的相关做菜视频`);

  const scroller = page.classList?.contains('bk-pageface') ? page : page.closest?.('.bk-pageface');
  const prevScroll = scroller?.scrollTop || 0;
  if (scroller && prevScroll > 0) scroller.scrollTop = 0;

  page.append(entry.holder);
  openWidth = window.innerWidth;
  current = {
    key,
    dish: entry.dish,
    holder: entry.holder,
    entry,
    page,
    side: single ? 'full' : side,
    single,
    scroller,
    prevScroll,
  };

  paint(entry);
  requestAnimationFrame(() => {
    if (current?.entry === entry) entry.holder.classList.add('is-open');
  });

  if (!entry.state.page) {
    void load(entry, 1);
  } else if (!entry.state.loading && Date.now() - entry.state.loadedAt > STALE_MS) {
    void load(entry, 1, { reset: true });
  }

  trimCache(key);
  return entry;
}

/** 收起：只摘掉视频层，下面的详情页、滚动位置、筛选状态都不动。 */
export function closeDishVideo(reason = 'api', { instant = false } = {}) {
  const cur = current;
  if (!cur) return false;
  current = null;
  const holder = cur.holder;
  holder.classList.remove('is-open');
  holder.classList.add('is-closing');

  const entry = CACHE.get(cur.key);
  const done = () => {
    if (entry) entry.closeTimer = 0;
    if (holder.parentNode) holder.remove();
    restoreScroll(cur.scroller, cur.prevScroll);
  };
  if (instant) {
    done();
  } else {
    if (entry?.closeTimer) window.clearTimeout(entry.closeTimer);
    if (entry) entry.closeTimer = window.setTimeout(done, CLOSE_MS);
    else window.setTimeout(done, CLOSE_MS);
  }

  document.dispatchEvent(
    new CustomEvent('foodsoul:dish-video-close', {
      detail: { dishId: cur.dish.id, reason },
    })
  );
  return true;
}

/* 详情浮层收起 = 它的视频另一半也该收起；换菜/翻页同理。 */
document.addEventListener('foodsoul:detail-close', (event) => {
  const id = event?.detail?.dish;
  if (!id || current?.dish.id === id) closeDishVideo('detail');
});

/* 窗口从双页切到单页（或反过来）时，旧页会被重排；直接收起，避免留下悬空面板。 */
window.addEventListener('resize', () => {
  if (!current) return;
  window.clearTimeout(resizeTimer);
  resizeTimer = window.setTimeout(() => {
    if (current && Math.abs(window.innerWidth - openWidth) > 40) {
      closeDishVideo('resize', { instant: true });
    }
  }, 180);
});

/* 验收 / 诊断用（只读） */
export const dishVideoState = () => ({
  open: Boolean(current),
  dishId: current?.dish?.id ?? null,
  name: current?.dish?.name ?? null,
  side: current?.side ?? null,
  single: current?.single ?? false,
  phase: current?.entry?.state.phase ?? null,
  page: current?.entry?.state.page ?? 0,
  cards: current?.holder?.querySelectorAll('.dm-video__card').length ?? 0,
  hasMore: Boolean(current?.entry?.state.results.length && !current.entry.state.exhausted),
  hasSearchInput: Boolean(current?.holder?.querySelector('input[type="search"]')),
  hasCloseButton: Boolean(current?.holder?.querySelector('.dm-video__close')),
});